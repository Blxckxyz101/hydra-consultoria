/**
 * CpfUnificadoPanel — consulta CPF unificada
 *
 * Fluxo correto:
 *  1. /api/infinity/consultas/cpf  (Hydra API, loga no histórico UMA vez)
 *  2. /api/infinity/external/skylers { tipo:"cpfbasico", noHistory:true }
 *     (Receita Federal via Skylers — enriquecimento de identidade)
 *  3. Rotação de foto via /api/infinity/external/skylers { tipo:"fotonc"|..., noHistory:true }
 *     — para na primeira foto encontrada
 *  4. Parentes: para cada CPF extraído, busca mini-foto (noHistory:true)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IdCard, Camera, FileText, Loader2, AlertTriangle,
  User, MapPin, Phone, Mail, Briefcase, ChevronDown, ChevronUp,
  Copy, Check, RefreshCw, Fingerprint, Users, Car, Heart,
  CreditCard, Shield, CheckCircle2, XCircle,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────
type Status = "idle" | "loading" | "done" | "error";
interface SkyField   { key: string; value: string }
interface SkySection { name: string; items: string[] }

// ─── API helpers ────────────────────────────────────────────────────────────

/** Hydra API: /consultas/cpf — principal, loga histórico */
async function fetchHydraCpf(cpf: string, token: string) {
  try {
    const r = await fetch("/api/infinity/consultas/cpf", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ dados: cpf }),
    });
    const json = await r.json() as {
      success: boolean;
      data?: { fields?: SkyField[]; sections?: SkySection[]; raw?: string };
      error?: string | null;
    };
    return {
      ok:       json.success,
      fields:   json.data?.fields   ?? [],
      sections: json.data?.sections ?? [],
      raw:      json.data?.raw      ?? "",
      error:    json.error ?? null,
    };
  } catch {
    return { ok: false, fields: [], sections: [], raw: "", error: "Erro de conexão" };
  }
}

/** Skylers proxy: /external/skylers — enriquecimento + fotos */
async function fetchSkylers(
  tipo: string,
  cpf:  string,
  token: string,
  opts: { noHistory?: boolean; skipLog?: boolean } = {},
) {
  try {
    const r = await fetch("/api/infinity/external/skylers", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({
        tipo,
        dados:     cpf,
        noHistory: opts.noHistory ?? true,
        skipLog:   opts.skipLog   ?? false,
      }),
    });
    const json = await r.json() as {
      success: boolean;
      data?: { fields?: SkyField[]; sections?: SkySection[]; raw?: string };
      error?: string;
    };
    const rawFields = json.data?.fields ?? [];
    // Imagem vem como campo FOTO_URL (data URI base64)
    const fotoField = rawFields.find(f =>
      f.key === "FOTO_URL" || f.key.toUpperCase() === "FOTO_URL"
    );
    const imageUrl = fotoField?.value ?? null;
    return {
      ok:       json.success,
      fields:   rawFields.filter(f => f.key !== "FOTO_URL" && f.key.toUpperCase() !== "FOTO_URL"),
      sections: json.data?.sections ?? [],
      imageUrl,
      raw:      json.data?.raw ?? "",
    };
  } catch {
    return { ok: false, fields: [], sections: [], imageUrl: null, raw: "" };
  }
}

// Merge: deduplica por key (maiúsculo), básico primeiro, hydra complementa
function mergeFields(basico: SkyField[], hydra: SkyField[]): SkyField[] {
  const seen = new Set<string>();
  const out:  SkyField[] = [];
  for (const f of [...basico, ...hydra]) {
    const k = f.key.toUpperCase().trim();
    if (!seen.has(k)) { seen.add(k); out.push(f); }
  }
  return out;
}
function mergeSections(a: SkySection[], b: SkySection[]): SkySection[] {
  const byName = new Map<string, SkySection>();
  for (const s of [...a, ...b]) {
    const k = s.name.toUpperCase().trim();
    if (byName.has(k)) {
      const existing = byName.get(k)!;
      const existSet = new Set(existing.items);
      byName.set(k, { name: existing.name, items: [...existing.items, ...s.items.filter(i => !existSet.has(i))] });
    } else {
      byName.set(k, { ...s });
    }
  }
  return Array.from(byName.values());
}

// ─── Ordem de rotação de foto ───────────────────────────────────────────────
const FOTO_ROTATION = [
  "fotonc","fotosp","fotomg","fotoba","fotope","fotorn","fotopr",
  "fotodf","fotorj","fotoce","fotoma","fotopb","fotogo","fotopi",
  "fotoal","fototo","fotoes","fotoro","fotoms",
];
const FOTO_LABELS: Record<string, string> = {
  fotonc:"Nacional", fotosp:"SP",  fotomg:"MG", fotoba:"BA", fotope:"PE",
  fotorn:"RN",       fotopr:"PR",  fotodf:"DF", fotorj:"RJ", fotoce:"CE",
  fotoma:"MA",       fotopb:"PB",  fotogo:"GO", fotopi:"PI", fotoal:"AL",
  fototo:"TO",       fotoes:"ES",  fotoro:"RO", fotoms:"MS",
};

// ─── Campos de identidade prioritários ─────────────────────────────────────
const HEADLINE_KEYS = new Set([
  "NOME","DATA NASCIMENTO","DATA DE NASCIMENTO","NASCIMENTO","NASC",
  "SEXO","GENERO","MAE","NOME MAE","NOME DA MAE","NOME MÃE","NOME DA MÃE",
  "PAI","NOME PAI","NOME DO PAI",
  "MUNICIPIO DE NASCIMENTO","NATURALIDADE","ESTADO CIVIL",
  "SITUACAO CADASTRAL","SITUACAO","SITUAÇÃO CADASTRAL","SITUAÇÃO",
  "TITULO ELEITOR","PIS","NIS","RG","ORGAO EMISSOR",
  "RENDA","FAIXA SALARIAL","CPF",
]);
const normKey = (k: string) =>
  k.toUpperCase().normalize("NFD").replace(/\p{Mn}/gu,"").replace(/[\s_\-·]+/g," ").trim();

function splitFields(fields: SkyField[]) {
  const headlineNorm = new Set(Array.from(HEADLINE_KEYS).map(normKey));
  const headline: SkyField[] = [];
  const rest:     SkyField[] = [];
  for (const f of fields) {
    (headlineNorm.has(normKey(f.key)) ? headline : rest).push(f);
  }
  return { headline, rest };
}

// ─── Section icon ───────────────────────────────────────────────────────────
function sectionIcon(name: string): React.ComponentType<{ className?: string }> {
  const n = name.toUpperCase();
  if (n.includes("ENDE") || n.includes("CEP"))                          return MapPin;
  if (n.includes("TEL") || n.includes("FONE") || n.includes("CELULAR")) return Phone;
  if (n.includes("EMAIL") || n.includes("E-MAIL"))                      return Mail;
  if (n.includes("EMPREGO") || n.includes("RAIS") || n.includes("VINCULO") || n.includes("TRABALHO")) return Briefcase;
  if (n.includes("PARENTE") || n.includes("FAMILIAR") || n.includes("RELAC"))  return Users;
  if (n.includes("VEICULO") || n.includes("CARRO") || n.includes("AUTO"))      return Car;
  if (n.includes("BENEFICIO") || n.includes("SAUDE") || n.includes("PLANO"))   return Heart;
  if (n.includes("BANCO") || n.includes("CREDIT") || n.includes("FINANC"))     return CreditCard;
  if (n.includes("PENA") || n.includes("PROCES") || n.includes("CRIME"))       return Shield;
  return FileText;
}

// ─── Extract CPF from parente string ────────────────────────────────────────
function extractCpf(item: string): string | null {
  const m = item.match(/CPF:\s*([\d.\-\/]+)/i);
  if (!m) return null;
  const d = m[1].replace(/\D/g,"");
  return d.length === 11 ? d : null;
}
function parseKV(item: string): Record<string,string> {
  const out: Record<string,string> = {};
  for (const part of item.split(/\s*[·•]\s*/)) {
    const idx = part.indexOf(":");
    if (idx > 0) out[part.slice(0,idx).trim().toUpperCase()] = part.slice(idx+1).trim();
  }
  return out;
}

// ─── UI helpers ─────────────────────────────────────────────────────────────
function StatusBadge({ status, label }: { status: Status; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-[0.18em] transition-all ${
      status==="loading" ? "bg-sky-400/10 border-sky-400/30 text-sky-300" :
      status==="done"    ? "bg-emerald-400/10 border-emerald-400/30 text-emerald-300" :
      status==="error"   ? "bg-rose-400/10 border-rose-400/30 text-rose-300" :
                           "bg-white/5 border-white/10 text-muted-foreground/50"
    }`}>
      {status==="loading" && <Loader2 className="w-2.5 h-2.5 animate-spin"/>}
      {status==="done"    && <CheckCircle2 className="w-2.5 h-2.5"/>}
      {status==="error"   && <XCircle className="w-2.5 h-2.5"/>}
      {status==="idle"    && <span className="w-1.5 h-1.5 rounded-full bg-current"/>}
      {label}
    </span>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0 group">
      <span className="text-[9px] uppercase tracking-[0.28em] text-muted-foreground/45 w-36 shrink-0 pt-0.5 leading-tight">{label}</span>
      <span className="text-sm text-foreground/90 flex-1 font-mono leading-relaxed break-all">{value}</span>
      <button
        onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(()=>setCopied(false),1500); }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground/40 hover:text-primary transition-all shrink-0"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400"/> : <Copy className="w-3 h-3"/>}
      </button>
    </div>
  );
}

function Collapsible({ title, icon: Icon, badge, defaultOpen=true, children }: {
  title: string; icon: React.ComponentType<{className?:string}>;
  badge?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl overflow-hidden">
      <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/3 transition-colors">
        <div className="flex items-center gap-2.5">
          <Icon className="w-4 h-4 text-primary"/>
          <span className="text-[11px] uppercase tracking-[0.32em] font-bold text-muted-foreground">{title}</span>
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

function Skeleton({ n=4 }: { n?: number }) {
  return (
    <div className="space-y-3 pt-3">
      {Array.from({length:n}).map((_,i)=>(
        <div key={i} className="flex gap-3 py-1">
          <div className="w-28 h-2.5 rounded bg-white/6 animate-pulse" style={{animationDelay:`${i*80}ms`}}/>
          <div className="flex-1 h-2.5 rounded bg-white/4 animate-pulse" style={{animationDelay:`${i*80+40}ms`}}/>
        </div>
      ))}
    </div>
  );
}

// ─── Parente card ────────────────────────────────────────────────────────────
function ParenteCard({ item, token }: { item: string; token: string }) {
  const [imageUrl, setImageUrl] = useState<string|null>(null);
  const [fotoStatus, setFotoStatus] = useState<"idle"|"loading"|"done"|"none">("idle");
  const kv = parseKV(item);
  const cpf = extractCpf(item);
  const nome       = kv["NOME"]        ?? kv["NAME"]      ?? "–";
  const parentesco = kv["PARENTESCO"]  ?? kv["GRAU"]      ?? kv["RELACAO"] ?? "";
  const cpfDisplay = kv["CPF"]         ?? cpf             ?? "";
  const nascimento = kv["NASCIMENTO"]  ?? kv["DT NASCIMENTO"] ?? kv["DATA NASCIMENTO"] ?? "";

  useEffect(() => {
    if (!cpf) return;
    setFotoStatus("loading");
    let alive = true;
    (async () => {
      for (const tipo of FOTO_ROTATION) {
        if (!alive) break;
        const r = await fetchSkylers(tipo, cpf, token, { noHistory: true });
        if (!alive) break;
        if (r.ok && r.imageUrl) { setImageUrl(r.imageUrl); setFotoStatus("done"); return; }
      }
      if (alive) setFotoStatus("none");
    })();
    return () => { alive = false; };
  }, [cpf, token]);

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-white/8 bg-white/3 hover:bg-white/5 transition-colors">
      <div className="w-12 h-12 rounded-lg overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center shrink-0">
        {fotoStatus==="loading" && <Fingerprint className="w-5 h-5 text-muted-foreground/20 animate-pulse"/>}
        {fotoStatus==="done" && imageUrl && <img src={imageUrl} alt={nome} className="w-full h-full object-cover object-top"/>}
        {(fotoStatus==="none" || fotoStatus==="idle") && <User className="w-5 h-5 text-muted-foreground/20"/>}
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

  // Combined result state
  const [fields,    setFields]    = useState<SkyField[]>([]);
  const [sections,  setSections]  = useState<SkySection[]>([]);
  const [cpfStatus, setCpfStatus] = useState<Status>("idle");
  const [basiStatus,setBasiStatus] = useState<Status>("idle");

  // Foto state
  const [fotoUrl,    setFotoUrl]    = useState<string|null>(null);
  const [fotoStatus, setFotoStatus] = useState<Status>("idle");
  const [fotoLabel,  setFotoLabel]  = useState("–");

  const abortRef = useRef(false);

  const run = useCallback(async () => {
    abortRef.current = false;
    setFields([]); setSections([]);
    setCpfStatus("loading"); setBasiStatus("loading");
    setFotoStatus("loading"); setFotoUrl(null); setFotoLabel("–");

    // ── 1 + 2: Hydra CPF + cpfbasico em paralelo ─────────────────────────
    const [hydra, basico] = await Promise.all([
      fetchHydraCpf(cpf, token),
      fetchSkylers("cpfbasico", cpf, token, { noHistory: true }),
    ]);

    if (!abortRef.current) {
      // Merge: basico fields first (nome/nascimento/mae/pai da Receita), depois Hydra
      const merged = mergeFields(basico.fields, hydra.fields);
      const mergedSections = mergeSections(basico.sections, hydra.sections);
      setFields(merged);
      setSections(mergedSections);
      setCpfStatus(hydra.ok || basico.ok ? "done" : "error");
      setBasiStatus(basico.ok ? "done" : "error");
    }

    // ── 3: Foto rotation sequencial, para na primeira ────────────────────
    let fotoFound = false;
    for (const tipo of FOTO_ROTATION) {
      if (abortRef.current) break;
      setFotoLabel(FOTO_LABELS[tipo] ?? tipo);
      const r = await fetchSkylers(tipo, cpf, token, { noHistory: true });
      if (abortRef.current) break;
      if (r.ok && r.imageUrl) {
        setFotoUrl(r.imageUrl);
        setFotoStatus("done");
        setFotoLabel(FOTO_LABELS[tipo] ?? tipo);
        fotoFound = true;
        break;
      }
    }
    if (!fotoFound && !abortRef.current) {
      setFotoStatus("error");
    }
  }, [cpf, token]);

  useEffect(() => {
    void run();
    return () => { abortRef.current = true; };
  }, [run]);

  const { headline, rest } = splitFields(fields);
  const parentesSection = sections.find(s =>
    s.name.toUpperCase().includes("PARENTE") || s.name.toUpperCase().includes("FAMILIAR")
  );
  const otherSections = sections.filter(s => s !== parentesSection);

  const dataStatus: Status = cpfStatus === "done" || basiStatus === "done"
    ? "done" : cpfStatus === "loading" || basiStatus === "loading"
    ? "loading" : "error";

  return (
    <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <IdCard className="w-4 h-4 text-primary"/>
            <span className="text-[10px] uppercase tracking-[0.4em] text-primary/70">CPF Unificado</span>
          </div>
          <div className="font-mono text-lg font-bold tracking-[0.25em] text-foreground">{cpf}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={dataStatus}  label="Dados"/>
          <StatusBadge status={fotoStatus}  label={`Foto · ${fotoLabel}`}/>
          <button
            onClick={()=>void run()}
            disabled={dataStatus==="loading" || fotoStatus==="loading"}
            className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${dataStatus==="loading" ? "animate-spin" : ""}`}/>
          </button>
        </div>
      </div>

      {/* ── Foto + Identidade ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">

        {/* Foto */}
        <div className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Camera className="w-3.5 h-3.5 text-primary"/>
              <span className="text-[9px] uppercase tracking-[0.32em] text-muted-foreground/60 font-bold">
                Biometria{fotoStatus==="done" ? ` · ${fotoLabel}` : ""}
              </span>
            </div>
            {fotoStatus==="loading" && (
              <span className="text-[8px] text-sky-400/60 font-mono flex items-center gap-1">
                <Loader2 className="w-2.5 h-2.5 animate-spin"/> {fotoLabel}
              </span>
            )}
          </div>
          <div className="px-4 pb-4">
            <AnimatePresence mode="wait">
              {fotoStatus==="done" && fotoUrl ? (
                <motion.div key="photo" initial={{opacity:0}} animate={{opacity:1}} className="relative overflow-hidden rounded-xl border border-white/10">
                  <img src={fotoUrl} alt="Foto" className="w-full object-cover object-top" style={{maxHeight:300,minHeight:160}}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display="none"; }}/>
                  <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent pointer-events-none"/>
                  <span className="absolute bottom-2 left-2 text-[8px] uppercase tracking-widest text-white/50 bg-black/40 backdrop-blur-sm rounded px-2 py-0.5 border border-white/10">
                    {fotoLabel}
                  </span>
                </motion.div>
              ) : fotoStatus==="error" ? (
                <motion.div key="nofoto" initial={{opacity:0}} animate={{opacity:1}} className="h-44 rounded-xl border border-white/5 bg-white/3 flex flex-col items-center justify-center gap-2">
                  <Camera className="w-7 h-7 text-muted-foreground/20"/>
                  <span className="text-[10px] text-muted-foreground/40">Foto não encontrada</span>
                </motion.div>
              ) : (
                <motion.div key="loading-foto" initial={{opacity:0}} animate={{opacity:1}} className="h-44 rounded-xl border border-white/5 bg-white/3 flex flex-col items-center justify-center gap-3">
                  <Fingerprint className="w-8 h-8 text-muted-foreground/20 animate-pulse"/>
                  <span className="text-[9px] text-sky-400/50 uppercase tracking-[0.28em]">buscando {fotoLabel}…</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Identidade */}
        <div className="rounded-2xl border border-white/10 bg-black/30 overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-white/5">
            <User className="w-4 h-4 text-primary"/>
            <span className="text-[11px] uppercase tracking-[0.32em] font-bold text-muted-foreground">Registro Geral</span>
            {basiStatus==="done" && <span className="text-[8px] uppercase tracking-widest text-emerald-400/60 border border-emerald-400/20 rounded-full px-1.5 py-0.5">Receita Federal</span>}
          </div>
          <div className="px-5 py-2">
            {dataStatus==="loading" ? (
              <Skeleton n={8}/>
            ) : dataStatus==="done" && headline.length > 0 ? (
              headline.map(f=><FieldRow key={f.key} label={f.key} value={f.value}/>)
            ) : (
              <div className="flex items-center gap-2 py-4 text-rose-400/70 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0"/>
                CPF não encontrado ou acesso temporariamente bloqueado
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Dados adicionais ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {dataStatus==="done" && rest.length > 0 && (
          <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}>
            <Collapsible title="Dados Adicionais" icon={FileText} badge={`${rest.length} campos`} defaultOpen={false}>
              <div className="pt-2">{rest.map(f=><FieldRow key={f.key} label={f.key} value={f.value}/>)}</div>
            </Collapsible>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Skeleton enquanto carrega ────────────────────────────────────── */}
      {dataStatus==="loading" && (
        <div className="space-y-3">
          {[1,2].map(i=>(
            <div key={i} className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-4 h-4 rounded bg-white/8 animate-pulse"/>
                <div className="w-36 h-2.5 rounded bg-white/6 animate-pulse"/>
              </div>
              <Skeleton n={3}/>
            </div>
          ))}
        </div>
      )}

      {/* ── Seções dinâmicas ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {otherSections.map((sec,i)=>(
          <motion.div key={sec.name} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.04}}>
            <Collapsible title={sec.name} icon={sectionIcon(sec.name)} badge={`${sec.items.length}`} defaultOpen={i<2}>
              <div className="pt-3 space-y-2">
                {sec.items.map((item,j)=>{
                  const kv = parseKV(item);
                  const entries = Object.entries(kv);
                  if (entries.length > 1) {
                    return (
                      <div key={j} className="rounded-lg border border-white/8 bg-white/3 px-3 py-2.5 space-y-1.5">
                        {entries.map(([k,v])=>(
                          <div key={k} className="flex items-start gap-2">
                            <span className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground/40 w-28 shrink-0 pt-0.5">{k}</span>
                            <span className="text-xs font-mono text-foreground/80 break-all flex-1">{v}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return (
                    <div key={j} className="text-sm text-foreground/75 font-mono leading-relaxed px-1 py-1 border-b border-white/5 last:border-0">{item}</div>
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
                {parentesSection.items.map((item,i)=>(
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
