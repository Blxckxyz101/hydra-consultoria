import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, Copy, Check, Download, FileJson, Eye, EyeOff,
  Sparkles, FolderOpen, CheckCircle2, Star, FileText, Camera,
  IdCard, User, Phone, Mail, MapPin, Car, Building2, TrendingUp,
  Wallet, Scale, Calendar, CreditCard, Fingerprint, Heart,
  ShieldAlert, Hash, List, Briefcase, Database, ChevronDown,
  ChevronUp, ExternalLink, Zap, type LucideIcon, Info, LayoutGrid, Rows3,
  Search, X, Share2, Lock, Clock, Loader2,
} from "lucide-react";
import { addFavorito, isFavorito } from "@/pages/favoritos";

const API_BASE = "/api/infinity";
type DossieStub = { id: string; title: string; items?: unknown[] };

function dossieAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function fetchDossieStubsAPI(): Promise<DossieStub[]> {
  try {
    const r = await fetch(`${API_BASE}/me/dossies`, { headers: dossieAuthHeaders() });
    if (!r.ok) return [];
    return await r.json() as DossieStub[];
  } catch { return []; }
}

async function addItemToDossieAPI(dossieId: string, newItem: object): Promise<boolean> {
  try {
    // Fetch current dossier, prepend item, PUT back
    const r = await fetch(`${API_BASE}/me/dossies`, { headers: dossieAuthHeaders() });
    if (!r.ok) return false;
    const all = await r.json() as DossieStub[];
    const dossie = all.find((d) => d.id === dossieId);
    if (!dossie) return false;
    const updatedItems = [newItem, ...(dossie.items ?? [])];
    const put = await fetch(`${API_BASE}/me/dossies/${dossieId}`, {
      method: "PUT",
      headers: dossieAuthHeaders(),
      body: JSON.stringify({ title: dossie.title, items: updatedItems }),
    });
    return put.ok;
  } catch { return false; }
}

function SaveToDossieButton({ tipo, query, data }: { tipo: string; query: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stubs, setStubs] = useState<DossieStub[]>([]);

  useEffect(() => {
    if (open && stubs.length === 0) {
      fetchDossieStubsAPI().then(setStubs);
    }
  }, [open]);

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
          {stubs.length === 0 && (
            <p className="px-3 py-3 text-[10px] text-muted-foreground/50">Nenhum dossiê criado</p>
          )}
          {stubs.map(d => (
            <button key={d.id} disabled={saving} onClick={async () => {
              setSaving(true);
              const parsed = (data as { fields?: unknown[]; sections?: unknown[]; raw?: string }) ?? {};
              const item = {
                id: Math.random().toString(36).slice(2) + Date.now().toString(36),
                tipo, query, addedAt: new Date().toISOString(), note: "",
                fields: parsed.fields ?? [], sections: parsed.sections ?? [], raw: parsed.raw ?? "",
              };
              const ok = await addItemToDossieAPI(d.id, item);
              setSaving(false);
              if (ok) { setSaved(true); setOpen(false); }
            }} className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-white/5 transition-colors disabled:opacity-50">
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
  const toggle = async () => {
    if (fav) return;
    const parsed = (data as { fields?: unknown[]; sections?: unknown[]; raw?: string }) ?? {};
    const ok = await addFavorito({
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

function ShareButton({ tipo, query, data }: { tipo: string; query: string; data: unknown }) {
  const [sharing, setSharing] = useState(false);
  const [open, setOpen] = useState(false);
  const [shareInfo, setShareInfo] = useState<{ url: string; expiresAt: Date } | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!shareInfo) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((shareInfo.expiresAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) clearInterval(timerRef.current);
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [shareInfo]);

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch(`${API_BASE}/consultas/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ tipo, query, data }),
      });
      if (!r.ok) { toast.error("Erro ao criar link"); return; }
      const d = await r.json() as { id: string; expiresAt: string };
      const url = `${window.location.origin}/shared/${d.id}`;
      setShareInfo({ url, expiresAt: new Date(d.expiresAt) });
      setOpen(true);
      await navigator.clipboard.writeText(url).catch(() => undefined);
      toast.success("Link copiado para a área de transferência!");
    } catch { toast.error("Erro ao compartilhar"); }
    finally { setSharing(false); }
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const isExpired = shareInfo !== null && secondsLeft === 0;

  return (
    <div className="relative">
      <button
        onClick={open ? () => setOpen(false) : handleShare}
        disabled={sharing}
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-violet-400 transition-colors shrink-0 disabled:opacity-50"
        title="Compartilhar consulta (link público · 10 min)"
      >
        {sharing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />}
        {sharing ? "..." : "Compartilhar"}
      </button>

      {open && shareInfo && (
        <div className="absolute right-0 top-6 z-50 w-72 rounded-xl border border-white/10 bg-[#06091a]/96 backdrop-blur-2xl shadow-2xl overflow-hidden">
          <div className="px-3 pt-3 pb-2.5 border-b border-white/5 flex items-center justify-between">
            <p className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground">Link compartilhado</p>
            {isExpired ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                <Lock className="w-3 h-3" /> Expirado
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400">
                <Clock className="w-3 h-3" /> {fmtTime(secondsLeft)}
              </span>
            )}
          </div>
          <div className="px-3 py-2.5 space-y-2.5">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/[0.08] px-2.5 py-1.5">
              <span className="flex-1 text-[10px] text-muted-foreground/80 truncate">{shareInfo.url}</span>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(shareInfo.url).catch(() => undefined);
                  setCopied(true); toast.success("Copiado!"); setTimeout(() => setCopied(false), 1500);
                }}
                className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
              </button>
            </div>
            <p className="text-[9px] text-muted-foreground/40 leading-relaxed">
              Qualquer pessoa com este link pode ver esta consulta sem precisar de cadastro.
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="w-full py-2 text-[9px] uppercase tracking-widest text-muted-foreground/40 hover:text-muted-foreground transition-colors border-t border-white/5"
          >
            Fechar
          </button>
        </div>
      )}
    </div>
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
  // Veículo
  "MARCA_MODEL0": "Marca / Modelo", "MARCA_MODELO": "Marca / Modelo",
  "PROPRIETARIO_NOME": "Proprietário", "PROPRIETARIO_CPF": "CPF do Proprietário",
  "ESTADO_ENDERECO": "Estado (Endereço)", "TIPO_VEICULO": "Tipo de Veículo",
  "ANO_MODELO": "Ano do Modelo", "ANO_FABRICACAO": "Ano de Fabricação",
  "HABILITADO_PARA_DIRIGIR": "Habilitado p/ Dirigir",
  // Pessoa
  "DATA_NASCIMENTO": "Data de Nascimento", "NOME_MAE": "Nome da Mãe", "NOME_PAI": "Nome do Pai",
  // Empresa
  "RAZAO_SOCIAL": "Razão Social", "NOME_FANTASIA": "Nome Fantasia",
  "CAPITAL_SOCIAL": "Capital Social", "NATUREZA_JURIDICA": "Natureza Jurídica",
  "DATA_ABERTURA": "Data de Abertura", "DATA_SITUACAO": "Data da Situação",
  "ULTIMA_ATUALIZACAO": "Última Atualização",
  // Processos / Jurídico
  "NUMERO_PROCESSO": "Nº do Processo", "NUM_PROCESSO": "Nº do Processo",
  "NUMERO_OAB": "Nº OAB", "NUM_OAB": "Nº OAB",
  "UF_OAB": "UF da OAB", "ESTADO_OAB": "UF da OAB",
  "NOME_ADVOGADO": "Nome do Advogado", "ADVOGADO": "Advogado",
  "TIPO_ACAO": "Tipo da Ação", "TIPO_PROCESSO": "Tipo do Processo",
  "TIPO_INSCRICAO": "Tipo de Inscrição", "SITUACAO_INSCRICAO": "Situação da Inscrição",
  "DATA_DISTRIBUICAO": "Data de Distribuição", "DATA_JULGAMENTO": "Data do Julgamento",
  "DATA_AUTUACAO": "Data de Autuação", "DATA_BAIXA": "Data de Baixa",
  "VARA": "Vara", "COMARCA": "Comarca", "TRIBUNAL": "Tribunal",
  "ORGAO_JULGADOR": "Órgão Julgador", "INSTANCIA": "Instância",
  "ASSUNTO": "Assunto / Matéria", "CLASSE_PROCESSUAL": "Classe Processual",
  "PARTES_ENVOLVIDAS": "Partes Envolvidas", "POLO_ATIVO": "Polo Ativo", "POLO_PASSIVO": "Polo Passivo",
  "VALOR_CAUSA": "Valor da Causa", "VALOR_DEBITO": "Valor do Débito",
  "SITUACAO_PROCESSO": "Situação do Processo", "FASE_ATUAL": "Fase Atual",
  "NUMERO_MANDADO": "Nº do Mandado", "TIPO_MANDADO": "Tipo do Mandado",
  "MOTIVO_PRISAO": "Motivo da Prisão", "DATA_EXPEDICAO": "Data de Expedição",
  "BANCO_CHEQUE": "Banco", "AGENCIA_CHEQUE": "Agência", "NUMERO_CHEQUE": "Nº do Cheque",
  "DATA_CHEQUE": "Data do Cheque", "VALOR_CHEQUE": "Valor do Cheque",
  "CERTIDAO_TIPO": "Tipo de Certidão", "CERTIDAO_STATUS": "Status da Certidão",
  "NUMERO_CERTIDAO": "Nº da Certidão", "DATA_EMISSAO_CERTIDAO": "Data de Emissão",
  "BEM_TIPO": "Tipo do Bem", "BEM_DESCRICAO": "Descrição do Bem",
  "BEM_VALOR": "Valor do Bem", "REGISTRO_IMOVEL": "Registro de Imóvel",
  "DIVIDA_TIPO": "Tipo da Dívida", "DIVIDA_VALOR": "Valor da Dívida",
  "DIVIDA_CREDOR": "Credor", "DIVIDA_STATUS": "Status da Dívida",
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
  const k = key.toUpperCase().trim();
  // For compound keys (A · B), only the leaf (rightmost) part is checked —
  // prevents "RESIDENTE EXTERIOR · NOME PAIS" from matching as a person name
  const leaf = k.includes("·") ? k.split("·").pop()!.trim() : k;

  // Exact matches on the leaf — avoids e.g. "NOME PAIS" matching "NOME"
  const EXACT = new Set(["NOME", "CPF", "CNPJ", "RG", "FOTO_URL"]);
  if (EXACT.has(leaf)) return true;

  // Substring matches that are safe even in compound keys
  const CONTAINS = [
    "RAZÃO SOCIAL", "RAZAO SOCIAL", "PLACA", "CHASSI",
    "TELEFONE", "EMAIL",
    "DATA NASCIMENTO", "DATA DE NASCIMENTO", "NASCIMENTO", "DATA NASC",
    "NOME MÃE", "NOME MAE", "NOME DA MAE", "NOME DA MÃE",
    "NOME PAI", "NOME DO PAI",
    "SEXO", "GENERO", "GÊNERO",
    "SITUAÇÃO CADASTRAL", "SITUACAO CADASTRAL",
  ];
  return CONTAINS.some(imp => leaf.includes(imp));
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
  if (!value || !value.trim()) return "Não encontrado";
  const k = key.toUpperCase();
  const v = value.trim().replace(/\D/g, "");
  if ((k === "CPF" || k.endsWith(" CPF") || k.startsWith("CPF ")) && /^\d{11}$/.test(v))
    return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  if ((k === "CNPJ" || k.includes("CNPJ")) && /^\d{14}$/.test(v))
    return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  if ((k.includes("TELEFONE") || k.includes("CELULAR")) && /^\d{10,11}$/.test(v))
    return v.length === 11 ? `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}` : `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
  if (k.includes("CEP") && /^\d{8}$/.test(v)) return `${v.slice(0, 5)}-${v.slice(5)}`;
  return value.trim();
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

  useEffect(() => {
    if (result.success && parsed.fields.length === 0 && parsed.sections.length === 0 && !!parsed.raw) {
      setShowRaw(true);
    }
  }, [result, parsed]);

  const photoUrl     = parsed.fields.find(f => f.key === "FOTO_URL")?.value;
  const displayFields = parsed.fields.filter(f => f.key !== "FOTO_URL");
  const headlineFields = displayFields.filter(f => isImportantField(f.key)).slice(0, 4);
  const otherFields    = displayFields.filter(f => !headlineFields.includes(f));

  const exportText = useMemo(() => {
    const MODULE_LABELS_TXT: Record<string,string> = {
      processo:"Processo Judicial",processos:"Processos Judiciais",mandado:"Mandado de Prisão",
      cpf:"CPF Completo",cpfbasico:"CPF Básico",cpffull:"CPF Full",nome:"Busca por Nome",
      telefone:"Telefone",email:"Email",placa:"Placa",cnpj:"CNPJ",foto:"Foto Biométrica",
      biometria:"Biometria",score:"Score de Crédito",score2:"Score Bureau",irpf:"IRPF",
      beneficios:"Benefícios Sociais",spc:"SPC / Negativação",parentes:"Parentes",
      endereco:"Endereço",rg:"RG",cnh:"CNH",cnhfull:"CNH Completo",
      advogadooab:"Advogado por OAB",oab:"Registro OAB",cheque:"Cheques sem Fundos",
      certidoes:"Certidões",dividas:"Dívidas",bens:"Bens Registrados",
    };
    const moduleTitleTxt = MODULE_LABELS_TXT[tipo] || tipo.toUpperCase();
    const SEP = "═".repeat(54);
    const LEGAL_TIPOS_TXT = new Set(["processo","processos","mandado","advogadooab","advogadooabuf","advogadocpf","oab"]);
    const PRO_PREFIXES = ["Dados Processo","Assuntos","Classes","Partes","Movimentos","Tramitacoes","Representantes"];
    const PRO_LABELS: Record<string,string> = {
      "Dados Processo":"DADOS DO PROCESSO","Assuntos":"ASSUNTOS","Classes":"CLASSES",
      "Partes":"PARTES","Movimentos":"MOVIMENTOS","Tramitacoes":"TRAMITAÇÕES","Representantes":"REPRESENTANTES",
    };
    const getProPrefix = (k: string) => PRO_PREFIXES.find(p => k.startsWith(p)) ?? "Geral";

    const formatProcessoItem = (item: string, idx: number, total: number): string[] => {
      const pairs = item.split(" · ").map(p => {
        const ci = p.indexOf(": ");
        return ci === -1 ? { k: p.trim(), v: "" } : { k: p.slice(0, ci).trim(), v: p.slice(ci + 2).trim() };
      }).filter(p => p.k);
      const groups = new Map<string, Array<{sub: string; v: string}>>();
      const order: string[] = [];
      for (const { k, v } of pairs) {
        const pre = getProPrefix(k);
        if (!groups.has(pre)) { groups.set(pre, []); order.push(pre); }
        groups.get(pre)!.push({ sub: k.replace(new RegExp(`^${pre}\\s*`), "").trim() || k, v });
      }
      const lines: string[] = [];
      if (total > 1) lines.push(`  ┌── Registro ${idx + 1} de ${total} ${"─".repeat(28)}`);
      for (const pre of order) {
        const entries = groups.get(pre)!;
        const label = PRO_LABELS[pre] || pre.toUpperCase();
        const isRepeat = ["Partes","Movimentos","Representantes"].includes(pre);
        if (isRepeat) {
          const subRecs: Array<Array<{sub: string; v: string}>> = [[]];
          const seen = new Set<string>();
          for (const e of entries) {
            if (seen.has(e.sub)) { subRecs.push([]); seen.clear(); }
            seen.add(e.sub); subRecs[subRecs.length - 1].push(e);
          }
          lines.push(`  │  ─ ${label} (${subRecs.length})`);
          subRecs.forEach((sr, ri) => {
            if (subRecs.length > 1) lines.push(`  │    • ${pre.replace(/s$/, "")} ${ri + 1}:`);
            sr.forEach(({ sub, v }) => lines.push(`  │      ${sub}: ${v}`));
          });
        } else {
          lines.push(`  │  ─ ${label}`);
          entries.forEach(({ sub, v }) => lines.push(`  │    ${sub}: ${v}`));
        }
        lines.push("  │");
      }
      if (total > 1) lines.push("  └" + "─".repeat(44));
      return lines;
    };

    const lines = [SEP, `  HYDRA CONSULTORIA — ${moduleTitleTxt}`, `  Consulta: ${query || "—"}`, `  Data: ${new Date().toLocaleString("pt-BR")}`, SEP, ""];
    parsed.fields.forEach(f => {
      if (f.key === "FOTO_URL" && f.value.startsWith("data:image")) lines.push(`  FOTO_URL: [imagem base64]`);
      else lines.push(`  ${f.key}: ${f.value}`);
    });
    if (parsed.fields.length > 0) lines.push("");
    parsed.sections.forEach(s => {
      const bar = "━".repeat(Math.max(0, 46 - s.name.length));
      lines.push(`━━ ${s.name} (${s.items.length}) ${bar}`);
      lines.push("");
      const isLegalSec = LEGAL_TIPOS_TXT.has(tipo) && s.items.length > 0 && s.items[0].includes(" · ");
      if (isLegalSec) {
        s.items.forEach((it, i) => formatProcessoItem(it, i, s.items.length).forEach(l => lines.push(l)));
      } else {
        s.items.forEach(it => lines.push(`  • ${it}`));
      }
      lines.push("");
    });
    lines.push(SEP);
    lines.push("  Hydra Consultoria — hydraconsultoria.com");
    lines.push(SEP);
    return lines.join("\n");
  }, [parsed, tipo, query]);

  const downloadTxt = () => {
    const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const MODULE_LABELS_FILE: Record<string,string> = {
      processo:"Processo_Judicial",processos:"Processos_Judiciais",mandado:"Mandado_de_Prisao",
      cpf:"CPF_Completo",cpfbasico:"CPF_Basico",cpffull:"CPF_Full",nome:"Busca_Nome",
      telefone:"Telefone",email:"Email",placa:"Placa",cnpj:"CNPJ",foto:"Foto_Biometrica",
      biometria:"Biometria",score:"Score",rg:"RG",cnh:"CNH",cnhfull:"CNH_Completo",
      advogadooab:"Advogado_OAB",oab:"OAB",cheque:"Cheques",certidoes:"Certidoes",
      dividas:"Dividas",bens:"Bens",irpf:"IRPF",beneficios:"Beneficios",spc:"SPC",
    };
    const labelFile = MODULE_LABELS_FILE[tipo] || tipo.toUpperCase();
    const cleanQ = (query || "consulta").replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, "_").replace(/_+/g, "_").slice(0, 30);
    const dateFile = new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
    a.href = url; a.download = `Hydra_${labelFile}_${cleanQ}_${dateFile}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = () => {
    const date = new Date().toLocaleString("pt-BR");
    const protocol = `INF-${Date.now().toString(36).toUpperCase().slice(-8)}`;

    // ── Theming by module type ──────────────────────────────────────────────
    const LEGAL_TIPOS  = new Set(["processo","processos","mandado","advogadooab","advogadooabuf","advogadocpf","oab","cheque","certidoes","dividas","bens"]);
    const VEH_TIPOS    = new Set(["placa","chassi","renavam","motor","cnh","cnhfull","cnham","cnhnc","cnhrs","cnhrr","crlvto","crlvmt","vistoria","frota","placafipe","placaserpro"]);
    const COMPANY_TIPOS= new Set(["cnpj","socios","funcionarios","empregos","iptu"]);
    const PHOTO_TIPOS  = new Set(["foto","biometria","fotodetran","fotoma","fotoce","fotosp","fotorj"]);
    const isLegal   = LEGAL_TIPOS.has(tipo);
    const isVehicle = VEH_TIPOS.has(tipo);
    const isCompany = COMPANY_TIPOS.has(tipo);
    const isPhoto   = PHOTO_TIPOS.has(tipo);

    const theme = isLegal
      ? { primary:"#1d4ed8", light:"#eff6ff", mid:"#93c5fd", dark:"#1e3a8a", border:"#bfdbfe", accent:"#3b82f6", tag:"Jurídico / Processos", icon:"" }
      : isVehicle
      ? { primary:"#c2410c", light:"#fff7ed", mid:"#fdba74", dark:"#7c2d12", border:"#fed7aa", accent:"#ea580c", tag:"Veicular", icon:"🚗" }
      : isCompany
      ? { primary:"#7c3aed", light:"#f5f3ff", mid:"#c4b5fd", dark:"#4c1d95", border:"#ddd6fe", accent:"#8b5cf6", tag:"Empresarial", icon:"🏢" }
      : isPhoto
      ? { primary:"#0e7490", light:"#ecfeff", mid:"#67e8f9", dark:"#164e63", border:"#a5f3fc", accent:"#06b6d4", tag:"Biometria / Foto", icon:"📷" }
      : { primary:"#0891b2", light:"#f0f9ff", mid:"#7dd3fc", dark:"#0c4a6e", border:"#bae6fd", accent:"#0ea5e9", tag:"OSINT", icon:"🔍" };

    const MODULE_LABELS: Record<string,string> = {
      processo:"Processo Judicial",processos:"Processos Judiciais",mandado:"Mandado de Prisão",
      advogadooab:"Advogado por OAB",advogadooabuf:"Advogado OAB/UF",advogadocpf:"Advogado por CPF",
      oab:"Registro OAB",cheque:"Cheques sem Fundos",certidoes:"Certidões",
      dividas:"Dívidas BACEN/FGTS",bens:"Bens Registrados",
      cpf:"CPF Completo",cpfbasico:"CPF Básico",cpffull:"CPF Full",nome:"Busca por Nome",
      telefone:"Telefone",email:"Email",placa:"Placa",cnpj:"CNPJ",
      foto:"Foto Biométrica",biometria:"Biometria",score:"Score de Crédito",
      score2:"Score Bureau",irpf:"IRPF",beneficios:"Benefícios Sociais",
      spc:"SPC / Negativação",parentes:"Parentes",endereco:"Endereço",
      rg:"RG",cnh:"CNH",cnhfull:"CNH Completo",
    };
    const moduleTitle = MODULE_LABELS[tipo] || tipo.toUpperCase();

    // ── Build HTML parts ────────────────────────────────────────────────────
    const fotoField = parsed.fields.find(f => f.key === "FOTO_URL");
    const bodyFields = parsed.fields.filter(f => f.key !== "FOTO_URL");

    // Fields rendered as 2-column pairs
    const fieldsHtml = bodyFields.length === 0 ? "" : `
      <section class="card">
        <div class="card-header"><span class="card-icon">📋</span>Campos Encontrados<span class="badge">${bodyFields.length}</span></div>
        <table class="fields-table">
          ${bodyFields.map((f, i) => `
            <tr class="${i % 2 === 0 ? "row-a" : "row-b"}">
              <td class="fkey">${f.key}</td>
              <td class="fval">${formatValue(f.key, f.value) || "—"}</td>
            </tr>
          `).join("")}
        </table>
      </section>`;

    // ── Processo item structured parser for PDF ────────────────────────────────
    const PRO_PREFIXES_PDF = ["Dados Processo","Assuntos","Classes","Partes","Movimentos","Tramitacoes","Representantes"];
    const PRO_LABELS_PDF: Record<string,string> = {
      "Dados Processo":"Dados do Processo","Assuntos":"Assuntos","Classes":"Classes",
      "Partes":"Partes","Movimentos":"Movimentos","Tramitacoes":"Tramitações","Representantes":"Representantes",
    };
    const getProPrefixPdf = (k: string) => PRO_PREFIXES_PDF.find(p => k.startsWith(p)) ?? "Geral";

    const renderProcessoItemHtml = (item: string, idx: number, total: number): string => {
      const pairs = item.split(" · ").map(p => {
        const ci = p.indexOf(": ");
        return ci === -1 ? { k: p.trim(), v: "" } : { k: p.slice(0, ci).trim(), v: p.slice(ci + 2).trim() };
      }).filter(p => p.k);
      const groups = new Map<string, Array<{sub: string; v: string}>>();
      const order: string[] = [];
      for (const { k, v } of pairs) {
        const pre = getProPrefixPdf(k);
        if (!groups.has(pre)) { groups.set(pre, []); order.push(pre); }
        groups.get(pre)!.push({ sub: k.replace(new RegExp(`^${pre}\\s*`), "").trim() || k, v });
      }
      let html = `<div class="processo-rec">`;
      if (total > 1) html += `<div class="rec-num">Registro ${idx + 1} de ${total}</div>`;
      for (const pre of order) {
        const entries = groups.get(pre)!;
        const label = PRO_LABELS_PDF[pre] || pre;
        const isRepeat = ["Partes","Movimentos","Representantes"].includes(pre);
        html += `<div class="pro-group"><div class="pro-group-hdr">${label}</div>`;
        if (isRepeat) {
          const subRecs: Array<Array<{sub: string; v: string}>> = [[]];
          const seen = new Set<string>();
          for (const e of entries) {
            if (seen.has(e.sub)) { subRecs.push([]); seen.clear(); }
            seen.add(e.sub); subRecs[subRecs.length - 1].push(e);
          }
          subRecs.forEach((sr, ri) => {
            if (subRecs.length > 1) html += `<div class="sub-rec-sep">${pre.replace(/s$/, "")} ${ri + 1}</div>`;
            html += `<table class="pro-tbl">${sr.map(({ sub, v }) => `<tr><td class="ptk">${sub}</td><td class="ptv">${v || "—"}</td></tr>`).join("")}</table>`;
          });
        } else {
          html += `<table class="pro-tbl">${entries.map(({ sub, v }) => `<tr><td class="ptk">${sub}</td><td class="ptv">${v || "—"}</td></tr>`).join("")}</table>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
      return html;
    };

    // Sections rendered with appropriate styling
    const sectionsHtml = parsed.sections.map(s => {
      const isLegalSec = /processo|mandado|crime|judicial|prisão|pena|delito/i.test(s.name);
      const isCheque   = /cheque|fundos/i.test(s.name);
      const isDivida   = /dívida|debito|fgts|bacen/i.test(s.name);
      const isBem      = /\bbem\b|\bimóvel\b|\bimóv|terreno|veículo registr/i.test(s.name);
      const secClass = isLegalSec ? "sec-legal" : isCheque ? "sec-cheque" : isDivida ? "sec-divida" : isBem ? "sec-bem" : "sec-normal";
      const isStructured = isLegalSec && s.items.length > 0 && s.items[0].includes(" · ");
      const itemsHtml = isStructured
        ? s.items.map((it, i) => renderProcessoItemHtml(it, i, s.items.length)).join("")
        : s.items.map(it => `<div class="sec-item">${it}</div>`).join("");
      return `
        <section class="card sec-card ${secClass}">
          <div class="card-header">
            <span class="sec-hdr-name">${s.name}</span>
            <span class="badge">${s.items.length}</span>
          </div>
          <div class="sec-items${isStructured ? " sec-structured" : ""}">
            ${itemsHtml}
          </div>
        </section>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Hydra · ${moduleTitle} · ${query}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",Arial,sans-serif;background:#f8fafc;color:#0f172a;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* Cover band */
.cover{background:linear-gradient(135deg,${theme.dark} 0%,${theme.primary} 100%);color:#fff;padding:28px 36px 24px;display:flex;justify-content:space-between;align-items:flex-start}
.cover-left{}
.cover-logo-wrap{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.cover-logo-img{width:34px;height:34px;object-fit:contain;filter:brightness(10) saturate(0);opacity:.85}
.cover-logo-text{font-size:10px;font-weight:700;letter-spacing:.45em;text-transform:uppercase;opacity:.75}
.cover-title{font-size:22px;font-weight:900;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px}
.cover-subtitle{font-size:11px;opacity:.65;letter-spacing:1px}
.cover-right{text-align:right;font-size:11px;line-height:2;opacity:.85}
.cover-right strong{opacity:1;font-weight:700}
.cover-type{display:inline-block;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:20px;padding:2px 12px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}

/* Accent stripe */
.stripe{height:4px;background:linear-gradient(to right,${theme.accent},${theme.mid},transparent)}

/* Main body */
.body{padding:24px 36px;max-width:100%}

/* Photo block */
.photo-block{display:flex;align-items:center;gap:20px;background:${theme.light};border:1px solid ${theme.border};border-radius:10px;padding:16px;margin-bottom:18px;border-left:4px solid ${theme.accent}}
.photo-block img{width:96px;height:120px;object-fit:cover;border-radius:6px;border:2px solid ${theme.primary};flex-shrink:0}
.photo-meta .label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${theme.primary};margin-bottom:4px}
.photo-meta .query-val{font-size:16px;font-weight:900;color:#0f172a}
.photo-meta .tipo-val{font-size:11px;color:#64748b;margin-top:3px}

/* Cards */
.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.card-header{display:flex;align-items:center;gap:8px;padding:10px 14px;background:${theme.light};border-bottom:1px solid ${theme.border};font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:${theme.primary}}
.card-icon{font-size:13px}
.badge{margin-left:auto;background:${theme.primary};color:#fff;border-radius:20px;padding:1px 9px;font-size:10px;font-weight:700;letter-spacing:.5px}

/* Fields table */
.fields-table{width:100%;border-collapse:collapse}
.fields-table td{padding:7px 14px;vertical-align:top;border-bottom:1px solid #f1f5f9;font-size:12.5px}
.fkey{font-weight:700;color:${theme.primary};text-transform:uppercase;font-size:10.5px;letter-spacing:.8px;width:35%;white-space:normal;padding-right:8px}
.fval{color:#0f172a;word-break:break-word}
.row-a{background:#fff}
.row-b{background:#f8fafc}

/* Section cards */
.sec-card .card-header{background:${theme.light}}
.sec-hdr-name{flex:1}
.sec-legal .card-header{background:#eff6ff;color:#1e40af;border-color:#bfdbfe}
.sec-legal .badge{background:#1d4ed8}
.sec-cheque .card-header{background:#fffbeb;color:#92400e;border-color:#fde68a}
.sec-cheque .badge{background:#d97706}
.sec-divida .card-header{background:#fff7ed;color:#c2410c;border-color:#fed7aa}
.sec-divida .badge{background:#ea580c}
.sec-bem .card-header{background:#f0fdf4;color:#166534;border-color:#bbf7d0}
.sec-bem .badge{background:#16a34a}
.sec-items{padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.sec-items.sec-structured{padding:0}
.sec-item{font-size:12px;font-family:"Courier New",monospace;background:#f8fafc;border-left:3px solid ${theme.border};padding:6px 10px;border-radius:3px;word-break:break-word;line-height:1.5}
.sec-legal .sec-item{background:#eff6ff;border-left-color:#93c5fd}
.sec-cheque .sec-item{background:#fffbeb;border-left-color:#fcd34d}
.sec-divida .sec-item{background:#fff7ed;border-left-color:#fdba74}
.sec-bem .sec-item{background:#f0fdf4;border-left-color:#86efac}

/* Processo structured records */
.processo-rec{border-bottom:2px solid #e2e8f0}
.processo-rec:last-child{border-bottom:none}
.rec-num{background:#1d4ed8;color:#fff;padding:6px 14px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}
.pro-group{border-top:1px solid #e2e8f0}
.pro-group-hdr{background:#eff6ff;color:#1e40af;padding:5px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #bfdbfe}
.pro-tbl{width:100%;border-collapse:collapse}
.pro-tbl tr{border-bottom:1px solid #f1f5f9}
.pro-tbl tr:last-child{border-bottom:none}
.ptk{padding:5px 10px 5px 14px;font-weight:600;color:#1e40af;font-size:10.5px;width:36%;white-space:normal;vertical-align:top}
.ptv{padding:5px 14px 5px 8px;color:#0f172a;font-size:11.5px;word-break:break-word;vertical-align:top}
.sub-rec-sep{background:#dbeafe;color:#1e3a8a;padding:4px 14px;font-size:10px;font-weight:600;border-top:1px solid #bfdbfe}

/* Footer */
.footer{margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px}
.footer strong{color:#64748b}

@media print{
  body{background:#fff}
  .cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .stripe{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .card-header{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>

<div class="cover">
  <div class="cover-left">
    <div class="cover-logo-wrap">
      <img src="/hydra-icon.png" class="cover-logo-img" onerror="this.style.display='none'" />
      <span class="cover-logo-text">Hydra Consultoria — Sistema OSINT</span>
    </div>
    <div class="cover-title">${moduleTitle}</div>
    <div class="cover-subtitle">Relatório de Inteligência Digital · Confidencial</div>
  </div>
  <div class="cover-right">
    <div class="cover-type">${theme.tag}</div><br>
    <div><strong>Consulta:</strong> ${query || "—"}</div>
    <div><strong>Data:</strong> ${date}</div>
    <div><strong>Protocolo:</strong> ${protocol}</div>
    <div><strong>Campos:</strong> ${bodyFields.length} &nbsp;·&nbsp; <strong>Listas:</strong> ${parsed.sections.length}</div>
  </div>
</div>
<div class="stripe"></div>

<div class="body">

${fotoField ? `
<div class="photo-block">
  <img src="${fotoField.value}" alt="Foto" onerror="this.style.display='none'" />
  <div class="photo-meta">
    <div class="label">Foto Biométrica Encontrada</div>
    <div class="query-val">${query || "—"}</div>
    <div class="tipo-val">Módulo: ${tipo.toUpperCase()} · Gerado em ${date}</div>
  </div>
</div>` : ""}

${fieldsHtml}
${sectionsHtml}

<div class="footer">
  <span>Hydra Consultoria · ${date} · ${protocol}</span>
  <span>Documento confidencial — uso restrito</span>
</div>

</div>

<script>setTimeout(()=>window.print(),400)</script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=960,height=780");
    if (win) { win.document.write(html); win.document.close(); }
  };

  // ── No result ──────────────────────────────────────────────────────────────
  const hasUsefulData = displayFields.length > 0 || parsed.sections.length > 0;
  const hasMeaningfulRaw = !!parsed.raw && parsed.raw !== "{}" && parsed.raw.length > 5;
  const showNoResult = !result.success && !hasUsefulData && !hasMeaningfulRaw;
  const showSuccessEmpty = result.success && !hasUsefulData && !hasMeaningfulRaw;

  if (showNoResult || showSuccessEmpty) {
    const isKnownEmpty = showSuccessEmpty;
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className={`mt-6 rounded-2xl border p-5 sm:p-6 ${isKnownEmpty ? "border-slate-400/20" : "border-amber-400/25"}`}
        style={{ background: isKnownEmpty ? "color-mix(in srgb, #64748b 6%, transparent)" : "color-mix(in srgb, #fbbf24 6%, transparent)", backdropFilter: "blur(20px)" }}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isKnownEmpty ? "bg-slate-400/15 border border-slate-400/30" : "bg-amber-400/15 border border-amber-400/30"}`}>
            <AlertTriangle className={`w-5 h-5 ${isKnownEmpty ? "text-slate-300" : "text-amber-300"}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-bold uppercase tracking-widest ${isKnownEmpty ? "text-slate-200" : "text-amber-200"}`}>
              {isKnownEmpty ? "Nenhum registro encontrado" : "Sem resultado"}
            </div>
            <p className={`text-xs mt-1.5 leading-relaxed ${isKnownEmpty ? "text-slate-300/70" : "text-amber-100/70"}`}>
              {isKnownEmpty
                ? "A consulta foi processada, mas não há dados cadastrados para este registro no provedor."
                : (result.error ?? "O provedor não retornou dados para esta consulta.")}
            </p>
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
          <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto scrollbar-none shrink-0">
            <span className="text-[9px] text-muted-foreground/50 hidden md:inline shrink-0">
              {queriedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <div className="w-px h-3 bg-white/10 shrink-0 hidden md:block" />
            <FavoriteButton tipo={tipo} query={query} data={result.data} />
            <SaveToDossieButton tipo={tipo} query={query} data={result.data} />
            <div className="w-px h-3 bg-white/10 shrink-0" />
            <button onClick={downloadTxt} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <Download className="w-3 h-3" /> TXT
            </button>
            <button onClick={downloadPdf} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-blue-400 transition-colors shrink-0">
              <FileText className="w-3 h-3" /> PDF
            </button>
            <CopyButton text={exportText} label="Copiar" />
            <ShareButton tipo={tipo} query={query} data={result.data} />
            <div className="w-px h-3 bg-white/10 shrink-0" />
            <button onClick={() => setCompact(v => !v)}
              className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest transition-colors shrink-0 ${compact ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
              title={compact ? "Modo detalhado" : "Modo compacto"}>
              {compact ? <Rows3 className="w-3 h-3" /> : <LayoutGrid className="w-3 h-3" />}
              <span className="hidden sm:inline">{compact ? "Detalhado" : "Compacto"}</span>
            </button>
            <div className="w-px h-3 bg-white/10 shrink-0" />
            <button onClick={() => setShowRaw(v => !v)}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0">
              {showRaw ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              <span className="hidden sm:inline">{showRaw ? "Ocultar" : "Bruto"}</span>
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
        <span className="text-[9px] uppercase tracking-[0.6em] text-muted-foreground/30">Hydra Consultoria</span>
        <Zap className="w-2.5 h-2.5 opacity-30" style={{ color: "var(--color-primary)" }} />
      </div>
    </motion.div>
  );
}
