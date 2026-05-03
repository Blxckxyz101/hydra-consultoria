import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  History,
  FileText,
  IdCard,
  Building2,
  Phone,
  Syringe,
  User,
  CreditCard,
  Heart,
  MapPin,
  Car,
  Users,
  Briefcase,
  Mail,
  Cog,
  Skull,
  ScrollText,
  Wallet,
  Cpu,
  Network,
} from "lucide-react";
import { ResultViewer } from "@/components/consultas/ResultViewer";
import { InfinityLoader } from "@/components/ui/InfinityLoader";

type Tipo =
  | "nome" | "cpf" | "pix" | "nis" | "cns" | "placa" | "chassi" | "telefone"
  | "mae" | "pai" | "parentes" | "cep" | "frota" | "cnpj" | "fucionarios"
  | "socios" | "empregos" | "cnh" | "renavam" | "obito" | "rg" | "email"
  | "motor" | "vacinas";

type TabDef = {
  id: Tipo;
  label: string;
  category: "Pessoa" | "Veículo" | "Empresa" | "Saúde" | "Outros";
  placeholder: string;
  hint: string;
  inputMode?: "numeric" | "text";
  icon: React.ComponentType<{ className?: string }>;
  sanitize?: (s: string) => string;
};

const TABS: TabDef[] = [
  // Pessoa
  { id: "cpf", label: "CPF", category: "Pessoa", placeholder: "00000000000", hint: "11 dígitos", inputMode: "numeric", icon: IdCard, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "nome", label: "Nome", category: "Pessoa", placeholder: "Nome completo", hint: "texto livre", icon: User, sanitize: (s) => s.slice(0, 80) },
  { id: "rg", label: "RG", category: "Pessoa", placeholder: "RG ou identidade", hint: "texto/numérico", icon: ScrollText },
  { id: "mae", label: "Mãe", category: "Pessoa", placeholder: "CPF do filho(a)", hint: "11 dígitos — busca pela mãe", inputMode: "numeric", icon: Heart, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "pai", label: "Pai", category: "Pessoa", placeholder: "CPF do filho(a)", hint: "11 dígitos — busca pelo pai", inputMode: "numeric", icon: Heart, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "parentes", label: "Parentes", category: "Pessoa", placeholder: "CPF", hint: "11 dígitos — rede familiar", inputMode: "numeric", icon: Users, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "obito", label: "Óbito", category: "Pessoa", placeholder: "CPF", hint: "11 dígitos", inputMode: "numeric", icon: Skull, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  // Contato
  { id: "telefone", label: "Telefone", category: "Outros", placeholder: "5511999999999", hint: "DDI + DDD + número", inputMode: "numeric", icon: Phone, sanitize: (s) => s.replace(/\D/g, "").slice(0, 13) },
  { id: "email", label: "Email", category: "Outros", placeholder: "exemplo@dominio.com", hint: "texto livre", icon: Mail },
  { id: "pix", label: "PIX", category: "Outros", placeholder: "Chave PIX", hint: "CPF/email/telefone/aleatória", icon: Wallet },
  { id: "cep", label: "CEP", category: "Outros", placeholder: "00000000", hint: "8 dígitos", inputMode: "numeric", icon: MapPin, sanitize: (s) => s.replace(/\D/g, "").slice(0, 8) },
  // Saúde / Social
  { id: "nis", label: "NIS", category: "Saúde", placeholder: "NIS/PIS", hint: "11 dígitos", inputMode: "numeric", icon: CreditCard, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "cns", label: "CNS", category: "Saúde", placeholder: "Cartão SUS", hint: "15 dígitos", inputMode: "numeric", icon: Heart, sanitize: (s) => s.replace(/\D/g, "").slice(0, 15) },
  { id: "vacinas", label: "Vacinas", category: "Saúde", placeholder: "CPF", hint: "11 dígitos", inputMode: "numeric", icon: Syringe, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  // Veículo
  { id: "placa", label: "Placa", category: "Veículo", placeholder: "ABC1234", hint: "Mercosul ou antiga", icon: Car, sanitize: (s) => s.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8) },
  { id: "chassi", label: "Chassi", category: "Veículo", placeholder: "9BWZZZ...", hint: "VIN 17 caracteres", icon: Cog, sanitize: (s) => s.toUpperCase().slice(0, 17) },
  { id: "renavam", label: "Renavam", category: "Veículo", placeholder: "00000000000", hint: "11 dígitos", inputMode: "numeric", icon: ScrollText, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "motor", label: "Motor", category: "Veículo", placeholder: "Nº do motor", hint: "alfanumérico", icon: Cpu },
  { id: "cnh", label: "CNH", category: "Veículo", placeholder: "CPF do condutor", hint: "11 dígitos", inputMode: "numeric", icon: IdCard, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "frota", label: "Frota", category: "Veículo", placeholder: "CPF/CNPJ", hint: "frota do titular", icon: Network, sanitize: (s) => s.replace(/\D/g, "").slice(0, 14) },
  // Empresa
  { id: "cnpj", label: "CNPJ", category: "Empresa", placeholder: "00000000000000", hint: "14 dígitos", inputMode: "numeric", icon: Building2, sanitize: (s) => s.replace(/\D/g, "").slice(0, 14) },
  { id: "socios", label: "Sócios", category: "Empresa", placeholder: "CNPJ", hint: "14 dígitos", inputMode: "numeric", icon: Users, sanitize: (s) => s.replace(/\D/g, "").slice(0, 14) },
  { id: "fucionarios", label: "Funcionários", category: "Empresa", placeholder: "CNPJ", hint: "14 dígitos", inputMode: "numeric", icon: Users, sanitize: (s) => s.replace(/\D/g, "").slice(0, 14) },
  { id: "empregos", label: "Empregos", category: "Empresa", placeholder: "CPF", hint: "histórico do CPF", inputMode: "numeric", icon: Briefcase, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
];

const CATEGORIES = ["Pessoa", "Veículo", "Empresa", "Saúde", "Outros"] as const;

const CATEGORY_GRADIENT: Record<string, string> = {
  Pessoa: "from-rose-400 to-pink-300",
  Veículo: "from-amber-400 to-orange-300",
  Empresa: "from-violet-400 to-fuchsia-300",
  Saúde: "from-emerald-400 to-teal-300",
  Outros: "from-sky-400 to-cyan-300",
};

type Historico = Array<{ id: number; tipo: string; query: string; username: string; success: boolean; createdAt: string }>;

export default function Consultas() {
  const [tab, setTab] = useState<Tipo>("cpf");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [activeCategory, setActiveCategory] = useState<typeof CATEGORIES[number]>("Pessoa");
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
    refetchInterval: 15_000,
  });

  const activeTab = useMemo(() => TABS.find((t) => t.id === tab)!, [tab]);
  const ActiveIcon = activeTab.icon;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || pending) return;
    setResult(null);
    setPending(true);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch(`/api/infinity/consultas/${tab}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dados: query.trim() }),
      });
      const data = await r.json();
      setResult(data);
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "Falha na requisição",
        data: { fields: [], sections: [], raw: "" },
      });
    } finally {
      setPending(false);
      queryClient.invalidateQueries({ queryKey: historyKey });
    }
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
            24 fontes operacionais · provedor Geass conectado
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

      {/* Tab grid for selected category */}
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
          {!pending && result && (
            <ResultViewer
              tipo={tab}
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
            <h2 className="text-xs font-semibold uppercase tracking-[0.4em] text-muted-foreground">
              Histórico Recente
            </h2>
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
                className="bg-black/30 border border-white/5 rounded-xl p-3 sm:p-4 flex items-center justify-between hover:border-primary/30 hover:bg-black/40 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded-md shrink-0">
                    {item.tipo}
                  </span>
                  <span className="font-mono text-sm truncate">{item.query}</span>
                  <span className="text-xs text-muted-foreground truncate hidden md:inline">— {item.username}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">
                    {new Date(item.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {item.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-300" />
                  )}
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
