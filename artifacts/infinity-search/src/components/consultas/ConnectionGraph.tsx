import { useState, useRef, useCallback, useEffect, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type NodeType = "person" | "relative" | "phone" | "address" | "company";

interface GraphNode {
  id: string; type: NodeType; label: string; sublabel?: string;
  photo?: string; cpf?: string;
  x: number; y: number; vx: number; vy: number; fx?: number; fy?: number;
  ring: number; ringIdx: number; ringTotal: number;
}

interface GraphEdge {
  src: string; dst: string; label?: string;
}

type Identity    = { nome: string; cpf: string };
type PhoneEntry  = { ddd: string; numero: string; tipo: string; classificacao: string };
type Address     = { logradouro: string; cidade: string; uf: string };
type Employment  = { empresa: string; cnpj: string };
type Relative    = { cpf: string; nome: string; relacao: string; sexo: string };

export interface GraphProps {
  identity: Identity;
  phones: PhoneEntry[];
  addresses: Address[];
  employments: Employment[];
  relatives: Relative[];
  mainPhoto: string | null;
  relPhotos: Record<string, string>;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const RINGS = [0, 100, 160, 230, 295];
const NODE_R: Record<NodeType, number> = { person: 36, relative: 22, phone: 18, address: 18, company: 18 };
const NODE_COLOR: Record<NodeType, string> = {
  person:   "#38bdf8",
  relative: "#f59e0b",
  phone:    "#a78bfa",
  address:  "#34d399",
  company:  "#fb923c",
};
const EDGE_COLOR: Record<NodeType, string> = {
  person:   "rgba(56,189,248,0.4)",
  relative: "rgba(245,158,11,0.3)",
  phone:    "rgba(167,139,250,0.35)",
  address:  "rgba(52,211,153,0.3)",
  company:  "rgba(251,146,60,0.3)",
};

// ─── Build graph data ─────────────────────────────────────────────────────────
function buildGraph(p: GraphProps): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // ring-1 groups
  const ring1: { id: string; type: NodeType; label: string; sublabel?: string; photo?: string; cpf?: string }[] = [];
  const ring2: typeof ring1 = [];
  const ring3: typeof ring1 = [];
  const ring4: typeof ring1 = [];

  // Classify relatives
  for (const r of p.relatives) {
    const cat = r.relacao.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const isPrimary = /pai|mae|conjuge|esposa|esposo/.test(cat);
    const isChild   = /filho|filha/.test(cat);
    const isSibling = /irm/.test(cat);
    const target    = isPrimary ? ring1 : (isChild || isSibling) ? ring2 : ring4;
    const id = `rel-${r.cpf || r.nome}`;
    target.push({ id, type: "relative", label: r.nome.split(" ").slice(0,2).join(" "), sublabel: r.relacao, photo: r.cpf ? p.relPhotos[r.cpf] : undefined, cpf: r.cpf });
  }

  // Phones → ring3
  const seenPhone = new Set<string>();
  for (const ph of p.phones.slice(0, 12)) {
    const num = `${ph.ddd}${ph.numero}`;
    if (seenPhone.has(num)) continue; seenPhone.add(num);
    ring3.push({ id: `phone-${num}`, type: "phone", label: `(${ph.ddd}) ${ph.numero.slice(0,5)}-${ph.numero.slice(5)}`, sublabel: ph.tipo || ph.classificacao || "Telefone" });
  }

  // Addresses → ring3
  const seenAddr = new Set<string>();
  for (const a of p.addresses.slice(0, 10)) {
    const key = `${a.cidade}-${a.logradouro}`;
    if (seenAddr.has(key)) continue; seenAddr.add(key);
    ring3.push({ id: `addr-${key}`, type: "address", label: a.cidade || a.logradouro, sublabel: a.uf });
  }

  // Companies → ring4
  const seenComp = new Set<string>();
  for (const e of p.employments.slice(0, 8)) {
    const key = e.cnpj || e.empresa;
    if (!e.empresa || seenComp.has(key)) continue; seenComp.add(key);
    ring4.push({ id: `co-${key}`, type: "company", label: e.empresa.slice(0,20), sublabel: "Empregadora" });
  }

  // Center node
  const mainId = `person-${p.identity.cpf}`;
  nodes.push({ id: mainId, type: "person", label: p.identity.nome.split(" ")[0] || "Titular",
    sublabel: p.identity.cpf, photo: p.mainPhoto ?? undefined,
    x: 0, y: 0, vx: 0, vy: 0, ring: 0, ringIdx: 0, ringTotal: 1 });

  // Place ring nodes
  const groups = [ring1, ring2, ring3, ring4];
  for (let ri = 0; ri < groups.length; ri++) {
    const grp = groups[ri];
    const r = RINGS[ri + 1];
    grp.forEach((n, idx) => {
      const angle = (2 * Math.PI * idx) / (grp.length || 1) - Math.PI / 2;
      nodes.push({ ...n, x: r * Math.cos(angle), y: r * Math.sin(angle), vx: 0, vy: 0, ring: ri + 1, ringIdx: idx, ringTotal: grp.length });
      edges.push({ src: mainId, dst: n.id, label: n.sublabel });
    });
  }

  return { nodes, edges };
}

// ─── Force simulation tick ────────────────────────────────────────────────────
function tick(nodes: GraphNode[]): GraphNode[] {
  const damping = 0.85;
  const repulse = 900;
  const ringStr = 0.08;

  const next = nodes.map(n => ({ ...n }));
  // Repulsion between same-ring nodes
  for (let i = 0; i < next.length; i++) {
    for (let j = i + 1; j < next.length; j++) {
      if (next[i].ring !== next[j].ring) continue;
      const dx = next[j].x - next[i].x, dy = next[j].y - next[i].y;
      const d2 = Math.max(dx*dx + dy*dy, 1);
      const f  = repulse / d2;
      const ux = dx / Math.sqrt(d2), uy = dy / Math.sqrt(d2);
      next[i].vx -= ux * f; next[i].vy -= uy * f;
      next[j].vx += ux * f; next[j].vy += uy * f;
    }
  }
  // Ring spring: attract back to their ideal radius
  for (const n of next) {
    if (n.ring === 0 || n.fx !== undefined) continue;
    const ideal = RINGS[n.ring];
    const dist = Math.sqrt(n.x * n.x + n.y * n.y) || 1;
    const delta = dist - ideal;
    n.vx -= (n.x / dist) * delta * ringStr;
    n.vy -= (n.y / dist) * delta * ringStr;
  }
  // Integrate
  for (const n of next) {
    if (n.fx !== undefined) { n.x = n.fx; n.y = n.fy!; continue; }
    if (n.ring === 0) { n.x = 0; n.y = 0; continue; }
    n.vx *= damping; n.vy *= damping;
    n.x += n.vx; n.y += n.vy;
  }
  return next;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ConnectionGraph(props: GraphProps) {
  const initial = useMemo(() => buildGraph(props), []);
  const [nodes, setNodes] = useState<GraphNode[]>(initial.nodes);
  const { edges } = initial;
  const [selected, setSelected] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const svgRef   = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ nodeId: string | null; mx: number; my: number }>({ nodeId: null, mx: 0, my: 0 });
  const panning  = useRef<{ active: boolean; mx: number; my: number; tx: number; ty: number }>({ active: false, mx: 0, my: 0, tx: 0, ty: 0 });
  const animRef  = useRef<number>(0);
  const stableRef = useRef(0);

  // Run simulation for ~120 frames then stop
  useEffect(() => {
    let frame = 0;
    const run = () => {
      if (frame++ > 120) { cancelAnimationFrame(animRef.current); return; }
      setNodes(prev => tick(prev));
      animRef.current = requestAnimationFrame(run);
    };
    animRef.current = requestAnimationFrame(run);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const svgToWorld = useCallback((ex: number, ey: number): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    return [
      (ex - r.left - cx - transform.x) / transform.scale,
      (ey - r.top  - cy - transform.y) / transform.scale,
    ];
  }, [transform]);

  const onNodePointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const [wx, wy] = svgToWorld(e.clientX, e.clientY);
    dragging.current = { nodeId: id, mx: wx, my: wy };
    setNodes(prev => prev.map(n => n.id === id ? { ...n, fx: n.x, fy: n.y } : n));
    (e.target as SVGElement).setPointerCapture(e.pointerId);
  }, [svgToWorld]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current.nodeId) {
      const [wx, wy] = svgToWorld(e.clientX, e.clientY);
      const id = dragging.current.nodeId;
      setNodes(prev => prev.map(n => n.id === id ? { ...n, fx: wx, fy: wy, x: wx, y: wy } : n));
      stableRef.current = 0;
      cancelAnimationFrame(animRef.current);
      let frame = 0;
      const run = () => { if (frame++ > 80) return; setNodes(t => tick(t)); animRef.current = requestAnimationFrame(run); };
      animRef.current = requestAnimationFrame(run);
    } else if (panning.current.active) {
      const dx = e.clientX - panning.current.mx, dy = e.clientY - panning.current.my;
      setTransform(t => ({ ...t, x: panning.current.tx + dx, y: panning.current.ty + dy }));
    }
  }, [svgToWorld]);

  const onPointerUp = useCallback((_e: React.PointerEvent, id?: string) => {
    if (id && !dragging.current.nodeId) setSelected(s => s === id ? null : id);
    if (dragging.current.nodeId) {
      const nid = dragging.current.nodeId;
      setNodes(prev => prev.map(n => n.id === nid ? { ...n, fx: undefined, fy: undefined } : n));
    }
    dragging.current.nodeId = null;
    panning.current.active  = false;
  }, []);

  const onSvgPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as SVGElement).closest("[data-node]")) return;
    panning.current = { active: true, mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y };
  }, [transform]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    setTransform(t => ({ ...t, scale: Math.max(0.3, Math.min(3, t.scale * factor)) }));
  }, []);

  const nodeMap = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  const selNode = selected ? nodeMap[selected] : null;
  const connectedIds = selected ? new Set(edges.flatMap(e => e.src === selected ? [e.dst] : e.dst === selected ? [e.src] : [])) : null;
  const LEGEND = [
    { type: "person" as NodeType, label: "Titular" },
    { type: "relative" as NodeType, label: "Parente" },
    { type: "phone" as NodeType, label: "Telefone" },
    { type: "address" as NodeType, label: "Endereço" },
    { type: "company" as NodeType, label: "Empresa" },
  ];

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.25)" }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.3)" }}>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest font-bold text-white/40">Grafo de Conexões</span>
          <span className="text-[9px] text-white/20">{nodes.length - 1} nós · {edges.length} arestas</span>
        </div>
        <div className="flex items-center gap-2">
          {LEGEND.map(l => (
            <div key={l.type} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: NODE_COLOR[l.type] }} />
              <span className="text-[9px] text-white/30">{l.label}</span>
            </div>
          ))}
          <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
            className="ml-2 px-2 py-1 rounded-lg text-[9px] text-white/40 hover:text-white/70 transition-colors"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}>Reset</button>
        </div>
      </div>

      {/* SVG */}
      <div className="relative" style={{ height: 500 }}>
        <svg ref={svgRef} className="w-full h-full select-none" style={{ cursor: panning.current.active ? "grabbing" : "grab" }}
          onPointerDown={onSvgPointerDown} onPointerMove={onPointerMove}
          onPointerUp={e => onPointerUp(e)} onWheel={onWheel}>
          <defs>
            {nodes.filter(n => n.photo).map(n => (
              <clipPath key={`clip-${n.id}`} id={`clip-${n.id}`}>
                <circle cx="0" cy="0" r={NODE_R[n.type]} />
              </clipPath>
            ))}
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="glow-strong">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <g transform={`translate(${(svgRef.current?.clientWidth ?? 700) / 2 + transform.x} ${(svgRef.current?.clientHeight ?? 500) / 2 + transform.y}) scale(${transform.scale})`}>
            {/* Edges */}
            {edges.map(e => {
              const s = nodeMap[e.src], t = nodeMap[e.dst];
              if (!s || !t) return null;
              const isConn = !selected || e.src === selected || e.dst === selected;
              const color  = EDGE_COLOR[t.type] ?? "rgba(255,255,255,0.15)";
              const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2 - 20;
              return (
                <path key={e.src + e.dst}
                  d={`M ${s.x} ${s.y} Q ${mx} ${my} ${t.x} ${t.y}`}
                  fill="none" stroke={isConn ? color : "rgba(255,255,255,0.04)"}
                  strokeWidth={isConn ? 1.5 : 0.5}
                  style={{ transition: "stroke 0.3s, stroke-width 0.3s" }} />
              );
            })}

            {/* Nodes */}
            {nodes.map(n => {
              const r     = NODE_R[n.type];
              const color = NODE_COLOR[n.type];
              const isSel = n.id === selected;
              const isConn = connectedIds?.has(n.id) ?? false;
              const dim   = selected && !isSel && !isConn && n.id !== `person-${props.identity.cpf}`;
              return (
                <g key={n.id} data-node="1" transform={`translate(${n.x} ${n.y})`}
                  style={{ cursor: "pointer", opacity: dim ? 0.25 : 1, transition: "opacity 0.3s" }}
                  onPointerDown={e => onNodePointerDown(e, n.id)}
                  onPointerUp={e => { e.stopPropagation(); if (!dragging.current.nodeId || dragging.current.nodeId === n.id) setSelected(s => s === n.id ? null : n.id); dragging.current.nodeId = null; }}>

                  {/* Glow ring for selected */}
                  {isSel && <circle r={r + 8} fill="none" stroke={color} strokeWidth="2" opacity="0.35" filter="url(#glow)" />}

                  {/* Background circle */}
                  <circle r={r} fill={`rgba(9,9,15,0.95)`}
                    stroke={isSel ? color : isConn ? color : `${color}55`}
                    strokeWidth={isSel ? 2.5 : isConn ? 1.5 : 1} />

                  {/* Photo or colored fill */}
                  {n.photo ? (
                    <image href={n.photo} x={-r} y={-r} width={r*2} height={r*2}
                      clipPath={`url(#clip-${n.id})`} preserveAspectRatio="xMidYMid slice" />
                  ) : (
                    <circle r={r - 3} fill={`${color}18`} />
                  )}

                  {/* Type icon overlay for non-photo nodes */}
                  {!n.photo && (
                    <text textAnchor="middle" dominantBaseline="central" fontSize={r * 0.65}
                      fill={color} style={{ pointerEvents: "none", userSelect: "none" }}>
                      {n.type === "phone" ? "☎" : n.type === "address" ? "⌖" : n.type === "company" ? "⚑" : "◉"}
                    </text>
                  )}

                  {/* Label */}
                  <text y={r + 10} textAnchor="middle" fontSize="8.5" fill="rgba(255,255,255,0.75)"
                    fontWeight={isSel ? "700" : "500"} style={{ pointerEvents: "none", userSelect: "none" }}>
                    {n.label.length > 14 ? n.label.slice(0,13)+"…" : n.label}
                  </text>
                  {n.sublabel && (
                    <text y={r + 19} textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.3)"
                      style={{ pointerEvents: "none", userSelect: "none" }}>
                      {n.sublabel.length > 14 ? n.sublabel.slice(0,13)+"…" : n.sublabel}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Selected node detail panel */}
        {selNode && (
          <div className="absolute bottom-4 left-4 max-w-xs rounded-2xl px-4 py-3 text-sm"
            style={{ background: "rgba(9,9,15,0.92)", border: `1px solid ${NODE_COLOR[selNode.type]}55`, backdropFilter: "blur(12px)" }}>
            <div className="flex items-center gap-3 mb-2">
              {selNode.photo && <img src={selNode.photo} className="w-10 h-10 rounded-full object-cover" style={{ border: `2px solid ${NODE_COLOR[selNode.type]}` }} />}
              <div>
                <p className="text-white font-bold text-[13px] leading-tight">{selNode.label}</p>
                {selNode.sublabel && <p className="text-white/40 text-[10px]">{selNode.sublabel}</p>}
              </div>
            </div>
            {selNode.cpf && <p className="text-[10px]" style={{ color: NODE_COLOR[selNode.type] }}>CPF: {selNode.cpf}</p>}
            <p className="text-[9px] text-white/25 mt-1 uppercase tracking-widest">{selNode.type === "person" ? "Titular" : selNode.type === "relative" ? "Parente" : selNode.type === "phone" ? "Telefone" : selNode.type === "address" ? "Endereço" : "Empresa"}</p>
          </div>
        )}

        <div className="absolute bottom-4 right-4 text-[9px] text-white/15 font-mono">
          Arraste nós · scroll para zoom
        </div>
      </div>
    </div>
  );
}
