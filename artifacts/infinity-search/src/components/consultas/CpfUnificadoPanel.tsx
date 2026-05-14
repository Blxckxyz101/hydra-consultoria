import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IdCard, Camera, FileText, Loader2, AlertTriangle, CheckCircle2, XCircle,
  User, MapPin, Phone, Mail, Briefcase, ChevronDown, ChevronUp, Copy, Check,
  RefreshCw, Fingerprint, Users, Car, Heart, CreditCard, Shield,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Status = "idle" | "loading" | "done" | "error";
interface SkyField   { key: string; value: string }
interface SkySection { name: string; items: string[] }
interface SkyResult  {
  status:   Status;
  fields:   SkyField[];
  sections: SkySection[];
  imageUrl: string | null;
  raw:      string;
}

// ─── Foto rotation order ──────────────────────────────────────────────────────
const FOTO_ROTATION = [
  { tipo: "fotonc", label: "Nacional" },
  { tipo: "fotosp", label: "SP"       },
  { tipo: "fotomg", label: "MG"       },
  { tipo: "fotoba", label: "BA"       },
  { tipo: "fotope", label: "PE"       },
  { tipo: "fotorn", label: "RN"       },
  { tipo: "fotopr", label: "PR"       },
  { tipo: "fotodf", label: "DF"       },
  { tipo: "fotorj", label: "RJ"       },
  { tipo: "fotoce", label: "CE"       },
  { tipo: "fotoma", label: "MA"       },
  { tipo: "fotopb", label: "PB"       },
  { tipo: "fotogo", label: "GO"       },
  { tipo: "fotopi", label: "PI"       },
  { tipo: "fotoal", label: "AL"       },
  { tipo: "fototo", label: "TO"       },
  { tipo: "fotoes", label: "ES"       },
  { tipo: "fotoro", label: "RO"       },
  { tipo: "fotoms", label: "MS"       },
];

// ─── API helper ───────────────────────────────────────────────────────────────
// The /external/skylers route returns:
//   { success: bool, data: { fields: [{key,value}], sections: [{name,items}], raw } }
// Image is stored in fields as { key: "FOTO_URL", value: "data:image/jpeg;base64,..." }
async function callSkylers(
  tipo: string,
  dados: string,
  token: string,
  opts: { noHistory?: boolean; skipLog?: boolean } = {},
): Promise<{ ok: boolean; fields: SkyField[]; sections: SkySection[]; imageUrl: string | null; raw: string }> {
  try {
    const r = await fetch("/api/infinity/external/skylers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tipo, dados, noHistory: opts.noHistory ?? false, skipLog: opts.skipLog ?? false }),
    });
    const json = await r.json() as {
      success: boolean;
      data?: { fields?: SkyField[]; sections?: SkySection[]; raw?: string };
      error?: string;
    };
    const fields   = json.data?.fields   ?? [];
    const sections = json.data?.sections ?? [];
    const raw      = json.data?.raw      ?? "";
    // Image is stored by the backend as a FOTO_URL field (data URI)
    const fotoField = fields.find(f => f.key === "FOTO_URL" || f.key.toLowerCase().includes("foto_url"));
    const imageUrl  = fotoField?.value ?? null;
    return { ok: json.success, fields: fields.filter(f => f.key !== "FOTO_URL"), sections, imageUrl, raw };
  } catch {
    return { ok: false, fields: [], sections: [], imageUrl: null, raw: "" };
  }
}

// Extract CPF from a parentes item string like "NOME: João · CPF: 123.456.789-01 · PARENTESCO: PAI"
function extractCpf(item: string): string | null {
  const m = item.match(/CPF:\s*([\d.\-\/]+)/i);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

// Parse key:value pairs from a section item string like "NOME: João · PARENTESCO: PAI"
function parseItemFields(item: string): Record<string, string> {
  const out: Record<string, string> = {};
  const SEP = /\s*[·•]\s*/;
  for (const part of item.split(SEP)) {
    const idx = part.indexOf(":");
    if (idx > 0) {
      const k = part.slice(0, idx).trim().toUpperCase();
      const v = part.slice(idx + 1).trim();
      if (k && v) out[k] = v;
    }
  }
  return out;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function FieldRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0 group">
      <span className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/50 w-36 shrink-0 pt-0.5 leading-tight">{label}</span>
      <span className="text-sm text-foreground/90 flex-1 font-mono leading-relaxed break-all">{value}</span>
      <button
        onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground/40 hover:text-primary transition-all shrink-0"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, defaultOpen = true, badge }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Icon className="w-4 h-4 text-primary" />
          <span className="text-[11px] uppercase tracking-[0.35em] font-bold text-muted-foreground">{title}</span>
          {badge && <span className="text-[8px] uppercase tracking-widest text-muted-foreground/40 border border-white/10 rounded-full px-1.5 py-0.5">{badge}</span>}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 border-t border-white/5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({ status, label }: { status: Status; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-[0.2em] transition-all ${
      status === "loading" ? "bg-sky-400/10 border-sky-400/30 text-sky-300" :
      status === "done"    ? "bg-emerald-400/10 border-emerald-400/30 text-emerald-300" :
      status === "error"   ? "bg-rose-400/10 border-rose-400/30 text-rose-300" :
                             "bg-white/5 border-white/10 text-muted-foreground"
    }`}>
      {status === "loading" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {status === "done"    && <CheckCircle2 className="w-2.5 h-2.5" />}
      {status === "error"   && <XCircle className="w-2.5 h-2.5" />}
      {status === "idle"    && <div className="w-1.5 h-1.5 rounded-full bg-current" />}
      {label}
    </div>
  );
}

function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-3 pt-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex gap-3 py-1">
          <div className="w-28 h-2.5 rounded bg-white/6 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
          <div className="flex-1 h-2.5 rounded bg-white/4 animate-pulse" style={{ animationDelay: `${i * 80 + 40}ms` }} />
        </div>
      ))}
    </div>
  );
}

// ─── Section icon mapping ─────────────────────────────────────────────────────
function sectionIcon(name: string): React.ComponentType<{ className?: string }> {
  const n = name.toUpperCase();
  if (n.includes("ENDE") || n.includes("CEP"))             return MapPin;
  if (n.includes("TEL") || n.includes("FONE") || n.includes("CELULAR")) return Phone;
  if (n.includes("EMAIL") || n.includes("E-MAIL"))         return Mail;
  if (n.includes("EMPREGO") || n.includes("RAIS") || n.includes("VINCULO") || n.includes("TRABALHO")) return Briefcase;
  if (n.includes("PARENTE") || n.includes("FAMILIAR") || n.includes("RELAC")) return Users;
  if (n.includes("VEICULO") || n.includes("CARRO") || n.includes("AUTO"))    return Car;
  if (n.includes("BENEFICIO") || n.includes("SAUDE") || n.includes("PLANO")) return Heart;
  if (n.includes("BANCO") || n.includes("CREDIT") || n.includes("FINANC"))   return CreditCard;
  if (n.includes("PENA") || n.includes("PROCES") || n.includes("CRIME"))     return Shield;
  return FileText;
}

// ─── Parente card ─────────────────────────────────────────────────────────────
function ParenteCard({ item, token }: { item: string; token: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fotoStatus, setFotoStatus] = useState<"idle" | "loading" | "done" | "none">("idle");
  const fields = parseItemFields(item);
  const cpf    = extractCpf(item);

  useEffect(() => {
    if (!cpf) return;
    setFotoStatus("loading");
    let found = false;
    const run = async () => {
      for (const { tipo } of FOTO_ROTATION) {
        if (found) break;
        try {
          const { ok, imageUrl: url } = await callSkylers(tipo, cpf, token, { noHistory: true });
          if (ok && url) {
            setImageUrl(url);
            setFotoStatus("done");
            found = true;
            break;
          }
        } catch { continue; }
      }
      if (!found) setFotoStatus("none");
    };
    void run();
  }, [cpf]);

  const nome        = fields["NOME"] ?? fields["NAME"] ?? "–";
  const parentesco  = fields["PARENTESCO"] ?? fields["GRAU"] ?? fields["RELACAO"] ?? "";
  const cpfDisplay  = fields["CPF"] ?? cpf ?? "";
  const nascimento  = fields["NASCIMENTO"] ?? fields["DT NASCIMENTO"] ?? fields["DATA NASCIMENTO"] ?? "";
  const sexo        = fields["SEXO"] ?? fields["GENERO"] ?? "";

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-white/8 bg-white/3 hover:bg-white/5 transition-colors">
      {/* mini foto */}
      <div className="w-12 h-12 rounded-lg overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center shrink-0">
        {fotoStatus === "loading" && <Fingerprint className="w-5 h-5 text-muted-foreground/20 animate-pulse" />}
        {fotoStatus === "done" && imageUrl && (
          <img src={imageUrl} alt={nome} className="w-full h-full object-cover object-top" />
        )}
        {(fotoStatus === "none" || fotoStatus === "idle") && !cpf && (
          <User className="w-5 h-5 text-muted-foreground/20" />
        )}
        {fotoStatus === "none" && cpf && <User className="w-5 h-5 text-muted-foreground/20" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">{nome}</span>
          {parentesco && (
            <span className="text-[8px] uppercase tracking-widest text-primary/70 border border-primary/20 rounded-full px-1.5 py-0.5">{parentesco}</span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground/50 font-mono space-y-0.5">
          {cpfDisplay && <div>CPF: {cpfDisplay}</div>}
          {nascimento && <div>Nasc: {nascimento}</div>}
          {sexo && <div>Sexo: {sexo}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Identity priority fields ─────────────────────────────────────────────────
const HEADLINE_KEYS = [
  "NOME", "DATA NASCIMENTO", "DATA DE NASCIMENTO", "NASCIMENTO", "NASC",
  "SEXO", "GENERO", "MAE", "NOME MAE", "NOME DA MAE", "PAI", "NOME PAI", "NOME DO PAI",
  "MUNICIPIO DE NASCIMENTO", "NATURALIDADE", "ESTADO CIVIL", "SITUACAO CADASTRAL",
  "SITUACAO", "TITULO ELEITOR", "PIS", "NIS", "RG", "ORGAO EMISSOR",
  "RENDA", "FAIXA SALARIAL",
];

function normKey(k: string) {
  return k.toUpperCase().normalize("NFD").replace(/\p{Mn}/gu, "").replace(/[\s_\-·]+/g, " ").trim();
}

function splitFields(fields: SkyField[]) {
  const headlineNorm = new Set(HEADLINE_KEYS.map(normKey));
  const headline: SkyField[] = [];
  const rest:     SkyField[] = [];
  for (const f of fields) {
    if (headlineNorm.has(normKey(f.key))) headline.push(f);
    else rest.push(f);
  }
  return { headline, rest };
}

// ─── Main component ───────────────────────────────────────────────────────────
export function CpfUnificadoPanel({ cpf }: { cpf: string }) {
  const token = localStorage.getItem("infinity_token") ?? "";

  const [cpfResult,  setCpfResult]  = useState<SkyResult>({ status: "idle", fields: [], sections: [], imageUrl: null, raw: "" });
  const [fotoResult, setFotoResult] = useState<SkyResult>({ status: "idle", fields: [], sections: [], imageUrl: null, raw: "" });
  const [fotoLabel,  setFotoLabel]  = useState("–");
  const [running,    setRunning]    = useState(false);

  const abortRef = useRef(false);

  const run = useCallback(async () => {
    abortRef.current = false;
    setRunning(true);
    setFotoLabel("–");
    setCpfResult({ status: "loading", fields: [], sections: [], imageUrl: null, raw: "" });
    setFotoResult({ status: "loading", fields: [], sections: [], imageUrl: null, raw: "" });

    // ── CPF main query (logs to history — this is the intended single history entry) ──
    void callSkylers("cpf", cpf, token).then(r => {
      setCpfResult({
        status:   r.ok ? "done" : "error",
        fields:   r.fields,
        sections: r.sections,
        imageUrl: null,
        raw:      r.raw,
      });
    }).catch(() => {
      setCpfResult({ status: "error", fields: [], sections: [], imageUrl: null, raw: "" });
    });

    // ── Foto rotation — sequential, stops immediately on first hit, noHistory on ALL ──
    let found = false;
    for (const { tipo, label } of FOTO_ROTATION) {
      if (abortRef.current) break;
      setFotoLabel(label);
      try {
        const r = await callSkylers(tipo, cpf, token, { noHistory: true });
        if (abortRef.current) break;
        if (r.ok && r.imageUrl) {
          setFotoResult({ status: "done", fields: [], sections: [], imageUrl: r.imageUrl, raw: "" });
          setFotoLabel(label);
          found = true;
          break; // hard stop — do not continue
        }
      } catch { continue; }
    }

    if (!found && !abortRef.current) {
      setFotoResult({ status: "error", fields: [], sections: [], imageUrl: null, raw: "" });
    }

    setRunning(false);
  }, [cpf, token]);

  useEffect(() => {
    void run();
    return () => { abortRef.current = true; };
  }, [run]);

  const { headline, rest } = splitFields(cpfResult.fields);

  // Find parentes section
  const parentesSection = cpfResult.sections.find(s =>
    s.name.toUpperCase().includes("PARENTE") || s.name.toUpperCase().includes("FAMILIAR")
  );
  const otherSections = cpfResult.sections.filter(s => s !== parentesSection);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <IdCard className="w-4 h-4 text-primary" />
            <span className="text-[10px] uppercase tracking-[0.4em] text-primary/70">CPF Unificado</span>
          </div>
          <div className="font-mono text-lg font-bold tracking-[0.25em] text-foreground">{cpf}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={cpfResult.status}  label="CPF" />
          <StatusBadge status={fotoResult.status} label={`Foto · ${fotoLabel}`} />
          <button
            onClick={() => void run()}
            disabled={running}
            className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Photo + Identity headline ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">

        {/* Photo column */}
        <div className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Camera className="w-3.5 h-3.5 text-primary" />
              <span className="text-[9px] uppercase tracking-[0.35em] text-muted-foreground/60 font-bold">
                Biometria{fotoResult.status === "done" ? ` · ${fotoLabel}` : ""}
              </span>
            </div>
            {fotoResult.status === "loading" && (
              <span className="text-[8px] text-sky-400/60 flex items-center gap-1 font-mono">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                {fotoLabel}
              </span>
            )}
          </div>
          <div className="px-4 pb-4">
            <AnimatePresence mode="wait">
              {fotoResult.status === "done" && fotoResult.imageUrl ? (
                <motion.div key="photo" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="relative overflow-hidden rounded-xl border border-white/10">
                  <img
                    src={fotoResult.imageUrl}
                    alt="Foto biométrica"
                    className="w-full object-cover"
                    style={{ maxHeight: 300, minHeight: 160, objectPosition: "top" }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                  <span className="absolute bottom-2 left-2 text-[8px] uppercase tracking-widest text-white/50 bg-black/40 backdrop-blur-sm rounded px-2 py-0.5 border border-white/10">
                    {fotoLabel}
                  </span>
                </motion.div>
              ) : fotoResult.status === "error" ? (
                <motion.div key="no-photo" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="h-44 rounded-xl border border-white/5 bg-white/3 flex flex-col items-center justify-center gap-2">
                  <Camera className="w-7 h-7 text-muted-foreground/20" />
                  <span className="text-[10px] text-muted-foreground/40">Foto não encontrada</span>
                </motion.div>
              ) : (
                <motion.div key="loading-photo" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="h-44 rounded-xl border border-white/5 bg-white/3 flex flex-col items-center justify-center gap-3">
                  <Fingerprint className="w-8 h-8 text-muted-foreground/20 animate-pulse" />
                  <span className="text-[9px] text-sky-400/50 uppercase tracking-[0.3em]">
                    buscando {fotoLabel}…
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Identity headline */}
        <div className="rounded-2xl border border-white/10 bg-black/30 overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-white/5">
            <User className="w-4 h-4 text-primary" />
            <span className="text-[11px] uppercase tracking-[0.35em] font-bold text-muted-foreground">Registro Geral</span>
          </div>
          <div className="px-5 py-2">
            {cpfResult.status === "loading" ? (
              <SkeletonRows n={7} />
            ) : cpfResult.status === "done" && headline.length > 0 ? (
              headline.map(f => <FieldRow key={f.key} label={f.key} value={f.value} />)
            ) : cpfResult.status === "error" ? (
              <div className="flex items-center gap-2 py-4 text-rose-400/70 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                CPF não encontrado ou acesso bloqueado
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Remaining fields (dados adicionais) ───────────────────────────── */}
      <AnimatePresence>
        {cpfResult.status === "done" && rest.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <SectionCard
              title="Dados Adicionais"
              icon={FileText}
              defaultOpen={false}
              badge={`${rest.length} campos`}
            >
              <div className="pt-2">
                {rest.map(f => <FieldRow key={f.key} label={f.key} value={f.value} />)}
              </div>
            </SectionCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Dynamic sections (streaming in as CPF result arrives) ─────────── */}
      <AnimatePresence>
        {cpfResult.status === "loading" && (
          <motion.div key="skel-sections" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="rounded-2xl border border-white/10 bg-black/30 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-4 h-4 rounded bg-white/8 animate-pulse" />
                  <div className="w-32 h-2.5 rounded bg-white/6 animate-pulse" />
                </div>
                <SkeletonRows n={3} />
              </div>
            ))}
          </motion.div>
        )}

        {cpfResult.status === "done" && otherSections.map((sec, i) => (
          <motion.div
            key={sec.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <SectionCard
              title={sec.name}
              icon={sectionIcon(sec.name)}
              defaultOpen={i < 2}
              badge={`${sec.items.length}`}
            >
              <div className="pt-3 space-y-2">
                {sec.items.map((item, j) => {
                  // Try to parse as key:value pairs for nicer display
                  const kv = parseItemFields(item);
                  const entries = Object.entries(kv);
                  if (entries.length > 1) {
                    return (
                      <div key={j} className="rounded-lg border border-white/8 bg-white/3 px-3 py-2.5 space-y-1.5">
                        {entries.map(([k, v]) => (
                          <div key={k} className="flex items-start gap-2">
                            <span className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground/40 w-28 shrink-0 pt-0.5">{k}</span>
                            <span className="text-xs font-mono text-foreground/80 break-all flex-1">{v}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return (
                    <div key={j} className="text-sm text-foreground/75 font-mono leading-relaxed px-1 py-1 border-b border-white/5 last:border-0">
                      {item}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* ── Parentes (with photos) ─────────────────────────────────────────── */}
      <AnimatePresence>
        {cpfResult.status === "done" && parentesSection && parentesSection.items.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <SectionCard
              title="Parentes"
              icon={Users}
              defaultOpen={true}
              badge={`${parentesSection.items.length}`}
            >
              <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {parentesSection.items.map((item, i) => (
                  <ParenteCard key={i} item={item} token={token} />
                ))}
              </div>
            </SectionCard>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
