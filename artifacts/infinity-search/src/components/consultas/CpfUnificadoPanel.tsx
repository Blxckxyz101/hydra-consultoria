import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IdCard, Camera, FileText, Loader2, AlertTriangle, CheckCircle2, XCircle,
  User, MapPin, Phone, Mail, Briefcase, ChevronDown, ChevronUp, Copy, Check,
  RefreshCw, Fingerprint,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Status = "idle" | "loading" | "done" | "error";
type Field  = [string, string];

interface ModuleResult {
  status: Status;
  fields: Field[];
  sections: { name: string; items: string[] }[];
  imageUrl?: string | null;
  raw: string;
}

// ─── Foto rotation order (biggest state DBs first) ───────────────────────────
const FOTO_ROTATION = [
  { tipo: "fotonc",  label: "Nacional"         },
  { tipo: "fotosp",  label: "SP"               },
  { tipo: "fotomg",  label: "MG"               },
  { tipo: "fotoba",  label: "BA"               },
  { tipo: "fotope",  label: "PE"               },
  { tipo: "fotorn",  label: "RN"               },
  { tipo: "fotopr",  label: "PR"               },
  { tipo: "fotodf",  label: "DF"               },
  { tipo: "fotorj",  label: "RJ"               },
  { tipo: "fotoce",  label: "CE"               },
  { tipo: "fotoma",  label: "MA"               },
  { tipo: "fotopb",  label: "PB"               },
  { tipo: "fotomg",  label: "MG"               },
  { tipo: "fotogo",  label: "GO"               },
  { tipo: "fotopi",  label: "PI"               },
  { tipo: "fotoal",  label: "AL"               },
  { tipo: "fototo",  label: "TO"               },
  { tipo: "fotoes",  label: "ES"               },
  { tipo: "fotoro",  label: "RO"               },
  { tipo: "fotoms",  label: "MS"               },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normKey(k: string): string {
  return k.toUpperCase()
    .normalize("NFD").replace(/\p{Mn}/gu, "")
    .replace(/[\s_\-·]+/g, "");
}

function extractImage(raw: string): string | null {
  const imageKeys = ["FOTO", "URLBASE64", "IMAGEMBASE64", "BASE64", "IMAGEM", "URLFOTO", "IMAGE"];
  try {
    const parsed = JSON.parse(raw);
    const search = (obj: unknown, depth = 0): string | null => {
      if (depth > 6 || !obj || typeof obj !== "object") return null;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const nk = normKey(k);
        if (imageKeys.some(ik => nk.includes(ik)) && typeof v === "string" && v.length > 100) {
          if (v.startsWith("http")) return v;
          return `data:image/jpeg;base64,${v}`;
        }
        const nested = search(v, depth + 1);
        if (nested) return nested;
      }
      return null;
    };
    return search(parsed);
  } catch {
    const b64 = raw.match(/"(?:foto|imagem|base64|image)":\s*"([A-Za-z0-9+/=]{200,})"/i);
    if (b64) return `data:image/jpeg;base64,${b64[1]}`;
    const url = raw.match(/"(?:url|foto|imagem)":\s*"(https?:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i);
    if (url) return url[1];
    return null;
  }
}

function parseResponse(raw: string): { fields: Field[]; sections: { name: string; items: string[] }[] } {
  const SEP = "\u23AF";
  const fields: Field[] = [];
  const sections: { name: string; items: string[] }[] = [];

  // Delimited provider format
  if (raw.includes(SEP)) {
    let currentSection: { name: string; items: string[] } | null = null;
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("⠀") || t.startsWith("▸") || /^[A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ\s]+:?\s*$/.test(t)) {
        currentSection = { name: t.replace(/^[▸⠀]+/, "").trim(), items: [] };
        sections.push(currentSection);
        continue;
      }
      const idx = t.indexOf(SEP);
      if (idx !== -1) {
        const key = t.slice(0, idx).trim();
        const val = t.slice(idx + 1).trim();
        if (key && val) {
          fields.push([key, val]);
        }
      } else if (currentSection && t) {
        currentSection.items.push(t);
      }
    }
    return { fields, sections };
  }

  // JSON format
  try {
    const parsed = JSON.parse(raw);
    const flatten = (obj: unknown, prefix = ""): void => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        obj.forEach((item, i) => flatten(item, `${prefix}[${i}]`));
        return;
      }
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          const strV = String(v);
          if (strV.length < 300 && !strV.startsWith("data:image") && strV.length > 0) {
            fields.push([k.replace(/_/g, " ").toUpperCase(), strV]);
          }
        } else if (v && typeof v === "object") {
          flatten(v, key);
        }
      }
    };
    flatten(parsed);
  } catch {
    // plain text
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t) fields.push(["INFO", t]);
    }
  }

  return { fields, sections };
}

async function fetchSkylers(tipo: string, cpf: string, token: string): Promise<{ ok: boolean; raw: string }> {
  const r = await fetch("/api/infinity/external/skylers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tipo, dados: cpf }),
  });
  const raw = await r.text();
  return { ok: r.ok, raw };
}

// ─── FieldRow ─────────────────────────────────────────────────────────────────
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

// ─── SectionCard ──────────────────────────────────────────────────────────────
function SectionCard({ title, icon: Icon, children, defaultOpen = true }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultOpen?: boolean;
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

// ─── StatusBadge ─────────────────────────────────────────────────────────────
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

// ─── Identity key groupings ───────────────────────────────────────────────────
const IDENTITY_KEYS = new Set([
  "NOME", "CPF", "RG", "SEXO", "DATANASCIMENTO", "NASC", "NASCIMENTO",
  "MAE", "NOMEMAE", "PAI", "NOMEPAI", "NATURALIDADE", "NACIONALIDADE",
  "ESTADOCIVIL", "SITUACAOCADASTRAL", "ORGAOEMISSOR", "DATAEMISSAO",
  "TITULOELEITOR", "PIS", "NIS", "CNS", "TIPOSANGUINEO",
]);
const ADDRESS_KEYS   = new Set(["LOGRADOURO","NUMERO","COMPLEMENTO","BAIRRO","CIDADE","MUNICIPIO","UF","CEP","ESTADO","ENDERECO"]);
const CONTACT_KEYS   = new Set(["TELEFONE","CELULAR","DDD","EMAIL","WHATSAPP","CONTATO"]);
const WORK_KEYS      = new Set(["EMPRESA","CNPJ","CARGO","ADMISSAO","DEMISSAO","SALARIO","EMPREGO","RAIS","VINCULO"]);

function groupFields(fields: Field[]) {
  const identity: Field[] = [], address: Field[] = [], contact: Field[] = [], work: Field[] = [], other: Field[] = [];
  for (const f of fields) {
    const nk = normKey(f[0]);
    if (IDENTITY_KEYS.has(nk) || [...IDENTITY_KEYS].some(ik => nk.includes(ik))) identity.push(f);
    else if (ADDRESS_KEYS.has(nk) || [...ADDRESS_KEYS].some(ak => nk.includes(ak))) address.push(f);
    else if (CONTACT_KEYS.has(nk) || [...CONTACT_KEYS].some(ck => nk.includes(ck))) contact.push(f);
    else if (WORK_KEYS.has(nk) || [...WORK_KEYS].some(wk => nk.includes(wk))) work.push(f);
    else other.push(f);
  }
  return { identity, address, contact, work, other };
}

// ─── Main component ───────────────────────────────────────────────────────────
export function CpfUnificadoPanel({ cpf }: { cpf: string }) {
  const token = localStorage.getItem("infinity_token") ?? "";

  const [mods, setMods] = useState<Record<string, ModuleResult>>({
    cpf:      { status: "idle", fields: [], sections: [], raw: "" },
    cpfbasico:{ status: "idle", fields: [], sections: [], raw: "" },
    foto:     { status: "idle", fields: [], sections: [], imageUrl: null, raw: "" },
  });
  const [fotoLabel, setFotoLabel] = useState("fotonc");
  const [running, setRunning] = useState(false);

  const setMod = (key: string, update: Partial<ModuleResult>) =>
    setMods(prev => ({ ...prev, [key]: { ...prev[key]!, ...update } }));

  const fetchAll = async () => {
    setRunning(true);
    setMods({
      cpf:      { status: "loading", fields: [], sections: [], raw: "" },
      cpfbasico:{ status: "loading", fields: [], sections: [], raw: "" },
      foto:     { status: "loading", fields: [], sections: [], imageUrl: null, raw: "" },
    });

    // CPF padrão + CPF básico in parallel
    void fetchSkylers("cpf", cpf, token).then(({ ok, raw }) => {
      const { fields, sections } = parseResponse(raw);
      setMod("cpf", { status: ok ? "done" : "error", fields, sections, raw });
    }).catch(() => setMod("cpf", { status: "error", fields: [], sections: [], raw: "" }));

    void fetchSkylers("cpfbasico", cpf, token).then(({ ok, raw }) => {
      const { fields, sections } = parseResponse(raw);
      setMod("cpfbasico", { status: ok ? "done" : "error", fields, sections, raw });
    }).catch(() => setMod("cpfbasico", { status: "error", fields: [], sections: [], raw: "" }));

    // Photo rotation
    let found = false;
    for (const { tipo, label } of FOTO_ROTATION) {
      if (found) break;
      try {
        const { ok, raw } = await fetchSkylers(tipo, cpf, token);
        if (!ok) continue;
        const img = extractImage(raw);
        if (img) {
          setFotoLabel(label);
          setMod("foto", { status: "done", fields: [], sections: [], imageUrl: img, raw });
          found = true;
        }
      } catch {
        continue;
      }
    }
    if (!found) {
      setMod("foto", { status: "error", fields: [], sections: [], imageUrl: null, raw: "" });
    }
    setRunning(false);
  };

  useEffect(() => { void fetchAll(); }, [cpf]);

  const cpfResult      = mods["cpf"]!;
  const cpfbasicoResult= mods["cpfbasico"]!;
  const fotoResult     = mods["foto"]!;

  const cpfGroups = groupFields(cpfResult.fields);
  const basicGroups = groupFields(cpfbasicoResult.fields);

  const isAllDone = cpfResult.status !== "loading" && cpfbasicoResult.status !== "loading" && fotoResult.status !== "loading";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <IdCard className="w-4 h-4 text-primary" />
            <span className="text-[10px] uppercase tracking-[0.4em] text-primary/70">CPF Unificado</span>
          </div>
          <div className="font-mono text-lg font-bold tracking-[0.25em] text-foreground">{cpf}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={cpfResult.status}      label="CPF" />
          <StatusBadge status={cpfbasicoResult.status} label="Básico" />
          <StatusBadge status={fotoResult.status}      label={`Foto · ${fotoLabel}`} />
          <button
            onClick={() => void fetchAll()}
            disabled={running}
            className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Global loading */}
      {!isAllDone && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-sky-400/5 border border-sky-400/20">
          <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
          <span className="text-xs text-sky-300/80">Consultando todas as bases…</span>
        </div>
      )}

      {/* Two-column layout: photo + identity */}
      <AnimatePresence>
        {isAllDone && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4"
          >
            {/* Photo column */}
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
                <div className="px-4 pt-4 pb-2 flex items-center gap-2">
                  <Camera className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[9px] uppercase tracking-[0.35em] text-muted-foreground/60 font-bold">Biometria · {fotoLabel}</span>
                </div>
                {fotoResult.status === "done" && fotoResult.imageUrl ? (
                  <div className="px-4 pb-4">
                    <div className="relative overflow-hidden rounded-xl border border-white/10">
                      <img
                        src={fotoResult.imageUrl}
                        alt="Foto biométrica"
                        className="w-full object-cover"
                        style={{ maxHeight: 320, minHeight: 180, objectPosition: "top" }}
                        onError={e => { (e.currentTarget as HTMLImageElement).src = ""; }}
                      />
                      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                      <span className="absolute bottom-2 left-2 text-[8px] uppercase tracking-widest text-white/50 bg-black/40 backdrop-blur-sm rounded px-2 py-0.5 border border-white/10">
                        {fotoLabel}
                      </span>
                    </div>
                  </div>
                ) : fotoResult.status === "loading" ? (
                  <div className="px-4 pb-4">
                    <div className="h-48 rounded-xl border border-white/5 bg-white/3 flex items-center justify-center">
                      <Fingerprint className="w-8 h-8 text-muted-foreground/20 animate-pulse" />
                    </div>
                  </div>
                ) : (
                  <div className="px-4 pb-4">
                    <div className="h-48 rounded-xl border border-white/5 bg-white/3 flex flex-col items-center justify-center gap-2">
                      <Camera className="w-7 h-7 text-muted-foreground/20" />
                      <span className="text-[10px] text-muted-foreground/40">Foto não encontrada</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Data column */}
            <div className="space-y-3">
              {/* Identity from CPF */}
              {cpfResult.status === "done" && cpfGroups.identity.length > 0 && (
                <SectionCard title="Registro Geral" icon={User}>
                  <div className="pt-3">
                    {cpfGroups.identity.map(([k, v]) => <FieldRow key={k} label={k} value={v} />)}
                  </div>
                </SectionCard>
              )}

              {/* Address */}
              {(cpfGroups.address.length > 0 || basicGroups.address.length > 0) && (
                <SectionCard title="Endereço" icon={MapPin} defaultOpen={false}>
                  <div className="pt-3">
                    {[...cpfGroups.address, ...basicGroups.address.filter(f =>
                      !cpfGroups.address.some(cf => normKey(cf[0]) === normKey(f[0]))
                    )].map(([k, v]) => <FieldRow key={k} label={k} value={v} />)}
                  </div>
                </SectionCard>
              )}

              {/* Contact */}
              {(cpfGroups.contact.length > 0 || basicGroups.contact.length > 0) && (
                <SectionCard title="Contato" icon={Phone} defaultOpen={false}>
                  <div className="pt-3">
                    {[...cpfGroups.contact, ...basicGroups.contact.filter(f =>
                      !cpfGroups.contact.some(cf => normKey(cf[0]) === normKey(f[0]))
                    )].map(([k, v]) => <FieldRow key={k} label={k} value={v} />)}
                  </div>
                </SectionCard>
              )}

              {/* CPF Básico fields */}
              {cpfbasicoResult.status === "done" && basicGroups.identity.length > 0 && (
                <SectionCard title="CPF Básico · Skylers" icon={FileText} defaultOpen={false}>
                  <div className="pt-3">
                    {basicGroups.identity.filter(f =>
                      !cpfGroups.identity.some(cf => normKey(cf[0]) === normKey(f[0]))
                    ).map(([k, v]) => <FieldRow key={k} label={k} value={v} />)}
                    {basicGroups.other.map(([k, v]) => <FieldRow key={k} label={k} value={v} />)}
                  </div>
                </SectionCard>
              )}

              {/* Work / empregos */}
              {(cpfGroups.work.length > 0 || basicGroups.work.length > 0) && (
                <SectionCard title="Vínculos Empregatícios" icon={Briefcase} defaultOpen={false}>
                  <div className="pt-3">
                    {[...cpfGroups.work, ...basicGroups.work].map(([k, v], i) => <FieldRow key={`${k}-${i}`} label={k} value={v} />)}
                  </div>
                </SectionCard>
              )}

              {/* Email */}
              {cpfGroups.other.filter(f => normKey(f[0]).includes("EMAIL")).length > 0 && (
                <SectionCard title="Email" icon={Mail} defaultOpen={false}>
                  <div className="pt-3">
                    {cpfGroups.other.filter(f => normKey(f[0]).includes("EMAIL")).map(([k, v]) => <FieldRow key={k} label={k} value={v} />)}
                  </div>
                </SectionCard>
              )}

              {/* Sections from provider text */}
              {cpfResult.sections.map((sec, i) => (
                <SectionCard key={i} title={sec.name} icon={FileText} defaultOpen={false}>
                  <div className="pt-3 space-y-1.5">
                    {sec.items.map((item, j) => (
                      <div key={j} className="text-sm text-foreground/80 font-mono leading-relaxed">{item}</div>
                    ))}
                  </div>
                </SectionCard>
              ))}

              {/* Error states */}
              {cpfResult.status === "error" && cpfResult.fields.length === 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-rose-400/5 border border-rose-400/20">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="text-xs text-rose-300/80">CPF padrão — sem resultado ou acesso bloqueado</span>
                </div>
              )}
              {cpfbasicoResult.status === "error" && cpfbasicoResult.fields.length === 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-rose-400/5 border border-rose-400/20">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="text-xs text-rose-300/80">CPF Básico — sem resultado ou acesso bloqueado</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
