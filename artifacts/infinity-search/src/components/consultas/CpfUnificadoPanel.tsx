/**
 * CpfUnificadoPanel — Consulta CPF Unificada
 *
 * Módulos:
 *  1. POST /api/infinity/consultas/cpf          — Hydra API (loga histórico uma vez)
 *  2. POST /api/infinity/external/skylers       { tipo:"cpfbasico", skipLog:true }
 *  3. Foto: /external/skylers em batches de 3 paralelos — para no 1º hit (mais rápido)
 *
 * Design: idêntico ao CpfFullPanel (carteira roxa, hero photo, mapa Leaflet/Nominatim)
 */

import { useState, useEffect, useRef, useMemo, createContext, useContext, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Fingerprint, Camera, FileText, Loader2, AlertTriangle,
  User, MapPin, Phone, Mail, ChevronDown,
  Copy, Check, RefreshCw, Users, Briefcase,
  CheckCircle2, XCircle, IdCard, Home, Download,
  LayoutList, StretchHorizontal,
} from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// ─── View mode context ────────────────────────────────────────────────────────
const ViewModeCtx = createContext<"compact" | "expanded">("expanded");
const useViewMode = () => useContext(ViewModeCtx);
type IconProp = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

// ─── Types ────────────────────────────────────────────────────────────────────
type Status = "idle" | "loading" | "done" | "error";
interface RawField   { key: string; value: string }
interface RawSection { name: string; items: string[] }
interface ParsedData { fields: [string, string][]; sections: { name: string; items: string[] }[]; raw: string }

type Identity = {
  nome: string; cpf: string; rg: string; mae: string; pai: string;
  naturalidade: string; dataNascimento: string; sexo: string;
  estadoCivil: string; orgaoEmissor: string; dataEmissao: string;
  situacaoCadastral: string; tipoSanguineo: string; pis: string; nis: string;
  email: string; enderecoPrincipal: string;
};
type Address = {
  logradouro: string; numero: string; complemento: string;
  bairro: string; cidade: string; uf: string; cep: string;
  lat?: number; lng?: number;
};

// ─── Foto rotation order (19 estados) ────────────────────────────────────────
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
const FOTO_BATCH = 3; // paralelos por rodada

// ─── Utilities ────────────────────────────────────────────────────────────────
function fmtCPF(c: string) {
  const d = c.replace(/\D/g, "");
  if (d.length !== 11) return c;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}

function normKey(k: string): string {
  return k.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[_\-\s\u00B7]/g,"");
}
function gf(fields: [string,string][], ...keys: string[]): string {
  for (const key of keys) {
    const ku = normKey(key);
    const f = fields.find(([fk]) => { const fku = normKey(fk); return fku === ku || fku.includes(ku); });
    if (f?.[1]?.trim()) return f[1].trim();
  }
  return "";
}
function gfExact(fields: [string,string][], ...keys: string[]): string {
  for (const key of keys) {
    const ku = normKey(key);
    const found = fields.find(([fk]) => normKey(fk) === ku);
    if (found?.[1]?.trim()) return found[1].trim();
  }
  return "";
}
function rxv(raw: string, ...keys: string[]): string {
  for (const key of keys) {
    const pattern = new RegExp(`(?:^|\\n|\\|)\\s*${key}[\\s:·]+([^\\n|·]{2,80})`, "im");
    const m = pattern.exec(raw);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

// ─── Normalize fields from API response ──────────────────────────────────────
function normalizeFields(raw: unknown): [string,string][] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0];
  if (Array.isArray(first)) return raw as [string,string][];
  if (typeof first === "object" && first !== null && "key" in first)
    return (raw as RawField[]).map(f => [f.key ?? "", f.value ?? ""] as [string,string]);
  return [];
}

// ─── API fetch helpers ────────────────────────────────────────────────────────
async function fetchModule(
  tipo: string, dados: string, skylers: boolean, skipLog = false, token: string
): Promise<{ ok: boolean; fields: [string,string][]; sections: RawSection[]; raw: string; imageUrl: string | null }> {
  try {
    const endpoint = skylers ? "/api/infinity/external/skylers" : `/api/infinity/consultas/${tipo}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 28_000);
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(skipLog ? { "X-Skip-Log": "1" } : {}),
      },
      body: JSON.stringify({ tipo, dados, skipLog }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const json = await r.json() as { success?: boolean; data?: Record<string, unknown>; error?: string };
    if (!json.data) return { ok: false, fields: [], sections: [], raw: "", imageUrl: null };
    const d = json.data;
    const rawFields = normalizeFields(d["fields"]);
    const fotoField = rawFields.find(([k]) => normKey(k) === "FOTOURL" || normKey(k) === "FOTO");
    return {
      ok:       !!json.success,
      fields:   rawFields.filter(([k]) => normKey(k) !== "FOTOURL" && normKey(k) !== "FOTO"),
      sections: Array.isArray(d["sections"]) ? d["sections"] as RawSection[] : [],
      raw:      typeof d["raw"] === "string" ? d["raw"] : "",
      imageUrl: fotoField?.[1] ?? null,
    };
  } catch {
    return { ok: false, fields: [], sections: [], raw: "", imageUrl: null };
  }
}

// ─── Build identity ───────────────────────────────────────────────────────────
function buildIdentity(cpfInput: string, fields: [string,string][], raw: string): Identity {
  const BOGUS_RE = /^(brasil|brazil|brasileir[ao]|português[ao]?|masculino|feminino|masc|fem|desconhecido|nao\s+consta|não\s+consta|sem\s+informacao|sem\s+informação|nao\s+informado|não\s+informado)$/i;
  const cleanNome = (v: string) => (!v || BOGUS_RE.test(v.trim()) ? "" : v);
  const BOGUS_PARENT_RE = /^(brasil|desconhecido|nao\s+consta|não\s+consta|sem\s+informacao|sem\s+informação|nao\s+informado|não\s+informado)$/i;
  const isValidParent = (v: string, subj: string) =>
    v.length >= 5 && v.toUpperCase() !== subj.toUpperCase() && !BOGUS_PARENT_RE.test(v.trim()) &&
    !/\b(NAO\s+ENCONTRADO|NÃO\s+ENCONTRADO|NAO\s+CONSTA|NÃO\s+CONSTA)\b/i.test(v);

  const nome = cleanNome(
    gfExact(fields,"NOME","NOME COMPLETO","NOMECOMPLETO","NOME DO CONTRIBUINTE") ||
    gf(fields,"NOME COMPLETO","NOMECOMPLETO","NOME DO CONTRIBUINTE") ||
    rxv(raw,"NOME COMPLETO","NOME DO CONTRIBUINTE")
  );
  const cpfVal = gfExact(fields,"CPF","NUMERO CPF","NUMEROCPF") || gf(fields,"CPF") || rxv(raw,"CPF") || cpfInput;
  const rg     = gf(fields,"RG","REGISTRO GERAL","NUMERORG","IDENTIDADE") || rxv(raw,"RG","IDENTIDADE");
  const rawMae = gfExact(fields,"NOME MAE","NOMEMAE","FILIACAO NOME MAE","MAE","FILIACAO1","FILIACAO 1") ||
                 gf(fields,"NOME MAE","NOMEMAE","MAE","FILIACAO 1") || rxv(raw,"NOME DA MÃE","NOME MAE","MAE");
  const rawPai = gfExact(fields,"NOME PAI","NOMEPAI","FILIACAO NOME PAI","PAI","FILIACAO2","FILIACAO 2") ||
                 gf(fields,"NOME PAI","NOMEPAI","PAI","FILIACAO 2") || rxv(raw,"NOME DO PAI","NOME PAI","PAI");
  const nomeUp = nome.toUpperCase();
  const paiSameAsMae = rawPai.trim().toUpperCase() === rawMae.trim().toUpperCase() && rawMae.trim().length > 0;

  const naturalidade = gfExact(fields,"NATURALIDADE","MUNICIPIO NASCIMENTO","MUNICIPIO DE NASCIMENTO") ||
                       rxv(raw,"NATURALIDADE","MUNICIPIO DE NASCIMENTO");
  const dataNascimento = gfExact(fields,"DATA NASCIMENTO","DATANASCIMENTO","DT NASCIMENTO","NASCIMENTO","DATA NASC") ||
                         gf(fields,"DATA NASCIMENTO","DATANASCIMENTO","DT NASCIMENTO") || rxv(raw,"DATA.*NASC","NASCIMENTO");
  const sexo         = gfExact(fields,"SEXO","GENERO") || gf(fields,"SEXO","GENERO","GÊNERO") || rxv(raw,"SEXO","GÊNERO");
  const estadoCivil  = gfExact(fields,"ESTADO CIVIL","ESTADOCIVIL") || gf(fields,"ESTADO CIVIL","ESTADOCIVIL") || rxv(raw,"ESTADO CIVIL");
  const orgaoEmissor = gfExact(fields,"ORGAO EMISSOR","ORGAOEMISSOR") || gf(fields,"ORGAO EMISSOR","ORGAOEMISSOR") || rxv(raw,"ORGAO EMISSOR");
  const dataEmissao  = gfExact(fields,"DATA EMISSAO","DATAEMISSAO","DATA EMISSÃO") || gf(fields,"DATA EMISSAO") || rxv(raw,"DATA.*EMIS");
  const situacaoCadastral = gfExact(fields,"SITUACAO CADASTRAL","SITUACAOCADASTRAL","STATUS RECEITA") ||
                            gf(fields,"SITUACAO CADASTRAL","STATUS RECEITA","STATUS") || rxv(raw,"SITUACAO","STATUS");
  const tipoSanguineo = gf(fields,"TIPO SANGUINEO","TIPOSANGUINEO","SANGUE") || rxv(raw,"SANGUE","TIPO SANG");
  const pis  = gf(fields,"PIS","PIS PASEP","PISPASEP") || rxv(raw,"PIS");
  const nis  = gf(fields,"NIS","NUMERONIS") || rxv(raw,"NIS");
  const email = gf(fields,"EMAIL","E-MAIL","ENDERECOEMAIL") || rxv(raw,"EMAIL","E-MAIL");

  const addrs = buildAddresses(fields, [], raw);
  const addr0 = addrs[0];
  const enderecoPrincipal = addr0
    ? [addr0.logradouro, addr0.numero, addr0.bairro, addr0.cidade, addr0.uf].filter(Boolean).join(", ")
    : rxv(raw,"LOGRADOURO","ENDERECO","RUA") || "";

  return {
    nome, cpf: cpfVal, rg,
    mae: isValidParent(rawMae, nomeUp) ? rawMae : "",
    pai: !paiSameAsMae && isValidParent(rawPai, nomeUp) ? rawPai : "",
    naturalidade, dataNascimento, sexo, estadoCivil, orgaoEmissor, dataEmissao,
    situacaoCadastral, tipoSanguineo, pis, nis, email, enderecoPrincipal,
  };
}

// ─── Build addresses ──────────────────────────────────────────────────────────
function buildAddresses(fields: [string,string][], sections: RawSection[], raw: string): Address[] {
  const out: Address[] = []; const seen = new Set<string>();
  function addAddr(a: Address) {
    const key = `${a.logradouro}|${a.numero}|${a.cep}`.toLowerCase().trim();
    if (!key || key === "||" || (!a.logradouro && !a.cep)) return;
    if (seen.has(key)) return; seen.add(key); out.push(a);
  }
  for (const sec of sections) {
    if (!/ENDEREC|LOGRADOURO|RESID|CEP|MORADA/i.test(sec.name)) continue;
    for (const item of sec.items) {
      addAddr({
        logradouro:  item.match(/(?:LOGRADOURO|ENDERECO|RUA|AV\.?)[\s:·]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
        numero:      item.match(/(?:\bNUMERO\b|\bNUM\b|Nº|N°)[\s:·]+([^|·\n\s,]+)/i)?.[1]?.trim() ?? "",
        complemento: item.match(/(?:COMPLEMENTO|COMPL|APTO|AP)[\s:·]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
        bairro:      item.match(/BAIRRO[\s:·]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
        cidade:      item.match(/(?:CIDADE|MUNICIPIO|MUNICÍPIO)[\s:·]+([^|·\n,\-]+)/i)?.[1]?.trim() ?? "",
        uf:          item.match(/(?:\bUF\b|\bESTADO\b)[\s:·]+([A-Z]{2})/i)?.[1]?.trim() ?? "",
        cep:         item.match(/CEP[\s:·]+(\d{5}-?\d{3}|\d{8})/i)?.[1]?.trim() ?? "",
      });
    }
  }
  const logradouro = gf(fields,"LOGRADOURO","ENDERECO","RUA","ENDERECO COMPLETO");
  if (logradouro) addAddr({
    logradouro, numero: gf(fields,"NUMERO","NÚMERO","NUM"),
    complemento: gf(fields,"COMPLEMENTO","COMPL","APTO"), bairro: gf(fields,"BAIRRO"),
    cidade: gf(fields,"CIDADE","MUNICIPIO","MUNICÍPIO"), uf: gf(fields,"UF","ESTADO","UFENDERECO"), cep: gf(fields,"CEP"),
  });
  for (const cm of raw.matchAll(/CEP[\s:·]+(\d{5}-?\d{3})/gi)) {
    const cep = cm[1]; const idx = cm.index ?? 0;
    const chunk = raw.slice(Math.max(0, idx - 400), idx + 200);
    addAddr({
      logradouro: rxv(chunk,"LOGRADOURO","ENDERECO","RUA","AV") || "",
      numero: rxv(chunk,"NUMERO","N[UÚ]MERO","NUM") || "",
      complemento: rxv(chunk,"COMPLEMENTO","COMPL","APTO") || "",
      bairro: rxv(chunk,"BAIRRO") || "",
      cidade: rxv(chunk,"CIDADE","MUNICIPIO","MUNICÍPIO") || "",
      uf: chunk.match(/\bUF[\s:·]+([A-Z]{2})\b/i)?.[1] ?? "",
      cep,
    });
  }
  return out;
}

// ─── Map helpers ──────────────────────────────────────────────────────────────
const MARKER_PALETTE = [
  { fill: "#7c3aed", stroke: "#a855f7", glow: "rgba(124,58,237,0.55)" },
  { fill: "#2563eb", stroke: "#60a5fa", glow: "rgba(37,99,235,0.55)" },
  { fill: "#059669", stroke: "#34d399", glow: "rgba(5,150,105,0.55)" },
  { fill: "#b45309", stroke: "#fbbf24", glow: "rgba(180,83,9,0.55)" },
  { fill: "#be123c", stroke: "#fb7185", glow: "rgba(190,18,60,0.55)" },
  { fill: "#0e7490", stroke: "#22d3ee", glow: "rgba(14,116,144,0.55)" },
];
function markerColor(idx: number) { return MARKER_PALETTE[idx % MARKER_PALETTE.length]; }

function MapBoundsAdjuster({ points }: { points: [number,number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) { map.setView(points[0], 14, { animate: false }); return; }
    const lats = points.map(p => p[0]);
    const lngs = points.map(p => p[1]);
    map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [52,52], maxZoom: 13, animate: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);
  return null;
}

// ─── CopyBtn ──────────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1400); }); }}
      className="shrink-0 transition-colors p-1 rounded-md active:bg-white/15" title="Copiar">
      {ok ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-white/25" />}
    </button>
  );
}

// ─── Collapsible section ──────────────────────────────────────────────────────
function CollapsibleSection({ title, icon: Icon, count, children, defaultOpen = true, delay = 0 }:
  { title: string; icon: IconProp; count?: number; children: React.ReactNode; defaultOpen?: boolean; delay?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const compact = useViewMode() === "compact";
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay, ease: [0.23, 1, 0.32, 1] }}>
      <div className="relative rounded-2xl overflow-hidden"
        style={{ background: "rgba(255,255,255,0.025)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", border: "1px solid rgba(255,255,255,0.07)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 32px rgba(0,0,0,0.3)" }}>
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(255,255,255,0.12), transparent)" }} />
        <div className={compact ? "px-4 py-3" : "px-5 py-4"}>
          <button onClick={() => setOpen(v => !v)} className="flex items-center gap-2.5 w-full text-left group">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)" }}>
              <Icon className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
            </div>
            <span className={`font-bold text-white flex-1 ${compact ? "text-[13px]" : "text-[15px]"}`}>
              {title}
              {count !== undefined && <span className={`font-normal ml-2 ${compact ? "text-[11px]" : "text-[13px]"}`} style={{ color: "color-mix(in srgb, var(--color-primary) 55%, transparent)" }}>({count})</span>}
            </span>
            <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }} className="text-white/30 group-hover:text-white/60 transition-colors">
              <ChevronDown className="w-4 h-4" />
            </motion.span>
          </button>
          <div className="mt-3 mb-0 h-px" style={{ background: "linear-gradient(to right, rgba(124,58,237,0.4), rgba(124,58,237,0.08), transparent)" }} />
          <AnimatePresence initial={false}>
            {open && (
              <motion.div key="c" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: "easeInOut" }} className={compact ? "pt-3" : "pt-4"}>
                {children}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Identity Card (purple header, CARTEIRA DE IDENTIDADE) ────────────────────
function IdentityCard({ id, photo }: { id: Identity; photo: string | null }) {
  const compact = useViewMode() === "compact";
  const [cpfCopied, setCpfCopied] = useState(false);
  const uf = id.orgaoEmissor.match(/\b([A-Z]{2})$/)?.[1] ?? id.orgaoEmissor.match(/[-\/\s]([A-Z]{2})$/)?.[1] ?? "";
  const copyCpf = () => {
    navigator.clipboard.writeText(fmtCPF(id.cpf)).then(() => { setCpfCopied(true); setTimeout(() => setCpfCopied(false), 1500); });
  };

  const F = ({ label, value, mono = false, accent, copyable }: { label: string; value: string; mono?: boolean; accent?: string; copyable?: boolean }) => {
    const [copied, setCopied] = useState(false);
    return (
      <div className="min-w-0 group relative">
        <p className="text-[8px] uppercase tracking-[0.22em] text-white/30 font-semibold mb-0.5">{label}</p>
        <div className="flex items-center gap-1.5">
          <p className={`flex-1 font-bold leading-tight break-words ${mono ? "font-mono" : ""} ${accent ?? "text-white"} ${compact ? "text-[11px]" : "text-[12.5px]"}`}>
            {value || <span className="text-white/20 font-normal">—</span>}
          </p>
          {copyable && value && (
            <button onClick={() => { navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}
              className="shrink-0 transition-colors p-1 rounded-md active:bg-white/15" title={`Copiar ${label}`}>
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-white/25" />}
            </button>
          )}
        </div>
        <div className="h-px bg-white/5 mt-1.5" />
      </div>
    );
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
      {/* Header banner — purple gradient */}
      <div className="relative px-6 sm:px-8 py-5 overflow-hidden"
        style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 55%, black) 0%, color-mix(in srgb, var(--color-primary) 40%, black) 50%, color-mix(in srgb, var(--color-primary) 48%, black) 100%)" }}>
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)", backgroundSize: "12px 12px" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 80% 50%, rgba(255,255,255,0.08) 0%, transparent 70%)" }} />
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">🇧🇷</span>
              <p className="text-[9px] font-extrabold tracking-[0.22em] text-white/95">REPÚBLICA FEDERATIVA DO BRASIL</p>
            </div>
            {uf && <p className="text-[8px] tracking-[0.16em] text-white/60 mb-0.5">SECRETARIA DE SEGURANÇA PÚBLICA — SSP/{uf}</p>}
            <p className="text-[13px] font-black tracking-[0.32em] text-white mt-1">CARTEIRA DE IDENTIDADE</p>
            {id.cpf && (
              <button onClick={copyCpf}
                className="mt-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all active:scale-95"
                style={{ background: cpfCopied ? "rgba(52,211,153,0.2)" : "rgba(255,255,255,0.12)", border: `1px solid ${cpfCopied ? "rgba(52,211,153,0.5)" : "rgba(255,255,255,0.22)"}`, backdropFilter: "blur(8px)" }}>
                {cpfCopied
                  ? <><Check className="w-3 h-3 text-emerald-300" /><span className="text-[11px] font-bold text-emerald-300 font-mono">Copiado!</span></>
                  : <><Copy className="w-3 h-3 text-white/70" /><span className="text-[11px] font-bold text-white/90 font-mono">{fmtCPF(id.cpf)}</span></>}
              </button>
            )}
          </div>
          <div className="text-right shrink-0">
            <span className="inline-block text-[8px] bg-white/20 backdrop-blur rounded-full px-3 py-1 text-white/90 border border-white/25 font-semibold tracking-widest">1ª VIA</span>
            {id.situacaoCadastral && (
              <p className={`text-[9px] mt-1.5 font-bold tracking-widest ${/REGULAR|ATIVO/i.test(id.situacaoCadastral) ? "text-emerald-300" : "text-amber-300"}`}>
                ◉ {id.situacaoCadastral.toUpperCase()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ background: "rgba(9,9,15,0.85)", backdropFilter: "blur(16px)" }} className={compact ? "p-4" : "p-5 sm:p-7"}>
        {compact ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-3">
              <p className="text-[8px] uppercase tracking-[0.22em] text-white/30 mb-0.5">Nome Completo</p>
              <p className="text-[15px] font-black text-white">{id.nome || "—"}</p>
              <div className="h-px bg-white/5 mt-1.5" />
            </div>
            <F label="CPF" value={fmtCPF(id.cpf)} mono copyable />
            <F label="RG" value={id.rg} />
            <F label="Nascimento" value={id.dataNascimento} />
            <F label="Mãe" value={id.mae} />
            {id.pai && <F label="Pai" value={id.pai} />}
            {id.sexo && <F label="Sexo" value={id.sexo} />}
          </div>
        ) : (
          <div className="flex gap-4">
            {/* Photo column */}
            <div className="shrink-0 flex flex-col items-center gap-2">
              <div className="relative overflow-hidden rounded-xl flex items-center justify-center"
                style={{ width: 76, height: 100, border: "2px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.04)", boxShadow: "0 4px 20px rgba(0,0,0,0.55)" }}>
                {photo
                  ? <img src={photo} alt="Foto" className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  : <div className="flex flex-col items-center gap-1 px-1">
                      <Camera className="w-6 h-6 text-white/15" />
                      <p className="text-[7px] text-white/15 text-center leading-tight">Sem foto</p>
                    </div>}
                {photo && (
                  <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(52,211,153,0.25)", border: "1px solid rgba(52,211,153,0.5)" }}>
                    <Fingerprint className="w-2 h-2 text-emerald-300" />
                  </div>
                )}
              </div>
              <p className="text-[6px] uppercase tracking-[0.15em] text-white/20 text-center">Titular</p>
              {id.tipoSanguineo && (
                <div className="w-11 h-11 rounded-xl border border-red-500/30 bg-red-950/20 flex flex-col items-center justify-center">
                  <p className="text-[6px] text-red-400/60 uppercase tracking-widest">Tipo</p>
                  <p className="text-sm font-black text-red-300">{id.tipoSanguineo}</p>
                </div>
              )}
            </div>

            {/* Fields grid */}
            <div className="flex-1 space-y-3 min-w-0">
              <div className="text-center mb-4">
                <p className="text-[8px] uppercase tracking-[0.32em] text-white/30 mb-1">Registro Geral</p>
                <p className="text-[22px] sm:text-[28px] font-black tracking-[0.1em] text-white leading-none">{id.rg || "—"}</p>
              </div>
              <F label="Nome Completo" value={id.nome} accent="text-white text-[13px]" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><F label="Mãe" value={id.mae} /><F label="Pai" value={id.pai} /></div>
              <div className="grid grid-cols-3 gap-2"><F label="Nascimento" value={id.dataNascimento} /><F label="Sexo" value={id.sexo} /><F label="Estado Civil" value={id.estadoCivil} /></div>
              <div className="grid grid-cols-2 gap-3"><F label="CPF" value={fmtCPF(id.cpf)} mono copyable /><F label="Naturalidade" value={id.naturalidade} /></div>
              <div className="grid grid-cols-2 gap-3"><F label="Órgão Emissor" value={id.orgaoEmissor} /><F label="Data de Emissão" value={id.dataEmissao} /></div>
              {id.pis && <div className="grid grid-cols-2 gap-3"><F label="PIS / NIS" value={id.pis || id.nis} mono /></div>}
              {id.email && <F label="E-mail" value={id.email} />}
              {id.enderecoPrincipal && (
                <div className="flex items-start gap-2 rounded-xl p-3 mt-1" style={{ background: "rgba(124,58,237,0.07)", border: "1px solid rgba(124,58,237,0.15)" }}>
                  <Home className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--color-primary)" }} />
                  <div className="min-w-0">
                    <p className="text-[8px] uppercase tracking-[0.22em] text-white/30 mb-0.5">Endereço Principal</p>
                    <p className="text-[12px] font-semibold text-white/85 break-words">{id.enderecoPrincipal}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Hero Photo Banner ────────────────────────────────────────────────────────
function HeroPhotoBanner({ photo, identity, cpf }: { photo: string; identity: Identity; cpf: string }) {
  const [imgOk, setImgOk] = useState(true);
  if (!imgOk) return null;
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      className="relative overflow-hidden rounded-3xl"
      style={{ border: "1px solid color-mix(in srgb, var(--color-primary) 22%, transparent)", boxShadow: "0 0 60px color-mix(in srgb, var(--color-primary) 8%, transparent), inset 0 1px 0 rgba(255,255,255,0.06)", backdropFilter: "blur(20px)" }}>
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 14%, transparent) 0%, rgba(9,9,15,0.95) 60%)" }} />
      <motion.div className="absolute -left-20 top-0 bottom-0 w-72 rounded-full blur-3xl pointer-events-none"
        style={{ background: "color-mix(in srgb, var(--color-primary) 14%, transparent)" }}
        animate={{ opacity: [0.5, 0.9, 0.5] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} />
      <div className="relative flex items-stretch">
        <div className="relative shrink-0 w-40 sm:w-52">
          <img src={photo} alt={identity.nome} className="w-full h-full object-cover" style={{ minHeight: 180 }} onError={() => setImgOk(false)} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to right, transparent 55%, rgba(9,9,15,0.96))" }} />
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-primary) 18%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)", backdropFilter: "blur(8px)" }}>
            <Fingerprint className="w-2.5 h-2.5" style={{ color: "var(--color-primary)" }} />
            <span className="text-[7px] uppercase tracking-widest font-bold" style={{ color: "color-mix(in srgb, var(--color-primary) 90%, white)" }}>Biométrica</span>
          </div>
        </div>
        <div className="flex-1 p-6 sm:p-8 flex flex-col justify-center min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <motion.div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-primary)" }}
              animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
            <span className="text-[9px] uppercase tracking-[0.3em] font-bold" style={{ color: "color-mix(in srgb, var(--color-primary) 70%, transparent)" }}>Foto Biométrica Confirmada</span>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white leading-tight break-words mb-1">{identity.nome || "Titular"}</p>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className="font-mono text-sm text-white/40">{fmtCPF(cpf)}</span>
            {identity.dataNascimento && <span className="text-xs text-white/30">· Nasc. {identity.dataNascimento}</span>}
            {identity.situacaoCadastral && (
              <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${/REGULAR|ATIVO/i.test(identity.situacaoCadastral) ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-amber-500/15 text-amber-300 border border-amber-500/30"}`}>
                ◉ {identity.situacaoCadastral}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-5">
            <a href={photo} download={`foto-${cpf}.jpg`}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold px-3.5 py-2 rounded-xl transition-all hover:brightness-110"
              style={{ background: "color-mix(in srgb, var(--color-primary) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 32%, transparent)", color: "var(--color-primary)" }}>
              <Download className="w-3 h-3" /> Baixar Foto
            </a>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Address Card ─────────────────────────────────────────────────────────────
function AddressCard({ addr, idx }: { addr: Address; idx: number }) {
  const full = [addr.logradouro, addr.numero, addr.complemento && addr.complemento !== "Não Informado" ? addr.complemento : "", addr.bairro, addr.cidade, addr.uf].filter(Boolean).join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(full)}`;
  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.05 }}
      className="group flex items-start gap-3 rounded-xl transition-all p-3"
      style={{ border: "1px solid color-mix(in srgb, var(--color-primary) 18%, transparent)", background: "color-mix(in srgb, var(--color-primary) 5%, transparent)", backdropFilter: "blur(8px)" }}>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5"
        style={{ background: "color-mix(in srgb, var(--color-primary) 20%, transparent)", color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)" }}>{idx + 1}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-white break-words">
          {addr.logradouro}{addr.numero ? `, ${addr.numero}` : ""}{addr.complemento && addr.complemento !== "Não Informado" ? ` — ${addr.complemento}` : ""}
        </p>
        <p className="text-[12px] text-white/55 mt-0.5">{[addr.bairro, addr.cidade, addr.uf].filter(Boolean).join(" · ")}{addr.cep ? ` · CEP ${addr.cep}` : ""}</p>
        {addr.lat && <p className="text-[9px] mt-0.5" style={{ color: "color-mix(in srgb, var(--color-primary) 45%, transparent)" }}>{addr.lat.toFixed(4)}, {addr.lng?.toFixed(4)}</p>}
      </div>
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all hover:brightness-110 whitespace-nowrap shrink-0"
        style={{ color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 28%, transparent)", background: "color-mix(in srgb, var(--color-primary) 8%, transparent)" }}>
        <MapPin className="w-3 h-3" /> Maps
      </a>
    </motion.div>
  );
}

// ─── Section detail renderer ──────────────────────────────────────────────────
function parseKV(item: string) {
  const out: Record<string,string> = {};
  for (const part of item.split(/\s*[·•]\s*/)) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0,i).trim().toUpperCase()] = part.slice(i+1).trim();
  }
  return out;
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, label }: { status: Status; label: string }) {
  const color = status==="loading" ? "bg-sky-400/10 border-sky-400/30 text-sky-300"
    : status==="done"  ? "bg-emerald-400/10 border-emerald-400/30 text-emerald-300"
    : status==="error" ? "bg-rose-400/10 border-rose-400/30 text-rose-300"
    : "bg-white/5 border-white/10 text-white/30";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-[0.18em] transition-all ${color}`}>
      {status==="loading" && <Loader2 className="w-2.5 h-2.5 animate-spin"/>}
      {status==="done"    && <CheckCircle2 className="w-2.5 h-2.5"/>}
      {status==="error"   && <XCircle className="w-2.5 h-2.5"/>}
      {status==="idle"    && <span className="w-1.5 h-1.5 rounded-full bg-current"/>}
      {label}
    </span>
  );
}

// ─── Section icons ────────────────────────────────────────────────────────────
function sectionIcon(name: string): IconProp {
  const n = name.toUpperCase();
  if (n.includes("ENDE") || n.includes("CEP"))       return MapPin;
  if (n.includes("TEL") || n.includes("FONE"))       return Phone;
  if (n.includes("EMAIL") || n.includes("E-MAIL"))   return Mail;
  if (n.includes("EMPREGO") || n.includes("RAIS"))   return Briefcase;
  if (n.includes("PARENTE") || n.includes("FAMIL"))  return Users;
  if (n.includes("IDENT"))                           return IdCard;
  if (n.includes("DADOS") || n.includes("INFORM"))   return User;
  return FileText;
}

// ─── Main component ──────────────────────────────────────────────────────────
export function CpfUnificadoPanel({ cpf }: { cpf: string }) {
  const token = localStorage.getItem("infinity_token") ?? "";

  // Data state
  const [cpfFields,    setCpfFields]    = useState<[string,string][]>([]);
  const [cpfSections,  setCpfSections]  = useState<RawSection[]>([]);
  const [cpfRaw,       setCpfRaw]       = useState("");
  const [basicoFields, setBasicoFields] = useState<[string,string][]>([]);
  const [basicoSections,setBasicoSections] = useState<RawSection[]>([]);
  const [basicoRaw,    setBasicoRaw]    = useState("");

  // Status
  const [cpfStatus,   setCpfStatus]   = useState<Status>("idle");
  const [basiStatus,  setBasiStatus]  = useState<Status>("idle");
  const [fotoUrl,     setFotoUrl]     = useState<string|null>(null);
  const [fotoStatus,  setFotoStatus]  = useState<Status>("idle");
  const [fotoLabel,   setFotoLabel]   = useState("buscando…");

  // Geocoding
  const [geoAddr,     setGeoAddr]     = useState<Address[]>([]);
  const [geocodingIP, setGeocodingIP] = useState(false);

  // View mode
  const [viewMode, setViewMode] = useState<"compact"|"expanded">("expanded");

  const abortRef = useRef(false);

  const run = useCallback(async () => {
    abortRef.current = false;
    setCpfFields([]); setCpfSections([]); setCpfRaw("");
    setBasicoFields([]); setBasicoSections([]); setBasicoRaw("");
    setCpfStatus("loading"); setBasiStatus("loading");
    setFotoStatus("loading"); setFotoUrl(null); setFotoLabel("buscando…");
    setGeoAddr([]); setGeocodingIP(false);

    // ── Fase 1: CPF (Hydra) + cpfbasico (Skylers) em paralelo ────────────
    const [cpfRes, basicoRes] = await Promise.all([
      fetchModule("cpf", cpf, false, false, token),          // Hydra, loga histórico
      fetchModule("cpfbasico", cpf, true, true, token),      // Skylers, skipLog
    ]);

    if (!abortRef.current) {
      setCpfFields(cpfRes.fields);
      setCpfSections(cpfRes.sections);
      setCpfRaw(cpfRes.raw);
      setCpfStatus(cpfRes.ok ? "done" : "error");
      setBasicoFields(basicoRes.fields);
      setBasicoSections(basicoRes.sections);
      setBasicoRaw(basicoRes.raw);
      setBasiStatus(basicoRes.ok ? "done" : "error");
    }

    // ── Fase 2: Foto em batches de 3 paralelos ────────────────────────────
    // Promise.any por batch — para no primeiro hit (muito mais rápido que sequencial)
    for (let i = 0; i < FOTO_TIPOS.length; i += FOTO_BATCH) {
      if (abortRef.current) break;
      const batch = FOTO_TIPOS.slice(i, i + FOTO_BATCH);
      setFotoLabel(batch.map(t => FOTO_LABELS[t] ?? t).join(" / "));
      try {
        const { url, label } = await Promise.any(
          batch.map(tipo =>
            fetchModule(tipo, cpf, true, true, token).then(r => {
              if (r.ok && r.imageUrl) return { url: r.imageUrl, label: FOTO_LABELS[tipo] ?? tipo };
              throw new Error("no foto");
            })
          )
        );
        if (!abortRef.current) {
          setFotoUrl(url);
          setFotoStatus("done");
          setFotoLabel(label);
        }
        break; // achou foto
      } catch {
        // nenhum no batch teve foto, continua pro próximo batch
      }
    }
    if (!abortRef.current) {
      setFotoStatus(s => s === "loading" ? "error" : s);
    }
  }, [cpf, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void run();
    return () => { abortRef.current = true; };
  }, [run]);

  // ── Geocoding (igual CpfFullPanel) ────────────────────────────────────────
  const addresses = useMemo(() => {
    const merged = [...cpfFields, ...basicoFields];
    const mergedSections = [...cpfSections, ...basicoSections];
    const mergedRaw = [cpfRaw, basicoRaw].join("\n");
    return buildAddresses(merged, mergedSections, mergedRaw);
  }, [cpfFields, basicoFields, cpfSections, basicoSections, cpfRaw, basicoRaw]);

  useEffect(() => {
    if (cpfStatus === "idle" && basiStatus === "idle") return;
    if (addresses.length === 0) return;
    let cancelled = false;
    setGeocodingIP(true);
    (async () => {
      const geocodeAddr = async (q: string): Promise<{ lat: number; lng: number } | null> => {
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=br`,
            { headers: { "Accept-Language": "pt-BR", "User-Agent": "HydraConsultoria/1.0" } }
          );
          const data = await r.json() as { lat: string; lon: string }[];
          if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        } catch { /* ignore */ }
        return null;
      };
      const result: Address[] = [];
      for (const addr of addresses.slice(0, 12)) {
        if (cancelled) break;
        if (!addr.logradouro && !addr.cep && !addr.cidade) { result.push(addr); continue; }
        const queries = [
          [addr.logradouro, addr.numero, addr.bairro, addr.cidade, addr.uf, "Brasil"].filter(Boolean).join(", "),
          [addr.cidade, addr.uf, "Brasil"].filter(Boolean).join(", "),
          addr.cep ? `${addr.cep}, Brasil` : "",
        ].filter(Boolean);
        let geo: { lat: number; lng: number } | null = null;
        for (const q of queries) {
          geo = await geocodeAddr(q);
          if (geo) break;
          await new Promise(res => setTimeout(res, 280));
        }
        result.push(geo ? { ...addr, lat: geo.lat, lng: geo.lng } : addr);
        await new Promise(res => setTimeout(res, 380));
      }
      if (!cancelled) { setGeoAddr(result); setGeocodingIP(false); }
    })();
    return () => { cancelled = true; };
  }, [addresses.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived state ─────────────────────────────────────────────────────────
  const allFields   = useMemo(() => {
    const merged = [...basicoFields, ...cpfFields];
    const seen = new Set<string>();
    return merged.filter(([k]) => { const nk = normKey(k); if (seen.has(nk)) return false; seen.add(nk); return true; });
  }, [cpfFields, basicoFields]);

  const allRaw = [basicoRaw, cpfRaw].join("\n");

  const identity = useMemo(() => buildIdentity(cpf, allFields, allRaw), [cpf, allFields, allRaw]);
  const geocoded  = geoAddr.filter(a => a.lat && a.lng);
  const geocodingInProgress = geocodingIP && geocoded.length === 0 && addresses.length > 0;

  const done     = cpfStatus !== "idle" && basiStatus !== "idle";
  const loading  = cpfStatus === "loading" || basiStatus === "loading";
  const hasIdentity = !!(identity.nome || identity.rg);

  // Sections to show (merge, deduplicate by name)
  const allSections = useMemo(() => {
    const map = new Map<string, RawSection>();
    for (const s of [...basicoSections, ...cpfSections]) {
      const k = s.name.toUpperCase().trim();
      if (map.has(k)) {
        const ex = map.get(k)!;
        const exSet = new Set(ex.items);
        map.set(k, { name: ex.name, items: [...ex.items, ...s.items.filter(i => !exSet.has(i))] });
      } else map.set(k, { ...s });
    }
    return Array.from(map.values());
  }, [cpfSections, basicoSections]);

  // Non-address sections
  const dataSections = allSections.filter(s =>
    !/ENDEREC|LOGRADOURO|RESID|CEP|MORADA/i.test(s.name)
  );

  return (
    <ViewModeCtx.Provider value={viewMode}>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

        {/* ── Status bar ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={cpfStatus}  label="CPF"/>
            <StatusBadge status={basiStatus} label="Receita Federal"/>
            <StatusBadge status={fotoStatus} label={fotoStatus==="loading" ? `Foto · ${fotoLabel}` : fotoStatus==="done" ? `Foto · ${fotoLabel}` : "Foto"}/>
          </div>
          <div className="flex items-center gap-1.5">
            {done && (
              <button onClick={() => setViewMode(v => v === "expanded" ? "compact" : "expanded")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold transition-all"
                style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)" }}>
                {viewMode === "expanded" ? <><LayoutList className="w-3 h-3" /> Compacto</> : <><StretchHorizontal className="w-3 h-3" /> Expandido</>}
              </button>
            )}
            <button onClick={() => void run()} disabled={loading}
              className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all disabled:opacity-40" title="Atualizar">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}/>
            </button>
          </div>
        </div>

        {/* ── Hero Photo ──────────────────────────────────────────────────── */}
        <AnimatePresence>
          {fotoUrl && <HeroPhotoBanner photo={fotoUrl} identity={identity} cpf={cpf} />}
        </AnimatePresence>

        {/* ── Carteira de Identidade ──────────────────────────────────────── */}
        <AnimatePresence>
          {(loading || hasIdentity) && (
            <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42, delay: 0.06, ease: [0.23, 1, 0.32, 1] }}>
              {loading && !hasIdentity ? (
                /* Loading skeleton */
                <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.09)" }}>
                  <div className="relative px-6 py-5 overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.35) 0%, rgba(88,28,220,0.28) 100%)" }}>
                    <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)", backgroundSize: "12px 12px" }} />
                    <div className="relative z-10 space-y-2">
                      <div className="h-3 w-48 rounded bg-white/15 animate-pulse" />
                      <div className="h-5 w-64 rounded bg-white/10 animate-pulse" style={{ animationDelay: "100ms" }} />
                      <div className="h-8 w-40 rounded-full bg-white/8 animate-pulse mt-3" style={{ animationDelay: "200ms" }} />
                    </div>
                  </div>
                  <div className="p-6" style={{ background: "rgba(9,9,15,0.85)" }}>
                    <div className="flex gap-4">
                      <div className="w-20 h-28 rounded-xl bg-white/5 animate-pulse shrink-0" />
                      <div className="flex-1 space-y-3">
                        {[90,70,55,80,60].map((w,i) => (
                          <div key={i} className="space-y-1">
                            <div className="h-2 rounded bg-white/8 animate-pulse" style={{ width: 40, animationDelay: `${i*60}ms` }} />
                            <div className="h-3 rounded bg-white/5 animate-pulse" style={{ width: `${w}%`, animationDelay: `${i*60+30}ms` }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : hasIdentity ? (
                <IdentityCard id={identity} photo={fotoUrl} />
              ) : (
                <div className="flex items-center gap-2 py-6 px-4 rounded-xl border border-rose-400/20 bg-rose-400/5 text-rose-400/70 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0"/>
                  CPF não encontrado ou temporariamente indisponível
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Endereços + Mapa (Leaflet / Nominatim) ──────────────────────── */}
        <AnimatePresence>
          {done && addresses.length > 0 && (
            <CollapsibleSection icon={MapPin} title="Endereços" count={addresses.length} delay={0.12}>
              {/* Map */}
              <div className="rounded-2xl overflow-hidden mb-5" style={{ border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 4px 32px rgba(0,0,0,0.45)" }}>
                <div className="relative" style={{ height: 380 }}>
                  <MapContainer center={[-14.235, -51.925]} zoom={4} className="h-full w-full"
                    style={{ background: "#080a14", zIndex: 10 }} zoomControl={false}>
                    <TileLayer attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                    <MapBoundsAdjuster points={geocoded.map(a => [a.lat!, a.lng!] as [number,number])} />
                    {geocoded.map((addr, i) => {
                      const mc = markerColor(i);
                      const shortLabel = [addr.logradouro, addr.numero].filter(Boolean).join(", ") || addr.cidade || `Endereço ${i+1}`;
                      const city = [addr.cidade, addr.uf].filter(Boolean).join(" – ");
                      return (
                        <CircleMarker key={i} center={[addr.lat!, addr.lng!]} radius={i===0?13:10}
                          pathOptions={{ fillColor: mc.fill, color: mc.stroke, weight: 2.5, fillOpacity: 0.92 }}>
                          <Tooltip permanent direction="top" offset={[0, -(i===0?17:14)]}>
                            <div style={{ background: "rgba(8,10,20,0.95)", border: `1px solid ${mc.stroke}55`, borderRadius: 8, padding: "3px 8px", color: "#fff", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", maxWidth: 240, boxShadow: `0 0 10px ${mc.glow}` }}>
                              <span style={{ color: mc.stroke, marginRight: 5, fontWeight: 900 }}>{i+1}</span>
                              {shortLabel.length > 34 ? shortLabel.slice(0,34)+"…" : shortLabel}
                              {city && <span style={{ color: "rgba(255,255,255,0.42)", marginLeft: 4 }}>· {city}</span>}
                            </div>
                          </Tooltip>
                          <Popup>
                            <div style={{ minWidth: 200, fontFamily: "inherit" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                                <span style={{ background: mc.fill, color:"#fff", borderRadius:"50%", width:20, height:20, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, flexShrink:0 }}>{i+1}</span>
                                <strong style={{ fontSize:12 }}>{shortLabel || `Endereço ${i+1}`}</strong>
                              </div>
                              {addr.complemento && addr.complemento !== "Não Informado" && <p style={{ margin:"2px 0", fontSize:11, color:"#555" }}>{addr.complemento}</p>}
                              {addr.bairro && <p style={{ margin:"2px 0", fontSize:11, color:"#444" }}>{addr.bairro}</p>}
                              {city && <p style={{ margin:"2px 0", fontSize:11, color:"#333" }}>{city}</p>}
                              {addr.cep && <p style={{ margin:"2px 0", fontSize:10, color:"#777" }}>CEP {addr.cep}</p>}
                              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([addr.logradouro,addr.numero,addr.cidade,addr.uf].filter(Boolean).join(", "))}`}
                                target="_blank" rel="noopener noreferrer"
                                style={{ display:"inline-flex", alignItems:"center", gap:4, marginTop:6, color:mc.fill, fontWeight:700, fontSize:11, textDecoration:"none" }}>
                                ↗ Google Maps
                              </a>
                            </div>
                          </Popup>
                        </CircleMarker>
                      );
                    })}
                  </MapContainer>

                  {/* Top-left overlay */}
                  <div className="absolute top-3 left-3 z-[1000] pointer-events-none flex flex-col gap-2">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                      style={{ background: "rgba(8,10,20,0.92)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.09)" }}>
                      <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--color-primary)" }} />
                      <span className="text-[10px] font-bold text-white tracking-wide">Mapa de Endereços</span>
                      {geocodingInProgress
                        ? <span className="flex items-center gap-1.5 text-[9px] text-white/40"><Loader2 className="w-3 h-3 animate-spin" /> geocodificando…</span>
                        : geocoded.length > 0
                          ? <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(124,58,237,0.2)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.3)" }}>{geocoded.length}/{addresses.length} marcados</span>
                          : null}
                    </div>
                  </div>

                  {/* Legend overlay bottom-right */}
                  {geocoded.length > 0 && (
                    <div className="absolute bottom-3 right-3 z-[1000] pointer-events-none max-w-[200px]">
                      <div className="rounded-xl px-3 py-2.5 flex flex-col gap-1.5"
                        style={{ background: "rgba(8,10,20,0.9)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        {geocoded.slice(0,6).map((addr, i) => {
                          const mc = markerColor(i);
                          return (
                            <div key={i} className="flex items-center gap-2 min-w-0">
                              <span className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[8px] font-black"
                                style={{ background: mc.fill, color: "#fff", boxShadow: `0 0 6px ${mc.glow}` }}>{i+1}</span>
                              <span className="text-[9px] text-white/60 truncate">
                                {addr.cidade || addr.logradouro || `Endereço ${i+1}`}{addr.uf ? `, ${addr.uf}` : ""}
                              </span>
                            </div>
                          );
                        })}
                        {geocoded.length > 6 && <span className="text-[8px] text-white/25 text-center mt-0.5">+{geocoded.length-6} mais</span>}
                      </div>
                    </div>
                  )}

                  {/* No coords placeholder */}
                  {!geocodingInProgress && geocoded.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center z-[1000] pointer-events-none">
                      <div className="flex flex-col items-center gap-2 px-5 py-4 rounded-2xl"
                        style={{ background: "rgba(8,10,20,0.88)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <MapPin className="w-5 h-5 text-white/20" />
                        <p className="text-[10px] text-white/30">Coordenadas não encontradas</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Address list */}
              <div className="space-y-2">
                {addresses.map((a, i) => <AddressCard key={i} addr={a} idx={i} />)}
              </div>
            </CollapsibleSection>
          )}
        </AnimatePresence>

        {/* ── Seções dinâmicas ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {done && dataSections.map((sec, i) => (
            <CollapsibleSection key={sec.name} icon={sectionIcon(sec.name)} title={sec.name}
              count={sec.items.length} delay={0.16 + i*0.04} defaultOpen={i < 2}>
              <div className="space-y-2 pt-1">
                {sec.items.map((item, j) => {
                  const kv = parseKV(item);
                  const entries = Object.entries(kv);
                  if (entries.length > 1) {
                    return (
                      <div key={j} className="rounded-lg border border-white/8 bg-white/3 px-3 py-2.5 space-y-2">
                        {entries.map(([k, v]) => (
                          <div key={k} className="flex items-start gap-2 group">
                            <span className="text-[8px] uppercase tracking-[0.25em] text-white/30 w-28 shrink-0 pt-0.5 leading-tight">{k}</span>
                            <span className="text-xs font-mono text-white/80 break-all flex-1">{v}</span>
                            <CopyBtn text={v} />
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return (
                    <div key={j} className="text-sm text-white/70 font-mono leading-relaxed px-1 py-1.5 border-b border-white/5 last:border-0 group flex items-start gap-2">
                      <span className="flex-1 break-all">{item}</span>
                      <CopyBtn text={item} />
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          ))}
        </AnimatePresence>

      </motion.div>
    </ViewModeCtx.Provider>
  );
}
