/**
 * CpfUnificadoPanel — consulta CPF unificada
 *
 * Fluxo:
 *  1. POST /api/infinity/consultas/cpf  { dados }          — Hydra API, loga histórico UMA vez
 *  2. POST /api/infinity/external/skylers { tipo:"cpfbasico", skipLog:true }  — enriquecimento Receita
 *     skipLog:true = não consome crédito separado (faz parte do pacote da consulta principal)
 *  3. Rotação de foto: /external/skylers { tipo:"fotonc"|..., skipLog:true } — sequencial, para no 1º hit
 *  4. Parentes: mini-foto por CPF extraído, skipLog:true
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Fingerprint, Camera, FileText, Loader2, AlertTriangle,
  User, MapPin, Phone, Mail, Briefcase, ChevronDown, ChevronUp,
  Copy, Check, RefreshCw, Users, Car, Heart, CreditCard, Shield,
  CheckCircle2, XCircle, Baby, CalendarDays,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────
type Status = "idle" | "loading" | "done" | "error";
interface Field   { key: string; value: string }
interface Section { name: string; items: string[] }

// ─── API ────────────────────────────────────────────────────────────────────

async function fetchHydraCpf(cpf: string, token: string) {
  try {
    const r = await fetch("/api/infinity/consultas/cpf", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ dados: cpf }),
    });
    const j = await r.json() as { success?: boolean; data?: { fields?: Field[]; sections?: Section[]; raw?: string }; error?: string | null };
    return { ok: !!j.success, fields: j.data?.fields ?? [], sections: j.data?.sections ?? [], raw: j.data?.raw ?? "", error: j.error ?? null };
  } catch { return { ok: false, fields: [], sections: [], raw: "", error: "Erro de conexão" }; }
}

// skipLog:true  → não consome crédito Skylers separado (enriquecimento = parte da consulta principal)
async function fetchSkylers(tipo: string, cpf: string, token: string, skipLog = true) {
  try {
    const r = await fetch("/api/infinity/external/skylers", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ tipo, dados: cpf, skipLog }),
    });
    const j = await r.json() as { success?: boolean; data?: { fields?: Field[]; sections?: Section[]; raw?: string }; error?: string };
    const rawFields = j.data?.fields ?? [];
    const fotoField = rawFields.find(f => f.key === "FOTO_URL" || f.key.toUpperCase() === "FOTO_URL");
    return {
      ok:       !!j.success,
      fields:   rawFields.filter(f => f.key !== "FOTO_URL" && f.key.toUpperCase() !== "FOTO_URL"),
      sections: j.data?.sections ?? [],
      imageUrl: fotoField?.value ?? null,
      raw:      j.data?.raw ?? "",
    };
  } catch { return { ok: false, fields: [], sections: [], imageUrl: null, raw: "" }; }
}

// ─── Merge helpers ──────────────────────────────────────────────────────────
function mergeFields(basico: Field[], hydra: Field[]): Field[] {
  const seen = new Set<string>();
  const out: Field[] = [];
  for (const f of [...basico, ...hydra]) {
    const k = f.key.toUpperCase().trim();
    if (!seen.has(k)) { seen.add(k); out.push(f); }
  }
  return out;
}
function mergeSections(a: Section[], b: Section[]): Section[] {
  const map = new Map<string, Section>();
  for (const s of [...a, ...b]) {
    const k = s.name.toUpperCase().trim();
    if (map.has(k)) {
      const ex = map.get(k)!;
      const exSet = new Set(ex.items);
      map.set(k, { name: ex.name, items: [...ex.items, ...s.items.filter(i => !exSet.has(i))] });
    } else map.set(k, { ...s });
  }
  return Array.from(map.values());
}

// ─── Field priority (matches backend PESSOA_PRIORITY_GROUPS) ───────────────
// Lower index = shown first in RG card
const PRIORITY_ALIASES: string[][] = [
  ["nome", "nome completo", "nome civil", "nome social"],
  ["data de nascimento", "data_nascimento", "nascimento", "dt_nascimento", "dt nascimento", "nasc", "data nasc", "datanascimento"],
  ["nome da mãe", "nome_mae", "nome mãe", "nome da mae", "nome mae", "filiacao · nome mae", "mae", "mãe", "filiacao mae"],
  ["nome do pai", "nome_pai", "nome pai", "filiacao · nome pai", "pai", "filiacao pai"],
  ["cpf", "rg", "documento"],
  ["sexo", "genero", "gênero", "idade", "sexo/gênero"],
  ["situação", "situacao", "status", "situação cadastral", "situacao cadastral", "status na receita"],
  ["estado civil"],
  ["municipio de nascimento", "município de nascimento", "naturalidade", "pais nascimento"],
  ["email", "e-mail"],
  ["telefone", "celular", "fone", "telefone celular", "tel"],
  ["logradouro", "endereço", "endereco", "bairro", "cidade", "uf", "cep", "municipio", "município"],
];
function fieldPriority(key: string): number {
  const k = key.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu,"").trim();
  for (let g = 0; g < PRIORITY_ALIASES.length; g++) {
    for (const alias of PRIORITY_ALIASES[g]) {
      const a = alias.normalize("NFD").replace(/\p{Mn}/gu,"");
      if (k === a) return g;
      if (a.includes(" ") && (k.includes(a) || a.includes(k))) return g;
    }
  }
  return 9999;
}
function sortByPriority(fields: Field[]): Field[] {
  return [...fields].sort((a, b) => fieldPriority(a.key) - fieldPriority(b.key));
}

// ─── Foto rotation order ────────────────────────────────────────────────────
const FOTO_TIPOS = [
  "fotonc","fotosp","fotomg","fotoba","fotope","fotorn","fotopr",
  "fotodf","fotorj","fotoce","fotoma","fotopb","fotogo","fotopi",
  "fotoal","fototo","fotoes","fotoro","fotoms",
];
const FOTO_LABELS: Record<string, string> = {
  fotonc:"Nacional",fotosp:"SP",fotomg:"MG",fotoba:"BA",fotope:"PE",
  fotorn:"RN",fotopr:"PR",fotodf:"DF",fotorj:"RJ",fotoce:"CE",
  fotoma:"MA",fotopb:"PB",fotogo:"GO",fotopi:"PI",fotoal:"AL",
  fototo:"TO",fotoes:"ES",fotoro:"RO",fotoms:"MS",
};

// ─── Field icon ─────────────────────────────────────────────────────────────
function fieldIcon(key: string) {
  const k = key.toLowerCase();
  if (k.includes("nasc") || k.includes("idade"))     return CalendarDays;
  if (k.includes("mae") || k.includes("mãe") || k.includes("pai")) return Baby;
  if (k.includes("sexo") || k.includes("gen"))       return User;
  if (k.includes("email") || k.includes("e-mail"))   return Mail;
  if (k.includes("tel") || k.includes("fone") || k.includes("cel")) return Phone;
  if (k.includes("end") || k.includes("logr") || k.includes("cep") || k.includes("bairro") || k.includes("cid")) return MapPin;
  if (k.includes("emprego") || k.includes("rais") || k.includes("vinculo")) return Briefcase;
  if (k.includes("cpf") || k.includes("rg") || k.includes("doc")) return Fingerprint;
  if (k.includes("situac") || k.includes("status"))  return Shield;
  if (k.includes("estado civil"))                    return Heart;
  return FileText;
}

// ─── Section icon ───────────────────────────────────────────────────────────
function sectionIcon(name: string) {
  const n = name.toUpperCase();
  if (n.includes("ENDE") || n.includes("CEP"))       return MapPin;
  if (n.includes("TEL") || n.includes("FONE"))       return Phone;
  if (n.includes("EMAIL") || n.includes("E-MAIL"))   return Mail;
  if (n.includes("EMPREGO") || n.includes("RAIS") || n.includes("VINCULO")) return Briefcase;
  if (n.includes("PARENTE") || n.includes("FAMIL"))  return Users;
  if (n.includes("VEICULO") || n.includes("CARRO"))  return Car;
  if (n.includes("BENEFICIO") || n.includes("SAUDE")) return Heart;
  if (n.includes("BANCO") || n.includes("CREDIT"))   return CreditCard;
  if (n.includes("PENA") || n.includes("PROCES") || n.includes("CRIME")) return Shield;
  return FileText;
}

// ─── Parse key:value from parente item ─────────────────────────────────────
function parseKV(item: string) {
  const out: Record<string,string> = {};
  for (const part of item.split(/\s*[·•]\s*/)) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0,i).trim().toUpperCase()] = part.slice(i+1).trim();
  }
  return out;
}
function extractCpf(item: string): string | null {
  const m = item.match(/CPF:\s*([\d.\-\/]+)/i);
  if (!m) return null;
  const d = m[1].replace(/\D/g,"");
  return d.length === 11 ? d : null;
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function StatusBadge({ status, label }: { status: Status; label: string }) {
  const base = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-[0.18em] transition-all";
  const color = status==="loading" ? "bg-sky-400/10 border-sky-400/30 text-sky-300"
    : status==="done"  ? "bg-emerald-400/10 border-emerald-400/30 text-emerald-300"
    : status==="error" ? "bg-rose-400/10 border-rose-400/30 text-rose-300"
    : "bg-white/5 border-white/10 text-muted-foreground/50";
  return (
    <span className={`${base} ${color}`}>
      {status==="loading" && <Loader2 className="w-2.5 h-2.5 animate-spin"/>}
      {status==="done"    && <CheckCircle2 className="w-2.5 h-2.5"/>}
      {status==="error"   && <XCircle className="w-2.5 h-2.5"/>}
      {status==="idle"    && <span className="w-1.5 h-1.5 rounded-full bg-current"/>}
      {label}
    </span>
  );
}

function CopyBtn({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { void navigator.clipboard.writeText(value); setOk(true); setTimeout(()=>setOk(false),1500); }}
      className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground/40 hover:text-primary transition-all shrink-0">
      {ok ? <Check className="w-3 h-3 text-emerald-400"/> : <Copy className="w-3 h-3"/>}
    </button>
  );
}

function Collapsible({ title, icon: Icon, badge, defaultOpen=true, children }: {
  title:string; icon:React.ComponentType<{className?:string}>; badge?:string; defaultOpen?:boolean; children:React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl overflow-hidden">
      <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/3 transition-colors">
        <div className="flex items-center gap-2.5">
          <Icon className="w-3.5 h-3.5 text-primary"/>
          <span className="text-[10px] uppercase tracking-[0.32em] font-bold text-muted-foreground">{title}</span>
          {badge && <span className="text-[8px] uppercase tracking-widest text-muted-foreground/35 border border-white/10 rounded-full px-1.5 py-0.5">{badge}</span>}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40"/> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40"/>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:0}} transition={{duration:0.2}} className="overflow-hidden">
            <div className="px-5 pb-4 border-t border-white/5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FieldSkeleton() {
  return (
    <div className="space-y-4 pt-2">
      {[140,100,160,80,120].map((w,i) => (
        <div key={i} className="space-y-1.5">
          <div className={`h-2 rounded bg-white/8 animate-pulse`} style={{width:48, animationDelay:`${i*60}ms`}}/>
          <div className={`h-3 rounded bg-white/5 animate-pulse`} style={{width:`${w}px`, animationDelay:`${i*60+30}ms`}}/>
        </div>
      ))}
    </div>
  );
}

// ─── RG Identity Card field ─────────────────────────────────────────────────
function RgField({ field }: { field: Field }) {
  const Icon = fieldIcon(field.key);
  return (
    <div className="group flex flex-col gap-0.5">
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className="w-2.5 h-2.5 text-primary/50 shrink-0"/>
        <span className="text-[8px] uppercase tracking-[0.32em] text-muted-foreground/40 leading-none">{field.key}</span>
      </div>
      <div className="flex items-start gap-1.5">
        <span className="text-[13px] font-semibold text-foreground/90 leading-snug break-all flex-1">{field.value}</span>
        <CopyBtn value={field.value}/>
      </div>
    </div>
  );
}

// ─── Parente card ────────────────────────────────────────────────────────────
function ParenteCard({ item, token }: { item: string; token: string }) {
  const [imageUrl, setImageUrl] = useState<string|null>(null);
  const [fotoStatus, setFotoStatus] = useState<"idle"|"loading"|"done"|"none">("idle");
  const kv = parseKV(item);
  const cpf = extractCpf(item);
  const nome = kv["NOME"] ?? kv["NAME"] ?? "–";
  const parentesco = kv["PARENTESCO"] ?? kv["GRAU"] ?? kv["RELACAO"] ?? "";
  const cpfDisplay = kv["CPF"] ?? cpf ?? "";
  const nascimento = kv["NASCIMENTO"] ?? kv["DT NASCIMENTO"] ?? kv["DATA NASCIMENTO"] ?? "";

  useEffect(() => {
    if (!cpf) return;
    setFotoStatus("loading");
    let alive = true;
    (async () => {
      for (const tipo of FOTO_TIPOS) {
        if (!alive) break;
        const r = await fetchSkylers(tipo, cpf, token);
        if (!alive) break;
        if (r.ok && r.imageUrl) { setImageUrl(r.imageUrl); setFotoStatus("done"); return; }
      }
      if (alive) setFotoStatus("none");
    })();
    return () => { alive = false; };
  }, [cpf, token]);

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-white/8 bg-white/3 hover:bg-white/5 transition-colors">
      <div className="w-11 h-11 rounded-lg overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center shrink-0">
        {fotoStatus==="loading" && <Fingerprint className="w-4 h-4 text-muted-foreground/20 animate-pulse"/>}
        {fotoStatus==="done" && imageUrl && <img src={imageUrl} alt={nome} className="w-full h-full object-cover object-top"/>}
        {(fotoStatus==="none" || fotoStatus==="idle") && <User className="w-4 h-4 text-muted-foreground/20"/>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">{nome}</span>
          {parentesco && <span className="text-[8px] uppercase tracking-widest text-primary/70 border border-primary/20 rounded-full px-1.5 py-0.5">{parentesco}</span>}
        </div>
        <div className="text-[10px] text-muted-foreground/50 font-mono space-y-0.5">
          {cpfDisplay && <div>CPF: {cpfDisplay}</div>}
          {nascimento && <div>Nasc: {nascimento}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export function CpfUnificadoPanel({ cpf }: { cpf: string }) {
  const token = localStorage.getItem("infinity_token") ?? "";

  const [fields,    setFields]    = useState<Field[]>([]);
  const [sections,  setSections]  = useState<Section[]>([]);
  const [cpfStatus, setCpfStatus] = useState<Status>("idle");
  const [basiStatus,setBasiStatus] = useState<Status>("idle");
  const [fotoUrl,   setFotoUrl]   = useState<string|null>(null);
  const [fotoStatus,setFotoStatus]= useState<Status>("idle");
  const [fotoLabel, setFotoLabel] = useState("–");

  const abortRef = useRef(false);

  const run = useCallback(async () => {
    abortRef.current = false;
    setFields([]); setSections([]);
    setCpfStatus("loading"); setBasiStatus("loading");
    setFotoStatus("loading"); setFotoUrl(null); setFotoLabel("–");

    // 1+2: Hydra CPF + cpfbasico Skylers — PARALELO
    // cpfbasico usa skipLog:true para não consumir crédito extra
    const [hydra, basico] = await Promise.all([
      fetchHydraCpf(cpf, token),
      fetchSkylers("cpfbasico", cpf, token, true),  // skipLog:true
    ]);

    if (!abortRef.current) {
      // basico fields primeiro (identidade Receita Federal), hydra complementa
      const merged = mergeFields(basico.fields, hydra.fields);
      const sorted = sortByPriority(merged);
      setFields(sorted);
      setSections(mergeSections(basico.sections, hydra.sections));
      setCpfStatus(hydra.ok ? "done" : hydra.ok === false && !basico.ok ? "error" : "done");
      setBasiStatus(basico.ok ? "done" : "error");
    }

    // 3: Foto rotation — sequencial, para no 1º hit, skipLog:true
    for (const tipo of FOTO_TIPOS) {
      if (abortRef.current) break;
      setFotoLabel(FOTO_LABELS[tipo] ?? tipo);
      const r = await fetchSkylers(tipo, cpf, token, true);
      if (abortRef.current) break;
      if (r.ok && r.imageUrl) {
        setFotoUrl(r.imageUrl);
        setFotoStatus("done");
        setFotoLabel(FOTO_LABELS[tipo] ?? tipo);
        break;
      }
    }
    if (!abortRef.current && fotoStatus !== "done") {
      setFotoStatus(s => s === "loading" ? "error" : s);
    }
  }, [cpf, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void run();
    return () => { abortRef.current = true; };
  }, [run]);

  const dataStatus: Status =
    cpfStatus==="done" || basiStatus==="done" ? "done"
    : cpfStatus==="loading" || basiStatus==="loading" ? "loading"
    : "error";

  // Split fields: top 8 identity fields vs the rest
  const identityFields = fields.slice(0, 8);
  const extraFields    = fields.slice(8);

  // Parentes section
  const parentesSection = sections.find(s =>
    s.name.toUpperCase().includes("PARENTE") || s.name.toUpperCase().includes("FAMIL")
  );
  const otherSections = sections.filter(s => s !== parentesSection);

  return (
    <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="space-y-4">

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={dataStatus}  label="CPF"/>
          <StatusBadge status={basiStatus}  label="Básico · Receita"/>
          <StatusBadge status={fotoStatus}  label={fotoStatus==="loading" ? `Foto · ${fotoLabel}` : fotoStatus==="done" ? `Foto · ${fotoLabel}` : "Foto"}/>
        </div>
        <button onClick={()=>void run()} disabled={dataStatus==="loading"}
          className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-all disabled:opacity-40" title="Atualizar">
          <RefreshCw className={`w-3.5 h-3.5 ${dataStatus==="loading" ? "animate-spin" : ""}`}/>
        </button>
      </div>

      {/* ── RG Identity Card ───────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-br from-black/60 via-sky-950/20 to-black/60 backdrop-blur-2xl">

        {/* Card header — República */}
        <div className="relative flex items-center justify-between px-5 py-3 border-b border-white/8 bg-black/20">
          <div>
            <div className="text-[8px] uppercase tracking-[0.45em] text-sky-400/60 font-bold mb-0.5">República Federativa do Brasil</div>
            <div className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground/50 font-semibold">Registro de Identidade</div>
          </div>
          <div className="text-right">
            <div className="text-[8px] uppercase tracking-[0.3em] text-muted-foreground/30">CPF</div>
            <div className="text-[11px] font-mono font-bold tracking-[0.2em] text-foreground/70">
              {cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
            </div>
          </div>
          {/* Subtle diagonal accent */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-sky-500/3 to-transparent pointer-events-none"/>
        </div>

        {/* Card body — Foto + Campos */}
        <div className="flex gap-0">

          {/* Foto column */}
          <div className="w-32 sm:w-40 shrink-0 flex flex-col border-r border-white/8">
            <div className="flex-1 relative overflow-hidden bg-black/40" style={{minHeight:200}}>
              <AnimatePresence mode="wait">
                {fotoStatus==="done" && fotoUrl ? (
                  <motion.img key="photo" src={fotoUrl} alt="Biometria"
                    initial={{opacity:0}} animate={{opacity:1}}
                    className="absolute inset-0 w-full h-full object-cover object-top"
                    onError={e=>{(e.currentTarget as HTMLImageElement).style.display="none";}}/>
                ) : fotoStatus==="error" ? (
                  <motion.div key="nofoto" initial={{opacity:0}} animate={{opacity:1}}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <Camera className="w-7 h-7 text-muted-foreground/15"/>
                    <span className="text-[9px] text-muted-foreground/30 text-center px-2">Foto não disponível</span>
                  </motion.div>
                ) : (
                  <motion.div key="loading-foto" initial={{opacity:0}} animate={{opacity:1}}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
                    <Fingerprint className="w-8 h-8 text-muted-foreground/15 animate-pulse"/>
                    <span className="text-[8px] text-sky-400/40 uppercase tracking-[0.25em] text-center px-2">{fotoLabel}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Camera label */}
            <div className="px-2 py-2 flex items-center gap-1.5 border-t border-white/8 bg-black/20">
              <Camera className="w-2.5 h-2.5 text-primary/40 shrink-0"/>
              <span className="text-[7px] uppercase tracking-[0.3em] text-muted-foreground/30">
                {fotoStatus==="done" ? fotoLabel : fotoStatus==="loading" ? "buscando…" : "biometria"}
              </span>
            </div>
          </div>

          {/* Identity fields */}
          <div className="flex-1 min-w-0 p-4 sm:p-5">
            {dataStatus==="loading" ? (
              <FieldSkeleton/>
            ) : dataStatus==="done" && identityFields.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                {identityFields.map(f => <RgField key={f.key} field={f}/>)}
              </div>
            ) : (
              <div className="flex items-center gap-2 py-6 text-rose-400/70 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0"/>
                CPF não encontrado ou temporariamente indisponível
              </div>
            )}
          </div>
        </div>

        {/* Card footer — stamp */}
        <div className="px-5 py-2.5 border-t border-white/8 bg-black/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${basiStatus==="done" ? "bg-emerald-400" : basiStatus==="loading" ? "bg-sky-400 animate-pulse" : "bg-rose-400"}`}/>
            <span className="text-[8px] uppercase tracking-[0.3em] text-muted-foreground/30">
              {basiStatus==="done" ? "Dados Receita Federal confirmados" : basiStatus==="loading" ? "Consultando Receita Federal…" : "Dados Hydra"}
            </span>
          </div>
          {dataStatus==="done" && fields.length > 0 && (
            <span className="text-[8px] text-muted-foreground/25 font-mono">{fields.length} campos</span>
          )}
        </div>
      </div>

      {/* ── Campos adicionais ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {dataStatus==="done" && extraFields.length > 0 && (
          <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}>
            <Collapsible title="Dados Adicionais" icon={FileText} badge={`${extraFields.length} campos`} defaultOpen={false}>
              <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                {extraFields.map(f => <RgField key={f.key} field={f}/>)}
              </div>
            </Collapsible>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Seções dinâmicas ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {otherSections.map((sec, i) => (
          <motion.div key={sec.name} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}>
            <Collapsible title={sec.name} icon={sectionIcon(sec.name)} badge={`${sec.items.length}`} defaultOpen={i<2}>
              <div className="pt-3 space-y-2">
                {sec.items.map((item, j) => {
                  const kv = parseKV(item);
                  const entries = Object.entries(kv);
                  if (entries.length > 1) {
                    return (
                      <div key={j} className="rounded-lg border border-white/8 bg-white/3 px-3 py-2.5 space-y-2">
                        {entries.map(([k, v]) => (
                          <div key={k} className="flex items-start gap-2 group">
                            <span className="text-[8px] uppercase tracking-[0.25em] text-muted-foreground/35 w-28 shrink-0 pt-0.5 leading-tight">{k}</span>
                            <span className="text-xs font-mono text-foreground/80 break-all flex-1">{v}</span>
                            <CopyBtn value={v}/>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return (
                    <div key={j} className="text-sm text-foreground/70 font-mono leading-relaxed px-1 py-1.5 border-b border-white/5 last:border-0 group flex items-start gap-2">
                      <span className="flex-1 break-all">{item}</span>
                      <CopyBtn value={item}/>
                    </div>
                  );
                })}
              </div>
            </Collapsible>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* ── Parentes ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {dataStatus==="done" && parentesSection && parentesSection.items.length > 0 && (
          <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
            <Collapsible title="Parentes" icon={Users} badge={`${parentesSection.items.length}`} defaultOpen>
              <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {parentesSection.items.map((item, i) => (
                  <ParenteCard key={i} item={item} token={token}/>
                ))}
              </div>
            </Collapsible>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
