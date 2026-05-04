import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, AlertTriangle, CheckCircle2, History, FileText,
  IdCard, Building2, Phone, User, CreditCard, Heart,
  MapPin, Car, Users, Briefcase, Mail, Cog, Skull, ScrollText,
  Wallet, Cpu, Network, Syringe, Database, Activity, ShieldCheck,
  ChevronRight, X, RotateCcw, Eye, Camera, Fingerprint,
  BarChart2, Receipt, Gift, AlertOctagon, Landmark,
  FileSearch, Scale, Home, Star, Award,
} from "lucide-react";
import { ResultViewer } from "@/components/consultas/ResultViewer";
import { InfinityLoader } from "@/components/ui/InfinityLoader";

type Tipo =
  | "nome" | "cpf" | "cpfbasico" | "pix" | "nis" | "cns" | "placa" | "chassi" | "telefone"
  | "mae" | "pai" | "parentes" | "cep" | "frota" | "cnpj" | "fucionarios"
  | "socios" | "empregos" | "cnh" | "cnhfull" | "renavam" | "obito" | "rg" | "email"
  | "motor" | "vacinas" | "foto" | "biometria"
  | "titulo" | "score" | "irpf" | "beneficios" | "mandado"
  | "dividas" | "bens" | "processos" | "spc" | "iptu" | "certidoes";

type TabDef = {
  id: Tipo;
  label: string;
  category: "Pessoa" | "Fotos" | "Veículo" | "Empresa" | "Saúde" | "Outros";
  placeholder: string;
  hint: string;
  inputMode?: "numeric" | "text";
  icon: React.ComponentType<{ className?: string }>;
  sanitize?: (s: string) => string;
};

const cpf11 = (s: string) => s.replace(/\D/g, "").slice(0, 11);
const cnpj14 = (s: string) => s.replace(/\D/g, "").slice(0, 14);

const TABS: TabDef[] = [
  // ── Pessoa ───────────────────────────────────────────────────────────────
  { id: "cpf",       label: "CPF",        category: "Pessoa",  placeholder: "00000000000",      hint: "11 dígitos",                    inputMode: "numeric", icon: IdCard,       sanitize: cpf11 },
  { id: "cpfbasico", label: "CPF Básico", category: "Pessoa",  placeholder: "00000000000",      hint: "11 dígitos · Skylers",          inputMode: "numeric", icon: FileText,     sanitize: cpf11 },
  { id: "nome",      label: "Nome",       category: "Pessoa",  placeholder: "Nome completo",    hint: "texto livre",                   icon: User,           sanitize: (s) => s.slice(0, 80) },
  { id: "rg",        label: "RG",         category: "Pessoa",  placeholder: "RG ou identidade", hint: "texto/numérico",                icon: ScrollText },
  { id: "mae",       label: "Mãe",        category: "Pessoa",  placeholder: "CPF do filho(a)",  hint: "11 dígitos — busca pela mãe",   inputMode: "numeric", icon: Heart,        sanitize: cpf11 },
  { id: "pai",       label: "Pai",        category: "Pessoa",  placeholder: "CPF do filho(a)",  hint: "11 dígitos — busca pelo pai",   inputMode: "numeric", icon: Heart,        sanitize: cpf11 },
  { id: "parentes",  label: "Parentes",   category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos — rede familiar",    inputMode: "numeric", icon: Users,        sanitize: cpf11 },
  { id: "obito",     label: "Óbito",      category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos",                    inputMode: "numeric", icon: Skull,        sanitize: cpf11 },
  { id: "foto",      label: "Foto CNH",   category: "Fotos",   placeholder: "CPF",              hint: "11 dígitos · foto da CNH · Skylers",       inputMode: "numeric", icon: Camera,       sanitize: cpf11 },
  { id: "biometria", label: "Biometria",  category: "Fotos",   placeholder: "CPF",              hint: "11 dígitos · foto nacional/biometria · Skylers", inputMode: "numeric", icon: Fingerprint,  sanitize: cpf11 },
  { id: "titulo",    label: "Título",     category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos · título de eleitor · Skylers", inputMode: "numeric", icon: Award, sanitize: cpf11 },
  { id: "score",     label: "Score",      category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos · score de crédito · Skylers",  inputMode: "numeric", icon: BarChart2, sanitize: cpf11 },
  { id: "irpf",      label: "IRPF",       category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos · declaração IR · Skylers",     inputMode: "numeric", icon: Receipt,   sanitize: cpf11 },
  { id: "beneficios",label: "Benefícios", category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos · Bolsa Família/BPC · Skylers", inputMode: "numeric", icon: Gift,      sanitize: cpf11 },
  { id: "mandado",   label: "Mandado",    category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos · mandado de prisão · Skylers", inputMode: "numeric", icon: AlertOctagon, sanitize: cpf11 },
  { id: "dividas",   label: "Dívidas",    category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos · BACEN/FGTS · Skylers",        inputMode: "numeric", icon: Landmark,  sanitize: cpf11 },
  { id: "processos", label: "Processos",  category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos · processos judiciais · Skylers",inputMode: "numeric", icon: Scale,     sanitize: cpf11 },
  { id: "certidoes", label: "Certidões",  category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos · Skylers",          inputMode: "numeric", icon: FileSearch,   sanitize: cpf11 },
  { id: "spc",       label: "SPC",        category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos · dados de crédito · Skylers",  inputMode: "numeric", icon: CreditCard, sanitize: cpf11 },
  { id: "bens",      label: "Bens",       category: "Pessoa",  placeholder: "CPF",              hint: "11 dígitos · patrimônio · Skylers",         inputMode: "numeric", icon: Star,      sanitize: cpf11 },
  // ── Veículo ──────────────────────────────────────────────────────────────
  { id: "placa",     label: "Placa",      category: "Veículo", placeholder: "ABC1234",          hint: "Mercosul ou antiga",            icon: Car,            sanitize: (s) => s.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8) },
  { id: "chassi",    label: "Chassi",     category: "Veículo", placeholder: "9BWZZZ...",        hint: "VIN 17 caracteres",             icon: Cog,            sanitize: (s) => s.toUpperCase().slice(0, 17) },
  { id: "renavam",   label: "Renavam",    category: "Veículo", placeholder: "00000000000",      hint: "11 dígitos",                    inputMode: "numeric", icon: ScrollText,   sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "motor",     label: "Motor",      category: "Veículo", placeholder: "Nº do motor",      hint: "alfanumérico",                  icon: Cpu },
  { id: "cnh",       label: "CNH",        category: "Veículo", placeholder: "CPF do condutor",  hint: "11 dígitos",                    inputMode: "numeric", icon: IdCard,       sanitize: cpf11 },
  { id: "cnhfull",   label: "CNH Full",   category: "Veículo", placeholder: "CPF do condutor",  hint: "11 dígitos · dados completos CNH · Skylers", inputMode: "numeric", icon: ShieldCheck, sanitize: cpf11 },
  { id: "frota",     label: "Frota",      category: "Veículo", placeholder: "CPF/CNPJ",         hint: "frota do titular",              icon: Network,        sanitize: (s) => s.replace(/\D/g, "").slice(0, 14) },
  // ── Empresa ──────────────────────────────────────────────────────────────
  { id: "cnpj",      label: "CNPJ",       category: "Empresa", placeholder: "00000000000000",   hint: "14 dígitos",                    inputMode: "numeric", icon: Building2,    sanitize: cnpj14 },
  { id: "socios",    label: "Sócios",     category: "Empresa", placeholder: "CNPJ",             hint: "14 dígitos",                    inputMode: "numeric", icon: Users,        sanitize: cnpj14 },
  { id: "fucionarios",label: "Funcionários",category: "Empresa",placeholder: "CNPJ",            hint: "14 dígitos",                    inputMode: "numeric", icon: Users,        sanitize: cnpj14 },
  { id: "empregos",  label: "Empregos",   category: "Empresa", placeholder: "CPF",              hint: "histórico do CPF",              inputMode: "numeric", icon: Briefcase,    sanitize: cpf11 },
  // ── Saúde ────────────────────────────────────────────────────────────────
  { id: "nis",       label: "NIS",        category: "Saúde",   placeholder: "NIS/PIS",          hint: "11 dígitos",                    inputMode: "numeric", icon: CreditCard,   sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "cns",       label: "CNS",        category: "Saúde",   placeholder: "Cartão SUS",       hint: "15 dígitos",                    inputMode: "numeric", icon: Heart,        sanitize: (s) => s.replace(/\D/g, "").slice(0, 15) },
  { id: "vacinas",   label: "Vacinas",    category: "Saúde",   placeholder: "CPF",              hint: "11 dígitos",                    inputMode: "numeric", icon: Syringe,      sanitize: cpf11 },
  // ── Outros ───────────────────────────────────────────────────────────────
  { id: "telefone",  label: "Telefone",   category: "Outros",  placeholder: "5511999999999",    hint: "DDI + DDD + número",            inputMode: "numeric", icon: Phone,        sanitize: (s) => s.replace(/\D/g, "").slice(0, 13) },
  { id: "email",     label: "Email",      category: "Outros",  placeholder: "exemplo@dominio.com", hint: "texto livre",               icon: Mail },
  { id: "pix",       label: "PIX",        category: "Outros",  placeholder: "Chave PIX",        hint: "CPF/email/telefone/aleatória",  icon: Wallet },
  { id: "cep",       label: "CEP",        category: "Outros",  placeholder: "00000000",         hint: "8 dígitos",                     inputMode: "numeric", icon: MapPin,       sanitize: (s) => s.replace(/\D/g, "").slice(0, 8) },
  { id: "iptu",      label: "IPTU",       category: "Outros",  placeholder: "CPF",              hint: "11 dígitos · Skylers",          inputMode: "numeric", icon: Home,         sanitize: cpf11 },
];

const CATEGORIES = ["Pessoa", "Fotos", "Veículo", "Empresa", "Saúde", "Outros"] as const;

const CATEGORY_GRADIENT: Record<string, string> = {
  Pessoa:  "from-rose-400 to-pink-300",
  Fotos:   "from-purple-400 to-indigo-300",
  Veículo: "from-amber-400 to-orange-300",
  Empresa: "from-violet-400 to-fuchsia-300",
  Saúde:   "from-emerald-400 to-teal-300",
  Outros:  "from-sky-400 to-cyan-300",
};

type Historico = Array<{ id: number; tipo: string; query: string; username: string; success: boolean; result: unknown | null; createdAt: string }>;

// Tipos disponíveis em ambas as bases (Infinity/Geass e Skylers) → mostra seletor
const PANEL_EXTERNAL_TIPOS = new Set([
  "cpf", "nome", "rg", "mae", "pai", "parentes", "obito", "nis", "cns", "vacinas",
  "telefone", "email", "pix", "cep", "placa", "chassi", "renavam", "motor", "cnh",
  "frota", "cnpj", "fucionarios", "socios", "empregos",
]);
// Tipos exclusivos do Skylers → vai direto sem seletor
const SKYLERS_ONLY_TIPOS = new Set([
  "cpfbasico", "titulo", "score", "irpf", "beneficios", "mandado",
  "dividas", "bens", "processos", "spc", "iptu", "certidoes", "cnhfull", "foto", "biometria",
]);
type ExternalBase = "skylers" | "credilink";
// Tipos que também têm base CrediLink (Skylers)
const CREDILINK_BASES = new Set<Tipo>(["cpf"]);

export default function Consultas() {
  const [tab, setTab] = useState<Tipo>("cpf");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ success: boolean; error?: string | null; data?: unknown } | null>(null);
  const [pending, setPending] = useState(false);
  const [activeCategory, setActiveCategory] = useState<typeof CATEGORIES[number]>("Pessoa");
  const [showBaseSelector, setShowBaseSelector] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<{ tipo: Tipo; dados: string } | null>(null);
  const queryClient = useQueryClient();

  const historyKey = ["infinity-history", 20] as const;
  const { data: history } = useQuery<Historico>({
    queryKey: historyKey,
    queryFn: async () => {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/consultas?limit=20", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const activeTab = useMemo(() => TABS.find((t) => t.id === tab)!, [tab]);
  const ActiveIcon = activeTab.icon;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || pending) return;
    if (SKYLERS_ONLY_TIPOS.has(tab)) {
      // Goes directly to Skylers — no base selector needed
      await executeQuery(tab, query.trim(), "skylers");
      return;
    }
    if (PANEL_EXTERNAL_TIPOS.has(tab)) {
      setPendingQuery({ tipo: tab, dados: query.trim() });
      setShowBaseSelector(true);
      return;
    }
    await executeQuery(tab, query.trim(), null);
  };

  const executeQuery = async (tipo: Tipo, dados: string, base: ExternalBase | null) => {
    setResult(null);
    setPending(true);
    setShowBaseSelector(false);
    setPendingQuery(null);
    try {
      const token = localStorage.getItem("infinity_token");
      let endpoint: string;
      let body: Record<string, string>;

      if (base === "credilink") {
        // CrediLink: usa o external/skylers com tipo=credilink
        endpoint = "/api/infinity/external/skylers";
        body = { tipo: "credilink", dados };
      } else if (base) {
        endpoint = `/api/infinity/external/${base}`;
        body = { tipo, dados };
      } else {
        endpoint = `/api/infinity/consultas/${tipo}`;
        body = { tipo, dados };
      }

      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await r.json() as { success: boolean; error?: string | null; data?: unknown; rateLimited?: boolean };
      if (data.rateLimited) {
        setResult({ success: false, error: data.error ?? "Limite diário atingido." });
      } else if (base && data.success && typeof data.data === "string") {
        setResult({ success: true, data: { fields: [], sections: [], raw: data.data } });
      } else {
        setResult(data);
      }
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : "Falha na requisição", data: { fields: [], sections: [], raw: "" } });
    } finally {
      setPending(false);
      queryClient.invalidateQueries({ queryKey: historyKey });
    }
  };

  // "Repetir consulta" — repopulates tab + query and executes directly
  const repeatQuery = (tipo: string, dados: string) => {
    const tabDef = TABS.find((t) => t.id === tipo);
    if (!tabDef) return;
    const cat = tabDef.category;
    setActiveCategory(cat);
    setTab(tabDef.id);
    setQuery(dados);
    setResult(null);
    // Route Skylers-only tipos correctly, others go to Geass
    const base: ExternalBase | null = SKYLERS_ONLY_TIPOS.has(tabDef.id) ? "skylers" : null;
    executeQuery(tabDef.id, dados, base);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // "Ver resultado salvo" — loads stored result without a new API call
  // DB stores only the parsed data { fields, sections, raw }; reconstruct the result wrapper
  const loadSavedResult = (item: Historico[number]) => {
    if (!item.result) return;
    setResult({ success: item.success, error: null, data: item.result });
    const tabDef = TABS.find((t) => t.id === item.tipo);
    if (tabDef) { setActiveCategory(tabDef.category); setTab(tabDef.id); }
    setQuery(item.query);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const tabsInCategory = TABS.filter((t) => t.category === activeCategory);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-gradient-to-r from-sky-300 to-cyan-200 bg-clip-text text-transparent"
          >
            Consultas
          </motion.h1>
          <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
            39 módulos · Geass + Skylers API (80+ endpoints) conectados
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-400/10 border border-emerald-400/30">
          <div className="relative">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
          </div>
          <span className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">Online</span>
        </div>
      </div>

      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 px-4 py-2 rounded-full text-[10px] uppercase tracking-[0.3em] font-bold transition-all border ${
                isActive
                  ? `bg-gradient-to-r ${CATEGORY_GRADIENT[cat]} text-black border-transparent shadow-[0_0_24px_-4px_rgba(56,189,248,0.5)]`
                  : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20"
              }`}
            >
              {cat} <span className="opacity-60">· {TABS.filter((t) => t.category === cat).length}</span>
            </button>
          );
        })}
      </div>

      {/* Tab grid */}
      <motion.div
        key={activeCategory}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2"
      >
        {tabsInCategory.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setQuery(""); setResult(null); }}
              className={`relative group flex flex-col items-center gap-1.5 p-3 sm:p-4 rounded-xl border transition-all ${
                isActive
                  ? "bg-primary/15 border-primary/50 shadow-[0_0_20px_-4px_rgba(56,189,248,0.6)]"
                  : "bg-black/20 border-white/5 hover:border-white/15 hover:bg-white/5"
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"} transition-colors`} />
              <span className={`text-[10px] uppercase tracking-widest font-bold ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
                {t.label}
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* Query form + result */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.4em] text-primary/70">
            <ActiveIcon className="w-3.5 h-3.5" />
            {activeTab.label} · {activeTab.hint}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <input
                value={query}
                onChange={(e) => setQuery(activeTab.sanitize ? activeTab.sanitize(e.target.value) : e.target.value)}
                placeholder={activeTab.placeholder}
                inputMode={activeTab.inputMode}
                className="w-full bg-black/40 border border-white/10 rounded-xl pl-12 pr-4 py-3.5 sm:py-4 font-mono tracking-wider text-base sm:text-lg focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={!query.trim() || pending}
              className="bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold uppercase tracking-[0.3em] text-xs px-6 sm:px-8 py-3.5 sm:py-0 rounded-xl hover:shadow-[0_0_30px_rgba(56,189,248,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {pending ? "Consultando" : "Consultar"}
            </button>
          </div>
        </form>

        <AnimatePresence mode="wait">
          {showBaseSelector && pendingQuery && !pending && (
            <motion.div
              key="base-selector"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="mt-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.5em] text-muted-foreground/50 mb-1">Origem dos dados</p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-foreground/90 bg-white/5 border border-white/10 px-2.5 py-0.5 rounded-md">{pendingQuery.dados}</span>
                    <span className="text-[10px] text-muted-foreground">— selecione a base</span>
                  </div>
                </div>
                <button
                  onClick={() => { setShowBaseSelector(false); setPendingQuery(null); }}
                  className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-white/5 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className={`grid gap-3 ${CREDILINK_BASES.has(pendingQuery.tipo) ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
                <motion.button
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => executeQuery(pendingQuery.tipo, pendingQuery.dados, null)}
                  className="group relative flex flex-col gap-3 p-4 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] to-transparent hover:border-primary/40 hover:from-primary/[0.12] transition-all duration-200 text-left overflow-hidden"
                >
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-xl bg-primary/15 border border-primary/25 group-hover:bg-primary/20 transition-colors">
                      <Database className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                      <Activity className="w-2.5 h-2.5 text-emerald-400" />
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400 font-semibold">Online</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-primary group-hover:text-sky-200 transition-colors">Infinity Search</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">OSINT completo via Geass API · recomendado</p>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-primary/50 group-hover:text-primary transition-colors">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Fonte principal</span>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => executeQuery(pendingQuery.tipo, pendingQuery.dados, "skylers")}
                  className="group relative flex flex-col gap-3 p-4 rounded-2xl border border-white/8 bg-gradient-to-br from-white/[0.04] to-transparent hover:border-sky-400/30 hover:from-sky-500/[0.07] transition-all duration-200 text-left overflow-hidden"
                >
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 group-hover:bg-sky-500/15 transition-colors">
                      <Network className="w-4 h-4 text-sky-400" />
                    </div>
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                      <Activity className="w-2.5 h-2.5 text-emerald-400" />
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400 font-semibold">Online</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-sky-300 group-hover:text-white transition-colors">Skylers API</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">Provedor avançado · 90+ módulos OSINT</p>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-sky-400/50 group-hover:text-sky-400 transition-colors">
                    <ChevronRight className="w-3 h-3" />
                    <span>Fonte alternativa</span>
                  </div>
                </motion.button>

                {CREDILINK_BASES.has(pendingQuery.tipo) && (
                  <motion.button
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => executeQuery(pendingQuery.tipo, pendingQuery.dados, "credilink")}
                    className="group relative flex flex-col gap-3 p-4 rounded-2xl border border-white/8 bg-gradient-to-br from-white/[0.04] to-transparent hover:border-blue-400/30 hover:from-blue-500/[0.07] transition-all duration-200 text-left overflow-hidden"
                  >
                    <div className="flex items-start justify-between">
                      <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 group-hover:bg-blue-500/15 transition-colors">
                        <CreditCard className="w-4 h-4 text-blue-400" />
                      </div>
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <Activity className="w-2.5 h-2.5 text-emerald-400" />
                        <span className="text-[8px] uppercase tracking-wider text-emerald-400 font-semibold">Online</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-blue-300 group-hover:text-white transition-colors">CrediLink</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">CPF via CrediLink · Skylers · dados financeiros</p>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-blue-400/50 group-hover:text-blue-400 transition-colors">
                      <ChevronRight className="w-3 h-3" />
                      <span>Fonte financeira</span>
                    </div>
                  </motion.button>
                )}

              </div>
            </motion.div>
          )}

          {pending && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-12 flex items-center justify-center"
            >
              <InfinityLoader size={72} label="Consultando fontes" />
            </motion.div>
          )}
          {!pending && !showBaseSelector && result && (
            <ResultViewer
              tipo={tab}
              query={query}
              result={result as { success: boolean; error?: string | null; data?: unknown }}
            />
          )}
        </AnimatePresence>
      </motion.div>

      {/* History */}
      <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.4em] text-muted-foreground">Histórico Recente</h2>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {history?.length ?? 0} registro(s)
          </span>
        </div>
        {!history || history.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm flex flex-col items-center gap-3">
            <FileText className="w-10 h-10 opacity-20" />
            Nenhuma consulta registrada ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.4) }}
                className="bg-black/30 border border-white/5 rounded-xl p-3 sm:p-4 flex items-center justify-between hover:border-primary/30 hover:bg-black/40 transition-all group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded-md shrink-0">
                    {item.tipo}
                  </span>
                  <span className="font-mono text-sm truncate">{item.query}</span>
                  <span className="text-xs text-muted-foreground truncate hidden md:inline">— {item.username}</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">
                    {new Date(item.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {item.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-300" />
                  )}
                  {!!item.result && item.success && (
                    <button
                      onClick={() => loadSavedResult(item)}
                      title="Ver resultado salvo"
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-all"
                    >
                      <Eye className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => repeatQuery(item.tipo, item.query)}
                    title="Repetir consulta"
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-[10px] uppercase tracking-[0.4em] text-muted-foreground">
          <span>Made by blxckxyz</span>
          <span className="text-primary/60">Infinity Search</span>
        </div>
      </div>
    </div>
  );
}
