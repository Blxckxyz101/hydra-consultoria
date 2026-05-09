import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, Copy, Check, Download, FileJson, Eye, EyeOff,
  Sparkles, FolderOpen, CheckCircle2, Star, FileText, Camera,
  IdCard, User, Phone, Mail, MapPin, Car, Building2, TrendingUp,
  Wallet, Scale, Calendar, CreditCard, Fingerprint, Heart,
  ShieldAlert, Hash, List, Briefcase, Database, ChevronDown,
  ChevronUp, ExternalLink, Zap, type LucideIcon, Info, LayoutGrid, Rows3,
  Search, X,
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
    <span className="text-[10px] uppercase tracking-widest text-muted-foreground/30">Crie um dossiê</span>
  );
  if (saved) return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-400">
      <CheckCircle2 className="w-3 h-3" /> Salvo
    </span>
  );
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
        <FolderOpen className="w-3 h-3" /> Dossiê
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-50 min-w-[200px] rounded-xl border border-white/10 bg-[#06091a]/96 backdrop-blur-2xl shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-white/5">
            <p className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground">Selecionar dossiê</p>
          </div>
          {stubs.map(d => (
            <button key={d.id} onClick={() => {
              const parsed = (data as { fields?: unknown[]; sections?: unknown[]; raw?: string }) ?? {};
              const ok = saveToD(d.id, {
                id: Math.random().toString(36).slice(2) + Date.now().toString(36),
                tipo, query, addedAt: new Date().toISOString(), note: "",
                fields: parsed.fields ?? [], sections: parsed.sections ?? [], raw: parsed.raw ?? "",
              });
              if (ok) { setSaved(true); setOpen(false); }
            }} className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-white/5 transition-colors">
              <FolderOpen className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
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
      tipo, query, note: "",
      fields: (parsed.fields ?? []) as Array<{ key: string; value: string }>,
      sections: (parsed.sections ?? []) as Array<{ name: string; items: string[] }>,
      raw: parsed.raw ?? "",
    });
    if (ok) { setFav(true); setAdded(true); setTimeout(() => setAdded(false), 1500); }
  };
  return (
    <button onClick={toggle} disabled={fav}
      className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest transition-colors ${fav ? "text-amber-400 cursor-default" : "text-muted-foreground hover:text-amber-400"}`}>
      <Star className={`w-3 h-3 ${fav ? "fill-amber-400" : ""}`} />
      {added ? "Salvo" : fav ? "Favorito" : "Favoritar"}
    </button>
  );
}

type ParsedField   = { key: string; value: string };
type ParsedSection = { name: string; items: string[] };
type Parsed        = { fields: ParsedField[]; sections: ParsedSection[]; raw: string };
type Props         = { tipo: string; query?: string; result: { success: boolean; error?: string | null; data?: Parsed | unknown } };

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard.writeText(text).then(() => { setDone(true); toast.success("Copiado!"); setTimeout(() => setDone(false), 1200); }); }}
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
      {done ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {done ? "Copiado" : label}
    </button>
  );
}

function InlineCopy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setDone(true); toast.success("Copiado!"); setTimeout(() => setDone(false), 1000); }); }}
      className="shrink-0 opacity-20 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-white/10" title="Copiar">
      {done ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

function isParsed(d: unknown): d is Parsed {
  return typeof d === "object" && d !== null && "fields" in d && Array.isArray((d as Parsed).fields) && "sections" in d && Array.isArray((d as Parsed).sections);
}

const KEY_FIXES: Record<string, string> = {
  "MARCA_MODEL0": "Marca / Modelo", "MARCA_MODELO": "Marca / Modelo",
  "PROPRIETARIO_NOME": "Proprietário", "PROPRIETARIO_CPF": "CPF do Proprietário",
  "ESTADO_ENDERECO": "Estado (Endereço)", "TIPO_VEICULO": "Tipo de Veículo",
  "ANO_MODELO": "Ano do Modelo", "ANO_FABRICACAO": "Ano de Fabricação",
  "HABILITADO_PARA_DIRIGIR": "Habilitado p/ Dirigir", "DATA_NASCIMENTO": "Data de Nascimento",
  "NOME_MAE": "Nome da Mãe", "NOME_PAI": "Nome do Pai",
  "RAZAO_SOCIAL": "Razão Social", "NOME_FANTASIA": "Nome Fantasia",
  "CAPITAL_SOCIAL": "Capital Social", "NATUREZA_JURIDICA": "Natureza Jurídica",
  "DATA_ABERTURA": "Data de Abertura", "DATA_SITUACAO": "Data da Situação",
  "ULTIMA_ATUALIZACAO": "Última Atualização",
};

function humanizeKey(key: string): string {
  return KEY_FIXES[key] ?? key.replace(/_/g, " ").trim();
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
  return [
    "NOME", "CPF", "CNPJ", "RAZÃO SOCIAL", "RAZAO SOCIAL",
    "PLACA", "CHASSI", "TELEFONE", "EMAIL", "RG",
    "DATA NASCIMENTO", "NASCIMENTO", "NASC",
    "NOME MÃE", "NOME MAE", "NOME DA MAE", "NOME DA MÃE",
    "NOME PAI", "NOME DO PAI",
    "SEXO", "GENERO", "GÊNERO",
    "SITUAÇÃO", "SITUACAO",
    "FOTO_URL",
  ].some(imp => k.includes(imp));
}

function getFieldIcon(key: string): LucideIcon {
  const k = key.toUpperCase();
  if (k.includes("CPF") || k.includes(" RG") || k.includes("CNH") || k.includes("TÍTULO") || k.includes("TITULO")) return IdCard;
  if (k.includes("NOME") || k.includes("PROPRIETARIO") || k.includes("TITULAR")) return User;
  if (k.includes("MÃE") || k.includes("MAE") || k.includes("PAI") || k.includes("CÔNJUGE") || k.includes("CONJUGE") || k.includes("FILHO")) return Heart;
  if (k.includes("TELEFONE") || k.includes("CELULAR") || k.includes("DDD") || k.includes("FONE")) return Phone;
  if (k.includes("EMAIL") || k.includes("E-MAIL")) return Mail;
  if (k.includes("ENDEREÇO") || k.includes("ENDERECO") || k.includes("RUA") || k.includes("CEP") || k.includes("BAIRRO") || k.includes("CIDADE") || k.includes("MUNICÍPIO") || k.includes("LOGRADOURO") || k.includes("UF") || k.includes("ESTADO")) return MapPin;
  if (k.includes("PLACA") || k.includes("CHASSI") || k.includes("RENAVAM") || k.includes("MOTOR") || k.includes("MARCA") || k.includes("MODELO") || k.includes("VEICULO") || k.includes("VEÍCULO") || k.includes("ANO_")) return Car;
  if (k.includes("CNPJ") || k.includes("EMPRESA") || k.includes("RAZÃO") || k.includes("RAZAO") || k.includes("FANTASIA") || k.includes("CAPITAL") || k.includes("NATUREZA") || k.includes("PORTE")) return Building2;
  if (k.includes("SCORE") || k.includes("CRÉDITO") || k.includes("CREDITO") || k.includes("RISCO") || k.includes("RATING")) return TrendingUp;
  if (k.includes("DÍVIDA") || k.includes("DIVIDA") || k.includes("DÉBITO") || k.includes("DEBITO") || k.includes("FGTS") || k.includes("VALOR") || k.includes("RENDA") || k.includes("SALÁRIO") || k.includes("BENEFÍCIO")) return Wallet;
  if (k.includes("PROCESSO") || k.includes("MANDADO") || k.includes("OAB") || k.includes("ADVOGADO") || k.includes("JURÍDICO") || k.includes("PENA") || k.includes("CRIME")) return Scale;
  if (k.includes("DATA") || k.includes("NASCIMENTO") || k.includes("EMISSÃO") || k.includes("VALIDADE") || k.includes("ABERTURA") || k.includes("SITUACAO")) return Calendar;
  if (k.includes("NIS") || k.includes("PIS") || k.includes("CNS") || k.includes("SUS") || k.includes("CARTÃO") || k.includes("CARTAO")) return CreditCard;
  if (k.includes("BIOMETRIA") || k.includes("DIGITAL") || k.includes("FACE") || k.includes("IMPRESSÃO")) return Fingerprint;
  if (k.includes("SITUAÇÃO") || k.includes("SITUACAO") || k.includes("STATUS") || k.includes("ATIVO") || k.includes("OBITO") || k.includes("ÓBITO")) return ShieldAlert;
  return Hash;
}

// Semantic field accent — helps users identify field types at a glance
function getFieldAccent(key: string) {
  const k = key.toUpperCase();
  if (k.includes("CPF") || k.includes("RG") || k.includes("CNH")) return { text: "text-sky-300", bg: "color-mix(in srgb, #38bdf8 12%, transparent)", border: "color-mix(in srgb, #38bdf8 25%, transparent)" };
  if (k.includes("NOME") || k.includes("PROPRIETARIO") || k.includes("TITULAR")) return { text: "text-rose-300", bg: "color-mix(in srgb, #fb7185 12%, transparent)", border: "color-mix(in srgb, #fb7185 25%, transparent)" };
  if (k.includes("MÃE") || k.includes("MAE") || k.includes("PAI") || k.includes("FILHO")) return { text: "text-pink-300", bg: "color-mix(in srgb, #f472b6 12%, transparent)", border: "color-mix(in srgb, #f472b6 25%, transparent)" };
  if (k.includes("TELEFONE") || k.includes("CELULAR")) return { text: "text-emerald-300", bg: "color-mix(in srgb, #34d399 12%, transparent)", border: "color-mix(in srgb, #34d399 25%, transparent)" };
  if (k.includes("EMAIL")) return { text: "text-teal-300", bg: "color-mix(in srgb, #2dd4bf 12%, transparent)", border: "color-mix(in srgb, #2dd4bf 25%, transparent)" };
  if (k.includes("ENDEREÇO") || k.includes("ENDERECO") || k.includes("CEP") || k.includes("CIDADE") || k.includes("RUA")) return { text: "text-amber-300", bg: "color-mix(in srgb, #fbbf24 12%, transparent)", border: "color-mix(in srgb, #fbbf24 25%, transparent)" };
  if (k.includes("PLACA") || k.includes("CHASSI") || k.includes("VEICULO") || k.includes("VEÍCULO")) return { text: "text-orange-300", bg: "color-mix(in srgb, #fb923c 12%, transparent)", border: "color-mix(in srgb, #fb923c 25%, transparent)" };
  if (k.includes("CNPJ") || k.includes("EMPRESA") || k.includes("RAZÃO") || k.includes("RAZAO")) return { text: "text-violet-300", bg: "color-mix(in srgb, #a78bfa 12%, transparent)", border: "color-mix(in srgb, #a78bfa 25%, transparent)" };
  if (k.includes("SCORE") || k.includes("CRÉDITO") || k.includes("CREDITO")) return { text: "text-lime-300", bg: "color-mix(in srgb, #a3e635 12%, transparent)", border: "color-mix(in srgb, #a3e635 25%, transparent)" };
  if (k.includes("PROCESSO") || k.includes("MANDADO")) return { text: "text-red-300", bg: "color-mix(in srgb, #f87171 12%, transparent)", border: "color-mix(in srgb, #f87171 25%, transparent)" };
  if (k.includes("DATA") || k.includes("NASCIMENTO")) return { text: "text-cyan-300", bg: "color-mix(in srgb, #67e8f9 12%, transparent)", border: "color-mix(in srgb, #67e8f9 25%, transparent)" };
  return { text: "text-primary", bg: "color-mix(in srgb, var(--color-primary) 12%, transparent)", border: "color-mix(in srgb, var(--color-primary) 25%, transparent)" };
}

function formatValue(key: string, value: string): string {
  const k = key.toUpperCase();
  const v = value.trim().replace(/\D/g, "");
  if ((k === "CPF" || k.endsWith(" CPF") || k.startsWith("CPF ")) && /^\d{11}$/.test(v))
    return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  if ((k === "CNPJ" || k.includes("CNPJ")) && /^\d{14}$/.test(v))
    return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  if ((k.includes("TELEFONE") || k.includes("CELULAR")) && /^\d{10,11}$/.test(v))
    return v.length === 11 ? `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}` : `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
  if (k.includes("CEP") && /^\d{8}$/.test(v)) return `${v.slice(0, 5)}-${v.slice(5)}`;
  return value;
}

type SectionTheme = { color: string; bgClass: string; borderClass: string; icon: LucideIcon; bgStyle: string; borderStyle: string };

function getSectionTheme(name: string): SectionTheme {
  const n = name.toUpperCase();
  if (n.includes("EMAIL") || n.includes("E-MAIL")) return { color: "text-sky-300", bgClass: "bg-sky-500/10", borderClass: "border-sky-500/20", bgStyle: "color-mix(in srgb, #38bdf8 10%, transparent)", borderStyle: "color-mix(in srgb, #38bdf8 25%, transparent)", icon: Mail };
  if (n.includes("TELEFONE") || n.includes("CELULAR") || n.includes("CONTATO") || n.includes("FONE")) return { color: "text-emerald-300", bgClass: "bg-emerald-500/10", borderClass: "border-emerald-500/20", bgStyle: "color-mix(in srgb, #34d399 10%, transparent)", borderStyle: "color-mix(in srgb, #34d399 25%, transparent)", icon: Phone };
  if (n.includes("ENDEREÇO") || n.includes("ENDERECO") || n.includes("CEP") || n.includes("LOGRADOURO") || n.includes("RESIDENCIA")) return { color: "text-amber-300", bgClass: "bg-amber-500/10", borderClass: "border-amber-500/20", bgStyle: "color-mix(in srgb, #fbbf24 10%, transparent)", borderStyle: "color-mix(in srgb, #fbbf24 25%, transparent)", icon: MapPin };
  if (n.includes("VÍNCULO") || n.includes("VINCULO") || n.includes("EMPREGO") || n.includes("RAIS") || n.includes("TRABALHO") || n.includes("FUNC") || n.includes("EMPRESA")) return { color: "text-violet-300", bgClass: "bg-violet-500/10", borderClass: "border-violet-500/20", bgStyle: "color-mix(in srgb, #a78bfa 10%, transparent)", borderStyle: "color-mix(in srgb, #a78bfa 25%, transparent)", icon: Briefcase };
  if (n.includes("PROCESSO") || n.includes("JUDICIAL") || n.includes("MANDADO") || n.includes("CRIME")) return { color: "text-rose-300", bgClass: "bg-rose-500/10", borderClass: "border-rose-500/20", bgStyle: "color-mix(in srgb, #fb7185 10%, transparent)", borderStyle: "color-mix(in srgb, #fb7185 25%, transparent)", icon: Scale };
  if (n.includes("VEÍCULO") || n.includes("VEICULO") || n.includes("PLACA") || n.includes("FROTA") || n.includes("AUTO")) return { color: "text-orange-300", bgClass: "bg-orange-500/10", borderClass: "border-orange-500/20", bgStyle: "color-mix(in srgb, #fb923c 10%, transparent)", borderStyle: "color-mix(in srgb, #fb923c 25%, transparent)", icon: Car };
  if (n.includes("SÓCIO") || n.includes("SOCIO") || n.includes("QSA") || n.includes("PARCEIRO") || n.includes("MEMBRO")) return { color: "text-fuchsia-300", bgClass: "bg-fuchsia-500/10", borderClass: "border-fuchsia-500/20", bgStyle: "color-mix(in srgb, #e879f9 10%, transparent)", borderStyle: "color-mix(in srgb, #e879f9 25%, transparent)", icon: Building2 };
  if (n.includes("PARENTE") || n.includes("FAMILIAR") || n.includes("FILHO") || n.includes("CÔNJUGE") || n.includes("CONJUGE")) return { color: "text-pink-300", bgClass: "bg-pink-500/10", borderClass: "border-pink-500/20", bgStyle: "color-mix(in srgb, #f472b6 10%, transparent)", borderStyle: "color-mix(in srgb, #f472b6 25%, transparent)", icon: Heart };
  return { color: "text-primary", bgClass: "bg-primary/10", borderClass: "border-primary/20", bgStyle: "color-mix(in srgb, var(--color-primary) 10%, transparent)", borderStyle: "color-mix(in srgb, var(--color-primary) 25%, transparent)", icon: Database };
}

// ─── Section item parser ──────────────────────────────────────────────────────
function parseSectionItem(item: string): Array<{ k: string; v: string }> | null {
  const parts = item.split(/\s·\s/);
  const pairs: Array<{ k: string; v: string }> = [];
  for (const part of parts) {
    const colonIdx = part.indexOf(": ");
    if (colonIdx > 0 && colonIdx < 35) {
      pairs.push({ k: part.slice(0, colonIdx).trim(), v: part.slice(colonIdx + 2).trim() });
    } else { return null; }
  }
  return pairs.length >= 2 ? pairs : null;
}

// ─── Collapsible Section card ─────────────────────────────────────────────────
const SECTION_COLLAPSE_THRESHOLD = 5;

function SectionCard({ sec, idx, filterText = "" }: { sec: ParsedSection; idx: number; filterText?: string }) {
  const theme = getSectionTheme(sec.name);
  const Icon = theme.icon;

  const filteredItems = useMemo(() => {
    if (!filterText.trim()) return sec.items;
    const term = filterText.toLowerCase();
    return sec.items.filter(item => item.toLowerCase().includes(term));
  }, [sec.items, filterText]);

  const [collapsed, setCollapsed] = useState(sec.items.length > SECTION_COLLAPSE_THRESHOLD);
  // When filtering, always expand so the user can see all matches
  const isFiltering = filterText.trim().length > 0;
  const visibleItems = (collapsed && !isFiltering) ? filteredItems.slice(0, SECTION_COLLAPSE_THRESHOLD) : filteredItems;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 + idx * 0.05, ease: [0.23, 1, 0.32, 1] }}
      className="rounded-2xl overflow-hidden"
      style={{
        border: `1px solid ${theme.borderStyle}`,
        background: `${theme.bgStyle}`,
        backdropFilter: "blur(20px)",
        boxShadow: `0 4px 32px ${theme.bgStyle}, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${theme.borderStyle}` }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: theme.bgStyle, border: `1px solid ${theme.borderStyle}` }}>
            <Icon className={`w-4 h-4 ${theme.color}`} />
          </div>
          <div>
            <h3 className={`text-xs font-bold uppercase tracking-[0.25em] ${theme.color}`}>{sec.name}</h3>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              {isFiltering
                ? <>{filteredItems.length} de {sec.items.length} {sec.items.length === 1 ? "registro" : "registros"}</>
                : <>{sec.items.length} {sec.items.length === 1 ? "registro" : "registros"}{collapsed ? ` · mostrando ${SECTION_COLLAPSE_THRESHOLD}` : ""}</>
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CopyButton text={visibleItems.join("\n")} label="Copiar" />
          {!isFiltering && sec.items.length > SECTION_COLLAPSE_THRESHOLD && (
            <button onClick={() => setCollapsed(v => !v)}
              className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest ${theme.color} opacity-70 hover:opacity-100 transition-opacity`}>
              {collapsed ? <><ChevronDown className="w-3 h-3" /> Ver todos</> : <><ChevronUp className="w-3 h-3" /> Recolher</>}
            </button>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="p-4 space-y-2">
        {filteredItems.length === 0 && isFiltering ? (
          <div className="py-6 text-center">
            <p className="text-[11px] text-muted-foreground/40 uppercase tracking-widest">Nenhum registro encontrado</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {visibleItems.map((item, i) => {
              const structured = parseSectionItem(item);
              return (
                <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }} transition={{ delay: Math.min(i * 0.012, 0.25) }} className="group relative">
                  {structured ? (
                    <div className="rounded-xl p-3.5 transition-all"
                      style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(8px)" }}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-3">
                        {structured.map(({ k, v }, pi) => (
                          <div key={pi} className="min-w-0">
                            <p className={`text-[9px] uppercase tracking-widest ${theme.color} opacity-60 mb-0.5`}>{k}</p>
                            <p className="text-[12px] font-semibold break-words text-white/90">{v || "—"}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 flex justify-end" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                        <InlineCopy text={item} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 rounded-xl p-3 transition-all group"
                      style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.05)", backdropFilter: "blur(8px)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.4)"; (e.currentTarget as HTMLElement).style.borderColor = theme.borderStyle; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.25)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)"; }}>
                      <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-black shrink-0 mt-px"
                        style={{ background: theme.bgStyle, color: "currentColor", border: `1px solid ${theme.borderStyle}` }}>
                        <span className={theme.color}>{i + 1}</span>
                      </span>
                      <p className="text-[12px] font-mono flex-1 break-words leading-relaxed text-white/80">{item}</p>
                      <InlineCopy text={item} />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}

        {/* Expand button */}
        {!isFiltering && collapsed && filteredItems.length > SECTION_COLLAPSE_THRESHOLD && (
          <button onClick={() => setCollapsed(false)}
            className="w-full py-3 rounded-xl text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2"
            style={{ background: theme.bgStyle, border: `1px solid ${theme.borderStyle}`, color: "currentColor" }}>
            <span className={theme.color}>+ {filteredItems.length - SECTION_COLLAPSE_THRESHOLD} registros ocultos · Clique para expandir</span>
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Photo URL normalization ──────────────────────────────────────────────────
const PHOTO_KEY_RE = /^(FOTO|IMAGEM|IMAGE|PHOTO|PIC|THUMB|FACE|BASE64|FOTOGRAFIA|RETRATO|BIOMETRIA|SELFIE|ROSTO|FIGURA)/i;
const RAW_BASE64_RE = /^[A-Za-z0-9+/]{500,}={0,2}$/;

function normalizePhotoUrl(v: string): string | null {
  if (!v || typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.startsWith("data:image")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const clean = trimmed.replace(/\s/g, "");
  if (clean.length >= 500 && RAW_BASE64_RE.test(clean.slice(0, 600))) {
    return `data:image/jpeg;base64,${clean}`;
  }
  return null;
}

// ─── Main ResultViewer ────────────────────────────────────────────────────────
export function ResultViewer({ tipo, query = "", result }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [compact, setCompact] = useState(false);
  const [filterText, setFilterText] = useState("");
  const queriedAt = useMemo(() => new Date(), []);

  const parsed: Parsed = useMemo(() => {
    if (isParsed(result.data)) {
      const d = result.data as Parsed;

      // ── Detect photo: explicit FOTO_URL first, then photo-named keys, then any base64 value ──
      let fotoValue: string | null = null;

      const explicitFoto = d.fields.find(f => f.key === "FOTO_URL");
      if (explicitFoto) fotoValue = normalizePhotoUrl(explicitFoto.value);

      if (!fotoValue) {
        for (const f of d.fields) {
          if (f.key !== "FOTO_URL" && PHOTO_KEY_RE.test(f.key)) {
            const n = normalizePhotoUrl(f.value);
            if (n) { fotoValue = n; break; }
          }
        }
      }

      if (!fotoValue) {
        for (const f of d.fields) {
          const n = normalizePhotoUrl(f.value);
          if (n) { fotoValue = n; break; }
        }
      }

      // Suppress fields that are: FOTO_URL, photo-key fields with base64, or whose value IS the detected photo
      const cleanFields = d.fields
        .filter(f => {
          if (f.key === "FOTO_URL") return false;
          if (isUselessValue(f.value)) return false;
          if (fotoValue && normalizePhotoUrl(f.value) === fotoValue) return false;
          if (PHOTO_KEY_RE.test(f.key) && normalizePhotoUrl(f.value)) return false;
          return true;
        })
        .map(f => ({ key: humanizeKey(f.key), value: f.value }));

      const fotoField: ParsedField | null = fotoValue ? { key: "FOTO_URL", value: fotoValue } : null;
      return { fields: fotoField ? [fotoField, ...cleanFields] : cleanFields, sections: d.sections, raw: d.raw };
    }
    return { fields: [], sections: [], raw: typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? {}) };
  }, [result.data]);

  const photoUrl     = parsed.fields.find(f => f.key === "FOTO_URL")?.value;
  const displayFields = parsed.fields.filter(f => f.key !== "FOTO_URL");
  const headlineFields = displayFields.filter(f => isImportantField(f.key)).slice(0, 4);
  const otherFields    = displayFields.filter(f => !headlineFields.includes(f));

  const exportText = useMemo(() => {
    const lines = [`═══ INFINITY SEARCH ═══`, `Tipo: ${tipo.toUpperCase()}`, `Data: ${new Date().toLocaleString("pt-BR")}`, ``];
    parsed.fields.forEach(f => {
      if (f.key === "FOTO_URL" && f.value.startsWith("data:image")) lines.push(`${f.key}: [imagem base64]`);
      else lines.push(`${f.key}: ${f.value}`);
    });
    parsed.sections.forEach(s => { lines.push(""); lines.push(`━ ${s.name} (${s.items.length}) ━`); s.items.forEach(it => lines.push(`  • ${it}`)); });
    lines.push(""); lines.push("Made by blxckxyz · Infinity Search");
    return lines.join("\n");
  }, [parsed, tipo]);

  const downloadTxt = () => {
    const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `infinity-${tipo}-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = () => {
    const date = new Date().toLocaleString("pt-BR");
    const fotoForPdf = parsed.fields.find(f => f.key === "FOTO_URL");
    const fieldsHtml = parsed.fields.filter(f => f.key !== "FOTO_URL").map(f => `<tr><td class="key">${f.key}</td><td class="val">${f.value || "—"}</td></tr>`).join("");
    const sectionsHtml = parsed.sections.map(s => `<div class="section"><div class="sec-title">${s.name} <span class="badge">${s.items.length}</span></div><ul>${s.items.map(it => `<li>${it}</li>`).join("")}</ul></div>`).join("");
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Infinity Search · ${tipo.toUpperCase()} · ${query}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111;padding:28px 36px;font-size:13px}.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #0891b2;padding-bottom:14px;margin-bottom:20px}.logo{font-size:22px;font-weight:900;letter-spacing:4px;text-transform:uppercase;color:#0891b2}.meta{text-align:right;color:#555;font-size:11px;line-height:1.7}.meta strong{color:#111}table{width:100%;border-collapse:collapse;margin-bottom:20px}tr:nth-child(even){background:#f4fbfd}td{padding:7px 10px;border-bottom:1px solid #e0f2f8;vertical-align:top}td.key{font-weight:700;color:#0e7490;text-transform:uppercase;font-size:11px;letter-spacing:1px;width:36%;white-space:nowrap}td.val{color:#111;font-size:13px;word-break:break-all}.section{margin-bottom:18px}.sec-title{font-weight:800;text-transform:uppercase;letter-spacing:2px;font-size:11px;color:#0891b2;margin-bottom:8px;display:flex;align-items:center;gap:8px}.badge{background:#0891b2;color:#fff;border-radius:9px;padding:1px 7px;font-size:10px}ul{list-style:none;padding:0}li{padding:5px 10px;background:#f4fbfd;border-left:3px solid #0891b2;margin-bottom:4px;font-size:12px;font-family:monospace;word-break:break-all}.footer{margin-top:24px;border-top:1px solid #e0f2f8;padding-top:10px;text-align:center;color:#aaa;font-size:10px;letter-spacing:2px;text-transform:uppercase}@media print{body{padding:10px 16px}}</style></head>
<body><div class="header"><div><div class="logo">∞ Infinity Search</div><div style="margin-top:4px;font-size:11px;color:#555">Relatório OSINT gerado automaticamente</div></div>
<div class="meta"><div><strong>Tipo:</strong> ${tipo.toUpperCase()}</div><div><strong>Consulta:</strong> ${query}</div><div><strong>Data:</strong> ${date}</div><div><strong>Campos:</strong> ${parsed.fields.length} &nbsp;·&nbsp; <strong>Listas:</strong> ${parsed.sections.length}</div></div></div>
${fotoForPdf ? `<div style="margin-bottom:20px;display:flex;align-items:center;gap:16px;padding:12px;border:1px solid #e0f2f8;border-radius:8px;background:#f4fbfd;"><img src="${fotoForPdf.value}" alt="Foto" style="width:96px;height:120px;object-fit:cover;border-radius:6px;border:2px solid #0891b2;" onerror="this.style.display='none'" /><div><div style="font-weight:700;color:#0e7490;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Foto Biométrica</div></div></div>` : ""}
${parsed.fields.length > 0 ? `<table>${fieldsHtml}</table>` : ""}${sectionsHtml}
<div class="footer">Made by blxckxyz · Infinity Search · ${date}</div>
<script>setTimeout(()=>window.print(),300)</script></body></html>`;
    const win = window.open("", "_blank", "width=900,height=700");
    if (win) { win.document.write(html); win.document.close(); }
  };

  // ── No result ──────────────────────────────────────────────────────────────
  if (!result.success && parsed.fields.length === 0 && parsed.sections.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="mt-6 rounded-2xl border border-amber-400/25 p-5 sm:p-6"
        style={{ background: "color-mix(in srgb, #fbbf24 6%, transparent)", backdropFilter: "blur(20px)" }}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold uppercase tracking-widest text-amber-200">Sem resultado</div>
            <p className="text-xs text-amber-100/70 mt-1.5 leading-relaxed">{result.error ?? "O provedor não retornou dados para esta consulta."}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  const fieldCount = displayFields.length;
  const sectionCount = parsed.sections.length;
  const totalItems = parsed.sections.reduce((acc, s) => acc + s.items.length, 0);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">

      {/* ── Result summary header ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden"
        style={{
          border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)",
          background: "color-mix(in srgb, var(--color-primary) 6%, rgba(0,0,0,0.4))",
          backdropFilter: "blur(24px)",
          boxShadow: "0 4px 40px color-mix(in srgb, var(--color-primary) 6%, transparent), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        {/* Top accent line */}
        <div className="h-[2px]" style={{ background: "linear-gradient(to right, var(--color-primary), color-mix(in srgb, var(--color-primary) 30%, transparent))" }} />

        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3">
          {/* Left: status + meta */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className={`w-2 h-2 rounded-full ${result.success ? "bg-emerald-400" : "bg-amber-400"}`} />
                <div className={`absolute inset-0 w-2 h-2 rounded-full ${result.success ? "bg-emerald-400" : "bg-amber-400"} animate-ping opacity-50`} />
              </div>
              <span className={`text-[11px] font-bold uppercase tracking-[0.3em] ${result.success ? "text-emerald-300" : "text-amber-300"}`}>
                {result.success ? "Encontrado" : "Sem dados"}
              </span>
            </div>
            {/* Stats pills */}
            <div className="hidden sm:flex items-center gap-2">
              {fieldCount > 0 && (
                <span className="text-[9px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)" }}>
                  {fieldCount} campos
                </span>
              )}
              {sectionCount > 0 && (
                <span className="text-[9px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full text-violet-300"
                  style={{ background: "color-mix(in srgb, #a78bfa 12%, transparent)", border: "1px solid color-mix(in srgb, #a78bfa 25%, transparent)" }}>
                  {sectionCount} lista{sectionCount !== 1 ? "s" : ""} · {totalItems} registros
                </span>
              )}
            </div>
          </div>

          {/* Right: timestamp + actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[9px] text-muted-foreground/50 hidden md:inline">
              {queriedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <div className="w-px h-3 bg-white/10" />
            <FavoriteButton tipo={tipo} query={query} data={result.data} />
            <SaveToDossieButton tipo={tipo} query={query} data={result.data} />
            <div className="w-px h-3 bg-white/10" />
            <button onClick={downloadTxt} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
              <Download className="w-3 h-3" /> TXT
            </button>
            <button onClick={downloadPdf} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-rose-400 transition-colors">
              <FileText className="w-3 h-3" /> PDF
            </button>
            <CopyButton text={exportText} label="Copiar" />
            <div className="w-px h-3 bg-white/10" />
            <button onClick={() => setCompact(v => !v)}
              className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest transition-colors ${compact ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
              title={compact ? "Modo detalhado" : "Modo compacto"}>
              {compact ? <Rows3 className="w-3 h-3" /> : <LayoutGrid className="w-3 h-3" />}
              {compact ? "Detalhado" : "Compacto"}
            </button>
            <div className="w-px h-3 bg-white/10" />
            <button onClick={() => setShowRaw(v => !v)}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              {showRaw ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showRaw ? "Ocultar" : "Bruto"}
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── Photo card ─────────────────────────────────────────────────────── */}
      {photoUrl && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className="rounded-2xl overflow-hidden"
          style={{
            border: "1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)",
            background: "color-mix(in srgb, var(--color-primary) 8%, rgba(0,0,0,0.5))",
            backdropFilter: "blur(24px)",
            boxShadow: "0 0 60px color-mix(in srgb, var(--color-primary) 8%, transparent)",
          }}
        >
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 p-6">
            {/* Photo */}
            <div className="relative shrink-0">
              <div className="absolute -inset-4 rounded-2xl blur-2xl opacity-40 pointer-events-none"
                style={{ background: "color-mix(in srgb, var(--color-primary) 30%, transparent)" }} />
              <div className="relative w-28 h-36 sm:w-36 sm:h-44 rounded-xl overflow-hidden"
                style={{ border: "2px solid color-mix(in srgb, var(--color-primary) 45%, transparent)", boxShadow: "0 0 40px color-mix(in srgb, var(--color-primary) 20%, transparent)" }}>
                <img src={photoUrl} alt="Foto Biométrica" className="w-full h-full object-cover"
                  onError={e => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = "none"; }} />
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "color-mix(in srgb, var(--color-primary) 20%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)" }}>
                <Camera className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
              </div>
            </div>
            {/* Info */}
            <div className="flex flex-col gap-4 text-center sm:text-left">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-3"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 28%, transparent)" }}>
                  <Fingerprint className="w-3 h-3" style={{ color: "var(--color-primary)" }} />
                  <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: "var(--color-primary)" }}>Foto Biométrica</span>
                </div>
                <p className="text-sm text-muted-foreground">Imagem biométrica encontrada na base de dados.</p>
                <p className="text-[10px] text-muted-foreground/50 mt-1">Tipo: {tipo.toUpperCase()} · Consulta: {query}</p>
              </div>
              <div className="flex items-center gap-3 justify-center sm:justify-start flex-wrap">
                {photoUrl.startsWith("data:image") ? (
                  <a href={photoUrl} download={`foto-biometrica-${tipo}-${Date.now()}.jpg`}
                    className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold px-3.5 py-2 rounded-xl transition-all hover:brightness-110"
                    style={{ background: "color-mix(in srgb, var(--color-primary) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 32%, transparent)", color: "var(--color-primary)" }}>
                    <Download className="w-3 h-3" /> Baixar Foto
                  </a>
                ) : (
                  <>
                    <CopyButton text={photoUrl} label="Copiar URL" />
                    <a href={photoUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors border border-white/10 rounded-lg px-3 py-1.5 hover:border-white/20 hover:bg-white/5">
                      <ExternalLink className="w-3 h-3" /> Abrir Original
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Headline cards (top important fields) ─────────────────────────── */}
      {headlineFields.length > 0 && (
        <div className={`grid gap-3 ${headlineFields.length === 1 ? "grid-cols-1" : headlineFields.length === 2 ? "grid-cols-2" : headlineFields.length === 3 ? "grid-cols-3" : "grid-cols-2 lg:grid-cols-4"}`}>
          {headlineFields.map((f, i) => {
            const Icon = getFieldIcon(f.key);
            const accent = getFieldAccent(f.key);
            const displayVal = formatValue(f.key, f.value);
            return (
              <motion.div key={`${f.key}-${i}`}
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: i * 0.06, type: "spring", stiffness: 300, damping: 22 }}
                whileHover={{ y: -3, transition: { duration: 0.15 } }}
                className="group relative overflow-hidden rounded-2xl cursor-pointer"
                style={{
                  border: `1px solid ${accent.border}`,
                  background: `linear-gradient(135deg, ${accent.bg} 0%, rgba(0,0,0,0.4) 100%)`,
                  backdropFilter: "blur(20px)",
                  boxShadow: `0 4px 24px ${accent.bg}, inset 0 1px 0 rgba(255,255,255,0.06)`,
                }}
                onClick={() => { navigator.clipboard.writeText(f.value); toast.success("Copiado!"); }}
                title="Clique para copiar"
              >
                {/* Inner glow */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{ background: `radial-gradient(ellipse at 50% 0%, ${accent.bg} 0%, transparent 70%)` }} />

                <div className="relative p-4 sm:p-5 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                      style={{ background: accent.bg, border: `1px solid ${accent.border}` }}>
                      <Icon className={`w-4 h-4 ${accent.text}`} />
                    </div>
                    <Sparkles className={`w-3 h-3 ${accent.text} opacity-30 group-hover:opacity-70 transition-opacity`} />
                  </div>
                  <div>
                    <p className={`text-[9px] uppercase tracking-[0.3em] font-semibold ${accent.text} opacity-70 mb-1.5`}>{f.key}</p>
                    <p className="text-sm sm:text-[15px] font-bold break-words leading-tight">{displayVal || "—"}</p>
                  </div>
                </div>
                {/* Copy hint */}
                <div className="absolute bottom-2.5 right-3 opacity-0 group-hover:opacity-50 transition-opacity">
                  <Copy className="w-3 h-3 text-muted-foreground" />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Detail fields ─────────────────────────────────────────────────── */}
      {otherFields.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.35)", backdropFilter: "blur(24px)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>

          {/* Section header */}
          <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)" }}>
              <List className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
            </div>
            <h3 className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground font-semibold">Detalhes</h3>
            <span className="text-[9px] text-muted-foreground/40 ml-1">· {otherFields.length} campos</span>
          </div>

          {/* Field rows — compact grid or detail rows */}
          {compact ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-3">
              {otherFields.map((f, i) => {
                const accent = getFieldAccent(f.key);
                const displayVal = formatValue(f.key, f.value);
                return (
                  <motion.div key={`${f.key}-${i}`}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(0.04 + i * 0.01, 0.25) }}
                    className="group relative flex flex-col gap-0.5 p-2.5 rounded-xl cursor-pointer transition-all"
                    style={{ background: "rgba(0,0,0,0.3)", border: `1px solid rgba(255,255,255,0.05)` }}
                    onClick={() => { navigator.clipboard.writeText(f.value); toast.success("Copiado!"); }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = accent.border; (e.currentTarget as HTMLElement).style.background = accent.bg; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.3)"; }}
                    title="Clique para copiar"
                  >
                    <p className={`text-[8px] uppercase tracking-widest font-semibold ${accent.text} opacity-60`}>{f.key}</p>
                    <p className="text-[11px] font-semibold break-all text-white/85 leading-snug">{displayVal || "—"}</p>
                    <Copy className="absolute top-2 right-2 w-2.5 h-2.5 opacity-0 group-hover:opacity-40 transition-opacity text-muted-foreground" />
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-white/[0.03]">
              {otherFields.map((f, i) => {
                const Icon = getFieldIcon(f.key);
                const accent = getFieldAccent(f.key);
                const displayVal = formatValue(f.key, f.value);
                return (
                  <motion.div key={`${f.key}-${i}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(0.12 + i * 0.016, 0.45) }}
                    className="group flex items-center gap-3.5 px-5 py-3.5 transition-all cursor-default"
                    style={{ cursor: "default" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: accent.bg, border: `1px solid ${accent.border}` }}>
                      <Icon className={`w-3.5 h-3.5 ${accent.text}`} />
                    </div>
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-4">
                      <p className={`text-[9px] uppercase tracking-[0.22em] font-semibold ${accent.text} opacity-70 whitespace-nowrap shrink-0`}>{f.key}</p>
                      <p className="text-[13px] font-medium break-all text-right text-white/85 truncate" title={displayVal}>{displayVal || "—"}</p>
                    </div>
                    <InlineCopy text={f.value} />
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      )}

      {/* ── Info tip when no structured fields but has raw ─────────────────── */}
      {displayFields.length === 0 && parsed.sections.length === 0 && parsed.raw && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="rounded-xl p-4 flex items-start gap-3"
          style={{ background: "color-mix(in srgb, var(--color-primary) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)" }}>
          <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--color-primary)" }} />
          <p className="text-xs text-muted-foreground">Dados retornados em formato bruto. Use o botão <strong>Bruto</strong> acima para visualizar.</p>
        </motion.div>
      )}

      {/* ── Section filter bar (only when there are sections with enough items) */}
      {totalItems >= 5 && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
            <input
              type="text"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              placeholder={`Filtrar nos ${totalItems} registros… ex: 1990, SP, João`}
              className="w-full pl-9 pr-9 py-2.5 text-[12px] rounded-xl outline-none transition-all"
              style={{
                background: "rgba(0,0,0,0.4)",
                border: `1px solid ${filterText ? "color-mix(in srgb, var(--color-primary) 35%, transparent)" : "rgba(255,255,255,0.08)"}`,
                color: "rgba(255,255,255,0.85)",
                backdropFilter: "blur(20px)",
              }}
            />
            {filterText && (
              <button onClick={() => setFilterText("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {filterText && (
            <span className="text-[10px] uppercase tracking-widest whitespace-nowrap"
              style={{ color: "var(--color-primary)" }}>
              {parsed.sections.reduce((acc, s) => acc + s.items.filter(it => it.toLowerCase().includes(filterText.toLowerCase())).length, 0)} resultado{parsed.sections.reduce((acc, s) => acc + s.items.filter(it => it.toLowerCase().includes(filterText.toLowerCase())).length, 0) !== 1 ? "s" : ""}
            </span>
          )}
        </motion.div>
      )}

      {/* ── Sections ─────────────────────────────────────────────────────── */}
      {parsed.sections.map((sec, idx) => (
        <SectionCard key={`${sec.name}-${idx}`} sec={sec} idx={idx} filterText={filterText} />
      ))}

      {/* ── Raw response (toggle) ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showRaw && parsed.raw && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(24px)" }}
          >
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="flex items-center gap-2">
                <FileJson className="w-3.5 h-3.5 text-muted-foreground/50" />
                <h3 className="text-[9px] uppercase tracking-[0.45em] text-muted-foreground/50">Resposta bruta do provedor</h3>
              </div>
              <CopyButton text={parsed.raw} />
            </div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-muted-foreground/60 max-h-80 overflow-y-auto p-5 leading-relaxed">
              {parsed.raw}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-2 pt-1 pb-2">
        <Zap className="w-2.5 h-2.5 opacity-30" style={{ color: "var(--color-primary)" }} />
        <span className="text-[9px] uppercase tracking-[0.6em] text-muted-foreground/30">Made by blxckxyz · Infinity Search</span>
        <Zap className="w-2.5 h-2.5 opacity-30" style={{ color: "var(--color-primary)" }} />
      </div>
    </motion.div>
  );
}
