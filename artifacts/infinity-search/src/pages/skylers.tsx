import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search, AlertTriangle, CheckCircle2, X, ChevronRight,
  IdCard, User, Phone, Mail, Wallet, MapPin, Car, ScrollText,
  Building2, Users, Briefcase, Heart, Skull, CreditCard,
  Cpu, Cog, FileText, Scale, Hash, Image, Zap, MessageCircle,
  ShieldCheck, Star, Activity, BarChart3, ClipboardList,
  Globe, Landmark, Receipt,
} from "lucide-react";
import { ResultViewer } from "@/components/consultas/ResultViewer";
import { InfinityLoader } from "@/components/ui/InfinityLoader";

type InputType = "cpf" | "cnpj" | "placa" | "text" | "tel" | "username" | "renavam" | "chassi" | "cep" | "id" | "email" | "oab" | "numero";

interface SkylersModule {
  key: string;
  label: string;
  category: SkylersCategory;
  input: InputType;
  hint: string;
  placeholder: string;
  icon: React.ComponentType<{ className?: string }>;
  endpoint?: "likes" | "telegram";
}

type SkylersCategory = "Fotos" | "Dados Pessoais" | "Veículos" | "Empresas" | "Processos" | "Especiais" | "Social";

const CATEGORIES: SkylersCategory[] = [
  "Dados Pessoais", "Veículos", "Fotos", "Empresas", "Processos", "Especiais", "Social",
];

const MODULES: SkylersModule[] = [
  // ── DADOS PESSOAIS ──────────────────────────────────────────────────────
  { key: "iseek-cpf", label: "CPF Completo", category: "Dados Pessoais", input: "cpf", hint: "11 dígitos", placeholder: "00000000000", icon: IdCard },
  { key: "iseek-cpfbasico", label: "CPF Básico", category: "Dados Pessoais", input: "cpf", hint: "11 dígitos", placeholder: "00000000000", icon: IdCard },
  { key: "iseek-dados---rg", label: "RG", category: "Dados Pessoais", input: "text", hint: "número do RG", placeholder: "000000000", icon: ScrollText },
  { key: "iseek-dados---nomeabreviadofriltros", label: "Nome", category: "Dados Pessoais", input: "text", hint: "nome completo", placeholder: "João Silva", icon: User },
  { key: "iseek-dados---mae", label: "Mãe", category: "Dados Pessoais", input: "cpf", hint: "CPF do filho(a)", placeholder: "00000000000", icon: Heart },
  { key: "iseek-dados---pai", label: "Pai", category: "Dados Pessoais", input: "cpf", hint: "CPF do filho(a)", placeholder: "00000000000", icon: Heart },
  { key: "iseek-dados---nasc", label: "Nascimento", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: IdCard },
  { key: "iseek-dados---nis", label: "NIS/PIS", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: CreditCard },
  { key: "iseek-dados---titulo", label: "Título Eleitor", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: ClipboardList },
  { key: "iseek-dados---email", label: "Email", category: "Dados Pessoais", input: "email", hint: "endereço de e-mail", placeholder: "exemplo@email.com", icon: Mail },
  { key: "iseek-dados---pix", label: "PIX", category: "Dados Pessoais", input: "text", hint: "chave PIX", placeholder: "CPF/email/telefone/aleatório", icon: Wallet },
  { key: "iseek-dados---telefone", label: "Telefone", category: "Dados Pessoais", input: "tel", hint: "DDD + número", placeholder: "11999999999", icon: Phone },
  { key: "iseek-dados---endereco", label: "Endereço", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: MapPin },
  { key: "iseek-dados---cep", label: "CEP", category: "Dados Pessoais", input: "cep", hint: "8 dígitos", placeholder: "00000000", icon: MapPin },
  { key: "iseek-dados---parentes", label: "Parentes", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Users },
  { key: "iseek-dados---dividas", label: "Dívidas", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Receipt },
  { key: "iseek-dados---bens", label: "Bens", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Landmark },
  { key: "iseek-dados---score", label: "Score 1", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: BarChart3 },
  { key: "iseek-dados---score2", label: "Score 2", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: BarChart3 },
  { key: "iseek-dados---obito", label: "Óbito", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Skull },
  { key: "iseek-dados---rais", label: "RAIS/Empregos", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Briefcase },
  { key: "iseek-dados---mandado", label: "Mandado", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: ShieldCheck },
  { key: "iseek-dados---beneficios", label: "Benefícios", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Star },
  { key: "iseek-dados---certidoes", label: "Certidões", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: FileText },
  { key: "iseek-dados---vacinas", label: "Vacinas", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Heart },
  { key: "iseek-dados---faculdades", label: "Faculdades", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Globe },
  { key: "iseek-dados---irpf", label: "IRPF", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Receipt },
  { key: "iseek-dados---assessoria", label: "Assessoria", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: FileText },
  { key: "iseek-dados---registro", label: "Registro", category: "Dados Pessoais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: ClipboardList },

  // ── VEÍCULOS ────────────────────────────────────────────────────────────
  { key: "iseek-dados---placa", label: "Placa", category: "Veículos", input: "placa", hint: "mercosul ou antiga", placeholder: "ABC1234", icon: Car },
  { key: "iseek-dados---renavam", label: "Renavam", category: "Veículos", input: "renavam", hint: "11 dígitos", placeholder: "00000000000", icon: ScrollText },
  { key: "iseek-dados---chassi", label: "Chassi", category: "Veículos", input: "chassi", hint: "VIN 17 caracteres", placeholder: "9BWZZZ...", icon: Cog },
  { key: "iseek-dados---motor", label: "Motor", category: "Veículos", input: "text", hint: "número do motor", placeholder: "N° do motor", icon: Cpu },
  { key: "iseek-dados---veiculos", label: "Veículos por CPF", category: "Veículos", input: "cpf", hint: "CPF do proprietário", placeholder: "00000000000", icon: Car },
  { key: "iseek-dados---fotodetran", label: "Foto Detran", category: "Veículos", input: "placa", hint: "placa do veículo", placeholder: "ABC1234", icon: Image },
  { key: "iseek-dados---crlvto", label: "CRLV TO", category: "Veículos", input: "placa", hint: "placa do veículo", placeholder: "ABC1234", icon: FileText },
  { key: "iseek-dados---crlvmt", label: "CRLV MT", category: "Veículos", input: "placa", hint: "placa do veículo", placeholder: "ABC1234", icon: FileText },
  { key: "iseek-dados---cnh", label: "CNH", category: "Veículos", input: "cpf", hint: "CPF do condutor", placeholder: "00000000000", icon: IdCard },
  { key: "iseek-dados---cnham", label: "CNH AM", category: "Veículos", input: "cpf", hint: "CPF do condutor", placeholder: "00000000000", icon: IdCard },
  { key: "iseek-dados---cnhnc", label: "CNH NC", category: "Veículos", input: "cpf", hint: "CPF do condutor", placeholder: "00000000000", icon: IdCard },
  { key: "iseek-dados---cnhrs", label: "CNH RS", category: "Veículos", input: "cpf", hint: "CPF do condutor", placeholder: "00000000000", icon: IdCard },
  { key: "iseek-dados---cnhrr", label: "CNH RR", category: "Veículos", input: "cpf", hint: "CPF do condutor", placeholder: "00000000000", icon: IdCard },
  { key: "placa-fipe", label: "Placa FIPE", category: "Veículos", input: "placa", hint: "placa do veículo", placeholder: "ABC1234", icon: Car },
  { key: "placa-serpro", label: "Placa Serpro", category: "Veículos", input: "placa", hint: "placa do veículo", placeholder: "ABC1234", icon: Car },
  { key: "vistoria", label: "Vistoria", category: "Veículos", input: "placa", hint: "placa do veículo", placeholder: "ABC1234", icon: ShieldCheck },

  // ── FOTOS ────────────────────────────────────────────────────────────────
  { key: "iseek-fotos---fotocnh", label: "Foto CNH", category: "Fotos", input: "cpf", hint: "CPF do condutor", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---crlvto", label: "CRLV TO (Foto)", category: "Fotos", input: "placa", hint: "placa do veículo", placeholder: "ABC1234", icon: Image },
  { key: "iseek-fotos---crlvmt", label: "CRLV MT (Foto)", category: "Fotos", input: "placa", hint: "placa do veículo", placeholder: "ABC1234", icon: Image },
  { key: "iseek-fotos---fotoma", label: "Foto MA", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotoce", label: "Foto CE", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotosp", label: "Foto SP", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotorj", label: "Foto RJ", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotoms", label: "Foto MS", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotonc", label: "Foto Nacional", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotoes", label: "Foto ES", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fototo", label: "Foto TO", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotoro", label: "Foto RO", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotomapresos", label: "Foto MA Presos", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotopi", label: "Foto PI", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotopr", label: "Foto PR", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotodf", label: "Foto DF", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotoal", label: "Foto AL", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotogo", label: "Foto GO", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotopb", label: "Foto PB", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotope", label: "Foto PE", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotorn", label: "Foto RN", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotoba", label: "Foto BA", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },
  { key: "iseek-fotos---fotomg", label: "Foto MG", category: "Fotos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Image },

  // ── EMPRESAS ─────────────────────────────────────────────────────────────
  { key: "iseek-dados---cnpj", label: "CNPJ", category: "Empresas", input: "cnpj", hint: "14 dígitos", placeholder: "00000000000000", icon: Building2 },
  { key: "iseek-dados---func", label: "Funcionários", category: "Empresas", input: "cnpj", hint: "CNPJ da empresa", placeholder: "00000000000000", icon: Users },
  { key: "iseek-dados---iptu", label: "IPTU", category: "Empresas", input: "text", hint: "CNPJ ou endereço", placeholder: "CNPJ ou endereço", icon: Landmark },

  // ── PROCESSOS ────────────────────────────────────────────────────────────
  { key: "iseek-dados---processo", label: "Processo", category: "Processos", input: "numero", hint: "número do processo", placeholder: "0000000-00.0000.0.00.0000", icon: Scale },
  { key: "iseek-dados---processos", label: "Processos por CPF", category: "Processos", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: Scale },
  { key: "iseek-dados---advogadooab", label: "Advogado por OAB", category: "Processos", input: "oab", hint: "número OAB", placeholder: "123456/SP", icon: User },
  { key: "iseek-dados---advogadooabuf", label: "Advogado OAB por UF", category: "Processos", input: "text", hint: "sigla do estado (ex: SP)", placeholder: "SP", icon: User },
  { key: "iseek-dados---advogadocpf", label: "Advogado por CPF", category: "Processos", input: "cpf", hint: "CPF do advogado", placeholder: "00000000000", icon: User },
  { key: "iseek-dados---oab", label: "OAB", category: "Processos", input: "oab", hint: "número OAB", placeholder: "123456/SP", icon: Hash },
  { key: "iseek-dados---matricula", label: "Matrícula", category: "Processos", input: "numero", hint: "número de matrícula", placeholder: "0000000", icon: ClipboardList },
  { key: "iseek-dados---cheque", label: "Cheque", category: "Processos", input: "numero", hint: "número do cheque", placeholder: "000000000", icon: FileText },

  // ── ESPECIAIS ─────────────────────────────────────────────────────────────
  { key: "cnh-full", label: "CNH Full", category: "Especiais", input: "cpf", hint: "CPF do condutor", placeholder: "00000000000", icon: IdCard },
  { key: "credilink", label: "CPF CrediLink", category: "Especiais", input: "cpf", hint: "CPF — crédito e score", placeholder: "00000000000", icon: BarChart3 },
  { key: "cpf-spc", label: "CPF SPC", category: "Especiais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: BarChart3 },
  { key: "iseek-dados---catcpf", label: "Catálogo CPF", category: "Especiais", input: "cpf", hint: "CPF", placeholder: "00000000000", icon: FileText },
  { key: "iseek-dados---catnumero", label: "Catálogo Número", category: "Especiais", input: "tel", hint: "número de telefone", placeholder: "11999999999", icon: Phone },

  // ── SOCIAL ───────────────────────────────────────────────────────────────
  { key: "likes", label: "Likes", category: "Social", input: "id", hint: "ID do perfil", placeholder: "ID numérico", icon: Star, endpoint: "likes" },
  { key: "telegram", label: "Telegram", category: "Social", input: "username", hint: "username sem @", placeholder: "usuario", icon: MessageCircle, endpoint: "telegram" },
];

const CATEGORY_COLORS: Record<SkylersCategory, { gradient: string; text: string; bg: string; border: string }> = {
  "Dados Pessoais": { gradient: "from-rose-400 to-pink-300", text: "text-rose-400", bg: "bg-rose-400/10", border: "border-rose-400/20" },
  "Veículos":       { gradient: "from-amber-400 to-orange-300", text: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
  "Fotos":          { gradient: "from-violet-400 to-fuchsia-300", text: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/20" },
  "Empresas":       { gradient: "from-blue-400 to-indigo-300", text: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20" },
  "Processos":      { gradient: "from-emerald-400 to-teal-300", text: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20" },
  "Especiais":      { gradient: "from-sky-400 to-cyan-300", text: "text-sky-400", bg: "bg-sky-400/10", border: "border-sky-400/20" },
  "Social":         { gradient: "from-purple-400 to-violet-300", text: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/20" },
};

function sanitizeInput(value: string, type: InputType): string {
  switch (type) {
    case "cpf": return value.replace(/\D/g, "").slice(0, 11);
    case "cnpj": return value.replace(/\D/g, "").slice(0, 14);
    case "tel": return value.replace(/\D/g, "").slice(0, 13);
    case "cep": return value.replace(/\D/g, "").slice(0, 8);
    case "renavam": return value.replace(/\D/g, "").slice(0, 11);
    case "placa": return value.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8);
    case "chassi": return value.toUpperCase().slice(0, 17);
    default: return value.slice(0, 120);
  }
}

type QueryResult = { success: boolean; error?: string | null; data?: unknown };

export default function Skylers() {
  const [activeCategory, setActiveCategory] = useState<SkylersCategory>("Dados Pessoais");
  const [selectedModule, setSelectedModule] = useState<SkylersModule | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const queryClient = useQueryClient();

  const modsInCategory = useMemo(
    () => MODULES.filter((m) => m.category === activeCategory),
    [activeCategory],
  );

  const filteredMods = useMemo(() => {
    if (!search.trim()) return modsInCategory;
    const q = search.toLowerCase();
    return MODULES.filter((m) =>
      m.label.toLowerCase().includes(q) ||
      m.key.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q),
    );
  }, [search, modsInCategory]);

  const showAll = search.trim().length > 0;

  const handleSelectModule = (mod: SkylersModule) => {
    setSelectedModule(mod);
    setQuery("");
    setResult(null);
    setSearch("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModule || !query.trim() || pending) return;

    setPending(true);
    setResult(null);
    try {
      const token = localStorage.getItem("infinity_token");
      const body: Record<string, string> = { valor: query.trim() };
      if (selectedModule.endpoint) {
        body.endpoint = selectedModule.endpoint;
      } else {
        body.modulo = selectedModule.key;
      }
      const skyCtrl = new AbortController();
      const skyTimer = setTimeout(() => skyCtrl.abort(), 20_000);
      const r = await fetch("/api/infinity/skylers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: skyCtrl.signal,
      });
      clearTimeout(skyTimer);
      const data = await r.json() as QueryResult & { rateLimited?: boolean };
      if (data.rateLimited) {
        setResult({ success: false, error: data.error ?? "Limite diário atingido." });
      } else {
        setResult(data);
      }
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : "Falha na requisição" });
    } finally {
      setPending(false);
      queryClient.invalidateQueries({ queryKey: ["infinity-history"] });
    }
  };

  const colors = activeCategory ? CATEGORY_COLORS[activeCategory] : CATEGORY_COLORS["Dados Pessoais"];

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-gradient-to-r from-primary to-cyan-200 bg-clip-text text-transparent"
          >
            Skylers API
          </motion.h1>
          <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
            {MODULES.length} módulos operacionais · provedor Skylers conectado
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-400/10 border border-emerald-400/30">
            <div className="relative">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <span className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">Online</span>
          </div>
        </div>
      </div>

      {/* Search + Category pills */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar módulo…"
            className="w-full bg-black/40 border border-white/10 rounded-xl pl-12 pr-10 py-3 text-sm focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {!search && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat;
              const c = CATEGORY_COLORS[cat];
              const count = MODULES.filter((m) => m.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => { setActiveCategory(cat); setSelectedModule(null); setResult(null); }}
                  className={`shrink-0 px-4 py-2 rounded-full text-[10px] uppercase tracking-[0.3em] font-bold transition-all border ${
                    isActive
                      ? `bg-gradient-to-r ${c.gradient} text-black border-transparent shadow-[0_0_24px_-4px_rgba(56,189,248,0.4)]`
                      : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20"
                  }`}
                >
                  {cat} <span className="opacity-60">· {count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Module grid */}
      <motion.div
        key={showAll ? "search" : activeCategory}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2"
      >
        {(showAll ? filteredMods : modsInCategory).map((mod) => {
          const Icon = mod.icon;
          const isActive = selectedModule?.key === mod.key;
          const c = CATEGORY_COLORS[mod.category];
          return (
            <button
              key={mod.key}
              onClick={() => handleSelectModule(mod)}
              className={`relative group flex flex-col items-center gap-1.5 p-3 sm:p-4 rounded-xl border transition-all ${
                isActive
                  ? "bg-primary/15 border-primary/50 shadow-[0_0_20px_-4px_rgba(56,189,248,0.6)]"
                  : "bg-black/20 border-white/5 hover:border-white/15 hover:bg-white/5"
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-primary" : c.text + " group-hover:text-foreground"} transition-colors`} />
              <span className={`text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-center leading-tight ${
                isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
              }`}>
                {mod.label}
              </span>
              {showAll && (
                <span className={`text-[8px] ${c.text} opacity-60`}>{mod.category}</span>
              )}
            </button>
          );
        })}
        {(showAll ? filteredMods : modsInCategory).length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground/50 text-sm">
            Nenhum módulo encontrado.
          </div>
        )}
      </motion.div>

      {/* Query form */}
      <AnimatePresence mode="wait">
        {selectedModule && (
          <motion.div
            key={selectedModule.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6 space-y-5"
          >
            {/* Module header */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.4em] text-primary/70">
                  {(() => { const Icon = selectedModule.icon; return <Icon className="w-3.5 h-3.5" />; })()}
                  <span>{selectedModule.label}</span>
                  <span className="opacity-50">·</span>
                  <span>{selectedModule.hint}</span>
                </div>
                <div className={`flex items-center gap-1 text-[9px] uppercase tracking-wider ${CATEGORY_COLORS[selectedModule.category].text}`}>
                  <Activity className="w-2.5 h-2.5" />
                  <span>{selectedModule.category}</span>
                </div>
              </div>
              <button
                onClick={() => { setSelectedModule(null); setResult(null); }}
                className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-white/5 transition-all"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Input form */}
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                <input
                  value={query}
                  onChange={(e) => setQuery(sanitizeInput(e.target.value, selectedModule.input))}
                  placeholder={selectedModule.placeholder}
                  inputMode={["cpf", "cnpj", "tel", "cep", "renavam", "numero", "id"].includes(selectedModule.input) ? "numeric" : "text"}
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-12 pr-4 py-3.5 sm:py-4 font-mono tracking-wider text-base sm:text-lg focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={!query.trim() || pending}
                className="bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold uppercase tracking-[0.3em] text-xs px-6 sm:px-8 py-3.5 sm:py-0 rounded-xl hover:shadow-[0_0_30px_rgba(56,189,248,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {pending ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    Consultando
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" />
                    Consultar
                  </>
                )}
              </button>
            </form>

            {/* Loading */}
            <AnimatePresence mode="wait">
              {pending && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="py-12 flex items-center justify-center"
                >
                  <InfinityLoader size={72} label="Consultando Skylers API" />
                </motion.div>
              )}

              {/* Result */}
              {!pending && result && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {result.success ? (
                    <div className="flex items-center gap-2 text-emerald-400 text-xs mb-4">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="uppercase tracking-widest font-semibold">Resultado encontrado</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-400 text-xs mb-4">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="uppercase tracking-widest font-semibold">{result.error ?? "Sem resultado"}</span>
                    </div>
                  )}
                  {result.success && !!result.data && (
                    <ResultViewer
                      tipo={selectedModule.category.toLowerCase() as never}
                      query={query}
                      result={result as { success: boolean; error?: string | null; data?: unknown }}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state when no module selected */}
      {!selectedModule && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl border border-white/5 bg-black/20 p-8 text-center"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground/80">Selecione um módulo acima</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                {MODULES.filter((m) => m.category === activeCategory).length} módulos disponíveis em <span className="text-primary/70">{activeCategory}</span>
              </p>
            </div>
            <div className="flex items-center gap-4 pt-2 text-[9px] uppercase tracking-[0.3em] text-muted-foreground/40">
              <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Autenticado</span>
              <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> Skylers API</span>
              <span className="flex items-center gap-1"><ChevronRight className="w-3 h-3" /> {MODULES.length} módulos</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Footer */}
      <div className="pt-4 border-t border-white/5 flex items-center justify-between text-[10px] uppercase tracking-[0.4em] text-muted-foreground">
        <span>Infinity Search</span>
        <span className="text-primary/60">Skylers API · {MODULES.length} módulos</span>
      </div>
    </div>
  );
}
