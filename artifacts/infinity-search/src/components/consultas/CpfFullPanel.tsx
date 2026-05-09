import { useState, useEffect, useRef, useMemo, createContext, useContext } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Phone, MapPin, Users, Briefcase, IdCard,
  Wallet, BarChart2, FileText, Car, CheckCircle2, XCircle,
  Loader2, MessageCircle, Scale, Building2, Award, Gift,
  AlertTriangle, Receipt, Star, ChevronDown, ChevronUp, Copy, Check,
  Camera, Fingerprint, Home, GitBranch, LayoutList, StretchHorizontal,
  Download, Network,
} from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { generateLaudoPDF } from "./LaudoPDF";
import { ConnectionGraph } from "./ConnectionGraph";

// ─── View mode context ────────────────────────────────────────────────────────
const ViewModeCtx = createContext<"compact" | "expanded">("expanded");
const useViewMode = () => useContext(ViewModeCtx);

// ─── Types ────────────────────────────────────────────────────────────────────
type ModuleStatus = "idle" | "loading" | "done" | "error";
type ParsedData = { fields: [string, string][]; sections: { name: string; items: string[] }[]; raw: string };
type ModuleResult = { status: ModuleStatus; data?: ParsedData; error?: string };

type Identity = {
  nome: string; cpf: string; rg: string; mae: string; pai: string;
  naturalidade: string; nacionalidade: string; dataNascimento: string;
  sexo: string; estadoCivil: string; orgaoEmissor: string; dataEmissao: string;
  situacaoCadastral: string; tipoSanguineo: string; tituloEleitor: string;
  pis: string; nis: string; email: string; enderecoPrincipal: string;
};
type PhoneEntry  = { ddd: string; numero: string; prioridade: string; classificacao: string; data: string; tipo: string };
type Address     = { logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string; lat?: number; lng?: number };
type Employment  = { empresa: string; cnpj: string; cargo: string; admissao: string; demissao: string; salario: string };
type Relative    = { cpf: string; nome: string; nasc: string; sexo: string; relacao: string; origem: string };
type RelCat      = "pai" | "mae" | "conjuge" | "filho" | "filha" | "irmao" | "irma" | "outro";

// ─── Modules ──────────────────────────────────────────────────────────────────
const MODULES = [
  { tipo: "cpf",        label: "CPF",           skylers: false },
  { tipo: "cpfbasico",  label: "CPF Básico",     skylers: true  },
  { tipo: "fotonc",     label: "Foto",           skylers: true  },
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

// ─── Normalize fields ─────────────────────────────────────────────────────────
function normalizeFields(raw: unknown): [string, string][] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0];
  if (Array.isArray(first)) return raw as [string, string][];
  if (typeof first === "object" && first !== null && "key" in first)
    return (raw as { key: string; value: string }[]).map(f => [f.key ?? "", f.value ?? ""] as [string, string]);
  return [];
}

function gf(fields: [string, string][], ...keys: string[]): string {
  for (const key of keys) {
    const ku = key.toUpperCase().replace(/[_\-\s]/g, "");
    const f = fields.find(([fk]) => {
      const fku = fk.toUpperCase().replace(/[_\-\s]/g, "");
      return fku === ku || fku.includes(ku) || ku.includes(fku);
    });
    if (f?.[1]?.trim()) return f[1].trim();
  }
  return "";
}
/** Exact-match only — prevents "NOME" from matching "NOMEMAE", "MUNICIPIONASCIMENTO" from matching "NASCIMENTO", etc. */
function gfExact(fields: [string, string][], ...keys: string[]): string {
  for (const key of keys) {
    const ku = key.toUpperCase().replace(/[_\-\s]/g, "");
    const found = fields.find(([fk]) => fk.toUpperCase().replace(/[_\-\s]/g, "") === ku);
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

function mergeFields(results: (ModuleResult | undefined)[]): [string, string][] {
  return results.flatMap(r => r?.data?.fields ?? []);
}
function mergeRaw(results: (ModuleResult | undefined)[]): string {
  return results.map(r => r?.data?.raw ?? "").join("\n");
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function parseDateBR(s: string): Date | null {
  if (!s) return null;
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m1) return new Date(parseInt(m1[3]), parseInt(m1[2]) - 1, parseInt(m1[1]));
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]));
  return null;
}
function calcDuration(start: string, end: string): string {
  const s = parseDateBR(start);
  if (!s) return "";
  const e = end ? (parseDateBR(end) ?? new Date()) : new Date();
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (months < 1) return "< 1 mês";
  if (months < 12) return `${months} mes${months > 1 ? "es" : ""}`;
  const yrs = Math.floor(months / 12); const rem = months % 12;
  return `${yrs} ano${yrs > 1 ? "s" : ""}${rem > 0 ? ` ${rem}m` : ""}`;
}

// ─── Relative categorizer ─────────────────────────────────────────────────────
function categorizeRel(rel: Relative): RelCat {
  // Include all available fields — APIs often put the relation type in `origem` or section name
  const r = [rel.relacao, rel.origem, rel.nome].join(" ").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/gi, " ");
  // Pai / genitores masculinos
  if (/\bpai\b|father|\bgenitor\b|genitorm|genitores?/.test(r) && !/\bfilh/.test(r)) return "pai";
  // Mãe / genitoras femininas
  if (/\bmae\b|mother|\bgenitora\b|genitorf/.test(r) && !/\bfilh/.test(r)) return "mae";
  // Cônjuge
  if (/conjuge|esposa|esposo|marido|companheiro|companheira|wife|husband|uniao|socio/.test(r)) return "conjuge";
  // Filhos
  if (/\bfilha\b|\bfilhos?\b/.test(r) && rel.sexo?.toLowerCase() === "f") return "filha";
  if (/\bfilha\b/.test(r)) return "filha";
  if (/\bfilho\b/.test(r)) return "filho";
  if (/\bfilhos\b/.test(r)) return rel.sexo?.toLowerCase() === "f" ? "filha" : "filho";
  if (/\bfilh/.test(r)) return rel.sexo?.toLowerCase() === "f" ? "filha" : "filho";
  // Irmãos
  if (/\birma\b|\birmas\b/.test(r)) return "irma";
  if (/\birmao\b|\irmaos\b/.test(r)) return "irmao";
  if (/\birm/.test(r)) return rel.sexo?.toLowerCase() === "f" ? "irma" : "irmao";
  return "outro";
}

// ─── Fetch module ─────────────────────────────────────────────────────────────
async function fetchModule(tipo: string, dados: string, skylers: boolean, skipLog = false): Promise<ModuleResult> {
  const token = localStorage.getItem("infinity_token");
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
    const json = await r.json() as { success: boolean; data?: unknown; error?: string };
    let parsed: ParsedData | undefined;
    if (json.data && typeof json.data === "object") {
      const d = json.data as Record<string, unknown>;
      parsed = {
        fields:   normalizeFields(d["fields"]),
        sections: Array.isArray(d["sections"]) ? d["sections"] as ParsedData["sections"] : [],
        raw:      typeof d["raw"] === "string" ? d["raw"] : "",
      };
    } else if (typeof json.data === "string") {
      parsed = { fields: [], sections: [], raw: json.data };
    }
    if (!json.success && !parsed?.fields.length && !parsed?.sections.length && !parsed?.raw)
      return { status: "error", error: json.error ?? "Sem resultado" };
    return { status: parsed ? "done" : "error", data: parsed, error: json.success ? undefined : (json.error ?? undefined) };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Erro de rede" };
  }
}

// ─── Build identity ───────────────────────────────────────────────────────────
function buildIdentity(results: Record<string, ModuleResult>): Identity {
  const sources = ["cpf", "cpfbasico", "titulo", "cnh"];
  const f = mergeFields(sources.map(k => results[k]));
  const raw = mergeRaw(sources.map(k => results[k]));

  // ── NOME: exact match FIRST to avoid "NOME" matching "NOMEMAE" / "NOMEPAI"
  const nome =
    gfExact(f, "NOME", "NOME COMPLETO", "NOMECOMPLETO", "NOME DO CONTRIBUINTE", "NOMECONTRIBUINTE") ||
    gf(f, "NOME COMPLETO", "NOMECOMPLETO", "NOME DO CONTRIBUINTE", "NOMECONTRIBUINTE") ||
    rxv(raw, "NOME COMPLETO", "NOME DO CONTRIBUINTE");

  const cpfVal = gfExact(f, "CPF", "NUMERO CPF", "NUMEROCPF") || gf(f, "CPF", "NUMEROCPF") || rxv(raw, "CPF");
  const rg     = gf(f,"RG","REGISTRO GERAL","NUMERORG","IDENTIDADE") || rxv(raw,"RG","IDENTIDADE");

  const rawMae = gfExact(f,"NOME MAE","NOMEMAE","MAE","FILIACAO1","FILIACAO 1") ||
                gf(f,"NOME MAE","NOMEMAE","MAE","FILIACAO 1","FILIACAO1") ||
                rxv(raw,"NOME DA MÃE","NOME MAE","NOMEMAE","MAE","FILIACAO 1");
  const rawPai = gfExact(f,"NOME PAI","NOMEPAI","PAI","FILIACAO2","FILIACAO 2") ||
                gf(f,"NOME PAI","NOMEPAI","PAI","FILIACAO 2","FILIACAO2") ||
                rxv(raw,"NOME DO PAI","NOME PAI","NOMEPAI","PAI","FILIACAO 2");
  const isValidParent = (v: string, subj: string) =>
    v.length >= 5 &&
    !/^https?:\/\//i.test(v) &&
    v.toUpperCase() !== subj.toUpperCase() &&
    !/\b(NAO\s+ENCONTRADO|NÃO\s+ENCONTRADO|NAO\s+CONSTA|NÃO\s+CONSTA|SEM\s+INFORMACAO|SEM\s+INFORMAÇÃO|NAO\s+INFORMADO|NÃO\s+INFORMADO|DESCONHECIDO|NAO\s+DECLARADO|NÃO\s+DECLARADO|CONSTAM\s+COMO|CONSTA\s+COMO|NAO\s+CADASTRADO|NÃO\s+CADASTRADO)\b/i.test(v);
  // Resolve nome early for validation (use fields directly to avoid circular call)
  const nomeForVal = (gfExact(f,"NOME","NOME COMPLETO","NOMECOMPLETO") || "").toUpperCase();
  const mae = isValidParent(rawMae, nomeForVal) ? rawMae : "";
  const pai = isValidParent(rawPai, nomeForVal) ? rawPai : "";

  // ── NATURALIDADE: exact match FIRST to avoid "MUNICIPIONASCIMENTO" matching "NASCIMENTO" date field
  const naturalidade =
    gfExact(f,"NATURALIDADE","MUNICIPIO NASCIMENTO","MUNICIPIODENASCIMENTO","MUNICIPIO DE NASCIMENTO","CIDADE NASCIMENTO","CIDADENASCIMENTO") ||
    rxv(raw,"NATURALIDADE","MUNICIPIO DE NASCIMENTO");

  // ── DATA NASCIMENTO: exact match FIRST so we don't accidentally grab naturalidade
  const dataNascimento =
    gfExact(f,"DATA NASCIMENTO","DATANASCIMENTO","DT NASCIMENTO","DTNASCIMENTO","NASCIMENTO","DATA NASC","DATANASC") ||
    gf(f,"DATA NASCIMENTO","DATANASCIMENTO","DT NASCIMENTO") ||
    rxv(raw,"DATA.*NASC","NASCIMENTO");

  const sexo          = gfExact(f,"SEXO","GENERO") || gf(f,"SEXO","GENERO","GÊNERO") || rxv(raw,"SEXO","GÊNERO");
  const estadoCivil   = gfExact(f,"ESTADO CIVIL","ESTADOCIVIL") || gf(f,"ESTADO CIVIL","ESTADOCIVIL") || rxv(raw,"ESTADO CIVIL");
  const orgaoEmissor  = gfExact(f,"ORGAO EMISSOR","ORGAOEMISSOR") || gf(f,"ORGAO EMISSOR","ORGAOEMISSOR","ÓRGÃO EMISSOR") || rxv(raw,"ORGAO EMISSOR","ÓRGÃO EMISSOR");
  const dataEmissao   = gfExact(f,"DATA EMISSAO","DATAEMISSAO","DATA EMISSÃO","DATAEMISSÃO") || gf(f,"DATA EMISSAO","DATAEMISSAO") || rxv(raw,"DATA.*EMIS");
  const situacaoCadastral = gfExact(f,"SITUACAO CADASTRAL","SITUACAOCADASTRAL","STATUS RECEITA") || gf(f,"SITUACAO CADASTRAL","SITUACAOCADASTRAL","STATUS RECEITA","STATUS") || rxv(raw,"SITUACAO","STATUS");
  const tipoSanguineo = gfExact(f,"TIPO SANGUINEO","TIPOSANGUINEO") || gf(f,"TIPO SANGUINEO","TIPOSANGUINEO","SANGUE") || rxv(raw,"SANGUE","TIPO SANG");
  const tituloEleitor = gfExact(f,"TITULO ELEITOR","TITULOELEITOR") || gf(f,"TITULO ELEITOR","TITULOELEITOR","TÍTULO") || rxv(raw,"TITULO.*ELEITOR");
  const pis           = gfExact(f,"PIS","PISPASEP","PIS PASEP") || gf(f,"PIS","PIS PASEP","PISPASEP") || rxv(raw,"PIS");
  const nis           = gfExact(f,"NIS","NUMERONIS") || gf(f,"NIS","NUMERONIS") || rxv(raw,"NIS");
  const email         = gfExact(f,"EMAIL","E-MAIL","ENDERECOEMAIL") || gf(f,"EMAIL","E-MAIL","ENDERECOEMAIL") || rxv(raw,"EMAIL","E-MAIL");
  const addr = buildAddresses(results)[0];
  const enderecoPrincipal = addr
    ? [addr.logradouro, addr.numero, addr.bairro, addr.cidade, addr.uf].filter(Boolean).join(", ")
    : rxv(raw,"LOGRADOURO","ENDERECO","RUA") || "";
  return { nome, cpf: cpfVal, rg, mae, pai, naturalidade, nacionalidade: "BRASIL",
    dataNascimento, sexo, estadoCivil, orgaoEmissor, dataEmissao, situacaoCadastral,
    tipoSanguineo, tituloEleitor, pis, nis, email, enderecoPrincipal };
}

// ─── Build phones ─────────────────────────────────────────────────────────────
function buildPhones(results: Record<string, ModuleResult>): PhoneEntry[] {
  const phones: PhoneEntry[] = []; const seen = new Set<string>();
  function add(ddd: string, num: string, prio = "", cls = "", data = "", tipo = "") {
    const key = `${ddd}${num.replace(/\D/g,"")}`;
    if (seen.has(key) || num.replace(/\D/g,"").length < 7) return;
    seen.add(key); phones.push({ ddd, numero: num.replace(/\D/g,""), prioridade: prio, classificacao: cls, data, tipo });
  }
  for (const mod of Object.values(results)) {
    if (!mod?.data) continue;
    for (const sec of mod.data.sections) {
      if (!/TELEFON|CELULAR|CONTATO|FONE|PHONE/i.test(sec.name)) continue;
      // Each item may be a single-line record (all fields inline, possibly separated by " · ")
      // e.g. Skylers: "Ddd: 11 · Numero: 999999999 · Tipo: CELULAR · Prioridade: 1"
      // or Geass:     "DDD: 11 NUMERO: 35643333 TIPO: FIXO"
      for (const item of sec.items) {
        let ddd  = item.match(/\b(?:DDD|COD(?:IGO)?[_\s]?AREA|AREA[_\s]?CODE)[\s:]+(\d{2,3})/i)?.[1]
                ?? item.match(/\((\d{2})\)/)?.[1] ?? "";
        let num  = item.match(/(?:NUMERO|TELEFONE|CELULAR|NUM|FONE)[\s:]+(\d[\d\s\-]{6,14})/i)?.[1]?.replace(/\D/g,"")
                ?? item.match(/\(?\d{2}\)?[\s\-]?(\d{4,5}[\s\-]?\d{4})/)?.[1]?.replace(/\D/g,"") ?? "";
        // If DDD not found separately but number has 10+ digits (DDD embedded), split it out
        if (!ddd && num.length >= 10) { ddd = num.slice(0, 2); num = num.slice(2); }
        const prio = item.match(/PRIORIDADE[\s:]+(\S+)/i)?.[1] ?? "";
        const cls  = item.match(/CLASSIF\w*[\s:]+(\S+)/i)?.[1] ?? "";
        const dt   = item.match(/DATA[\s:]+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? "";
        const tipo = /CELULAR|MOVEL/i.test(item) ? "Celular" : /FIXO|RESIDENC/i.test(item) ? "Fixo" : "";
        if (num) add(ddd, num, prio, cls, dt, tipo);
      }
    }
    for (const [k, v] of mod.data.fields) {
      if (!/TELEFON|CELULAR|FONE|PHONE/i.test(k)) continue;
      const clean = v.replace(/\D/g,"");
      if (clean.length >= 8) add(
        clean.length >= 10 ? clean.slice(0,2) : "",
        clean.length >= 10 ? clean.slice(2) : clean,
        "", "", "", /CELULAR|MOVEL/i.test(k) ? "Celular" : /FIXO|RESIDENC/i.test(k) ? "Fixo" : ""
      );
    }
    for (const m of mod.data.raw.matchAll(/\((\d{2})\)\s*(\d{4,5}[-\s]?\d{4})/g)) add(m[1], m[2].replace(/\D/g,""), "", "", "", "");
    // "DDD: 11 NUMERO: 35643333" — Geass field-format phones without bullet section
    for (const m of mod.data.raw.matchAll(/\bDDD[\s:]+(\d{2,3})\s+(?:NUMERO|NUM|TELEFONE|FONE)[\s:]+(\d{6,11})/gi)) add(m[1], m[2].replace(/\D/g,""), "", "", "", "");
    for (const m of mod.data.raw.matchAll(/\b(\d{2})\s+(\d{4,5}\d{4})\b/g)) {
      if (parseInt(m[1]) >= 11 && parseInt(m[1]) <= 99) add(m[1], m[2], "", "", "", "");
    }
  }
  phones.sort((a, b) => phoneScore(b) - phoneScore(a));
  return phones;
}

// ─── Build addresses ──────────────────────────────────────────────────────────
function buildAddresses(results: Record<string, ModuleResult>): Address[] {
  const out: Address[] = []; const seen = new Set<string>();
  function addAddr(a: Address) {
    const key = `${a.logradouro}|${a.numero}|${a.cep}`.toLowerCase().trim();
    if (!key || key === "||" || (!a.logradouro && !a.cep)) return;
    if (seen.has(key)) return; seen.add(key); out.push(a);
  }
  for (const mod of Object.values(results)) {
    if (!mod?.data) continue;
    for (const sec of mod.data.sections) {
      if (!/ENDEREC|LOGRADOURO|RESID|CEP|MORADA/i.test(sec.name)) continue;
      for (const item of sec.items) {
        addAddr({
          logradouro:  item.match(/(?:LOGRADOURO|ENDERECO|RUA|AV\.?|ALAMEDA)[\s:·]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
          numero:      item.match(/(?:\bNUMERO\b|\bNUM\b|Nº|N°)[\s:·]+([^|·\n\s,]+)/i)?.[1]?.trim() ?? "",
          complemento: item.match(/(?:COMPLEMENTO|COMPL|APTO|AP)[\s:·]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
          bairro:      item.match(/BAIRRO[\s:·]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
          cidade:      item.match(/(?:CIDADE|MUNICIPIO|MUNICÍPIO)[\s:·]+([^|·\n,\-]+)/i)?.[1]?.trim() ?? "",
          uf:          item.match(/(?:\bUF\b|\bESTADO\b)[\s:·]+([A-Z]{2})/i)?.[1]?.trim() ?? "",
          cep:         item.match(/CEP[\s:·]+(\d{5}-?\d{3}|\d{8})/i)?.[1]?.trim() ?? "",
        });
      }
    }
    const flds = mod.data.fields;
    const logradouro = gf(flds,"LOGRADOURO","ENDERECO","RUA","ENDERECO COMPLETO","LOGRADOUROCOMPLETO");
    if (logradouro) addAddr({
      logradouro, numero: gf(flds,"NUMERO","NÚMERO","NUM","NUMEROIMOVEL"),
      complemento: gf(flds,"COMPLEMENTO","COMPL","APTO"), bairro: gf(flds,"BAIRRO"),
      cidade: gf(flds,"CIDADE","MUNICIPIO","MUNICÍPIO"), uf: gf(flds,"UF","ESTADO","UFENDERECO"), cep: gf(flds,"CEP","CEPENDERECO"),
    });
    for (const cm of mod.data.raw.matchAll(/CEP[\s:·]+(\d{5}-?\d{3})/gi)) {
      const cep = cm[1]; const idx = cm.index ?? 0;
      const chunk = mod.data.raw.slice(Math.max(0, idx - 400), idx + 200);
      addAddr({ logradouro: rxv(chunk,"LOGRADOURO","ENDERECO","RUA","AV") || "", numero: rxv(chunk,"NUMERO","N[UÚ]MERO","NUM") || "",
        complemento: rxv(chunk,"COMPLEMENTO","COMPL","APTO") || "", bairro: rxv(chunk,"BAIRRO") || "",
        cidade: rxv(chunk,"CIDADE","MUNICIPIO","MUNICÍPIO") || "", uf: chunk.match(/\bUF[\s:·]+([A-Z]{2})\b/i)?.[1] ?? "", cep });
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
      const empresa = item.match(/(?:EMPRESA|RAZAO SOCIAL|EMPREGADOR|NOMEEMPREGADOR)[\s:·]+([^|·\n]+)/i)?.[1]?.trim()
                   ?? item.match(/^([^|·\n:]{5,60})(?:\s*[|·]|$)/)?.[1]?.trim() ?? "";
      out.push({
        empresa, cnpj: item.match(/CNPJ[\s:·]+(\d[\d.\-/]+)/i)?.[1] ?? "",
        cargo:    item.match(/(?:CARGO|FUNCAO|FUNÇÃO|CBO)[\s:·]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
        admissao: item.match(/(?:ADMISSAO|ADMISSÃO|ENTRADA|DTADMISSAO|DATA ADMIS)[\s:·]+(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? "",
        demissao: item.match(/(?:DEMISSAO|DEMISSÃO|SAIDA|DTRESCISAO|DATA DEMIS)[\s:·]+(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? "",
        salario:  item.match(/(?:SALARIO|SALÁRIO|REMUNER|SALARIOCONTRIBUICAO)[\s:·]+([R$\d.,\s]+)/i)?.[1]?.trim() ?? "",
      });
    }
  }
  return out.filter(e => e.empresa);
}

// ─── Build relatives ──────────────────────────────────────────────────────────
// Parses multiple module results from both Geass and Skylers databases and
// merges them into a single deduplicated list.
// Pass sources as [res, forcedRelacao | undefined] pairs.
// forcedRelacao: when the module is "mae"/"maeSky"/"pai"/"paiSky", the record
// represents a single parent — we override the relação field accordingly.
function buildRelatives(...entries: ([ModuleResult | undefined, string?])[]): Relative[] {
  const relatives: Relative[] = []; const seen = new Set<string>();
  // Some APIs embed the relation type as a prefix in the name field: "MÃE — NADINE SANTOS"
  // We extract it to set relacao and strip it from nome so names render clean.
  // Broad separator: hyphen, en/em dash, U+23AF (⎯ Geass delimiter), horizontal bar, colon, middle dot
  const REL_PREFIX = /^(M[ÃA]E|PAI|IRM[ÃA][OS]?|FILH[OA]S?|C[OÔ]NJUGE|PARENTE|RELACIONADO)\s*[-\u2013\u2014\u23AF\u2012\u2015:·\u00B7]+\s*/i;
  const BARE_DASH  = /^[-\u2013\u2014\u23AF\u2012\u2015\s]+/;
  function addRel(r: Partial<Relative>) {
    const raw = (r.nome || "").trim();
    const prefixMatch = raw.match(REL_PREFIX);
    // Strip "MÃE — NOME" pattern OR bare leading dashes like "—NOME"
    const nome     = prefixMatch ? raw.slice(prefixMatch[0].length).trim() : raw.replace(BARE_DASH, "").trim();
    const prefixRel = prefixMatch
      ? prefixMatch[1].toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      : "";
    // Use prefix as relacao only when current relacao is generic/absent
    const isGeneric = !r.relacao || /^(PARENTE|RELACIONADO|OUTROS?)$/i.test(r.relacao);
    const relacao   = (prefixRel && isGeneric) ? prefixRel : (r.relacao || prefixRel || "");
    // Reject URLs, very short or empty names
    if (!nome || nome.length < 3 || /^https?:\/\//i.test(nome)) return;
    const key = (r.cpf || nome || "").toLowerCase().trim();
    if (!key || seen.has(key)) return; seen.add(key);
    relatives.push({ cpf: r.cpf||"", nome, nasc: r.nasc||"", sexo: r.sexo||"", relacao, origem: r.origem||"" });
  }
  function scanRaw(raw: string, fallbackRelacao?: string) {
    const entries2 = raw.split(/\bNOME[\s:·]+/i);
    for (let i = 1; i < entries2.length; i++) {
      const chunk = entries2[i].slice(0, 300);
      const nome = (chunk.match(/^([^·\n|,;]{3,60}?)(?:\s*[·|]|\s+CPF|\s+NASC|\s*$)/i)?.[1]
        ?.replace(/\s+[A-Z]{3,}(?:\s*[\u23AF\-].*)?\s*$/, "")
        ?.trim()) ?? "";
      const cpf  = chunk.match(/CPF[\s:·]+(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})/i)?.[1]?.replace(/\D/g,"") ?? "";
      const nasc = chunk.match(/(?:NASC|NASCIMENTO|DATA_NASC)[\s:·]+(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? "";
      const sexo = chunk.match(/SEXO[\s:·]+([MF])/i)?.[1] ?? "";
      if (nome || cpf) addRel({ nome, cpf, nasc, sexo, relacao: fallbackRelacao });
    }
  }
  function parseGeassParentes(raw: string): boolean {
    // Geass API format: "(N) PARENTES ENCONTRADOS PARA O CPF - XXXXXXXXXX"
    // Each entry:  CPF PARENTE ⎯ 12345678901 ⎯ NOME PARENTE ⎯ NOME AQUI ⎯ PARENTESCO ⎯ PAI
    // The separator ⎯ (U+23AF) appears BEFORE "PARENTESCO", so we must match it explicitly.
    // BUG HISTORY: using \s+PARENTESCO instead of \s*⎯\s*PARENTESCO caused the regex
    // to never match — the ⎯ before PARENTESCO is not whitespace and breaks the pattern.
    const SEP = "\u23AF";
    // Rich format: CPF PARENTE ⎯ [cpf] ⎯ NOME PARENTE ⎯ [name] ⎯ PARENTESCO ⎯ [relac]
    const reRich = new RegExp(
      `CPF\\s+PARENTE\\s*${SEP}\\s*([\\d.\\-/]*)\\s*${SEP}\\s*NOME\\s+PARENTE\\s*${SEP}\\s*([^${SEP}]+?)\\s*${SEP}\\s*PARENTESCO\\s*${SEP}\\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ]+)`,
      "gi"
    );
    let m: RegExpExecArray | null;
    let added = false;
    while ((m = reRich.exec(raw)) !== null) {
      const cpf   = m[1].replace(/\D/g, "");
      const nome  = m[2].trim();
      const relac = m[3].trim().toUpperCase();
      addRel({ cpf: cpf.length === 11 ? cpf : "", nome, relacao: relac });
      added = true;
    }
    if (added) return true;
    // Simple fallback: NOME PARENTE ⎯ [name] ⎯ PARENTESCO ⎯ [relac]  (no CPF field)
    const reSimple = new RegExp(
      `NOME\\s+PARENTE\\s*${SEP}\\s*([^${SEP}]+?)\\s*${SEP}\\s*PARENTESCO\\s*${SEP}\\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ]+)`,
      "gi"
    );
    while ((m = reSimple.exec(raw)) !== null) {
      addRel({ nome: m[1].trim(), relacao: m[2].trim().toUpperCase() });
      added = true;
    }
    return added;
  }
  function extractSingleRecord(res: ModuleResult, relacao: string) {
    // For mae/pai modules: the response is a person record — extract as one relative entry
    const f = res.data!.fields;
    const raw = res.data!.raw;
    const nome = gf(f,"NOME","NOMERELACIONADO","NOMECOMPLETO") || raw.match(/NOME[\s:·]+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^·\n,;|]{2,60}?)(?:\s*[·|]|$)/i)?.[1]?.trim() || "";
    const cpf  = (gf(f,"CPF","CPFREL","CPFRELACIONADO") || raw.match(/\bCPF[\s:·]+(\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})/i)?.[1] || "").replace(/\D/g,"");
    const nasc = gf(f,"DATANASCIMENTO","NASC","NASCIMENTO","DATA_NASC") || raw.match(/(?:NASC|NASCIMENTO)[\s:·]+(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] || "";
    const sexo = gf(f,"SEXO") || raw.match(/SEXO[\s:·]+([MF])/i)?.[1] || "";
    if (nome || cpf) addRel({ nome, cpf, nasc, sexo, relacao, origem: "direto" });
    // Also try to pick up any additional relatives hidden in sections
    if (res.data!.sections.length > 0) processSource(res, relacao);
  }
  function processSource(res: ModuleResult, forcedRelacao?: string) {
    const startLen = relatives.length;
    const rawText  = res.data!.raw;

    // ── Geass "(N) PARENTES ENCONTRADOS" — always runs FIRST, before section loop ──
    // This format uses ⎯-delimited fields (not section headers) so the API server
    // produces sections=[] for it. Running the parser here (not inside the
    // sections-empty guard) means it also wins when a non-standard Geass response
    // accidentally creates sections, preventing the section loop from emitting garbled entries.
    if (rawText && /PARENTES\s+ENCONTRADOS/i.test(rawText)) {
      if (parseGeassParentes(rawText)) return; // structured parse succeeded → done
    }

    for (const sec of res.data!.sections) {
      const items = sec.items;
      if (!items.length) continue;
      const isFullRecord = items.some(it =>
        (it.includes("CPF") || it.includes("NOME")) && (it.includes("·") || it.includes("|") || it.match(/[A-Z]{2,}:.*[A-Z]{2,}:/))
      );
      if (isFullRecord) {
        for (const item of items) {
          const cpf    = item.match(/CPF[\s:·]+(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})/i)?.[1]?.replace(/\D/g,"") ?? "";
          const nome   = (item.match(/NOME RELACIONADO[\s:·]+([^·|\n,;]{3,60}?)(?:\s*[·|]|\s+CPF|\s+NASC|$)/i)?.[1]
                      || item.match(/NOME[\s:·]+([^·|\n,;]{3,60}?)(?:\s*[·|]|\s+CPF|\s+NASC|$)/i)?.[1])?.trim() ?? "";
          const nasc   = item.match(/(?:NASC|DATA_?NASC|NASCIMENTO)[\s:·]+(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? "";
          const sexo   = item.match(/SEXO[\s:·]+([MF])/i)?.[1] ?? "";
          const origem = item.match(/ORIGEM[\s:·]+([^·|\n,;]{2,40}?)(?:\s*[·|]|$)/i)?.[1]?.trim() ?? "";
          // Extract relationship type from PARENTESCO / TIPO_RELAC / RELACAO fields
          const relac  = item.match(/PARENTESCO[\s:·]+([A-Z]+)/i)?.[1]
                      ?? item.match(/TIPO[_\s]?RELAC\w*[\s:·]+([A-Z]+)/i)?.[1]
                      ?? item.match(/RELAC\w*[\s:·]+([A-Z]+)/i)?.[1]
                      ?? "";
          if (cpf || nome) addRel({ cpf, nome, nasc, sexo, relacao: relac || forcedRelacao || sec.name, origem });
        }
      } else {
        let cur: Partial<Relative> = { relacao: forcedRelacao || sec.name };
        for (const item of items) {
          const kv = item.match(/^([A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_0-9 ]+):\s*(.+)$/i);
          if (!kv) continue;
          const k = kv[1].trim().toUpperCase().replace(/[\s_]/g,""); const v = kv[2].trim();
          const isNome = k === "NOME" || k === "NOMERELACIONADO" || k === "NOMEPARTE";
          if (isNome && cur.nome) { addRel(cur); cur = { relacao: forcedRelacao || sec.name }; }
          if (isNome) cur.nome = v;
          else if (k === "CPF" || k === "CPFREL" || k === "CPFRELACIONADO") cur.cpf = v.replace(/\D/g,"");
          else if (k.includes("NASC") || k.includes("DATANASC")) cur.nasc = v;
          else if (k === "SEXO") cur.sexo = v;
          else if (k.includes("ORIGEM")) cur.origem = v;
          else if (k.includes("RELAC") || k.includes("PARENT")) cur.relacao = forcedRelacao || v;
        }
        addRel(cur);
      }
    }
    // scanRaw is the last resort — skip it when the raw looks like a Geass parentes
    // response (parseGeassParentes already ran above and returned false, meaning 0 matches;
    // scanRaw on that format produces garbled entries via the NOME split heuristic).
    if (relatives.length === startLen && rawText && !/PARENTES\s+ENCONTRADOS/i.test(rawText)) {
      scanRaw(rawText, forcedRelacao);
    }
    if (relatives.length === startLen && res.data!.fields.length > 0) {
      const cpf = gf(res.data!.fields,"CPF","CPFREL"); const nome = gf(res.data!.fields,"NOME","NOMERELACIONADO");
      const nasc = gf(res.data!.fields,"NASC","NASCIMENTO","DATANASCIMENTO");
      if (cpf || nome) addRel({ cpf, nome, nasc, relacao: forcedRelacao });
    }
  }
  for (const [src, forced] of entries) {
    if (!src?.data) continue;
    if (forced) {
      extractSingleRecord(src, forced);
    } else {
      processSource(src);
    }
  }
  return relatives;
}

// ─── Extract photo ────────────────────────────────────────────────────────────
function extractPhotoFromResult(res: ModuleResult): string | null {
  if (!res?.data) return null;
  // Priority 1: look for FOTO_URL key specifically (set by parseSkylers)
  const fotoField = res.data.fields.find(([k]) => k === "FOTO_URL");
  if (fotoField?.[1]) {
    const v = fotoField[1].trim();
    if (v) return v.startsWith("data:") ? v : /^https?:\/\//.test(v) ? v : `data:image/jpeg;base64,${v.replace(/\s/g, "")}`;
  }
  // Priority 2: raw field (only if it looks like a pure data URI or URL)
  const raw = res.data.raw ?? "";
  if (raw) {
    const trimmed = raw.trim().replace(/\s/g, "");
    if (raw.trim().startsWith("data:image")) return raw.trim();
    if (trimmed.length > 500 && /^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 200))) return `data:image/jpeg;base64,${trimmed}`;
  }
    // Priority 3: scan only photo-related field keys
  for (const [k, v] of res.data.fields) {
    if (!v || !/FOTO|URL_FOTO|IMAGEM|BASE64|BIOMETRIA/i.test(k)) continue;
    if (v.trim().startsWith("data:image")) return v.trim();
    if (/^https?:\/\//.test(v.trim())) return v.trim();
    const clean = v.replace(/\s/g, "");
    if (clean.length > 200 && /^[A-Za-z0-9+/=]+$/.test(clean.slice(0, 100))) return `data:image/jpeg;base64,${clean}`;
  }
  // Priority 4: scan ALL field values for any long base64/data-URI (last resort)
  for (const [, v] of res.data.fields) {
    if (!v || v.length < 500) continue;
    if (v.trim().startsWith("data:image")) return v.trim();
    const clean = v.replace(/\s/g, "");
    if (clean.length > 500 && /^[A-Za-z0-9+/=]{500,}$/.test(clean.slice(0, 600))) return `data:image/jpeg;base64,${clean}`;
  }
  return null;
}
function extractPhoto(results: Record<string, ModuleResult>): string | null {
  for (const key of ["fotonc", "foto"]) {
    const r = results[key];
    if (r?.data) { const p = extractPhotoFromResult(r); if (p) return p; }
  }
  for (const key of ["cpfbasico", "cpf"]) {
    const res = results[key];
    if (!res?.data) continue;
    for (const [k, v] of res.data.fields) {
      if (/FOTO|URL_FOTO|IMAGEM|BASE64/i.test(k) && v && v.length > 50)
        return v.startsWith("http") ? v : v.startsWith("data:") ? v : `data:image/jpeg;base64,${v}`;
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
  const body = n.length === 9 ? `${n.slice(0,5)}-${n.slice(5)}`
             : n.length === 8 ? `${n.slice(0,4)}-${n.slice(4)}`
             : n;
  return ddd ? `(${ddd}) ${body}` : body;
}
function phoneScore(p: { ddd: string; numero: string; prioridade: string; data: string }): number {
  let s = 0;
  // Mobile (9 digits starting with 9 or 8) = higher priority
  if (p.numero.length === 9 && /^[98]/.test(p.numero)) s += 1000;
  // Has DDD = more reliable
  if (p.ddd) s += 500;
  // Prioridade field (lower = better, max bonus 300)
  if (p.prioridade) { const n = parseInt(p.prioridade); if (!isNaN(n)) s += Math.max(0, 300 - n * 30); }
  // Most recent date first
  if (p.data) {
    const m = p.data.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) s += parseInt(m[3]) * 12 + parseInt(m[2]);
  }
  return s;
}

// ─── Copy button ──────────────────────────────────────────────────────────────
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
type IconProp = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
function SectionHeader({ icon: Icon, title, count }: { icon: IconProp; title: string; count?: number }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <Icon className="w-4.5 h-4.5" style={{ color: "var(--color-primary)" }} />
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          {title}
          {count !== undefined && <span className="text-sm font-normal" style={{ color: "color-mix(in srgb, var(--color-primary) 55%, transparent)" }}>({count})</span>}
        </h2>
      </div>
      <div className="h-px mt-2" style={{ background: "linear-gradient(to right, var(--color-primary), transparent)" }} />
    </div>
  );
}

// ─── Collapsible Section (glass) ──────────────────────────────────────────────
function CollapsibleSection({ title, icon: Icon, count, children, defaultOpen = true, delay = 0 }:
  { title: string; icon: IconProp; count?: number; children: React.ReactNode; defaultOpen?: boolean; delay?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const compact = useViewMode() === "compact";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* Glass wrapper */}
      <div className="relative rounded-2xl overflow-hidden"
        style={{ background: "rgba(255,255,255,0.025)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", border: "1px solid rgba(255,255,255,0.07)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 32px rgba(0,0,0,0.3)" }}>
        {/* Top shine */}
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(255,255,255,0.12), transparent)" }} />

        <div className={compact ? "px-4 py-3" : "px-5 py-4"}>
          {/* Header button */}
          <button onClick={() => setOpen(v => !v)} className="flex items-center gap-2.5 w-full text-left group">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)" }}>
              <Icon className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
            </div>
            <span className={`font-bold text-white flex-1 ${compact ? "text-[13px]" : "text-[15px]"}`}>
              {title}
              {count !== undefined && (
                <span className={`font-normal ml-2 ${compact ? "text-[11px]" : "text-[13px]"}`} style={{ color: "color-mix(in srgb, var(--color-primary) 55%, transparent)" }}>({count})</span>
              )}
            </span>
            <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }} className="text-white/30 group-hover:text-white/60 transition-colors">
              <ChevronDown className="w-4 h-4" />
            </motion.span>
          </button>

          {/* Divider */}
          <div className="mt-3 mb-0 h-px" style={{ background: "linear-gradient(to right, rgba(124,58,237,0.4), rgba(124,58,237,0.08), transparent)" }} />

          {/* Content */}
          <AnimatePresence initial={false}>
            {open && (
              <motion.div key="c"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className={compact ? "pt-3" : "pt-4"}>
                {children}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Identity Card ────────────────────────────────────────────────────────────
function IdentityCard({ id, photo }: { id: Identity; photo: string | null }) {
  const compact = useViewMode() === "compact";
  const [cpfCopied, setCpfCopied] = useState(false);
  const uf = id.orgaoEmissor.match(/\b([A-Z]{2})$/)?.[1] ?? id.orgaoEmissor.match(/[-\/\s]([A-Z]{2})$/)?.[1] ?? "";
  const copyCpf = () => {
    navigator.clipboard.writeText(fmtCPF(id.cpf)).then(() => {
      setCpfCopied(true);
      setTimeout(() => setCpfCopied(false), 1500);
    });
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
            <button
              onClick={() => { navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}
              className="shrink-0 transition-colors p-1 rounded-md active:bg-white/15"
              title={`Copiar ${label}`}>
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
      {/* Header banner */}
      <div className="relative px-6 sm:px-8 py-5 overflow-hidden" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 55%, black) 0%, color-mix(in srgb, var(--color-primary) 40%, black) 50%, color-mix(in srgb, var(--color-primary) 48%, black) 100%)" }}>
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)", backgroundSize: "12px 12px" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 80% 50%, rgba(255,255,255,0.08) 0%, transparent 70%)" }} />
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1"><span className="text-xl">🇧🇷</span><p className="text-[9px] font-extrabold tracking-[0.22em] text-white/95">REPÚBLICA FEDERATIVA DO BRASIL</p></div>
            {uf && <p className="text-[8px] tracking-[0.16em] text-white/60 mb-0.5">SECRETARIA DE SEGURANÇA PÚBLICA — SSP/{uf}</p>}
            <p className="text-[13px] font-black tracking-[0.32em] text-white mt-1">CARTEIRA DE IDENTIDADE</p>
            {/* Copy CPF pill — prominent and always accessible */}
            {id.cpf && (
              <button onClick={copyCpf}
                className="mt-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all active:scale-95"
                style={{ background: cpfCopied ? "rgba(52,211,153,0.2)" : "rgba(255,255,255,0.12)", border: `1px solid ${cpfCopied ? "rgba(52,211,153,0.5)" : "rgba(255,255,255,0.22)"}`, backdropFilter: "blur(8px)" }}>
                {cpfCopied
                  ? <><Check className="w-3 h-3 text-emerald-300" /><span className="text-[11px] font-bold text-emerald-300 font-mono">Copiado!</span></>
                  : <><Copy className="w-3 h-3 text-white/70" /><span className="text-[11px] font-bold text-white/90 font-mono">{fmtCPF(id.cpf)}</span></>
                }
              </button>
            )}
          </div>
          <div className="text-right shrink-0">
            <span className="inline-block text-[8px] bg-white/20 backdrop-blur rounded-full px-3 py-1 text-white/90 border border-white/25 font-semibold tracking-widest">1ª VIA</span>
            {id.situacaoCadastral && <p className={`text-[9px] mt-1.5 font-bold tracking-widest ${/REGULAR|ATIVO/i.test(id.situacaoCadastral) ? "text-emerald-300" : "text-amber-300"}`}>◉ {id.situacaoCadastral.toUpperCase()}</p>}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ background: "rgba(9,9,15,0.85)", backdropFilter: "blur(16px)" }} className={compact ? "p-4" : "p-5 sm:p-7"}>
        {compact ? (
          /* ── Compact layout ── */
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
          /* ── Expanded layout ── */
          <div className="flex gap-4">
            {/* Photo column — always visible, like a real ID card */}
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
              {(id.tituloEleitor || id.pis) && (
                <div className="grid grid-cols-2 gap-3">
                  {id.tituloEleitor && <F label="Título de Eleitor" value={id.tituloEleitor} mono />}
                  {id.pis && <F label="PIS / NIS" value={id.pis || id.nis} mono />}
                </div>
              )}
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
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      className="relative overflow-hidden rounded-3xl"
      style={{
        border: "1px solid color-mix(in srgb, var(--color-primary) 22%, transparent)",
        boxShadow: "0 0 60px color-mix(in srgb, var(--color-primary) 8%, transparent), inset 0 1px 0 rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px)",
      }}>

      {/* Background gradient */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 14%, transparent) 0%, rgba(9,9,15,0.95) 60%)" }} />
      {/* Animated glow */}
      <motion.div className="absolute -left-20 top-0 bottom-0 w-72 rounded-full blur-3xl pointer-events-none"
        style={{ background: "color-mix(in srgb, var(--color-primary) 14%, transparent)" }}
        animate={{ opacity: [0.5, 0.9, 0.5] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} />

      <div className="relative flex items-stretch">
        {/* Large photo */}
        <div className="relative shrink-0 w-40 sm:w-52">
          <img src={photo} alt={identity.nome} className="w-full h-full object-cover"
            style={{ minHeight: 180 }}
            onError={() => setImgOk(false)} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to right, transparent 55%, rgba(9,9,15,0.96))" }} />
          {/* Fingerprint badge */}
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-primary) 18%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)", backdropFilter: "blur(8px)" }}>
            <Fingerprint className="w-2.5 h-2.5" style={{ color: "var(--color-primary)" }} />
            <span className="text-[7px] uppercase tracking-widest font-bold" style={{ color: "color-mix(in srgb, var(--color-primary) 90%, white)" }}>Biométrica</span>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 p-6 sm:p-8 flex flex-col justify-center min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <motion.div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-primary)" }}
              animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
            <span className="text-[9px] uppercase tracking-[0.3em] font-bold" style={{ color: "color-mix(in srgb, var(--color-primary) 70%, transparent)" }}>Foto Biométrica Confirmada</span>
          </div>

          <p className="text-2xl sm:text-3xl font-black text-white leading-tight break-words mb-1">
            {identity.nome || "Titular"}
          </p>

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
              ↓ Baixar Foto
            </a>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Phone card ───────────────────────────────────────────────────────────────
function PhoneCard({ phone, idx }: { phone: PhoneEntry; idx: number }) {
  const compact = useViewMode() === "compact";
  const formatted = fmtPhone(phone.ddd, phone.numero);
  const isMobile  = phone.numero.length === 9 && /^[98]/.test(phone.numero);
  const tipoLabel = phone.tipo || (isMobile ? "Celular" : phone.numero.length === 8 ? "Fixo" : "");
  const noDDD     = !phone.ddd;
  const waHref    = `https://wa.me/55${phone.ddd}${phone.numero}`;

  if (compact) {
    return (
      <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }}
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-white/[0.04] transition-all">
        <Phone className="w-3.5 h-3.5 shrink-0" style={{ color: isMobile ? "#34d399" : "var(--color-primary)" }} />
        <span className="flex-1 font-mono text-[13px] font-bold text-white">{formatted}</span>
        {tipoLabel && <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-semibold ${isMobile ? "bg-emerald-500/15 text-emerald-400" : "bg-white/8 text-white/35"}`}>{tipoLabel}</span>}
        {noDDD && <span className="text-[8px] text-amber-500/60 px-1">sem DDD</span>}
        <CopyBtn text={formatted} />
        <a href={waHref} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[9px] font-bold transition-colors">
          <MessageCircle className="w-2.5 h-2.5" /> WA
        </a>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.04 }}
      className="flex items-center gap-3 rounded-xl transition-all p-3"
      style={{ border: `1px solid ${isMobile ? "rgba(52,211,153,0.18)" : "rgba(255,255,255,0.07)"}`, background: "rgba(0,0,0,0.2)", backdropFilter: "blur(8px)" }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: isMobile ? "rgba(52,211,153,0.1)" : "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                 border: `1px solid ${isMobile ? "rgba(52,211,153,0.25)" : "color-mix(in srgb, var(--color-primary) 25%, transparent)"}` }}>
        <Phone className="w-4 h-4" style={{ color: isMobile ? "#34d399" : "var(--color-primary)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[14px] font-bold font-mono text-white">{formatted}</p>
          {tipoLabel && (
            <span className={`text-[8px] px-2 py-0.5 rounded-full font-semibold ${isMobile ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-white/6 text-white/30 border border-white/10"}`}>
              {tipoLabel}
            </span>
          )}
          {noDDD && <span className="text-[8px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500/60 border border-amber-500/20">sem DDD</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-0.5">
          {phone.prioridade && <span className="text-[9px] text-white/30">Prio {phone.prioridade}</span>}
          {phone.classificacao && phone.classificacao !== "Não Informado" && <span className="text-[9px] text-white/25">· {phone.classificacao}</span>}
          {phone.data && phone.data !== "Não Informado" && <span className="text-[9px] text-white/20">· {phone.data}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <CopyBtn text={formatted} />
        <a href={waHref} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] font-bold transition-colors whitespace-nowrap">
          <MessageCircle className="w-3 h-3" /> WA
        </a>
      </div>
    </motion.div>
  );
}

// ─── Address card ─────────────────────────────────────────────────────────────
function AddressCard({ addr, idx }: { addr: Address; idx: number }) {
  const compact = useViewMode() === "compact";
  const full = [addr.logradouro, addr.numero, addr.complemento && addr.complemento !== "Não Informado" ? addr.complemento : "", addr.bairro, addr.cidade, addr.uf].filter(Boolean).join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(full)}`;
  if (compact) {
    return (
      <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }}
        className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04] transition-all">
        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0" style={{ background: "color-mix(in srgb, var(--color-primary) 18%, transparent)", color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)" }}>{idx + 1}</span>
        <span className="flex-1 text-[12px] text-white/75 truncate">{full || "—"}</span>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "color-mix(in srgb, var(--color-primary) 60%, transparent)" }}>
          <MapPin className="w-3.5 h-3.5" />
        </a>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.05 }}
      className="group flex items-start gap-3 rounded-xl transition-all p-3"
      style={{ border: "1px solid color-mix(in srgb, var(--color-primary) 18%, transparent)", background: "color-mix(in srgb, var(--color-primary) 5%, transparent)", backdropFilter: "blur(8px)" }}>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5" style={{ background: "color-mix(in srgb, var(--color-primary) 20%, transparent)", color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)" }}>{idx + 1}</div>
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

// ─── Employment Timeline ──────────────────────────────────────────────────────
function EmploymentTimeline({ employments }: { employments: Employment[] }) {
  const compact = useViewMode() === "compact";
  const sorted = [...employments].sort((a, b) => (parseDateBR(b.admissao)?.getTime() ?? 0) - (parseDateBR(a.admissao)?.getTime() ?? 0));

  if (compact) {
    return (
      <div className="space-y-1.5">
        {sorted.map((emp, i) => {
          const isCurrent = !emp.demissao;
          const duration = calcDuration(emp.admissao, emp.demissao);
          return (
            <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04] transition-all">
              <div className={`w-2 h-2 rounded-full shrink-0 ${isCurrent ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-white/20"}`} />
              <span className="flex-1 text-[12px] font-semibold text-white truncate">{emp.empresa}</span>
              {emp.cargo && <span className="text-[10px] text-white/35 hidden sm:block truncate max-w-[120px]">{emp.cargo}</span>}
              <span className="text-[9px] text-white/30 shrink-0">{emp.admissao || "?"} → {isCurrent ? "Hoje" : emp.demissao}</span>
              {duration && <span className="text-[8px] text-white/20 shrink-0 hidden sm:block">{duration}</span>}
              {emp.salario && <span className="text-[11px] font-bold text-emerald-400 shrink-0">{/^R/.test(emp.salario.trim()) ? emp.salario : `R$ ${emp.salario}`}</span>}
              {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />}
            </motion.div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative pl-8">
      <div className="absolute left-[11px] top-3 bottom-3 w-0.5 rounded-full"
        style={{ background: "linear-gradient(to bottom, var(--color-primary), rgba(255,255,255,0.06), transparent)" }} />
      <div className="space-y-5">
        {sorted.map((emp, i) => {
          const isCurrent = !emp.demissao;
          const duration = calcDuration(emp.admissao, emp.demissao);
          const initials = emp.empresa.match(/\b\w/g)?.slice(0, 2).join("").toUpperCase() ?? "?";
          return (
            <motion.div key={i} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }} className="relative">
              <div className={`absolute -left-[21px] top-5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${isCurrent ? "border-emerald-400 bg-emerald-900/60 shadow-[0_0_10px_rgba(52,211,153,0.45)]" : "border-primary/50 bg-[#09090f]"}`}>
                {isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
              </div>
              <div className="rounded-2xl border p-4 transition-all"
                style={{ border: isCurrent ? "1px solid rgba(16,185,129,0.22)" : "1px solid rgba(255,255,255,0.07)", background: isCurrent ? "rgba(6,78,59,0.12)" : "rgba(0,0,0,0.18)", backdropFilter: "blur(8px)" }}>
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[12px] font-black shrink-0"
                    style={isCurrent ? { background: "rgba(16,185,129,0.15)", color: "rgb(110,231,183)", border: "1px solid rgba(16,185,129,0.3)" } : { background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", color: "color-mix(in srgb, var(--color-primary) 80%, white)", border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)" }}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold text-white leading-tight truncate">{emp.empresa}</p>
                        {emp.cargo && <p className="text-[11px] text-white/45 mt-0.5">{emp.cargo}</p>}
                      </div>
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest shrink-0"
                          style={{ border: "1px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.1)", color: "rgb(110,231,183)" }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Atual
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-[10px] text-white/35">
                        <span>{emp.admissao || "?"}</span><span className="text-white/15">→</span>
                        <span className={isCurrent ? "text-emerald-400/70" : ""}>{isCurrent ? "Presente" : emp.demissao}</span>
                      </div>
                      {duration && <span className="text-[9px] px-2 py-0.5 rounded-full text-white/30" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}>{duration}</span>}
                      {emp.cnpj && <span className="text-[9px] font-mono text-white/18">{emp.cnpj}</span>}
                    </div>
                    {emp.salario && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[8.5px] uppercase tracking-wider text-white/22">Remuneração</span>
                        <span className="text-[13px] font-bold text-emerald-400">{/^R/.test(emp.salario.trim()) ? emp.salario : `R$ ${emp.salario}`}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Map helpers ──────────────────────────────────────────────────────────────
const MARKER_PALETTE = [
  { fill: "#7c3aed", stroke: "#a855f7", glow: "rgba(124,58,237,0.55)" },
  { fill: "#2563eb", stroke: "#60a5fa", glow: "rgba(37,99,235,0.55)" },
  { fill: "#059669", stroke: "#34d399", glow: "rgba(5,150,105,0.55)" },
  { fill: "#b45309", stroke: "#fbbf24", glow: "rgba(180,83,9,0.55)" },
  { fill: "#be123c", stroke: "#fb7185", glow: "rgba(190,18,60,0.55)" },
  { fill: "#0e7490", stroke: "#22d3ee", glow: "rgba(14,116,144,0.55)" },
  { fill: "#4f46e5", stroke: "#818cf8", glow: "rgba(79,70,229,0.55)" },
  { fill: "#7c3aed", stroke: "#a855f7", glow: "rgba(124,58,237,0.55)" },
];
function markerColor(idx: number) { return MARKER_PALETTE[idx % MARKER_PALETTE.length]; }

function MapBoundsAdjuster({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) { map.setView(points[0], 14, { animate: false }); return; }
    const lats = points.map(p => p[0]);
    const lngs = points.map(p => p[1]);
    const sw: [number, number] = [Math.min(...lats), Math.min(...lngs)];
    const ne: [number, number] = [Math.max(...lats), Math.max(...lngs)];
    map.fitBounds([sw, ne], { padding: [52, 52], maxZoom: 13, animate: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);
  return null;
}

// ─── Person Node ──────────────────────────────────────────────────────────────
function PersonNode({ nome, cpf, nasc, photo, loading, isMain, label, sexo, small }: {
  nome?: string; cpf?: string; nasc?: string; photo?: string; loading?: boolean;
  isMain?: boolean; label?: string; sexo?: string; small?: boolean;
}) {
  const emoji = sexo?.toLowerCase() === "f" ? "♀" : sexo?.toLowerCase() === "m" ? "♂" : "";
  const sz = isMain ? { w: 76, h: 96 } : small ? { w: 52, h: 66 } : { w: 64, h: 80 };
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0">
      {label && (
        <span className={`text-[8px] uppercase tracking-widest font-bold mb-0.5 ${isMain ? "" : "text-white/35"}`}
          style={isMain ? { color: "var(--color-primary)" } : {}}>
          {label}
        </span>
      )}
      <div
        className="relative overflow-hidden flex items-center justify-center rounded-2xl"
        style={{
          width: sz.w, height: sz.h,
          ...(isMain
            ? { border: "2px solid rgba(124,58,237,0.75)", boxShadow: "0 0 28px rgba(124,58,237,0.4)", background: "rgba(255,255,255,0.05)" }
            : photo
              ? { border: "1.5px solid rgba(52,211,153,0.35)", boxShadow: "0 0 12px rgba(52,211,153,0.12)", background: "rgba(255,255,255,0.04)" }
              : { border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }),
        }}>
        {loading
          ? <Loader2 className={`animate-spin text-white/25 ${isMain ? "w-6 h-6" : "w-5 h-5"}`} />
          : photo
            ? <img src={photo} alt={nome} className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            : <User className={`text-white/10 ${isMain ? "w-8 h-8" : "w-6 h-6"}`} />}
        {isMain && (
          <div className="absolute top-1 left-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: "rgba(124,58,237,0.55)" }}>
            <Star className="w-2 h-2 text-white" fill="white" />
          </div>
        )}
        {photo && (
          <div className={`absolute bottom-1 right-1 rounded-full flex items-center justify-center ${isMain ? "w-4 h-4" : "w-3 h-3"}`}
            style={{ background: "rgba(52,211,153,0.25)", border: "1px solid rgba(52,211,153,0.5)" }}>
            <Fingerprint className={`text-emerald-300 ${isMain ? "w-2 h-2" : "w-1.5 h-1.5"}`} />
          </div>
        )}
      </div>
      <div className={`text-center ${isMain ? "max-w-[100px]" : "max-w-[80px]"}`}>
        <p className={`font-bold leading-tight line-clamp-2 ${isMain ? "text-[11px] text-white" : "text-[10px] text-white/75"}`}>
          {nome || "—"}{emoji ? <span className="text-white/30 ml-0.5 text-[8px]">{emoji}</span> : null}
        </p>
        {cpf && cpf.length === 11 && <p className="text-[7px] font-mono text-white/30 mt-0.5">{fmtCPF(cpf)}</p>}
        {nasc && <p className="text-[7px] text-white/22 mt-0.5">{nasc}</p>}
      </div>
    </div>
  );
}

// ─── Family Tree ──────────────────────────────────────────────────────────────
function FamilyTree({ relatives, photos, loadingPhotos, identity, mainPhoto }: {
  relatives: Relative[]; photos: Record<string, string>;
  loadingPhotos: Set<string>; identity: Identity; mainPhoto: string | null;
}) {
  const cats: Record<RelCat, Relative[]> = { pai:[], mae:[], conjuge:[], filho:[], filha:[], irmao:[], irma:[], outro:[] };
  for (const r of relatives) cats[categorizeRel(r)].push(r);
  const np = (r: Relative) => ({ photo: r.cpf ? photos[r.cpf] : undefined, loading: r.cpf ? loadingPhotos.has(r.cpf) : false });

  type ParentEntry = { nome: string; cpf: string; nasc: string; label: string; rel?: Relative };
  const parents: ParentEntry[] = [];
  if (cats.mae.length > 0) cats.mae.forEach(r => parents.push({ nome: r.nome, cpf: r.cpf, nasc: r.nasc, label: "Mãe", rel: r }));
  else if (identity.mae) parents.push({ nome: identity.mae, cpf: "", nasc: "", label: "Mãe" });
  if (cats.pai.length > 0) cats.pai.forEach(r => parents.push({ nome: r.nome, cpf: r.cpf, nasc: r.nasc, label: "Pai", rel: r }));
  else if (identity.pai) parents.push({ nome: identity.pai, cpf: "", nasc: "", label: "Pai" });

  const siblings = [...cats.irmao, ...cats.irma];
  const children = [...cats.filho, ...cats.filha];
  const conjuges = cats.conjuge;
  const outros   = cats.outro;
  const hasTree  = parents.length > 0 || siblings.length > 0 || children.length > 0 || conjuges.length > 0 || relatives.length > 0;

  const Connector = ({ h = 28 }: { h?: number }) => (
    <div className="flex justify-center pointer-events-none select-none">
      <div className="w-0.5 rounded-full" style={{ height: h, background: "linear-gradient(to bottom,rgba(124,58,237,0.3),rgba(255,255,255,0.06))" }} />
    </div>
  );
  const HConnector = () => <div className="flex-1 h-0.5 self-center mx-1 rounded-full" style={{ background: "rgba(255,255,255,0.07)" }} />;

  if (!hasTree) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.2)" }}>
        <Users className="w-10 h-10 mx-auto mb-3 text-white/10" />
        <p className="text-sm text-white/25">Nenhum parente encontrado.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-x-auto" style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.15)" }}>
      <div className="min-w-[480px] p-6 sm:p-8">
        {parents.length > 0 && (
          <>
            <div className="flex items-end justify-center gap-10">
              {parents.map((p, i) => {
                // For parents with CPF: use np(). For parents with name-only: look up by lowercase name key.
                const pPhoto = p.rel ? np(p.rel).photo : (photos[p.nome.toLowerCase()] ?? undefined);
                const pLoading = p.rel ? np(p.rel).loading : (p.nome ? loadingPhotos.has(p.nome.toLowerCase()) : false);
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                    <PersonNode nome={p.nome} cpf={p.cpf} nasc={p.nasc} label={p.label} photo={pPhoto} loading={pLoading} />
                  </motion.div>
                );
              })}
            </div>
            <Connector h={32} />
          </>
        )}

        <div className="flex items-center justify-center gap-2 min-w-0">
          {siblings.length > 0 && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex gap-3 overflow-x-auto max-w-[260px] sm:max-w-[340px] pb-1 scrollbar-none">
                {siblings.map((s, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.06 }} className="shrink-0">
                    <PersonNode nome={s.nome} cpf={s.cpf} nasc={s.nasc} sexo={s.sexo}
                      label={/irma|irmã/i.test(s.relacao) || s.sexo?.toLowerCase() === "f" ? "Irmã" : "Irmão"} {...np(s)} />
                  </motion.div>
                ))}
              </div>
              <HConnector />
            </div>
          )}

          <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}>
            <PersonNode nome={identity.nome || "Titular"} cpf={identity.cpf} nasc={identity.dataNascimento}
              sexo={identity.sexo} photo={mainPhoto ?? undefined} isMain label="★ Titular" />
          </motion.div>

          {conjuges.length > 0 && (
            <div className="flex items-center gap-2">
              <HConnector />
              <div className="flex gap-4">
                {conjuges.map((c, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.08 }}>
                    <PersonNode nome={c.nome} cpf={c.cpf} nasc={c.nasc} sexo={c.sexo} label="Cônjuge" {...np(c)} />
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </div>

        {children.length > 0 && (
          <>
            <Connector h={32} />
            <div className="flex items-start justify-center gap-6 flex-wrap">
              {children.map((c, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.07 }}>
                  <PersonNode nome={c.nome} cpf={c.cpf} nasc={c.nasc} sexo={c.sexo}
                    label={/filha/i.test(c.relacao) || c.sexo?.toLowerCase() === "f" ? "Filha" : "Filho"} {...np(c)} />
                </motion.div>
              ))}
            </div>
          </>
        )}


        {outros.length > 0 && (() => {
          // Group "outros" by their relacao / origem label for clarity
          const groups: Record<string, Relative[]> = {};
          for (const r of outros) {
            const key = r.origem || r.relacao || "Relacionado";
            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
          }
          const groupEntries = Object.entries(groups);
          return (
            <>
              <div className="h-px bg-white/5 mt-8 mb-6" />
              <p className="text-[8px] uppercase tracking-widest text-white/20 mb-5 font-bold text-center">
                Outros Relacionados ({outros.length})
              </p>
              {groupEntries.map(([grpLabel, grpRels], gi) => (
                <div key={gi} className="mb-6">
                  {groupEntries.length > 1 && (
                    <p className="text-[8px] uppercase tracking-[0.2em] text-white/25 font-semibold mb-3 text-center">{grpLabel}</p>
                  )}
                  <div className="flex flex-wrap justify-center gap-4">
                    {grpRels.map((r, i) => (
                      <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.04 * (gi * 10 + i) }}>
                        <PersonNode nome={r.nome} cpf={r.cpf} nasc={r.nasc} sexo={r.sexo}
                          label={groupEntries.length === 1 ? (r.origem || r.relacao || "Relacionado") : undefined}
                          small {...np(r)} />
                      </motion.div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          );
        })()}
      </div>
    </div>
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
  const [relPhotos, setRelPhotos]       = useState<Record<string, string>>({});
  const [relPhotosLoading, setRelPhotosLoading] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"compact" | "expanded">("expanded");
  const [showGraph, setShowGraph]       = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);

  const finalResultsRef = useRef<Record<string, ModuleResult>>({});
  const runRef = useRef(0);
  // Tracks the last CPF for which log-cpffull was sent — prevents React StrictMode
  // from firing the effect twice and double-counting the query.
  const loggedCpfRef = useRef<string | null>(null);

  // ── Fetch modules ─────────────────────────────────────────────────────────
  useEffect(() => {
    const clean = cpf.replace(/\D/g,"");
    if (clean.length !== 11) return;
    const id = ++runRef.current;
    setRunning(true); setDone(false);
    setMStates(Object.fromEntries(MODULES.map(m => [m.tipo, "loading" as ModuleStatus])));
    setMResults({}); setGeoAddr([]); setRelPhotos({}); setRelPhotosLoading(new Set());
    finalResultsRef.current = {};
    const accumulated: Record<string, ModuleResult> = {};
    // Log the whole CPF Full as a single consulta entry.
    // Guard against React StrictMode double-fire: only send if this CPF hasn't been
    // logged yet in this component's lifetime.
    if (loggedCpfRef.current !== clean) {
      loggedCpfRef.current = clean;
      const _tok = localStorage.getItem("infinity_token");
      fetch("/api/infinity/log-cpffull", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${_tok}` },
        body: JSON.stringify({ cpf: clean }),
      }).catch(() => {});
    }
    void Promise.allSettled(
      MODULES.map(async ({ tipo, skylers }) => {
        const res = await fetchModule(tipo, clean, skylers, true);
        if (runRef.current !== id) return;
        accumulated[tipo] = res;
        setMStates(p => ({ ...p, [tipo]: res.status }));
        setMResults(p => ({ ...p, [tipo]: res }));
      })
    ).then(() => {
      if (runRef.current !== id) return;
      finalResultsRef.current = accumulated;
      setRunning(false); setDone(true);
    });
    return () => { runRef.current++; };
  }, [cpf]);

  // ── Geocode ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!done) return;
    const addrs = buildAddresses(finalResultsRef.current);
    if (!addrs.length) return;
    let cancelled = false;
    (async () => {
      const geocodeAddr = async (q: string): Promise<{ lat: number; lng: number } | null> => {
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=br`,
            { headers: { "Accept-Language": "pt-BR", "User-Agent": "InfinitySearch/1.0" } }
          );
          const data = await r.json() as { lat: string; lon: string }[];
          if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        } catch { /* ignore */ }
        return null;
      };
      const result: Address[] = [];
      for (const addr of addrs.slice(0, 15)) {
        if (cancelled) break;
        if (!addr.logradouro && !addr.cep && !addr.cidade) { result.push(addr); continue; }
        // Try full address first, fall back to city+UF, then CEP only
        const queries = [
          [addr.logradouro, addr.numero, addr.bairro, addr.cidade, addr.uf, "Brasil"].filter(Boolean).join(", "),
          [addr.cidade, addr.uf, "Brasil"].filter(Boolean).join(", "),
          addr.cep ? `${addr.cep}, Brasil` : "",
        ].filter(Boolean);
        let geo: { lat: number; lng: number } | null = null;
        for (const q of queries) {
          geo = await geocodeAddr(q);
          if (geo) break;
          await new Promise(res => setTimeout(res, 300));
        }
        result.push(geo ? { ...addr, lat: geo.lat, lng: geo.lng } : addr);
        await new Promise(res => setTimeout(res, 400));
      }
      if (!cancelled) setGeoAddr(result);
    })();
    return () => { cancelled = true; };
  }, [done]);

  // ── Relative photos ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!done) return;
    let cancelled = false;

    (async () => {
      const acc = finalResultsRef.current;
      const rels = buildRelatives([acc["parentes"]]);

      // CPFs already known from the parentes result
      const cpfSet = new Set(rels.filter(r => r.cpf && r.cpf.length === 11).map(r => r.cpf));

      // For parents that don't have CPF in the parentes list, look them up by name
      // Keys for relPhotos will be CPF (if found) or lowercase name (fallback)
      const parentNamesToResolve: { name: string; key: string }[] = [];
      const maeInRels = rels.some(r => categorizeRel(r) === "mae" && r.cpf.length === 11);
      const paiInRels = rels.some(r => categorizeRel(r) === "pai" && r.cpf.length === 11);
      const identityNow = buildIdentity(acc);
      if (!maeInRels && identityNow.mae) {
        parentNamesToResolve.push({ name: identityNow.mae, key: identityNow.mae.toLowerCase() });
      }
      if (!paiInRels && identityNow.pai) {
        parentNamesToResolve.push({ name: identityNow.pai, key: identityNow.pai.toLowerCase() });
      }

      // Resolve parent names → CPFs using the nome API
      const nameKeyMap: Record<string, string> = {}; // cpf/name-key → relPhotos key
      for (const { name, key } of parentNamesToResolve) {
        if (cancelled) return;
        try {
          const res = await fetchModule("nome", name, false, true);
          if (res.data) {
            const resolvedCpf = (gfExact(res.data.fields, "CPF") || gf(res.data.fields, "CPF", "NUMEROCPF"))
              ?.replace(/\D/g, "");
            if (resolvedCpf && resolvedCpf.length === 11) {
              cpfSet.add(resolvedCpf);
              nameKeyMap[resolvedCpf] = key; // after photo fetch, also store under name key
            } else {
              // Can't resolve CPF — mark name key as loading anyway so tree shows spinner
              nameKeyMap[key] = key;
            }
          }
        } catch { /* ignore */ }
      }

      if (!cpfSet.size) return;
      setRelPhotosLoading(new Set(cpfSet));

      await Promise.allSettled(
        [...cpfSet].map(async (relCpf) => {
          let ph: string | null = null;
          for (const tipo of ["fotonc", "foto", "biometria", "fotosp", "fotomg", "fotoba", "fotopr", "fotoce"]) {
            if (cancelled) break;
            const res = await fetchModule(tipo, relCpf, true, true);
            ph = res.data ? extractPhotoFromResult(res) : null;
            if (ph) break;
          }
          if (cancelled) return;
          setRelPhotosLoading(prev => { const n = new Set(prev); n.delete(relCpf); return n; });
          if (ph) {
            setRelPhotos(prev => {
              const next = { ...prev, [relCpf]: ph! };
              // Also store under the name key so FamilyTree can find it for CPF-less parents
              const nameKey = nameKeyMap[relCpf];
              if (nameKey) next[nameKey] = ph!;
              return next;
            });
          }
        })
      );
    })();

    return () => { cancelled = true; };
  }, [done]);

  // ── Foto cascade: try additional photo sources if main foto module returned nothing ─
  useEffect(() => {
    if (!done) return;
    const currentPhoto = extractPhoto(finalResultsRef.current);
    if (currentPhoto) return; // already have a photo
    const clean = cpf.replace(/\D/g, "");
    if (clean.length !== 11) return;
    let cancelled = false;
    (async () => {
      for (const tipo of ["foto", "biometria", "fotosp", "fotomg", "fotoba", "fotopr", "fotoce", "fotorn", "fotogo", "fotopb", "fotope", "fotoal", "fotodf", "fototo"]) {
        if (cancelled) break;
        const res = await fetchModule(tipo, clean, true, true);
        const ph = res.data ? extractPhotoFromResult(res) : null;
        if (ph) {
          // Inject the found photo into the fotonc module result so it shows in the panel
          setMResults(prev => ({
            ...prev,
            fotonc: { status: "done", data: { fields: [["FOTO_URL", ph]], sections: [], raw: "" } },
          }));
          break;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [done, cpf]);

  // ── Derived (memoized to prevent flickering on incremental module loads) ──
  const identity    = useMemo(() => buildIdentity(mResults),              [mResults]);
  const phones      = useMemo(() => buildPhones(mResults),                [mResults]);
  const addresses   = useMemo(() => buildAddresses(mResults),             [mResults]);
  const employments = useMemo(() => buildEmployments(mResults["empregos"]), [mResults]);
  const relatives   = useMemo(() => {
    const rels = buildRelatives([mResults["parentes"]]);
    // Never show the subject themselves as a relative node
    const subCpf  = cpf.replace(/\D/g, "");
    const subNome = (identity.nome || "").toUpperCase().trim();
    return rels.filter(r => {
      if (subCpf  && r.cpf  && r.cpf  === subCpf)  return false;
      if (subNome && r.nome && r.nome.toUpperCase().trim() === subNome) return false;
      return true;
    });
  }, [mResults, cpf, identity]);
  const photo       = useMemo(() => extractPhoto(mResults),               [mResults]);
  // Enrich identity with mae/pai names found in the relatives list when CPF modules lack them
  const identityFull = useMemo(() => {
    if (identity.mae && identity.pai) return identity;
    const id = { ...identity };
    for (const r of relatives) {
      const cat = categorizeRel(r);
      if (!id.mae && cat === "mae" && r.nome) id.mae = r.nome;
      if (!id.pai && cat === "pai" && r.nome) id.pai = r.nome;
      if (id.mae && id.pai) break;
    }
    return id;
  }, [identity, relatives]);

  const scoreFields1 = mResults["score"]?.data?.fields ?? [];
  const scoreFields2 = mResults["score2"]?.data?.fields ?? [];
  const score1    = gf(scoreFields1,"SCORE","PONTUACAO","PONTUAÇÃO","SERASA") || mResults["score"]?.data?.raw?.match(/\b(\d{3,4})\b/)?.[1] || "";
  const score2Val = gf(scoreFields2,"SCORE","PONTUACAO","PONTUAÇÃO","SERASA") || mResults["score2"]?.data?.raw?.match(/\b(\d{3,4})\b/)?.[1] || "";

  const geocoded  = geoAddr.filter(a => a.lat && a.lng);
  const doneCount = MODULES.filter(m => mStates[m.tipo] === "done").length;

  const hasIdentity  = !!(identity.nome || identity.rg);
  const hasCNH       = mResults["cnh"]?.status === "done" && (mResults["cnh"]?.data?.fields.length ?? 0) > 0;
  const hasObito     = mResults["obito"]?.status === "done" && ((mResults["obito"]?.data?.fields.length ?? 0) > 0 || /falecido|obito|óbito/i.test(mResults["obito"]?.data?.raw ?? ""));
  const hasLegal     = ["processos","mandado"].some(k => mResults[k]?.status === "done" && ((mResults[k]?.data?.sections?.length ?? 0) > 0 || (mResults[k]?.data?.fields.length ?? 0) > 0));
  const hasParentes  = relatives.length > 0 || !!(identityFull.mae) || !!(identityFull.pai);
  const extras       = (["irpf","beneficios","dividas","bens","titulo","spc"] as const).filter(k =>
    mResults[k]?.status === "done" && mResults[k]?.data &&
    ((mResults[k]!.data!.fields.length > 0) || (mResults[k]!.data!.sections.length > 0) || mResults[k]!.data!.raw.length > 20)
  );

  const extraLabels: Record<string, { label: string; icon: IconProp }> = {
    irpf:      { label: "IRPF / Imposto de Renda", icon: Receipt },
    beneficios:{ label: "Benefícios Sociais",       icon: Gift },
    dividas:   { label: "Dívidas",                  icon: Wallet },
    bens:      { label: "Bens Registrados",         icon: Building2 },
    titulo:    { label: "Título de Eleitor",         icon: Award },
    spc:       { label: "SPC / Negativação",         icon: AlertTriangle },
  };

  const noData = done && !hasIdentity && !phones.length && !addresses.length && !relatives.length;
  const geocodingInProgress = done && addresses.length > 0 && geoAddr.length === 0;

  return (
    <ViewModeCtx.Provider value={viewMode}>
      <div className="mt-6 space-y-6">

        {/* ── Progress tracker ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {(running || done) && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-2xl p-5" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] uppercase tracking-widest font-bold text-white/30">
                  {running ? "Consultando módulos em paralelo…" : `Concluído — ${doneCount}/${MODULES.length} módulos com dados`}
                </span>
                <div className="flex items-center gap-2">
                  {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                  {done && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setExportingPDF(true);
                          generateLaudoPDF({ cpf, identity, phones, addresses, employments, relatives, photo, relPhotos, score1, score2Val, mResults })
                            .finally(() => setExportingPDF(false));
                        }}
                        disabled={exportingPDF}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold transition-all disabled:opacity-50"
                        style={{ border: "1px solid rgba(56,189,248,0.3)", background: "rgba(56,189,248,0.08)", color: "rgba(56,189,248,0.9)" }}
                        title="Exportar Laudo Pericial em PDF">
                        {exportingPDF ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        {exportingPDF ? "Gerando…" : "Laudo PDF"}
                      </button>
                      <button
                        onClick={() => setShowGraph(v => !v)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold transition-all"
                        style={{
                          border: `1px solid ${showGraph ? "rgba(245,158,11,0.45)" : "rgba(255,255,255,0.1)"}`,
                          background: showGraph ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.06)",
                          color: showGraph ? "rgba(245,158,11,0.95)" : "rgba(255,255,255,0.55)",
                        }}
                        title={showGraph ? "Ocultar grafo" : "Visualizar grafo de conexões"}>
                        <Network className="w-3 h-3" />
                        {showGraph ? "Ocultar Grafo" : "Ver Grafo"}
                      </button>
                      <button onClick={() => setViewMode(v => v === "expanded" ? "compact" : "expanded")}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold transition-all"
                        style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)" }}
                        title={viewMode === "expanded" ? "Mudar para modo compacto" : "Mudar para modo expandido"}>
                        {viewMode === "expanded"
                          ? <><LayoutList className="w-3 h-3" /> Compacto</>
                          : <><StretchHorizontal className="w-3 h-3" /> Expandido</>}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="h-1.5 rounded-full mb-4 overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
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
                      <span className={s === "done" ? "text-white/65" : s === "error" ? "text-white/20" : "text-white/35"}>{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Results ────────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="space-y-4">

              {/* Grafo de Conexões */}
              {showGraph && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
                  <SectionHeader icon={Network} title="Grafo de Conexões" />
                  <ConnectionGraph
                    identity={identity}
                    phones={phones}
                    addresses={addresses}
                    employments={employments}
                    relatives={relatives}
                    mainPhoto={photo}
                    relPhotos={relPhotos}
                  />
                </motion.div>
              )}

              {/* Hero Photo — FIRST, full-width, prominent */}
              {photo && (
                <HeroPhotoBanner photo={photo} identity={identity} cpf={cpf} />
              )}

              {/* Carteira de Identidade */}
              {hasIdentity && (
                <motion.div
                  initial={{ opacity: 0, y: 22 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.42, delay: 0.06, ease: [0.23, 1, 0.32, 1] }}>
                  <SectionHeader icon={IdCard} title="Carteira de Identidade" />
                  <IdentityCard id={identityFull} photo={photo} />
                </motion.div>
              )}

              {/* Telefones */}
              {phones.length > 0 && (
                <CollapsibleSection icon={Phone} title="Telefones" count={phones.length} delay={0.10}>
                  <div className={viewMode === "compact" ? "divide-y divide-white/5" : "space-y-2"}>
                    {phones.map((p, i) => <PhoneCard key={i} phone={p} idx={i} />)}
                  </div>
                </CollapsibleSection>
              )}

              {/* Árvore Genealógica */}
              {hasParentes && (
                <CollapsibleSection icon={GitBranch} title="Árvore Genealógica" count={relatives.length > 0 ? relatives.length : undefined} delay={0.14}>
                  <FamilyTree relatives={relatives} photos={relPhotos} loadingPhotos={relPhotosLoading} identity={identityFull} mainPhoto={photo} />
                  {relatives.length === 0 && !identityFull.mae && !identityFull.pai && mResults["parentes"]?.data?.raw && (
                    <div className="mt-3 rounded-xl p-4" style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.2)" }}>
                      <pre className="text-xs text-white/40 whitespace-pre-wrap break-words font-mono max-h-64 overflow-y-auto">{mResults["parentes"].data.raw}</pre>
                    </div>
                  )}
                </CollapsibleSection>
              )}

              {/* Endereços + Mapa */}
              {addresses.length > 0 && (
                <CollapsibleSection icon={MapPin} title="Endereços" count={addresses.length} delay={0.18}>
                  {/* ── Map ─────────────────────────────────────────────────── */}
                  <div className="rounded-2xl overflow-hidden mb-5" style={{ border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 4px 32px rgba(0,0,0,0.45)" }}>
                    <div className="relative" style={{ height: 400 }}>
                      <MapContainer
                        center={[-14.235, -51.925]} zoom={4}
                        className="h-full w-full"
                        style={{ background: "#080a14", zIndex: 10 }}
                        zoomControl={false}
                      >
                        <TileLayer
                          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                        />
                        <MapBoundsAdjuster points={geocoded.map(a => [a.lat!, a.lng!] as [number,number])} />
                        {geocoded.map((addr, i) => {
                          const mc = markerColor(i);
                          const shortLabel = [addr.logradouro, addr.numero].filter(Boolean).join(", ")
                            || addr.cidade || `Endereço ${i + 1}`;
                          const city = [addr.cidade, addr.uf].filter(Boolean).join(" – ");
                          return (
                            <CircleMarker
                              key={i}
                              center={[addr.lat!, addr.lng!]}
                              radius={i === 0 ? 13 : 10}
                              pathOptions={{
                                fillColor: mc.fill,
                                color: mc.stroke,
                                weight: 2.5,
                                fillOpacity: 0.92,
                              }}
                            >
                              <Tooltip permanent direction="top" offset={[0, -(i === 0 ? 17 : 14)]}>
                                <div style={{
                                  background: "rgba(8,10,20,0.95)",
                                  border: `1px solid ${mc.stroke}55`,
                                  borderRadius: 8, padding: "3px 8px",
                                  color: "#fff", fontSize: 10, fontWeight: 700,
                                  whiteSpace: "nowrap", maxWidth: 240,
                                  boxShadow: `0 0 10px ${mc.glow}`,
                                }}>
                                  <span style={{ color: mc.stroke, marginRight: 5, fontWeight: 900 }}>
                                    {i + 1}
                                  </span>
                                  {shortLabel.length > 34 ? shortLabel.slice(0, 34) + "…" : shortLabel}
                                  {city && <span style={{ color: "rgba(255,255,255,0.42)", marginLeft: 4 }}>· {city}</span>}
                                </div>
                              </Tooltip>
                              <Popup>
                                <div style={{ minWidth: 200, fontFamily: "inherit" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                    <span style={{ background: mc.fill, color: "#fff", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{i + 1}</span>
                                    <strong style={{ fontSize: 12 }}>{shortLabel || `Endereço ${i + 1}`}</strong>
                                  </div>
                                  {addr.complemento && addr.complemento !== "Não Informado" && <p style={{ margin: "2px 0", fontSize: 11, color: "#555" }}>{addr.complemento}</p>}
                                  {addr.bairro && <p style={{ margin: "2px 0", fontSize: 11, color: "#444" }}>{addr.bairro}</p>}
                                  {city && <p style={{ margin: "2px 0", fontSize: 11, color: "#333" }}>{city}</p>}
                                  {addr.cep && <p style={{ margin: "2px 0", fontSize: 10, color: "#777" }}>CEP {addr.cep}</p>}
                                  <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([addr.logradouro, addr.numero, addr.cidade, addr.uf].filter(Boolean).join(", "))}`}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, color: mc.fill, fontWeight: 700, fontSize: 11, textDecoration: "none" }}
                                  >
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
                              : null
                          }
                        </div>
                      </div>

                      {/* Legend overlay bottom-right */}
                      {geocoded.length > 0 && (
                        <div className="absolute bottom-3 right-3 z-[1000] pointer-events-none max-w-[200px]">
                          <div className="rounded-xl px-3 py-2.5 flex flex-col gap-1.5"
                            style={{ background: "rgba(8,10,20,0.9)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)" }}>
                            {geocoded.slice(0, 6).map((addr, i) => {
                              const mc = markerColor(i);
                              return (
                                <div key={i} className="flex items-center gap-2 min-w-0">
                                  <span className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[8px] font-black"
                                    style={{ background: mc.fill, color: "#fff", boxShadow: `0 0 6px ${mc.glow}` }}>{i + 1}</span>
                                  <span className="text-[9px] text-white/60 truncate">
                                    {addr.cidade || addr.logradouro || `Endereço ${i + 1}`}{addr.uf ? `, ${addr.uf}` : ""}
                                  </span>
                                </div>
                              );
                            })}
                            {geocoded.length > 6 && (
                              <span className="text-[8px] text-white/25 text-center mt-0.5">+{geocoded.length - 6} mais</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* No coords yet placeholder */}
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

                  {/* ── Address list ──────────────────────────────────────────── */}
                  <div className={viewMode === "compact" ? "divide-y divide-white/5" : "space-y-2"}>
                    {addresses.map((a, i) => <AddressCard key={i} addr={a} idx={i} />)}
                  </div>
                </CollapsibleSection>
              )}

              {/* Histórico Profissional */}
              {employments.length > 0 && (
                <CollapsibleSection icon={Briefcase} title="Histórico Profissional" count={employments.length} delay={0.22}>
                  <EmploymentTimeline employments={employments} />
                </CollapsibleSection>
              )}

              {/* Score de Crédito */}
              {(score1 || score2Val) && (
                <CollapsibleSection icon={BarChart2} title="Score de Crédito" delay={0.26}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { label: "Score Serasa / Bureau 1", val: score1,    grad: "from-violet-600 to-indigo-600", bgGrad: "from-violet-500/10 to-indigo-500/5", bdr: "rgba(139,92,246,0.25)" },
                      { label: "Score Bureau 2",          val: score2Val, grad: "from-sky-600 to-indigo-500",    bgGrad: "from-sky-500/10 to-indigo-500/5",    bdr: "rgba(14,165,233,0.25)" },
                    ].filter(s => s.val).map(s => {
                      const pct   = Math.min(100, (parseInt(s.val) / 1000) * 100);
                      const color = pct > 70 ? "text-emerald-300" : pct > 40 ? "text-amber-300" : "text-red-300";
                      return (
                        <div key={s.label} className={`rounded-2xl p-5 flex items-center gap-5 bg-gradient-to-br ${s.bgGrad}`} style={{ border: `1px solid ${s.bdr}` }}>
                          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-lg font-black text-white shrink-0 bg-gradient-to-br ${s.grad} shadow-lg`}>{s.val}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-widest text-white/30 mb-1.5">{s.label}</p>
                            <div className="h-2 rounded-full overflow-hidden mb-1" style={{ background: "rgba(255,255,255,0.08)" }}>
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
                <CollapsibleSection icon={Car} title="CNH — Carteira Nacional de Habilitação" delay={0.28}>
                  <div className="rounded-2xl p-5 grid grid-cols-2 sm:grid-cols-3 gap-4" style={{ border: "1px solid rgba(249,115,22,0.2)", background: "rgba(249,115,22,0.05)" }}>
                    {(mResults["cnh"]?.data?.fields ?? []).map(([k, v], i) => (
                      <div key={i}><p className="text-[8.5px] uppercase tracking-[0.2em] text-white/25 mb-0.5">{k}</p><p className="text-[13px] font-semibold text-white">{v || "—"}</p></div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {/* Processos & Mandados */}
              {hasLegal && (
                <CollapsibleSection icon={Scale} title="Processos & Mandados" delay={0.30}>
                  <div className="space-y-3">
                    {["processos","mandado"].flatMap(tipo => {
                      const res = mResults[tipo];
                      if (!res?.data) return [];
                      const secs = res.data.sections.length > 0 ? res.data.sections
                        : (res.data.fields.length > 0 ? [{ name: tipo.toUpperCase(), items: res.data.fields.map(([k,v]) => `${k}: ${v}`) }] : []);
                      return secs.map((sec, si) => (
                        <div key={`${tipo}-${si}`} className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(244,63,94,0.2)", background: "rgba(244,63,94,0.04)" }}>
                          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: "rgba(0,0,0,0.2)", borderBottom: "1px solid rgba(244,63,94,0.1)" }}>
                            <Scale className="w-3.5 h-3.5 text-rose-400" />
                            <span className="text-[10px] uppercase tracking-widest text-rose-300 font-bold">{sec.name || tipo.toUpperCase()}</span>
                            <span className="text-[9px] text-rose-400/30 ml-1">({sec.items.length})</span>
                          </div>
                          <div className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: "rgba(244,63,94,0.07)" }}>
                            {sec.items.map((item, ii) => <div key={ii} className="px-4 py-2.5 text-sm text-white/60 leading-relaxed">{item}</div>)}
                          </div>
                        </div>
                      ));
                    })}
                  </div>
                </CollapsibleSection>
              )}

              {/* Dados Adicionais */}
              {extras.length > 0 && (
                <CollapsibleSection icon={FileText} title="Dados Adicionais" defaultOpen={false} delay={0.32}>
                  <div className="space-y-4">
                    {extras.map(key => {
                      const meta = extraLabels[key]; const res = mResults[key];
                      if (!meta || !res?.data) return null;
                      const { label, icon: Icon } = meta;
                      const { fields, sections, raw } = res.data;
                      return (
                        <div key={key} className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(9,9,15,0.6)" }}>
                          <div className="px-4 py-3 flex items-center gap-2" style={{ background: "rgba(0,0,0,0.2)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                            <Icon className="w-3.5 h-3.5" style={{ color:"var(--color-primary)" }} />
                            <span className="text-[11px] uppercase tracking-widest font-bold text-white">{label}</span>
                          </div>
                          <div className="p-4 space-y-3">
                            {fields.length > 0 && (
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {fields.map(([k, v], i) => <div key={i}><p className="text-[8.5px] uppercase tracking-[0.18em] text-white/25 mb-0.5">{k}</p><p className="text-sm font-semibold text-white">{v}</p></div>)}
                              </div>
                            )}
                            {sections.map((sec, si) => (
                              <div key={si}>
                                {sec.name && <p className="text-[9px] uppercase tracking-widest text-white/25 mb-1.5">{sec.name}</p>}
                                <div className="divide-y rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.04)" }}>
                                  {sec.items.map((item, ii) => <div key={ii} className="px-3 py-2 text-sm text-white/55">{item}</div>)}
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
                <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34 }}>
                  <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(239,68,68,0.3)", background: "rgba(127,29,29,0.1)" }}>
                    <div className="px-5 py-3 flex items-center gap-2" style={{ background: "rgba(127,29,29,0.2)", borderBottom: "1px solid rgba(239,68,68,0.15)" }}>
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <span className="text-[11px] uppercase tracking-widest font-bold text-red-300">Registro de Óbito</span>
                    </div>
                    <div className="p-5">
                      <p className="text-xs text-red-400/70 mb-3">Pessoa falecida conforme registros oficiais.</p>
                      {(mResults["obito"]?.data?.fields ?? []).length > 0
                        ? <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {(mResults["obito"]?.data?.fields ?? []).map(([k, v], i) => (
                              <div key={i}><p className="text-[9px] uppercase tracking-[0.2em] text-red-400/40 mb-0.5">{k}</p><p className="text-sm font-semibold text-red-200">{v}</p></div>
                            ))}
                          </div>
                        : <p className="text-sm text-red-300/60 font-mono">{mResults["obito"]?.data?.raw}</p>
                      }
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
    </ViewModeCtx.Provider>
  );
}
