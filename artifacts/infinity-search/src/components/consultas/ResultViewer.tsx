import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Copy,
  Check,
  Download,
  FileJson,
  Eye,
  EyeOff,
  Sparkles,
  FolderOpen,
  CheckCircle2,
  Star,
  FileText,
  Camera,
  IdCard,
  User,
  Phone,
  Mail,
  MapPin,
  Car,
  Building2,
  TrendingUp,
  Wallet,
  Scale,
  Calendar,
  CreditCard,
  Fingerprint,
  Heart,
  ShieldAlert,
  Hash,
  List,
  Briefcase,
  Database,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { addFavorito, isFavorito } from "@/pages/favoritos";

const STORAGE_KEY = "infinity_dossies";

type DossieStub = { id: string; title: string };

function loadDossieStubs(): DossieStub[] {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return arr.map((d: { id: string; title: string }) => ({ id: d.id, title: d.title }));
  } catch { return []; }
}

function saveToD(dossieId: string, item: object) {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    const idx = arr.findIndex((d: { id: string }) => d.id === dossieId);
    if (idx === -1) return false;
    arr[idx].items = [item, ...(arr[idx].items ?? [])];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    return true;
  } catch { return false; }
}

function SaveToDossieButton({ tipo, query, data }: { tipo: string; query: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const stubs = loadDossieStubs();

  if (stubs.length === 0) return (
    <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40">
      Crie um dossiê primeiro
    </span>
  );

  if (saved) return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-400">
      <CheckCircle2 className="w-3 h-3" /> Salvo
    </span>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-amber-300 transition-colors"
      >
        <FolderOpen className="w-3 h-3" /> Dossiê
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-50 min-w-[200px] rounded-xl border border-white/10 bg-[#06091a]/95 backdrop-blur-2xl shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-white/5">
            <p className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground">Selecionar dossiê</p>
          </div>
          {stubs.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                const parsed = (data as { fields?: unknown[]; sections?: unknown[]; raw?: string }) ?? {};
                const ok = saveToD(d.id, {
                  id: Math.random().toString(36).slice(2) + Date.now().toString(36),
                  tipo, query,
                  addedAt: new Date().toISOString(),
                  note: "",
                  fields: parsed.fields ?? [],
                  sections: parsed.sections ?? [],
                  raw: parsed.raw ?? "",
                });
                if (ok) { setSaved(true); setOpen(false); }
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-white/5 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
              <span className="truncate">{d.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FavoriteButton({ tipo, query, data }: { tipo: string; query: string; data: unknown }) {
  const [fav, setFav] = useState(() => isFavorito(tipo, query));
  const [added, setAdded] = useState(false);

  const toggle = () => {
    if (fav) return;
    const parsed = (data as { fields?: unknown[]; sections?: unknown[]; raw?: string }) ?? {};
    const ok = addFavorito({
      tipo, query,
      note: "",
      fields: (parsed.fields ?? []) as Array<{ key: string; value: string }>,
      sections: (parsed.sections ?? []) as Array<{ name: string; items: string[] }>,
      raw: parsed.raw ?? "",
    });
    if (ok) {
      setFav(true);
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={fav}
      title={fav ? "Já é favorito" : "Adicionar aos favoritos"}
      className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest transition-colors ${
        fav ? "text-amber-400 cursor-default" : "text-muted-foreground hover:text-amber-400"
      }`}
    >
      <Star className={`w-3 h-3 ${fav ? "fill-amber-400" : ""}`} />
      {added ? "Salvo" : fav ? "Favorito" : "Favoritar"}
    </button>
  );
}

type ParsedField = { key: string; value: string };
type ParsedSection = { name: string; items: string[] };
type Parsed = { fields: ParsedField[]; sections: ParsedSection[]; raw: string };

type Props = {
  tipo: string;
  query?: string;
  result: { success: boolean; error?: string | null; data?: Parsed | unknown };
};

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
    >
      {done ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {done ? "Copiado" : label}
    </button>
  );
}

function InlineCopy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1000);
        });
      }}
      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-white/10"
      title="Copiar"
    >
      {done
        ? <Check className="w-3 h-3 text-emerald-400" />
        : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

function isParsed(d: unknown): d is Parsed {
  return (
    typeof d === "object" && d !== null &&
    "fields" in d && Array.isArray((d as Parsed).fields) &&
    "sections" in d && Array.isArray((d as Parsed).sections)
  );
}

const KEY_FIXES: Record<string, string> = {
  "MARCA_MODEL0": "Marca / Modelo",
  "MARCA_MODELO": "Marca / Modelo",
  "PROPRIETARIO_NOME": "Proprietário",
  "PROPRIETARIO_CPF": "CPF do Proprietário",
  "ESTADO_ENDERECO": "Estado (Endereço)",
  "TIPO_VEICULO": "Tipo de Veículo",
  "ANO_MODELO": "Ano do Modelo",
  "ANO_FABRICACAO": "Ano de Fabricação",
  "HABILITADO_PARA_DIRIGIR": "Habilitado p/ Dirigir",
  "DATA_NASCIMENTO": "Data de Nascimento",
  "NOME_MAE": "Nome da Mãe",
  "NOME_PAI": "Nome do Pai",
  "RAZAO_SOCIAL": "Razão Social",
  "NOME_FANTASIA": "Nome Fantasia",
  "CAPITAL_SOCIAL": "Capital Social",
  "NATUREZA_JURIDICA": "Natureza Jurídica",
  "DATA_ABERTURA": "Data de Abertura",
  "DATA_SITUACAO": "Data da Situação",
  "ULTIMA_ATUALIZACAO": "Última Atualização",
};

function humanizeKey(key: string): string {
  if (KEY_FIXES[key]) return KEY_FIXES[key];
  return key.replace(/_/g, " ").trim();
}

function isUselessValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v || v === "none" || v === "null" || v === "undefined") return true;
  if (v === "sem informação" || v === "sem informacao" || v === "sem info") return true;
  if (v === "não informado" || v === "nao informado") return true;
  return false;
}

function isImportantField(key: string): boolean {
  const k = key.toUpperCase();
  const important = ["NOME", "CPF", "CNPJ", "RAZÃO SOCIAL", "RAZAO SOCIAL", "PLACA", "CHASSI", "TELEFONE", "EMAIL", "RG", "DATA NASCIMENTO", "NASCIMENTO", "NOME MÃE", "NOME PAI", "FOTO_URL"];
  return important.some((imp) => k.includes(imp));
}

// ─── Field icons ─────────────────────────────────────────────────────────────
function getFieldIcon(key: string): LucideIcon {
  const k = key.toUpperCase();
  if (k.includes("CPF") || k.includes(" RG") || k.includes("CNH") || k.includes("TÍTULO") || k.includes("TITULO")) return IdCard;
  if (k.includes("NOME") || k.includes("PROPRIETARIO") || k.includes("TITULAR")) return User;
  if (k.includes("MÃE") || k.includes("MAE") || k.includes("PAI") || k.includes("CÔNJUGE") || k.includes("CONJUGE") || k.includes("FILHO")) return Heart;
  if (k.includes("TELEFONE") || k.includes("CELULAR") || k.includes("DDD") || k.includes("FONE")) return Phone;
  if (k.includes("EMAIL") || k.includes("E-MAIL")) return Mail;
  if (k.includes("ENDEREÇO") || k.includes("ENDERECO") || k.includes("RUA") || k.includes("CEP") || k.includes("BAIRRO") || k.includes("CIDADE") || k.includes("MUNICÍPIO") || k.includes("MUNICIPIO") || k.includes("LOGRADOURO") || k.includes("COMPLEMENTO") || k.includes("UF") || k.includes("ESTADO")) return MapPin;
  if (k.includes("PLACA") || k.includes("CHASSI") || k.includes("RENAVAM") || k.includes("MOTOR") || k.includes("MARCA") || k.includes("MODELO") || k.includes("VEICULO") || k.includes("VEÍCULO") || k.includes("ANO_")) return Car;
  if (k.includes("CNPJ") || k.includes("EMPRESA") || k.includes("RAZÃO") || k.includes("RAZAO") || k.includes("FANTASIA") || k.includes("CAPITAL") || k.includes("NATUREZA") || k.includes("PORTE")) return Building2;
  if (k.includes("SCORE") || k.includes("CRÉDITO") || k.includes("CREDITO") || k.includes("RISCO") || k.includes("RATING")) return TrendingUp;
  if (k.includes("DÍVIDA") || k.includes("DIVIDA") || k.includes("DÉBITO") || k.includes("DEBITO") || k.includes("FGTS") || k.includes("BACEN") || k.includes("VALOR") || k.includes("RENDA") || k.includes("SALÁRIO") || k.includes("SALARIO") || k.includes("BENEFÍCIO") || k.includes("BENEFICIO")) return Wallet;
  if (k.includes("PROCESSO") || k.includes("MANDADO") || k.includes("OAB") || k.includes("ADVOGADO") || k.includes("JURÍDICO") || k.includes("JURIDICO") || k.includes("PENA") || k.includes("CRIME")) return Scale;
  if (k.includes("DATA") || k.includes("NASCIMENTO") || k.includes("EMISSÃO") || k.includes("EMISSAO") || k.includes("VALIDADE") || k.includes("PRAZO") || k.includes("ABERTURA") || k.includes("SITUACAO")) return Calendar;
  if (k.includes("NIS") || k.includes("PIS") || k.includes("CNS") || k.includes("SUS") || k.includes("CARTÃO") || k.includes("CARTAO")) return CreditCard;
  if (k.includes("BIOMETRIA") || k.includes("DIGITAL") || k.includes("FACE") || k.includes("IMPRESSÃO")) return Fingerprint;
  if (k.includes("SITUAÇÃO") || k.includes("SITUACAO") || k.includes("STATUS") || k.includes("ATIVO") || k.includes("OBITO") || k.includes("ÓBITO")) return ShieldAlert;
  if (k.includes("HABILITADO") || k.includes("CNH")) return Car;
  return Hash;
}

function getFieldAccent(key: string): string {
  const k = key.toUpperCase();
  if (k.includes("CPF") || k.includes("RG") || k.includes("CNH") || k.includes("TITULO")) return "text-sky-300";
  if (k.includes("NOME") || k.includes("PROPRIETARIO") || k.includes("TITULAR")) return "text-rose-300";
  if (k.includes("MÃE") || k.includes("MAE") || k.includes("PAI") || k.includes("FILHO")) return "text-pink-300";
  if (k.includes("TELEFONE") || k.includes("CELULAR")) return "text-emerald-300";
  if (k.includes("EMAIL")) return "text-teal-300";
  if (k.includes("ENDEREÇO") || k.includes("ENDERECO") || k.includes("CEP") || k.includes("CIDADE") || k.includes("RUA")) return "text-amber-300";
  if (k.includes("PLACA") || k.includes("CHASSI") || k.includes("VEICULO") || k.includes("VEÍCULO")) return "text-orange-300";
  if (k.includes("CNPJ") || k.includes("EMPRESA") || k.includes("RAZÃO") || k.includes("RAZAO")) return "text-violet-300";
  if (k.includes("SCORE") || k.includes("CRÉDITO") || k.includes("CREDITO")) return "text-lime-300";
  if (k.includes("DÍVIDA") || k.includes("DIVIDA") || k.includes("VALOR") || k.includes("RENDA")) return "text-yellow-300";
  if (k.includes("PROCESSO") || k.includes("MANDADO")) return "text-red-300";
  if (k.includes("DATA") || k.includes("NASCIMENTO")) return "text-cyan-300";
  return "text-primary";
}

// ─── Format field values ──────────────────────────────────────────────────────
function formatValue(key: string, value: string): string {
  const k = key.toUpperCase();
  const v = value.trim().replace(/\D/g, "");
  if ((k === "CPF" || k.endsWith(" CPF") || k.startsWith("CPF ")) && /^\d{11}$/.test(v)) {
    return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  }
  if ((k === "CNPJ" || k.includes("CNPJ")) && /^\d{14}$/.test(v)) {
    return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  }
  if ((k.includes("TELEFONE") || k.includes("CELULAR")) && /^\d{10,11}$/.test(v)) {
    if (v.length === 11) return `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
    return `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
  }
  if (k.includes("CEP") && /^\d{8}$/.test(v)) {
    return `${v.slice(0, 5)}-${v.slice(5)}`;
  }
  return value;
}

// ─── Section theming ──────────────────────────────────────────────────────────
type SectionTheme = {
  color: string;
  bg: string;
  border: string;
  ring: string;
  icon: LucideIcon;
};

function getSectionTheme(name: string): SectionTheme {
  const n = name.toUpperCase();
  if (n.includes("EMAIL") || n.includes("E-MAIL")) return { color: "text-sky-300", bg: "bg-sky-500/10", border: "border-sky-500/20", ring: "ring-sky-500/10", icon: Mail };
  if (n.includes("TELEFONE") || n.includes("CELULAR") || n.includes("CONTATO") || n.includes("FONE")) return { color: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/20", ring: "ring-emerald-500/10", icon: Phone };
  if (n.includes("ENDEREÇO") || n.includes("ENDERECO") || n.includes("CEP") || n.includes("LOGRADOURO") || n.includes("RESIDENCIA")) return { color: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/20", ring: "ring-amber-500/10", icon: MapPin };
  if (n.includes("VÍNCULO") || n.includes("VINCULO") || n.includes("EMPREGO") || n.includes("RAIS") || n.includes("TRABALHO") || n.includes("FUNC") || n.includes("EMPRESA")) return { color: "text-violet-300", bg: "bg-violet-500/10", border: "border-violet-500/20", ring: "ring-violet-500/10", icon: Briefcase };
  if (n.includes("PROCESSO") || n.includes("JUDICIAL") || n.includes("MANDADO") || n.includes("CRIME")) return { color: "text-rose-300", bg: "bg-rose-500/10", border: "border-rose-500/20", ring: "ring-rose-500/10", icon: Scale };
  if (n.includes("VEÍCULO") || n.includes("VEICULO") || n.includes("PLACA") || n.includes("FROTA") || n.includes("AUTO")) return { color: "text-orange-300", bg: "bg-orange-500/10", border: "border-orange-500/20", ring: "ring-orange-500/10", icon: Car };
  if (n.includes("SÓCIO") || n.includes("SOCIO") || n.includes("QSA") || n.includes("PARCEIRO") || n.includes("MEMBRO")) return { color: "text-fuchsia-300", bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/20", ring: "ring-fuchsia-500/10", icon: Building2 };
  if (n.includes("PARENTE") || n.includes("FAMILIAR") || n.includes("FILHO") || n.includes("CÔNJUGE") || n.includes("CONJUGE")) return { color: "text-pink-300", bg: "bg-pink-500/10", border: "border-pink-500/20", ring: "ring-pink-500/10", icon: Heart };
  return { color: "text-cyan-300", bg: "bg-cyan-500/10", border: "border-cyan-500/20", ring: "ring-cyan-500/10", icon: Database };
}

// ─── Headline card gradient ───────────────────────────────────────────────────
function headlineGradient(key: string): string {
  const k = key.toUpperCase();
  if (k.includes("CPF") || k.includes("RG")) return "from-sky-500/20 via-sky-400/10 to-transparent border-sky-400/30";
  if (k.includes("CNPJ") || k.includes("RAZÃO") || k.includes("RAZAO") || k.includes("EMPRESA")) return "from-violet-500/20 via-violet-400/10 to-transparent border-violet-400/30";
  if (k.includes("TELEFONE") || k.includes("CELULAR")) return "from-emerald-500/20 via-emerald-400/10 to-transparent border-emerald-400/30";
  if (k.includes("EMAIL")) return "from-teal-500/20 via-teal-400/10 to-transparent border-teal-400/30";
  if (k.includes("PLACA") || k.includes("CHASSI") || k.includes("VEICULO") || k.includes("VEÍCULO")) return "from-orange-500/20 via-orange-400/10 to-transparent border-orange-400/30";
  if (k.includes("NOME")) return "from-rose-500/20 via-rose-400/10 to-transparent border-rose-400/30";
  if (k.includes("NASCIMENTO") || k.includes("DATA")) return "from-cyan-500/20 via-cyan-400/10 to-transparent border-cyan-400/30";
  return "from-primary/20 via-primary/10 to-transparent border-primary/30";
}

// ─── Section item parser ──────────────────────────────────────────────────────
function parseSectionItem(item: string): Array<{ k: string; v: string }> | null {
  // Try "Key: Value · Key2: Value2" format
  const parts = item.split(/\s·\s/);
  const pairs: Array<{ k: string; v: string }> = [];
  for (const part of parts) {
    const colonIdx = part.indexOf(": ");
    if (colonIdx > 0 && colonIdx < 35) {
      pairs.push({ k: part.slice(0, colonIdx).trim(), v: part.slice(colonIdx + 2).trim() });
    } else {
      return null; // Not structured
    }
  }
  return pairs.length >= 2 ? pairs : null;
}

// ─── Collapsible Section ──────────────────────────────────────────────────────
const SECTION_COLLAPSE_THRESHOLD = 6;

function SectionCard({ sec, idx }: { sec: ParsedSection; idx: number }) {
  const theme = getSectionTheme(sec.name);
  const Icon = theme.icon;
  const [collapsed, setCollapsed] = useState(sec.items.length > SECTION_COLLAPSE_THRESHOLD);

  const visibleItems = collapsed ? sec.items.slice(0, 4) : sec.items;

  return (
    <motion.div
      key={`${sec.name}-${idx}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 + idx * 0.04 }}
      className={`rounded-2xl border ${theme.border} ${theme.bg} backdrop-blur-2xl overflow-hidden`}
    >
      {/* Section header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg ${theme.bg} border ${theme.border} flex items-center justify-center shrink-0`}>
            <Icon className={`w-4 h-4 ${theme.color}`} />
          </div>
          <div>
            <h3 className={`text-xs font-bold uppercase tracking-[0.25em] ${theme.color}`}>{sec.name}</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">{sec.items.length} {sec.items.length === 1 ? "registro" : "registros"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CopyButton text={sec.items.join("\n")} label="Copiar" />
          {sec.items.length > SECTION_COLLAPSE_THRESHOLD && (
            <button
              onClick={() => setCollapsed((v) => !v)}
              className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest ${theme.color} opacity-70 hover:opacity-100 transition-opacity`}
            >
              {collapsed ? <><ChevronDown className="w-3 h-3" /> Ver todos</> : <><ChevronUp className="w-3 h-3" /> Recolher</>}
            </button>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="px-5 pb-5 space-y-2">
        <AnimatePresence initial={false}>
          {visibleItems.map((item, i) => {
            const structured = parseSectionItem(item);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ delay: Math.min(i * 0.015, 0.3) }}
                className="group relative"
              >
                {structured ? (
                  <div className="rounded-xl bg-black/30 border border-white/5 hover:border-white/10 transition-colors p-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                      {structured.map(({ k, v }, pi) => (
                        <div key={pi} className="min-w-0">
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{k}</p>
                          <p className="text-xs font-medium break-words">{v}</p>
                        </div>
                      ))}
                    </div>
                    <InlineCopy text={item} />
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-xl bg-black/30 border border-white/5 hover:border-white/10 hover:bg-black/50 transition-all p-3">
                    <div className={`w-5 h-5 rounded-md ${theme.bg} border ${theme.border} flex items-center justify-center text-[9px] font-bold ${theme.color} shrink-0 mt-px`}>
                      {i + 1}
                    </div>
                    <p className="text-xs font-mono flex-1 break-words leading-relaxed">{item}</p>
                    <InlineCopy text={item} />
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Expand/collapse summary */}
        {collapsed && sec.items.length > SECTION_COLLAPSE_THRESHOLD && (
          <button
            onClick={() => setCollapsed(false)}
            className={`w-full text-center py-2 text-[10px] uppercase tracking-widest ${theme.color} opacity-60 hover:opacity-100 transition-opacity`}
          >
            + {sec.items.length - 4} registros ocultos · Clique para expandir
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function ResultViewer({ tipo, query = "", result }: Props) {
  const [showRaw, setShowRaw] = useState(false);

  const parsed: Parsed = useMemo(() => {
    if (isParsed(result.data)) {
      const d = result.data as Parsed;
      const cleanFields = d.fields
        .filter((f) => f.key !== "FOTO_URL" && !isUselessValue(f.value))
        .map((f) => ({ key: humanizeKey(f.key), value: f.value }));
      const fotoField = d.fields.find((f) => f.key === "FOTO_URL");
      return {
        fields: fotoField ? [fotoField, ...cleanFields] : cleanFields,
        sections: d.sections,
        raw: d.raw,
      };
    }
    return { fields: [], sections: [], raw: typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? {}) };
  }, [result.data]);

  const photoUrl = parsed.fields.find((f) => f.key === "FOTO_URL")?.value;
  const displayFields = parsed.fields.filter((f) => f.key !== "FOTO_URL");
  const headlineFields = displayFields.filter((f) => isImportantField(f.key)).slice(0, 4);
  const otherFields = displayFields.filter((f) => !headlineFields.includes(f));

  const exportText = useMemo(() => {
    const lines = [
      `═══ INFINITY SEARCH ═══`,
      `Tipo: ${tipo.toUpperCase()}`,
      `Data: ${new Date().toLocaleString("pt-BR")}`,
      ``,
    ];
    parsed.fields.forEach((f) => {
      if (f.key === "FOTO_URL" && f.value.startsWith("data:image")) {
        lines.push(`${f.key}: [imagem base64 — use a opção Baixar Foto]`);
      } else {
        lines.push(`${f.key}: ${f.value}`);
      }
    });
    parsed.sections.forEach((s) => {
      lines.push("");
      lines.push(`━ ${s.name} (${s.items.length}) ━`);
      s.items.forEach((it) => lines.push(`  • ${it}`));
    });
    lines.push("");
    lines.push("Made by blxckxyz · Infinity Search");
    return lines.join("\n");
  }, [parsed, tipo]);

  const downloadTxt = () => {
    const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `infinity-${tipo}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = () => {
    const date = new Date().toLocaleString("pt-BR");
    const fotoForPdf = parsed.fields.find((f) => f.key === "FOTO_URL");
    const fieldsHtml = parsed.fields
      .filter((f) => f.key !== "FOTO_URL")
      .map(f => `
      <tr>
        <td class="key">${f.key}</td>
        <td class="val">${f.value || "—"}</td>
      </tr>`).join("");

    const sectionsHtml = parsed.sections.map(s => `
      <div class="section">
        <div class="sec-title">${s.name} <span class="badge">${s.items.length}</span></div>
        <ul>${s.items.map(it => `<li>${it}</li>`).join("")}</ul>
      </div>`).join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Infinity Search · ${tipo.toUpperCase()} · ${query}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111;padding:28px 36px;font-size:13px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #0891b2;padding-bottom:14px;margin-bottom:20px}
    .logo{font-size:22px;font-weight:900;letter-spacing:4px;text-transform:uppercase;color:#0891b2}
    .meta{text-align:right;color:#555;font-size:11px;line-height:1.7}
    .meta strong{color:#111}
    table{width:100%;border-collapse:collapse;margin-bottom:20px}
    tr:nth-child(even){background:#f4fbfd}
    td{padding:7px 10px;border-bottom:1px solid #e0f2f8;vertical-align:top}
    td.key{font-weight:700;color:#0e7490;text-transform:uppercase;font-size:11px;letter-spacing:1px;width:36%;white-space:nowrap}
    td.val{color:#111;font-size:13px;word-break:break-all}
    .section{margin-bottom:18px}
    .sec-title{font-weight:800;text-transform:uppercase;letter-spacing:2px;font-size:11px;color:#0891b2;margin-bottom:8px;display:flex;align-items:center;gap:8px}
    .badge{background:#0891b2;color:#fff;border-radius:9px;padding:1px 7px;font-size:10px}
    ul{list-style:none;padding:0}
    li{padding:5px 10px;background:#f4fbfd;border-left:3px solid #0891b2;margin-bottom:4px;font-size:12px;font-family:monospace;word-break:break-all}
    .footer{margin-top:24px;border-top:1px solid #e0f2f8;padding-top:10px;text-align:center;color:#aaa;font-size:10px;letter-spacing:2px;text-transform:uppercase}
    @media print{body{padding:10px 16px}button{display:none}}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">∞ Infinity Search</div>
      <div style="margin-top:4px;font-size:11px;color:#555">Relatório OSINT gerado automaticamente</div>
    </div>
    <div class="meta">
      <div><strong>Tipo:</strong> ${tipo.toUpperCase()}</div>
      <div><strong>Consulta:</strong> ${query}</div>
      <div><strong>Data:</strong> ${date}</div>
      <div><strong>Campos:</strong> ${parsed.fields.length} &nbsp;·&nbsp; <strong>Listas:</strong> ${parsed.sections.length}</div>
    </div>
  </div>
  ${fotoForPdf ? `
  <div style="margin-bottom:20px;display:flex;align-items:center;gap:16px;padding:12px;border:1px solid #e0f2f8;border-radius:8px;background:#f4fbfd;">
    <img src="${fotoForPdf.value}" alt="Foto Biométrica" style="width:96px;height:120px;object-fit:cover;border-radius:6px;border:2px solid #0891b2;" onerror="this.style.display='none'" />
    <div>
      <div style="font-weight:700;color:#0e7490;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Foto Biométrica</div>
      <div style="color:#555;font-size:11px;">Encontrada na base de dados</div>
    </div>
  </div>` : ""}
  ${parsed.fields.length > 0 ? `<table>${fieldsHtml}</table>` : ""}
  ${sectionsHtml}
  <div class="footer">Made by blxckxyz · Infinity Search · ${date}</div>
  <script>setTimeout(()=>window.print(),300)</script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=900,height=700");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  if (!result.success && parsed.fields.length === 0 && parsed.sections.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/5 backdrop-blur-xl p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold uppercase tracking-widest text-amber-200">Sem resultado</div>
            <p className="text-xs text-amber-100/80 mt-1">{result.error ?? "O provedor não retornou dados para esta consulta."}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 space-y-4"
    >
      {/* ── Action toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-1">
        {/* Status badge */}
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className={`w-2 h-2 rounded-full ${result.success ? "bg-emerald-400" : "bg-amber-400"}`} />
            <div className={`absolute inset-0 w-2 h-2 rounded-full ${result.success ? "bg-emerald-400" : "bg-amber-400"} animate-ping opacity-60`} />
          </div>
          <span className={`text-[10px] uppercase tracking-[0.35em] font-semibold ${result.success ? "text-emerald-300" : "text-amber-300"}`}>
            {result.success ? "Encontrado" : "Sem dados"}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            · {parsed.fields.filter(f => f.key !== "FOTO_URL").length} campos · {parsed.sections.length} listas
          </span>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <FavoriteButton tipo={tipo} query={query} data={result.data} />
          <SaveToDossieButton tipo={tipo} query={query} data={result.data} />
          <div className="w-px h-3 bg-white/10" />
          <button onClick={downloadTxt} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
            <Download className="w-3 h-3" /> TXT
          </button>
          <button onClick={downloadPdf} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-rose-400 transition-colors">
            <FileText className="w-3 h-3" /> PDF
          </button>
          <CopyButton text={exportText} label="Copiar" />
          <div className="w-px h-3 bg-white/10" />
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {showRaw ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showRaw ? "Ocultar" : "Bruto"}
          </button>
        </div>
      </div>

      {/* ── Photo card ─────────────────────────────────────────────────────── */}
      {photoUrl && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className="rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/10 via-sky-500/5 to-transparent backdrop-blur-xl overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 p-5 sm:p-6">
            {/* Photo */}
            <div className="relative shrink-0">
              <div className="absolute -inset-3 rounded-2xl bg-cyan-400/15 blur-2xl" />
              <div className="relative w-28 h-36 sm:w-32 sm:h-40 rounded-xl overflow-hidden border-2 border-cyan-400/40 shadow-[0_0_40px_rgba(34,211,238,0.25)]">
                <img
                  src={photoUrl}
                  alt="Foto Biométrica"
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = "none"; }}
                />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-cyan-400/20 border border-cyan-400/40 flex items-center justify-center">
                <Camera className="w-3 h-3 text-cyan-300" />
              </div>
            </div>
            {/* Info */}
            <div className="flex flex-col gap-3 text-center sm:text-left">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-400/10 border border-cyan-400/20 mb-2">
                  <Fingerprint className="w-3 h-3 text-cyan-400" />
                  <span className="text-[9px] uppercase tracking-widest font-bold text-cyan-300">Foto Biométrica</span>
                </div>
                <p className="text-sm text-muted-foreground">Imagem biométrica encontrada na base de dados.</p>
              </div>
              <div className="flex items-center gap-3 justify-center sm:justify-start flex-wrap">
                {photoUrl.startsWith("data:image") ? (
                  <a
                    href={photoUrl}
                    download={`foto-biometrica-${tipo}-${Date.now()}.jpg`}
                    className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-cyan-400/70 hover:text-cyan-300 transition-colors border border-cyan-400/20 rounded-lg px-3 py-1.5 hover:border-cyan-400/40 hover:bg-cyan-400/5"
                  >
                    <Download className="w-3 h-3" /> Baixar Foto
                  </a>
                ) : (
                  <>
                    <CopyButton text={photoUrl} label="Copiar URL" />
                    <a
                      href={photoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-cyan-300 transition-colors border border-white/10 rounded-lg px-3 py-1.5 hover:border-cyan-400/30 hover:bg-cyan-400/5"
                    >
                      <ExternalLink className="w-3 h-3" /> Abrir Original
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Headline cards (top 4 important fields) ────────────────────────── */}
      {headlineFields.length > 0 && (
        <div className={`grid gap-3 ${headlineFields.length === 1 ? "grid-cols-1" : headlineFields.length === 2 ? "grid-cols-2" : headlineFields.length === 3 ? "grid-cols-3" : "grid-cols-2 lg:grid-cols-4"}`}>
          {headlineFields.map((f, i) => {
            const Icon = getFieldIcon(f.key);
            const accent = getFieldAccent(f.key);
            const grad = headlineGradient(f.key);
            const displayVal = formatValue(f.key, f.value);
            return (
              <motion.div
                key={`${f.key}-${i}`}
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: i * 0.06, type: "spring", stiffness: 300, damping: 22 }}
                whileHover={{ y: -3, transition: { duration: 0.15 } }}
                className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br ${grad} backdrop-blur-xl p-4 cursor-default`}
                onClick={() => navigator.clipboard.writeText(f.value)}
                title="Clique para copiar"
              >
                <div className="absolute inset-0 bg-black/20" />
                <div className="relative flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className={`w-7 h-7 rounded-lg bg-black/30 border border-white/10 flex items-center justify-center`}>
                      <Icon className={`w-3.5 h-3.5 ${accent}`} />
                    </div>
                    <Sparkles className={`w-3 h-3 ${accent} opacity-40 group-hover:opacity-80 transition-opacity`} />
                  </div>
                  <div>
                    <p className={`text-[9px] uppercase tracking-[0.3em] font-semibold ${accent} opacity-80 mb-1`}>{f.key}</p>
                    <p className="text-sm sm:text-base font-bold break-words leading-tight tracking-tight">{displayVal || "—"}</p>
                  </div>
                </div>
                {/* Copy hint on hover */}
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-60 transition-opacity">
                  <Copy className="w-2.5 h-2.5 text-muted-foreground" />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Detail fields ───────────────────────────────────────────────────── */}
      {otherFields.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-white/5 flex items-center gap-2">
            <List className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">Detalhes</h3>
            <span className="text-[9px] text-muted-foreground/40 ml-1">· {otherFields.length} campos</span>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {otherFields.map((f, i) => {
              const Icon = getFieldIcon(f.key);
              const accent = getFieldAccent(f.key);
              const displayVal = formatValue(f.key, f.value);
              return (
                <motion.div
                  key={`${f.key}-${i}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(0.14 + i * 0.018, 0.5) }}
                  className="group flex items-center gap-3.5 px-5 py-3 hover:bg-white/[0.03] transition-colors"
                >
                  {/* Icon */}
                  <div className={`w-7 h-7 rounded-lg bg-black/40 border border-white/5 flex items-center justify-center shrink-0`}>
                    <Icon className={`w-3.5 h-3.5 ${accent} opacity-70`} />
                  </div>
                  {/* Label + Value */}
                  <div className="flex-1 min-w-0 grid grid-cols-[auto_1fr] gap-x-4 items-center sm:flex sm:flex-row sm:justify-between sm:gap-4">
                    <p className={`text-[9px] uppercase tracking-[0.22em] font-medium ${accent} opacity-70 whitespace-nowrap shrink-0`}>{f.key}</p>
                    <p className="text-sm font-medium break-words text-right sm:text-left truncate" title={displayVal}>{displayVal || "—"}</p>
                  </div>
                  {/* Copy */}
                  <InlineCopy text={f.value} />
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Sections ───────────────────────────────────────────────────────── */}
      {parsed.sections.map((sec, idx) => (
        <SectionCard key={`${sec.name}-${idx}`} sec={sec} idx={idx} />
      ))}

      {/* ── Raw response (toggle) ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showRaw && parsed.raw && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-2xl border border-white/8 bg-black/50 backdrop-blur-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <FileJson className="w-3.5 h-3.5 text-muted-foreground/60" />
                <h3 className="text-[9px] uppercase tracking-[0.45em] text-muted-foreground/60">Resposta bruta do provedor</h3>
              </div>
              <CopyButton text={parsed.raw} />
            </div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-muted-foreground/70 max-h-80 overflow-y-auto p-5 leading-relaxed">
              {parsed.raw}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-2 pt-1">
        <Zap className="w-2.5 h-2.5 text-primary/30" />
        <span className="text-[9px] uppercase tracking-[0.6em] text-muted-foreground/40">
          Made by blxckxyz · Infinity Search
        </span>
        <Zap className="w-2.5 h-2.5 text-primary/30" />
      </div>
    </motion.div>
  );
}
