import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Phone, MapPin, Users, Briefcase, IdCard,
  Wallet, BarChart2, FileText, Car, CheckCircle2, XCircle,
  Loader2, MessageCircle, Scale, Building2, Award, Gift,
  AlertTriangle, Receipt, Star, ChevronDown, ChevronUp, Copy, Check,
  Camera, Fingerprint, Home,
} from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// ─── Types ────────────────────────────────────────────────────────────────────
type ModuleStatus = "idle" | "loading" | "done" | "error";
type ParsedData = { fields: [string, string][]; sections: { name: string; items: string[] }[]; raw: string };
type ModuleResult = { status: ModuleStatus; data?: ParsedData; error?: string };

type Identity = {
  nome: string; cpf: string; rg: string; mae: string; pai: string;
  naturalidade: string; nacionalidade: string; dataNascimento: string;
  sexo: string; estadoCivil: string; orgaoEmissor: string; dataEmissao: string;
  situacaoCadastral: string; tipoSanguineo: string; tituloEleitor: string;
  pis: string; nis: string; email: string;
  enderecoPrincipal: string;
};
type PhoneEntry  = { ddd: string; numero: string; prioridade: string; classificacao: string; data: string; tipo: string };
type Address     = { logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string; lat?: number; lng?: number };
type Employment  = { empresa: string; cnpj: string; cargo: string; admissao: string; demissao: string; salario: string };

// ─── Modules list ─────────────────────────────────────────────────────────────
const MODULES = [
  { tipo: "cpf",        label: "CPF",           skylers: false },
  { tipo: "cpfbasico",  label: "CPF Básico",     skylers: true  },
  { tipo: "foto",       label: "Foto",           skylers: true  },
  { tipo: "parentes",   label: "Parentes",       skylers: false },
  { tipo: "empregos",   label: "Empregos",       skylers: false },
  { tipo: "cnh",        label: "CNH",            skylers: false },
  { tipo: "obito",      label: "Óbito",          skylers: false },
  { tipo: "score",      label: "Score",          skylers: true  },
  { tipo: "score2",     label: "Score 2",        skylers: true  },
  { tipo: "irpf",       label: "IRPF",           skylers: true  },
  { tipo: "beneficios", label: "Benefícios",     skylers: true  },
  { tipo: "mandado",    label: "Mandados",       skylers: true  },
  { tipo: "dividas",    label: "Dívidas",        skylers: true  },
  { tipo: "bens",       label: "Bens",           skylers: true  },
  { tipo: "processos",  label: "Processos",      skylers: true  },
  { tipo: "spc",        label: "SPC",            skylers: true  },
  { tipo: "titulo",     label: "Título Eleitor", skylers: true  },
];

// ─── Normalize API fields (handles both tuple[] and {key,value}[] formats) ───
function normalizeFields(raw: unknown): [string, string][] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0];
  if (Array.isArray(first)) return raw as [string, string][];
  if (typeof first === "object" && first !== null && "key" in first)
    return (raw as { key: string; value: string }[]).map(f => [f.key ?? "", f.value ?? ""] as [string, string]);
  return [];
}

// ─── Field getter — searches fields array with flexible key matching ──────────
function gf(fields: [string, string][], ...keys: string[]): string {
  for (const key of keys) {
    const ku = key.toUpperCase();
    const f = fields.find(([fk]) => {
      const fku = fk.toUpperCase().replace(/[_\-\s]/g, "");
      const ku2 = ku.replace(/[_\-\s]/g, "");
      return fku === ku2 || fku.includes(ku2) || ku2.includes(fku);
    });
    if (f?.[1]?.trim()) return f[1].trim();
  }
  return "";
}

// ─── Raw text field extractor ─────────────────────────────────────────────────
function rxv(raw: string, ...keys: string[]): string {
  for (const key of keys) {
    const pattern = new RegExp(`(?:^|\\n|\\|)\\s*${key}[\\s:·]+([^\\n|·]{2,80})`, "im");
    const m = pattern.exec(raw);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

// ─── Merge all fields from multiple results ───────────────────────────────────
function mergeFields(results: (ModuleResult | undefined)[]): [string, string][] {
  return results.flatMap(r => r?.data?.fields ?? []);
}
function mergeRaw(results: (ModuleResult | undefined)[]): string {
  return results.map(r => r?.data?.raw ?? "").join("\n");
}

// ─── Fetch one module ─────────────────────────────────────────────────────────
async function fetchModule(tipo: string, dados: string, skylers: boolean): Promise<ModuleResult> {
  const token = localStorage.getItem("infinity_token");
  try {
    const endpoint = skylers ? "/api/infinity/external/skylers" : `/api/infinity/consultas/${tipo}`;
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tipo, dados }),
    });
    const json = await r.json() as { success: boolean; data?: unknown; error?: string };
    if (!json.success) return { status: "error", error: json.error ?? "Sem resultado" };
    let parsed: ParsedData;
    if (typeof json.data === "string") {
      parsed = { fields: [], sections: [], raw: json.data };
    } else if (json.data && typeof json.data === "object") {
      const d = json.data as Record<string, unknown>;
      parsed = {
        fields:   normalizeFields(d["fields"]),
        sections: Array.isArray(d["sections"]) ? d["sections"] as ParsedData["sections"] : [],
        raw:      typeof d["raw"] === "string" ? d["raw"] : "",
      };
    } else {
      return { status: "error" };
    }
    return { status: "done", data: parsed };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Erro de rede" };
  }
}

// ─── Build identity from all CPF-related modules ──────────────────────────────
function buildIdentity(results: Record<string, ModuleResult>): Identity {
  const sources = ["cpf", "cpfbasico", "titulo", "cnh"];
  const f = mergeFields(sources.map(k => results[k]));
  const raw = mergeRaw(sources.map(k => results[k]));

  const nome              = gf(f,"NOME","NOME COMPLETO","NOME_COMPLETO")                 || rxv(raw,"NOME COMPLETO","NOME");
  const cpfVal            = gf(f,"CPF","NUMERO CPF","NUMERO_CPF")                        || rxv(raw,"CPF");
  const rg                = gf(f,"RG","REGISTRO GERAL","NUMERO_RG","NUMERO RG","IDENTIDADE") || rxv(raw,"RG","IDENTIDADE");
  const mae               = gf(f,"NOME MAE","NOME_MAE","MAE","FILIACAO 1","FILIACAO1")   || rxv(raw,"NOME DA MÃE","NOME_MAE","MAE","FILIACAO 1");
  const pai               = gf(f,"NOME PAI","NOME_PAI","PAI","FILIACAO 2","FILIACAO2")   || rxv(raw,"NOME DO PAI","NOME_PAI","PAI","FILIACAO 2");
  const naturalidade      = gf(f,"MUNICIPIO NASCIMENTO","MUNICIPIO_NASCIMENTO","NATURALIDADE","CIDADE NASCIMENTO") || rxv(raw,"NATURALIDADE","MUNICIPIO.*NASC","CIDADE.*NASC");
  const dataNascimento    = gf(f,"DATA NASCIMENTO","DATA_NASCIMENTO","DT NASCIMENTO","DT_NASCIMENTO","NASCIMENTO") || rxv(raw,"DATA.*NASC","NASCIMENTO");
  const sexo              = gf(f,"SEXO","GENERO","GÊNERO")                               || rxv(raw,"SEXO","GÊNERO");
  const estadoCivil       = gf(f,"ESTADO CIVIL","ESTADO_CIVIL")                          || rxv(raw,"ESTADO CIVIL");
  const orgaoEmissor      = gf(f,"ORGAO EMISSOR","ORGAO_EMISSOR","ÓRGÃO EMISSOR")        || rxv(raw,"ORGAO EMISSOR","ÓRGÃO EMISSOR");
  const dataEmissao       = gf(f,"DATA EMISSAO","DATA_EMISSAO","DATA EMISSÃO")           || rxv(raw,"DATA.*EMIS");
  const situacaoCadastral = gf(f,"SITUACAO CADASTRAL","SITUACAO_CADASTRAL","STATUS RECEITA","STATUS") || rxv(raw,"SITUACAO","STATUS");
  const tipoSanguineo     = gf(f,"TIPO SANGUINEO","TIPO_SANGUINEO","SANGUE")             || rxv(raw,"SANGUE","TIPO SANG");
  const tituloEleitor     = gf(f,"TITULO ELEITOR","TITULO_ELEITOR","NÚMERO TÍTULO")      || rxv(raw,"TITULO.*ELEITOR");
  const pis               = gf(f,"PIS","NIS","PIS PASEP","PIS_PASEP")                   || rxv(raw,"PIS","NIS");
  const nis               = gf(f,"NIS","PIS","NUMERO_NIS")                              || rxv(raw,"NIS");
  const email             = gf(f,"EMAIL","E-MAIL","ENDERECO EMAIL")                     || rxv(raw,"EMAIL","E-MAIL");

  // Build a short address string for the identity card header
  const addr = buildAddresses(results)[0];
  const enderecoPrincipal = addr
    ? [addr.logradouro, addr.numero, addr.bairro, addr.cidade, addr.uf].filter(Boolean).join(", ")
    : rxv(raw,"LOGRADOURO","ENDERECO","RUA") || "";

  return { nome, cpf: cpfVal, rg, mae, pai, naturalidade, nacionalidade: "BRASIL",
    dataNascimento, sexo, estadoCivil, orgaoEmissor, dataEmissao, situacaoCadastral,
    tipoSanguineo, tituloEleitor, pis, nis, email, enderecoPrincipal };
}

// ─── Build phones from all modules ───────────────────────────────────────────
function buildPhones(results: Record<string, ModuleResult>): PhoneEntry[] {
  const phones: PhoneEntry[] = [];
  const seen = new Set<string>();

  function add(ddd: string, num: string, prio = "", cls = "", data = "", tipo = "") {
    const key = `${ddd}${num.replace(/\D/g,"")}`;
    if (seen.has(key) || num.replace(/\D/g,"").length < 7) return;
    seen.add(key);
    phones.push({ ddd, numero: num.replace(/\D/g,""), prioridade: prio, classificacao: cls, data, tipo });
  }

  // From sections of any module
  for (const mod of Object.values(results)) {
    if (!mod?.data) continue;
    for (const sec of mod.data.sections) {
      if (!/TELEFON|CELULAR|CONTATO|FONE|PHONE/i.test(sec.name)) continue;
      for (const item of sec.items) {
        const ddd  = item.match(/DDD[\s:]+(\d{2,3})/i)?.[1]   ?? item.match(/\((\d{2})\)/)?.[1] ?? item.match(/^\s*(\d{2})\b/)?.[1] ?? "";
        const num  = item.match(/(?:NUMERO|TELEFONE|CELULAR|NUM)[\s:]+(\d[\d\s\-]{6,11})/i)?.[1]?.replace(/\D/g,"")
                  ?? item.match(/\(?\d{2}\)?[\s\-]?(\d{4,5}[\s\-]?\d{4})/)?.[1]?.replace(/\D/g,"") ?? "";
        const prio = item.match(/PRIORIDADE[\s:]+(\S+)/i)?.[1] ?? "";
        const cls  = item.match(/CLASSIF\w*[\s:]+(\S+)/i)?.[1] ?? "";
        const dt   = item.match(/DATA[\s:]+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? "";
        const tipo = /CELULAR|MOVEL/i.test(item) ? "Celular" : /FIXO|RESIDENC/i.test(item) ? "Fixo" : "";
        if (num) add(ddd, num, prio, cls, dt, tipo);
      }
    }

    // From fields
    for (const [k, v] of mod.data.fields) {
      if (!/TELEFON|CELULAR|FONE|PHONE/i.test(k)) continue;
      const clean = v.replace(/\D/g,"");
      if (clean.length >= 8) {
        const ddd = clean.length >= 10 ? clean.slice(0,2) : "";
        const num = clean.length >= 10 ? clean.slice(2) : clean;
        const tipo = /CELULAR|MOVEL/i.test(k) ? "Celular" : /FIXO|RESIDENC/i.test(k) ? "Fixo" : "";
        add(ddd, num, "", "", "", tipo);
      }
    }

    // From raw text — match (XX) XXXXX-XXXX patterns
    const rawPhones = mod.data.raw.matchAll(/\((\d{2})\)\s*(\d{4,5}[-\s]?\d{4})/g);
    for (const m of rawPhones) add(m[1], m[2].replace(/\D/g,""), "", "", "", "");

    // Raw text — match standalone DDD + number patterns
    const rawPhones2 = mod.data.raw.matchAll(/\b(\d{2})\s+(\d{4,5}\d{4})\b/g);
    for (const m of rawPhones2) {
      if (parseInt(m[1]) >= 11 && parseInt(m[1]) <= 99) add(m[1], m[2], "", "", "", "");
    }
  }

  return phones;
}

// ─── Build addresses from all modules ─────────────────────────────────────────
function buildAddresses(results: Record<string, ModuleResult>): Address[] {
  const out: Address[] = [];
  const seen = new Set<string>();

  function addAddr(a: Address) {
    const key = `${a.logradouro}|${a.numero}|${a.cep}`.toLowerCase();
    if (seen.has(key) || (!a.logradouro && !a.cep)) return;
    seen.add(key);
    out.push(a);
  }

  for (const mod of Object.values(results)) {
    if (!mod?.data) continue;

    // From sections
    for (const sec of mod.data.sections) {
      if (!/ENDEREC|LOGRADOURO|RESID|CEP|MORADA/i.test(sec.name)) continue;
      for (const item of sec.items) {
        addAddr({
          logradouro:  item.match(/(?:LOGRADOURO|ENDERECO|RUA|AV\.?|ALAMEDA)[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
          numero:      item.match(/(?:\bNUMERO\b|\bNUM\b|Nº|N°)[\s:]+([^|·\n\s,]+)/i)?.[1]?.trim() ?? "",
          complemento: item.match(/(?:COMPLEMENTO|COMPL|APTO|AP)[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
          bairro:      item.match(/BAIRRO[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
          cidade:      item.match(/(?:CIDADE|MUNICIPIO|MUNICÍPIO)[\s:]+([^|·\n,\-]+)/i)?.[1]?.trim() ?? "",
          uf:          item.match(/(?:\bUF\b|\bESTADO\b)[\s:]+([A-Z]{2})/i)?.[1]?.trim() ?? "",
          cep:         item.match(/CEP[\s:]+(\d{5}-?\d{3}|\d{8})/i)?.[1]?.trim() ?? "",
        });
      }
    }

    // From fields
    const f = mod.data.fields;
    const logradouro = gf(f,"LOGRADOURO","ENDERECO","RUA","ENDERECO COMPLETO","LOGRADOURO_COMPLETO");
    if (logradouro) {
      addAddr({
        logradouro,
        numero:      gf(f,"NUMERO","NÚMERO","NUM","NUMERO_IMOVEL"),
        complemento: gf(f,"COMPLEMENTO","COMPL","APTO"),
        bairro:      gf(f,"BAIRRO"),
        cidade:      gf(f,"CIDADE","MUNICIPIO","MUNICÍPIO"),
        uf:          gf(f,"UF","ESTADO","UF_ENDERECO"),
        cep:         gf(f,"CEP","CEP_ENDERECO"),
      });
    }

    // From raw text — look for CEP + surrounding address lines
    const raw = mod.data.raw;
    const cepMatches = raw.matchAll(/CEP[\s:·]+(\d{5}-?\d{3})/gi);
    for (const cm of cepMatches) {
      const cep = cm[1];
      // Get the 4 lines surrounding the CEP match
      const idx = cm.index ?? 0;
      const chunk = raw.slice(Math.max(0, idx - 400), idx + 200);
      addAddr({
        logradouro:  rxv(chunk, "LOGRADOURO","ENDERECO","RUA","AV") || "",
        numero:      rxv(chunk, "NUMERO","N[UÚ]MERO","NUM") || "",
        complemento: rxv(chunk, "COMPLEMENTO","COMPL","APTO") || "",
        bairro:      rxv(chunk, "BAIRRO") || "",
        cidade:      rxv(chunk, "CIDADE","MUNICIPIO","MUNICÍPIO") || "",
        uf:          chunk.match(/\bUF[\s:·]+([A-Z]{2})\b/i)?.[1] ?? "",
        cep,
      });
    }
  }

  return out;
}

// ─── Build employments ────────────────────────────────────────────────────────
function buildEmployments(r?: ModuleResult): Employment[] {
  if (!r?.data) return [];
  const out: Employment[] = [];
  for (const sec of r.data.sections) {
    for (const item of sec.items) {
      const empresa = item.match(/(?:EMPRESA|RAZAO SOCIAL|EMPREGADOR|NOME_EMPREGADOR)[\s:]+([^|·\n]+)/i)?.[1]?.trim()
                   ?? item.match(/^([^|·\n:]{5,60})(?:\s*[|·]|$)/)?.[1]?.trim() ?? "";
      out.push({
        empresa,
        cnpj:     item.match(/CNPJ[\s:]+(\d[\d.\-/]+)/i)?.[1] ?? "",
        cargo:    item.match(/(?:CARGO|FUNCAO|FUNÇÃO|CBO)[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
        admissao: item.match(/(?:ADMISSAO|ADMISSÃO|ENTRADA|DT_ADMISSAO|DATA ADMIS)[\s:]+(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? "",
        demissao: item.match(/(?:DEMISSAO|DEMISSÃO|SAIDA|DT_RESCISAO|DATA DEMIS)[\s:]+(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? "",
        salario:  item.match(/(?:SALARIO|SALÁRIO|REMUNER|SALARIO_CONTRIBUICAO)[\s:]+([R$\d.,\s]+)/i)?.[1]?.trim() ?? "",
      });
    }
  }
  return out.filter(e => e.empresa);
}

// ─── Extract photo from foto module or fallback ───────────────────────────────
function extractPhoto(results: Record<string, ModuleResult>): string | null {
  const fotoRes = results["foto"];
  if (fotoRes?.data) {
    // Check raw — if it's a base64 blob
    const raw = fotoRes.data.raw;
    if (raw && raw.length > 500 && /^[A-Za-z0-9+/=]{100,}/.test(raw.trim())) {
      return `data:image/jpeg;base64,${raw.trim()}`;
    }
    if (raw?.startsWith("data:image")) return raw;
    if (/^https?:\/\//.test(raw?.trim() ?? "")) return raw.trim();

    // Check fields
    for (const [k, v] of fotoRes.data.fields) {
      if (/FOTO|URL|BASE64|IMG|IMAGE/i.test(k) && v) {
        if (v.startsWith("data:image")) return v;
        if (/^https?:\/\//.test(v)) return v;
        if (v.length > 200) return `data:image/jpeg;base64,${v}`;
      }
    }
    // If no key matched, try any long field value
    const longField = fotoRes.data.fields.find(([,v]) => v.length > 500);
    if (longField) return `data:image/jpeg;base64,${longField[1]}`;
  }

  // Fallback: check cpfbasico / cpf for a photo URL field
  for (const key of ["cpfbasico", "cpf"]) {
    const res = results[key];
    if (!res?.data) continue;
    for (const [k, v] of res.data.fields) {
      if (/FOTO|URL_FOTO|IMAGEM/i.test(k) && v) return v.startsWith("http") ? v : `data:image/jpeg;base64,${v}`;
    }
  }
  return null;
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtCPF(c: string) {
  const d = c.replace(/\D/g,"");
  return d.length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}` : c;
}
function fmtPhone(ddd: string, num: string) {
  const n = num.replace(/\D/g,"");
  if (n.length === 9) return `(${ddd}) ${n.slice(0,5)}-${n.slice(5)}`;
  if (n.length === 8) return `(${ddd}) ${n.slice(0,4)}-${n.slice(4)}`;
  return ddd ? `(${ddd}) ${n}` : n;
}

// ─── Small copy button ────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1000); }); }}
      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10" title="Copiar">
      {done ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-white/40" />}
    </button>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, count }: { icon: React.ComponentType<{className?:string; style?: React.CSSProperties}>; title: string; count?: number }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <Icon className="w-4.5 h-4.5" style={{ color: "var(--color-primary)" }} />
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          {title}
          {count !== undefined && (
            <span className="text-sm font-normal" style={{ color: "color-mix(in srgb, var(--color-primary) 55%, transparent)" }}>
              ({count})
            </span>
          )}
        </h2>
      </div>
      <div className="h-px mt-2" style={{ background: "linear-gradient(to right, var(--color-primary), transparent)" }} />
    </div>
  );
}

// ─── Collapsible section wrapper ──────────────────────────────────────────────
function CollapsibleSection({ title, icon: Icon, count, children, defaultOpen = true }:
  { title: string; icon: React.ComponentType<{className?:string; style?: React.CSSProperties}>; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-2.5 w-full text-left group mb-3">
        <Icon className="w-4.5 h-4.5 shrink-0" style={{ color: "var(--color-primary)" }} />
        <span className="text-lg font-bold text-white flex-1">
          {title}
          {count !== undefined && (
            <span className="text-sm font-normal ml-2" style={{ color: "color-mix(in srgb, var(--color-primary) 55%, transparent)" }}>
              ({count})
            </span>
          )}
        </span>
        <span className="text-white/30 group-hover:text-white/60 transition-colors">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      <div className="h-px mb-4" style={{ background: "linear-gradient(to right, var(--color-primary), transparent)" }} />
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="c" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Identity Card ─────────────────────────────────────────────────────────────
function IdentityCard({ id, photo }: { id: Identity; photo: string | null }) {
  const uf = id.orgaoEmissor.match(/\b([A-Z]{2})$/)?.[1] ?? id.orgaoEmissor.match(/[-\/\s]([A-Z]{2})$/)?.[1] ?? "";
  const F = ({ label, value, mono = false, accent }: { label: string; value: string; mono?: boolean; accent?: string }) => (
    <div className="min-w-0">
      <p className="text-[8px] uppercase tracking-[0.22em] text-white/30 font-semibold mb-0.5">{label}</p>
      <p className={`text-[12.5px] font-bold leading-tight break-words ${mono ? "font-mono" : ""} ${accent ?? "text-white"}`}>
        {value || <span className="text-white/20 font-normal">—</span>}
      </p>
      <div className="h-px bg-white/5 mt-1.5" />
    </div>
  );

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60">
      {/* Header band */}
      <div className="relative px-8 py-6 overflow-hidden" style={{ background: "linear-gradient(135deg, #5b21b6 0%, #4338ca 50%, #6d28d9 100%)" }}>
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: "repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)",
          backgroundSize: "12px 12px"
        }} />
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">🇧🇷</span>
              <p className="text-[9px] font-extrabold tracking-[0.24em] text-white/95">REPÚBLICA FEDERATIVA DO BRASIL</p>
            </div>
            {uf && <p className="text-[8px] tracking-[0.16em] text-white/60 mb-0.5">SECRETARIA DE SEGURANÇA PÚBLICA — SSP/{uf}</p>}
            <p className="text-[13px] font-black tracking-[0.32em] text-white mt-1">CARTEIRA DE IDENTIDADE</p>
          </div>
          <div className="text-right">
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
      <div className="bg-[#09090f] p-5 sm:p-7">
        <div className="flex gap-5">
          {/* Main data */}
          <div className="flex-1 space-y-3 min-w-0">
            {/* RG number */}
            <div className="text-center mb-5">
              <p className="text-[8.5px] uppercase tracking-[0.32em] text-white/30 mb-1">Registro Geral</p>
              <p className="text-[28px] font-black tracking-[0.12em] text-white leading-none">{id.rg || "—"}</p>
            </div>

            <F label="Nome Completo" value={id.nome} accent="text-white text-[14px]" />
            <div className="grid grid-cols-2 gap-4">
              <F label="Mãe" value={id.mae} />
              <F label="Pai" value={id.pai} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <F label="Nascimento" value={id.dataNascimento} />
              <F label="Sexo" value={id.sexo} />
              <F label="Estado Civil" value={id.estadoCivil} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="CPF" value={fmtCPF(id.cpf)} mono />
              <F label="Naturalidade" value={id.naturalidade} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Órgão Emissor" value={id.orgaoEmissor} />
              <F label="Data de Emissão" value={id.dataEmissao} />
            </div>
            {(id.tituloEleitor || id.pis) && (
              <div className="grid grid-cols-2 gap-4">
                {id.tituloEleitor && <F label="Título de Eleitor" value={id.tituloEleitor} mono />}
                {id.pis && <F label="PIS / NIS" value={id.pis || id.nis} mono />}
              </div>
            )}
            {id.email && <F label="E-mail" value={id.email} />}
            {id.enderecoPrincipal && (
              <div className="flex items-start gap-2 rounded-xl bg-primary/5 border border-primary/15 p-3 mt-1">
                <Home className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--color-primary)" }} />
                <div className="min-w-0">
                  <p className="text-[8px] uppercase tracking-[0.22em] text-white/30 mb-0.5">Endereço Principal</p>
                  <p className="text-[12px] font-semibold text-white/85 break-words">{id.enderecoPrincipal}</p>
                </div>
              </div>
            )}
          </div>

          {/* Photo column */}
          <div className="shrink-0 hidden sm:flex flex-col items-center gap-2 mt-1">
            <div className="w-28 h-36 rounded-xl overflow-hidden border-2 border-white/15 bg-white/5 flex items-center justify-center relative">
              {photo
                ? <img src={photo} alt="Foto" className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                : <div className="flex flex-col items-center gap-1.5">
                    <Camera className="w-8 h-8 text-white/10" />
                    <p className="text-[8px] text-white/15 text-center leading-tight px-1">Sem foto</p>
                  </div>
              }
              {photo && (
                <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-emerald-400/20 border border-emerald-400/40 flex items-center justify-center">
                  <Fingerprint className="w-2.5 h-2.5 text-emerald-300" />
                </div>
              )}
            </div>
            <p className="text-[7.5px] uppercase tracking-[0.2em] text-white/20 text-center">Foto do Titular</p>

            {/* Type sanguineo badge */}
            {id.tipoSanguineo && (
              <div className="mt-1 w-14 h-14 rounded-xl border border-red-500/30 bg-red-950/20 flex flex-col items-center justify-center">
                <p className="text-[8px] text-red-400/60 uppercase tracking-widest">Tipo</p>
                <p className="text-lg font-black text-red-300">{id.tipoSanguineo}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Phone card ───────────────────────────────────────────────────────────────
function PhoneCard({ phone, idx }: { phone: PhoneEntry; idx: number }) {
  const formatted = fmtPhone(phone.ddd, phone.numero);
  const waLink = `https://wa.me/55${phone.ddd}${phone.numero}`;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.04 }}
      className="group flex items-center gap-3 rounded-xl border border-white/8 bg-black/25 hover:bg-black/40 hover:border-white/15 transition-all p-3"
    >
      <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
        <Phone className="w-4 h-4 text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold font-mono text-white">{formatted}</p>
        <div className="flex items-center gap-2 flex-wrap mt-0.5">
          {phone.tipo && <span className="text-[9px] text-emerald-400/70 uppercase tracking-wider">{phone.tipo}</span>}
          {phone.prioridade && <span className="text-[9px] text-white/30">· Prioridade: {phone.prioridade}</span>}
          {phone.classificacao && <span className="text-[9px] text-white/30">· {phone.classificacao}</span>}
          {phone.data && phone.data !== "Não Informado" && <span className="text-[9px] text-white/20">· {phone.data}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <CopyBtn text={formatted} />
        <a href={waLink} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] font-bold transition-colors whitespace-nowrap">
          <MessageCircle className="w-3 h-3" /> WA
        </a>
      </div>
    </motion.div>
  );
}

// ─── Address card ─────────────────────────────────────────────────────────────
function AddressCard({ addr, idx }: { addr: Address; idx: number }) {
  const full = [addr.logradouro, addr.numero, addr.complemento && addr.complemento !== "Não Informado" ? addr.complemento : "", addr.bairro, addr.cidade, addr.uf].filter(Boolean).join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(full)}`;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.05 }}
      className="group flex items-start gap-3 rounded-xl border border-amber-500/15 bg-amber-500/5 hover:bg-amber-500/8 hover:border-amber-500/25 transition-all p-3"
    >
      <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-[11px] font-black text-amber-300 shrink-0 mt-0.5">
        {idx + 1}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-white break-words">
          {addr.logradouro}{addr.numero ? `, ${addr.numero}` : ""}
          {addr.complemento && addr.complemento !== "Não Informado" ? ` — ${addr.complemento}` : ""}
        </p>
        <p className="text-[12px] text-white/55 mt-0.5">
          {[addr.bairro, addr.cidade, addr.uf].filter(Boolean).join(" · ")}
          {addr.cep ? ` · CEP ${addr.cep}` : ""}
        </p>
        {addr.lat && <p className="text-[9px] text-amber-400/40 mt-0.5">📍 {addr.lat.toFixed(4)}, {addr.lng?.toFixed(4)}</p>}
      </div>
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-amber-300 text-[10px] font-semibold border border-amber-500/25 hover:bg-amber-500/10 transition-colors whitespace-nowrap shrink-0">
        <MapPin className="w-3 h-3" /> Maps
      </a>
    </motion.div>
  );
}

// ─── Main CpfFullPanel ────────────────────────────────────────────────────────
type Props = { cpf: string };

export function CpfFullPanel({ cpf }: Props) {
  const [running, setRunning]   = useState(false);
  const [done, setDone]         = useState(false);
  const [mStates, setMStates]   = useState<Record<string, ModuleStatus>>({});
  const [mResults, setMResults] = useState<Record<string, ModuleResult>>({});
  const [geoAddr, setGeoAddr]   = useState<Address[]>([]);
  const runRef = useRef(0);

  useEffect(() => {
    const clean = cpf.replace(/\D/g,"");
    if (clean.length !== 11) return;
    const id = ++runRef.current;
    setRunning(true); setDone(false);
    setMStates(Object.fromEntries(MODULES.map(m => [m.tipo, "loading"])));
    setMResults({});
    setGeoAddr([]);

    void Promise.allSettled(
      MODULES.map(async ({ tipo, skylers }) => {
        const res = await fetchModule(tipo, clean, skylers);
        if (runRef.current !== id) return;
        setMStates(p => ({ ...p, [tipo]: res.status }));
        setMResults(p => ({ ...p, [tipo]: res }));
      })
    ).then(() => { if (runRef.current === id) { setRunning(false); setDone(true); } });

    return () => { runRef.current = id + 1; };
  }, [cpf]);

  // Geocode addresses after all modules are done
  useEffect(() => {
    if (!done) return;
    const addrs = buildAddresses(mResults);
    if (!addrs.length) return;
    let cancelled = false;
    (async () => {
      const result: Address[] = [];
      for (const addr of addrs.slice(0, 8)) {
        if (cancelled) break;
        const q = [addr.logradouro, addr.numero, addr.bairro, addr.cidade, addr.uf, "Brasil"].filter(Boolean).join(", ");
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`, { headers: { "Accept-Language": "pt-BR", "User-Agent": "InfinitySearch/1.0" } });
          const data = await r.json() as { lat: string; lon: string }[];
          result.push(data[0] ? { ...addr, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : addr);
        } catch { result.push(addr); }
        await new Promise(res => setTimeout(res, 400));
      }
      if (!cancelled) setGeoAddr(result);
    })();
    return () => { cancelled = true; };
  }, [done, mResults]);

  // Derived data
  const identity    = buildIdentity(mResults);
  const phones      = buildPhones(mResults);
  const addresses   = buildAddresses(mResults);
  const employments = buildEmployments(mResults["empregos"]);
  const photo       = extractPhoto(mResults);

  const score1    = (gf(mResults["score"]?.data?.fields  ?? [], "SCORE","PONTUACAO","PONTUAÇÃO","SERASA") || mResults["score"]?.data?.raw?.match(/\b(\d{3,4})\b/)?.[1]) ?? "";
  const score2Val = (gf(mResults["score2"]?.data?.fields ?? [], "SCORE","PONTUACAO","PONTUAÇÃO","SERASA") || mResults["score2"]?.data?.raw?.match(/\b(\d{3,4})\b/)?.[1]) ?? "";

  const geocoded  = geoAddr.filter(a => a.lat && a.lng);
  const center: [number,number] = geocoded[0] ? [geocoded[0].lat!, geocoded[0].lng!] : [-14.235, -51.925];
  const doneCount = MODULES.filter(m => mStates[m.tipo] === "done").length;

  const hasIdentity = !!(identity.nome || identity.rg);
  const hasCNH      = mResults["cnh"]?.status === "done" && (mResults["cnh"]?.data?.fields.length ?? 0) > 0;
  const hasObito    = mResults["obito"]?.status === "done" && (
    (mResults["obito"]?.data?.fields.length ?? 0) > 0 ||
    /falecido|obito|óbito/i.test(mResults["obito"]?.data?.raw ?? "")
  );
  const hasLegal    = ["processos","mandado"].some(k =>
    mResults[k]?.status === "done" && ((mResults[k]?.data?.sections?.length ?? 0) > 0 || (mResults[k]?.data?.fields.length ?? 0) > 0)
  );
  const extras      = (["irpf","beneficios","dividas","bens","titulo","spc"] as const).filter(k =>
    mResults[k]?.status === "done" && mResults[k]?.data &&
    ((mResults[k]!.data!.fields.length > 0) || (mResults[k]!.data!.sections.length > 0) || mResults[k]!.data!.raw.length > 20)
  );

  const extraLabels: Record<string, { label: string; icon: React.ComponentType<{className?:string}> }> = {
    irpf:      { label: "IRPF / Imposto de Renda", icon: Receipt },
    beneficios:{ label: "Benefícios Sociais",       icon: Gift },
    dividas:   { label: "Dívidas",                  icon: Wallet },
    bens:      { label: "Bens Registrados",         icon: Building2 },
    titulo:    { label: "Título de Eleitor",         icon: Award },
    spc:       { label: "SPC / Negativação",         icon: AlertTriangle },
  };

  const noData = done && !hasIdentity && !phones.length && !addresses.length;

  return (
    <div className="mt-6 space-y-8">
      {/* ── Progress tracker ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {(running || done) && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                {running ? "Consultando módulos em paralelo…" : `Concluído — ${doneCount}/${MODULES.length} módulos com dados`}
              </span>
              {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
            </div>
            <div className="h-1.5 bg-white/5 rounded-full mb-4 overflow-hidden">
              <motion.div className="h-full rounded-full" style={{ background: "var(--color-primary)" }}
                animate={{ width: `${(doneCount / MODULES.length) * 100}%` }} transition={{ duration: 0.5 }} />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-1.5">
              {MODULES.map(m => {
                const s = mStates[m.tipo] ?? "idle";
                return (
                  <div key={m.tipo} className="flex items-center gap-1 text-[9px] truncate">
                    {s === "loading" && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0 text-primary" />}
                    {s === "done"    && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />}
                    {s === "error"   && <XCircle className="w-2.5 h-2.5 text-red-400/40 shrink-0" />}
                    {s === "idle"    && <div className="w-2.5 h-2.5 rounded-full bg-white/8 shrink-0" />}
                    <span className={s === "done" ? "text-white/65" : s === "error" ? "text-white/20" : "text-white/35"}>
                      {m.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Results ───────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-10">

            {/* Carteira de Identidade */}
            {hasIdentity && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <SectionHeader icon={IdCard} title="Carteira de Identidade" />
                <IdentityCard id={identity} photo={photo} />
              </motion.div>
            )}

            {/* Foto standalone (if found and identity exists) */}
            {photo && hasIdentity && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                className="rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/8 to-transparent p-4 flex items-center gap-5">
                <div className="relative shrink-0">
                  <div className="absolute -inset-2 rounded-2xl bg-cyan-400/10 blur-xl" />
                  <div className="relative w-24 h-32 rounded-xl overflow-hidden border-2 border-cyan-400/35">
                    <img src={photo} alt="Foto biométrica" className="w-full h-full object-cover"
                      onError={e => { const el = (e.currentTarget as HTMLImageElement).closest(".relative") as HTMLElement | null; if (el) el.style.display = "none"; }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Fingerprint className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[9px] uppercase tracking-widest font-bold text-cyan-300">Foto Biométrica</span>
                  </div>
                  <p className="text-sm text-white font-semibold">{identity.nome}</p>
                  <p className="text-xs text-white/40 mt-0.5">{fmtCPF(identity.cpf)}</p>
                  <a href={photo} download={`foto-${cpf}.jpg`}
                    className="inline-flex items-center gap-1.5 mt-2 text-[10px] uppercase tracking-widest text-cyan-400/70 hover:text-cyan-300 border border-cyan-400/20 hover:border-cyan-400/40 rounded-lg px-2.5 py-1 transition-colors">
                    ↓ Baixar Foto
                  </a>
                </div>
              </motion.div>
            )}

            {/* Telefones */}
            {phones.length > 0 && (
              <CollapsibleSection icon={Phone} title="Telefones" count={phones.length}>
                <div className="space-y-2">
                  {phones.map((p, i) => <PhoneCard key={i} phone={p} idx={i} />)}
                </div>
              </CollapsibleSection>
            )}

            {/* Relações / Parentes */}
            {(() => {
              const res = mResults["parentes"];
              if (!res?.data) return null;
              const allItems = res.data.sections.flatMap(s => s.items.map(item => ({ sec: s.name, item })));
              if (!allItems.length && !res.data.fields.length) return null;
              return (
                <CollapsibleSection icon={Users} title="Relações & Parentes" count={allItems.length || res.data.fields.length}>
                  <div className="rounded-2xl border border-white/10 bg-[#09090f] overflow-hidden">
                    {allItems.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[600px]">
                          <thead>
                            <tr className="border-b border-white/8 bg-black/30">
                              {["Foto","CPF","Relação","Nome","Nascimento","Sexo","Origem"].map(h => (
                                <th key={h} className="px-3 py-3 text-left text-[9px] uppercase tracking-[0.18em] text-white/30 font-semibold whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {allItems.map(({ sec, item }, i) => {
                              const cpfM    = item.match(/CPF[\s:]+(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})/i)?.[1] ?? "";
                              const nome    = item.match(/NOME[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "";
                              const nasc    = item.match(/(?:NASC|DATA_NASC)[\s:]+(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? "";
                              const sexo    = item.match(/SEXO[\s:]+([MFMF])/i)?.[1] ?? "";
                              const origem  = item.match(/ORIGEM[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "";
                              return (
                                <tr key={i} className="border-b border-white/4 hover:bg-white/[0.02] transition-colors">
                                  <td className="px-3 py-2.5">
                                    <div className="w-9 h-11 rounded-lg bg-white/5 border border-white/8 flex items-center justify-center">
                                      <User className="w-4 h-4 text-white/12" />
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 font-mono text-xs text-white/40">{fmtCPF(cpfM) || "—"}</td>
                                  <td className="px-3 py-2.5">
                                    <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold bg-primary/10 text-primary/80">{sec || "—"}</span>
                                  </td>
                                  <td className="px-3 py-2.5 text-white font-semibold text-[13px] whitespace-nowrap">{nome || "—"}</td>
                                  <td className="px-3 py-2.5 text-white/45 text-xs whitespace-nowrap">{nasc || "—"}</td>
                                  <td className="px-3 py-2.5 text-white/45 text-xs">{sexo || "—"}</td>
                                  <td className="px-3 py-2.5 text-white/35 text-xs">{origem || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {res.data.fields.map(([k, v], i) => (
                          <div key={i}>
                            <p className="text-[8.5px] uppercase tracking-widest text-white/25 mb-0.5">{k}</p>
                            <p className="text-sm text-white font-medium">{v}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CollapsibleSection>
              );
            })()}

            {/* Visualização Geográfica + Endereços */}
            {addresses.length > 0 && (
              <CollapsibleSection icon={MapPin} title="Endereços" count={addresses.length}>
                {/* Map */}
                <div className="rounded-2xl border border-white/10 overflow-hidden mb-4">
                  <div className="relative h-[320px]">
                    <MapContainer center={center} zoom={geocoded.length > 0 ? 7 : 4}
                      className="h-full w-full z-10" style={{ background: "#0c0e1c" }}>
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                      />
                      {geocoded.map((addr, i) => (
                        <CircleMarker key={i} center={[addr.lat!, addr.lng!]}
                          radius={12}
                          pathOptions={{ fillColor: "#7c3aed", color: "#a855f7", weight: 2, fillOpacity: 0.9 }}>
                          {/* Permanent label showing address */}
                          <Tooltip permanent direction="top" offset={[0, -14]}
                            className="leaflet-tooltip-dark">
                            <div style={{ background: "rgba(9,9,15,0.92)", border: "1px solid rgba(168,85,247,0.4)", borderRadius: 8, padding: "4px 8px", color: "#fff", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", maxWidth: 220 }}>
                              <span style={{ color: "#a855f7", marginRight: 5 }}>◉ {i+1}</span>
                              {addr.logradouro}{addr.numero ? `, ${addr.numero}` : ""}
                              {addr.cidade ? ` — ${addr.cidade}` : ""}
                            </div>
                          </Tooltip>
                          <Popup>
                            <div className="text-xs space-y-1 min-w-[180px]">
                              <p className="font-bold text-gray-800">{addr.logradouro}{addr.numero ? `, ${addr.numero}` : ""}</p>
                              {addr.complemento && addr.complemento !== "Não Informado" && <p className="text-gray-500">{addr.complemento}</p>}
                              {addr.bairro && <p className="text-gray-600">{addr.bairro}</p>}
                              <p className="text-gray-600">{[addr.cidade, addr.uf].filter(Boolean).join(" — ")}</p>
                              {addr.cep && <p className="text-gray-500">CEP: {addr.cep}</p>}
                              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([addr.logradouro,addr.numero,addr.cidade,addr.uf].filter(Boolean).join(","))}`}
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-violet-600 font-bold hover:underline mt-1">
                                📍 Google Maps
                              </a>
                            </div>
                          </Popup>
                        </CircleMarker>
                      ))}
                    </MapContainer>

                    {/* Map overlay badge */}
                    <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 bg-[#09090f]/90 backdrop-blur rounded-xl px-3 py-2 border border-white/10 pointer-events-none">
                      <MapPin className="w-3 h-3" style={{ color: "var(--color-primary)" }} />
                      <span className="text-[10px] font-semibold text-white">Mapa de Endereços</span>
                      <span className="text-[9px] text-white/30">{geocoded.length} geocodificados</span>
                    </div>
                    {geocoded.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center z-[1000] pointer-events-none">
                        <div className="bg-[#09090f]/80 rounded-xl px-4 py-3 border border-white/8 text-center">
                          <Loader2 className="w-4 h-4 animate-spin text-primary mx-auto mb-1" />
                          <p className="text-[10px] text-white/40">Geocodificando endereços…</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Address cards */}
                <div className="space-y-2">
                  {addresses.map((a, i) => <AddressCard key={i} addr={a} idx={i} />)}
                </div>
              </CollapsibleSection>
            )}

            {/* Empregos */}
            {employments.length > 0 && (
              <CollapsibleSection icon={Briefcase} title="Empregos / Vínculos" count={employments.length}>
                <div className="rounded-2xl border border-white/10 bg-[#09090f] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[580px]">
                      <thead>
                        <tr className="border-b border-white/8 bg-black/30">
                          {["Empresa","CNPJ","Cargo","Admissão","Demissão","Salário"].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-[9px] uppercase tracking-[0.2em] text-white/30 font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {employments.map((e, i) => (
                          <tr key={i} className="border-b border-white/4 hover:bg-white/[0.025] transition-colors">
                            <td className="px-4 py-3 text-white font-semibold">{e.empresa || "—"}</td>
                            <td className="px-4 py-3 text-white/35 font-mono text-xs">{e.cnpj || "—"}</td>
                            <td className="px-4 py-3 text-white/60">{e.cargo || "—"}</td>
                            <td className="px-4 py-3 text-white/45 text-xs">{e.admissao || "—"}</td>
                            <td className="px-4 py-3 text-white/45 text-xs">{e.demissao || "Atual"}</td>
                            <td className="px-4 py-3 text-emerald-400 font-bold">{e.salario || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Score de Crédito */}
            {(score1 || score2Val) && (
              <CollapsibleSection icon={BarChart2} title="Score de Crédito">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: "Score Serasa / Bureau 1", val: score1,    grad: "from-violet-600 to-indigo-600",  bgGrad: "from-violet-500/10 to-indigo-500/5",  border: "border-violet-500/25" },
                    { label: "Score Bureau 2",          val: score2Val, grad: "from-sky-600 to-indigo-500",     bgGrad: "from-sky-500/10 to-indigo-500/5",     border: "border-sky-500/25" },
                  ].filter(s => s.val).map(s => {
                    const pct = Math.min(100, (parseInt(s.val) / 1000) * 100);
                    const color = pct > 70 ? "text-emerald-300" : pct > 40 ? "text-amber-300" : "text-red-300";
                    return (
                      <div key={s.label} className={`rounded-2xl border ${s.border} bg-gradient-to-br ${s.bgGrad} p-5 flex items-center gap-5`}>
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-lg font-black text-white shrink-0 bg-gradient-to-br ${s.grad} shadow-lg`}>
                          {s.val}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[9px] uppercase tracking-widest text-white/30 mb-1.5">{s.label}</p>
                          <div className="h-2 bg-white/8 rounded-full overflow-hidden mb-1">
                            <div className={`h-full rounded-full bg-gradient-to-r ${s.grad}`} style={{ width: `${pct}%` }} />
                          </div>
                          <p className={`text-[11px] font-bold ${color}`}>{s.val} / 1000</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            )}

            {/* CNH */}
            {hasCNH && (
              <CollapsibleSection icon={Car} title="CNH — Carteira Nacional de Habilitação">
                <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {(mResults["cnh"]?.data?.fields ?? []).map(([k, v], i) => (
                    <div key={i}>
                      <p className="text-[8.5px] uppercase tracking-[0.2em] text-white/25 mb-0.5">{k}</p>
                      <p className="text-[13px] font-semibold text-white">{v || "—"}</p>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Processos & Mandados */}
            {hasLegal && (
              <CollapsibleSection icon={Scale} title="Processos & Mandados">
                <div className="space-y-3">
                  {["processos","mandado"].flatMap(tipo => {
                    const res = mResults[tipo];
                    if (!res?.data) return [];
                    const secs = res.data.sections.length > 0 ? res.data.sections : (res.data.fields.length > 0 ? [{ name: tipo.toUpperCase(), items: res.data.fields.map(([k,v]) => `${k}: ${v}`) }] : []);
                    return secs.map((sec, si) => (
                      <div key={`${tipo}-${si}`} className="rounded-2xl border border-rose-500/20 bg-rose-500/5 overflow-hidden">
                        <div className="px-4 py-2.5 bg-black/20 border-b border-rose-500/10 flex items-center gap-2">
                          <Scale className="w-3.5 h-3.5 text-rose-400" />
                          <span className="text-[10px] uppercase tracking-widest text-rose-300 font-bold">{sec.name || tipo.toUpperCase()}</span>
                          <span className="text-[9px] text-rose-400/30 ml-1">({sec.items.length})</span>
                        </div>
                        <div className="divide-y divide-rose-500/8 max-h-64 overflow-y-auto">
                          {sec.items.map((item, ii) => (
                            <div key={ii} className="px-4 py-2.5 text-sm text-white/60 leading-relaxed">{item}</div>
                          ))}
                        </div>
                      </div>
                    ));
                  })}
                </div>
              </CollapsibleSection>
            )}

            {/* Dados Adicionais (IRPF, Benefícios, etc.) */}
            {extras.length > 0 && (
              <CollapsibleSection icon={FileText} title="Dados Adicionais" defaultOpen={false}>
                <div className="space-y-4">
                  {extras.map(key => {
                    const meta = extraLabels[key];
                    const res  = mResults[key];
                    if (!meta || !res?.data) return null;
                    const { label, icon: Icon } = meta as { label: string; icon: React.ComponentType<{className?:string; style?: React.CSSProperties}> };
                    const { fields, sections, raw } = res.data;
                    return (
                      <div key={key} className="rounded-2xl border border-white/10 bg-[#09090f] overflow-hidden">
                        <div className="px-4 py-3 bg-black/20 border-b border-white/6 flex items-center gap-2">
                          <Icon className="w-3.5 h-3.5" style={{ color:"var(--color-primary)" }} />
                          <span className="text-[11px] uppercase tracking-widest font-bold text-white">{label}</span>
                        </div>
                        <div className="p-4 space-y-3">
                          {fields.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              {fields.map(([k, v], i) => (
                                <div key={i}>
                                  <p className="text-[8.5px] uppercase tracking-[0.18em] text-white/25 mb-0.5">{k}</p>
                                  <p className="text-sm font-semibold text-white">{v}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {sections.map((sec, si) => (
                            <div key={si}>
                              {sec.name && <p className="text-[9px] uppercase tracking-widest text-white/25 mb-1.5">{sec.name}</p>}
                              <div className="divide-y divide-white/4 rounded-xl border border-white/6 overflow-hidden">
                                {sec.items.map((item, ii) => (
                                  <div key={ii} className="px-3 py-2 text-sm text-white/55">{item}</div>
                                ))}
                              </div>
                            </div>
                          ))}
                          {!fields.length && !sections.length && raw && (
                            <pre className="text-xs text-white/40 whitespace-pre-wrap break-words font-mono max-h-48 overflow-y-auto">{raw}</pre>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            )}

            {/* Óbito */}
            {hasObito && (
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
                <div className="rounded-2xl border border-red-500/30 bg-red-950/15 overflow-hidden">
                  <div className="px-5 py-3 bg-red-950/25 border-b border-red-500/15 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    <span className="text-[11px] uppercase tracking-widest font-bold text-red-300">Registro de Óbito</span>
                  </div>
                  <div className="p-5">
                    <p className="text-xs text-red-400/70 mb-3">Pessoa falecida conforme registros oficiais.</p>
                    {(mResults["obito"]?.data?.fields ?? []).length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {(mResults["obito"]?.data?.fields ?? []).map(([k, v], i) => (
                          <div key={i}>
                            <p className="text-[9px] uppercase tracking-[0.2em] text-red-400/40 mb-0.5">{k}</p>
                            <p className="text-sm font-semibold text-red-200">{v}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-red-300/60 font-mono">{mResults["obito"]?.data?.raw}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Sem dados */}
            {noData && (
              <div className="text-center py-20 text-muted-foreground">
                <Star className="w-14 h-14 mx-auto mb-4 opacity-10" />
                <p className="text-sm">Nenhum dado encontrado para este CPF.</p>
                <p className="text-xs text-white/20 mt-1">Verifique se o número está correto.</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
