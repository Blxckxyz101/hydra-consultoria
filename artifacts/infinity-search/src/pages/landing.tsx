import { Link } from "wouter";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AnimatedBackground } from "@/components/ui/AnimatedBackground";
import logoUrl from "@/assets/hydra-icon.jpg";
import {
  Search, Shield, Car, Building2, Scale, Camera,
  ArrowRight, CheckCircle2, Zap, Lock, Users,
  Clock, Crown, Flame, Star, ChevronRight, Quote, ChevronDown,
} from "lucide-react";

const STATS = [
  { value: "92+", label: "Módulos Ativos" },
  { value: "24", label: "Módulos Biométricos" },
  { value: "18", label: "Módulos Veiculares" },
  { value: "99.9%", label: "Uptime Garantido" },
];

const CATEGORIES = [
  {
    icon: Search,
    title: "Inteligência de Pessoas",
    color: "sky",
    desc: "CPF Full, Score de Crédito, IRPF, Benefícios, Árvore Familiar, Título de Eleitor, NIS/PIS e muito mais.",
    count: "28 módulos",
  },
  {
    icon: Camera,
    title: "Análise Biométrica",
    color: "violet",
    desc: "Fotos por estado (SP, RJ, MG, BA e 20+ outros), CNH, Detran, reconhecimento facial e presos.",
    count: "24 módulos",
  },
  {
    icon: Car,
    title: "Investigação Veicular",
    color: "amber",
    desc: "Placa, CRLV (TO/MT), RENAVAM, Chassi, Motor, Vistoria, Frota, FIPE e Serpro.",
    count: "18 módulos",
  },
  {
    icon: Building2,
    title: "Dados Corporativos",
    color: "emerald",
    desc: "CNPJ completo, Sócios, Quadro de Funcionários, Empregos, IPTU e vínculos empresariais.",
    count: "8 módulos",
  },
  {
    icon: Scale,
    title: "Jurídico & Patrimônio",
    color: "rose",
    desc: "Processos judiciais, Mandados de prisão, OAB, Dívidas, Bens, Certidões e SPC.",
    count: "14 módulos",
  },
];

const PLANS = [
  {
    id: "padrao",
    label: "14 Dias Padrão",
    price: "70,00",
    consultas: 420,
    tier: null as null,
    features: ["30 consultas/dia por módulo", "10 fotos/dia", "Dossiê e histórico", "Assistente IA"],
    highlight: true,
    badge: "Mais Popular",
    icon: Star,
  },
  {
    id: "vip",
    label: "14 Dias VIP",
    price: "150,00",
    consultas: 840,
    tier: "vip" as const,
    features: ["60 consultas/dia por módulo", "25 fotos/dia", "Processos jurídicos", "Temas exclusivos"],
    highlight: false,
    badge: "VIP",
    icon: Crown,
  },
  {
    id: "ultra",
    label: "14 Dias ULTRA",
    price: "500,00",
    consultas: 2800,
    tier: "ultra" as const,
    features: ["200 consultas/dia por módulo", "200 fotos/dia", "Acesso máximo", "Todos os temas"],
    highlight: false,
    badge: "Ultra",
    icon: Flame,
  },
];

const TESTIMONIALS = [
  {
    name: "Ricardo M.",
    role: "Detetive Particular · SP",
    avatar: "RM",
    color: "#38bdf8",
    text: "Uso a Hydra diariamente nas minhas investigações. O CPF Full e a árvore familiar economizaram horas de trabalho por semana. Nunca vi uma plataforma tão completa no Brasil.",
    stars: 5,
  },
  {
    name: "Fernanda O.",
    role: "Advogada Trabalhista · RJ",
    avatar: "FO",
    color: "#a78bfa",
    text: "Os módulos de processos judiciais e OAB são incríveis. Consigo verificar o histórico de uma parte em segundos, antes gastava horas no TJ. Vale muito o investimento.",
    stars: 5,
  },
  {
    name: "Carlos A.",
    role: "Analista de Crédito · BH",
    avatar: "CA",
    color: "#34d399",
    text: "Implementei a Hydra no fluxo de análise de crédito da nossa empresa. A combinação de Score, SPC e dados de renda num só lugar é diferencial competitivo real.",
    stars: 5,
  },
  {
    name: "Juliana P.",
    role: "Gestora de RH · Curitiba",
    avatar: "JP",
    color: "#fbbf24",
    text: "Antes de contratar qualquer pessoa fazemos consulta na Hydra. Já evitamos 3 contratações problemáticas só esse ano. O retorno foi imediato no primeiro mês.",
    stars: 5,
  },
  {
    name: "Marcos T.",
    role: "Corretor de Imóveis · Recife",
    avatar: "MT",
    color: "#fb7185",
    text: "Verificar inquilinos ficou muito mais seguro. Os dados de processos e certidões que a plataforma traz em segundos antes levavam dias para conseguir.",
    stars: 5,
  },
  {
    name: "Ana L.",
    role: "Investigadora Corporativa · DF",
    avatar: "AL",
    color: "#38bdf8",
    text: "Melhor custo-benefício que já encontrei. O plano de recargas é perfeito para o meu volume variável de consultas. Suporte rápido e plataforma sempre no ar.",
    stars: 5,
  },
];

const FAQ = [
  {
    q: "O que é OSINT?",
    a: "OSINT (Open Source Intelligence) é a prática de coletar e analisar informações de fontes públicas e legalmente acessíveis. A Hydra reúne dados de bases públicas brasileiras — Receita Federal, DETRAN, tribunais, entre outras — e entrega tudo em segundos.",
  },
  {
    q: "Meus dados e consultas ficam seguros?",
    a: "Sim. A plataforma usa autenticação com PIN, 2FA TOTP e sessão protegida. Suas consultas são privadas e acessíveis apenas por você. Nenhum dado é compartilhado com terceiros.",
  },
  {
    q: "Como funciona o pagamento via PIX?",
    a: "Ao escolher um plano ou recarga, geramos um QR Code PIX na hora. Após o pagamento, o saldo ou acesso é ativado automaticamente em segundos, sem aprovação manual.",
  },
  {
    q: "Posso cancelar ou o plano expira sozinho?",
    a: "Não existe mensalidade. Os planos têm prazo definido (1, 7, 14 ou 30 dias) e expiram naturalmente ao fim do período. As recargas de consultas não expiram e acumulam indefinidamente.",
  },
  {
    q: "Qual a diferença entre Plano e Recarga?",
    a: "O Plano dá acesso completo à plataforma por um período. A Recarga é um pacote de consultas avulsas sem prazo de validade, ideal para quem usa de forma pontual ou quer complementar um plano ativo.",
  },
  {
    q: "Qual plano é indicado para iniciantes?",
    a: "O plano '1 Dia Padrão' por R$ 15 é perfeito para testar a plataforma. Para uso regular, o '14 Dias Padrão' oferece o melhor custo-benefício com 420 consultas incluídas.",
  },
];

const STEPS = [
  { num: "01", title: "Crie sua conta", desc: "Escolha seu plano e registre-se em menos de 2 minutos." },
  { num: "02", title: "Pague via PIX", desc: "QR Code gerado na hora, saldo creditado em segundos." },
  { num: "03", title: "Comece as consultas", desc: "Acesso imediato a todos os módulos do seu plano." },
];

function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="px-6 py-20 max-w-3xl mx-auto">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-black mb-3" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.08em" }}>
          PERGUNTAS FREQUENTES
        </h2>
        <p className="text-muted-foreground text-sm">Tudo o que você precisa saber antes de começar</p>
      </div>
      <div className="space-y-2">
        {FAQ.map((item, i) => (
          <div
            key={i}
            className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden transition-all hover:border-white/20"
          >
            <button
              className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
              onClick={() => setOpen(open === i ? null : i)}
            >
              <span className="font-semibold text-sm">{item.q}</span>
              <ChevronDown
                className="w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200"
                style={{ transform: open === i ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            </button>
            <AnimatePresence initial={false}>
              {open === i && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden"
                >
                  <p className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-white/5 pt-3">
                    {item.a}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen w-full text-foreground overflow-x-hidden relative" style={{ background: "#06091a" }}>
      <AnimatedBackground />

      {/* ── Nav ── */}
      <header
        className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.06] backdrop-blur-2xl"
        style={{ background: "rgba(6,9,26,0.85)", paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center justify-between px-6 h-16">
          <Link href="/" className="flex items-center gap-3">
            <img src={logoUrl} alt="Hydra" className="w-9 h-9 object-contain" />
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "22px", letterSpacing: "0.2em", color: "#38bdf8" }}>HYDRA</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <button className="touch-target px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground border border-white/10 hover:border-white/20 transition-all flex items-center justify-center">
                Entrar
              </button>
            </Link>
            <Link href="/registro">
              <button
                className="touch-target px-5 py-2 rounded-xl text-sm font-bold text-black transition-all hover:opacity-90 flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #38bdf8, #818cf8)" }}
              >
                Criar Conta
              </button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative pb-24 px-6 text-center" style={{ paddingTop: "calc(9rem + env(safe-area-inset-top, 0px))" }}>
        <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-sky-400/30 bg-sky-400/10 text-sky-300 text-xs font-semibold tracking-wider uppercase mb-6">
            <Zap className="w-3 h-3" />
            Plataforma OSINT #1 do Brasil
          </div>
          <h1
            className="text-5xl sm:text-7xl font-black tracking-tight mb-6 leading-none"
            style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.06em" }}
          >
            <span style={{ color: "#38bdf8", filter: "drop-shadow(0 0 40px #38bdf855)" }}>INTELIGÊNCIA</span>
            <br />
            <span className="text-white">OSINT DE ELITE</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
            92+ módulos de dados brasileiros. CPF, veículos, empresas, biometria, processos e muito mais — acesso instantâneo via PIX.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/registro">
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2.5 px-8 py-4 rounded-2xl font-bold text-base text-black shadow-2xl"
                style={{ background: "linear-gradient(135deg, #38bdf8, #818cf8)", boxShadow: "0 8px 40px #38bdf840" }}
              >
                Começar agora — a partir de R$ 15
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            </Link>
            <Link href="/login">
              <button className="flex items-center gap-2 px-6 py-4 rounded-2xl font-medium text-sm text-muted-foreground hover:text-foreground border border-white/10 hover:border-white/20 transition-all">
                <Lock className="w-4 h-4" />
                Já tenho conta
              </button>
            </Link>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto"
        >
          {STATS.map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-4 text-center">
              <div className="text-2xl font-black" style={{ color: "#38bdf8" }}>{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-1 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </motion.div>
      </section>

      {/* ── Categories ── */}
      <section className="px-6 py-20 max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-black mb-3" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.08em" }}>
            COBERTURA TOTAL DE DADOS
          </h2>
          <p className="text-muted-foreground text-sm">Todas as verticais de inteligência numa única plataforma</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CATEGORIES.map((cat, i) => {
            const Icon = cat.icon;
            const colorMap: Record<string, string> = {
              sky: "#38bdf8", violet: "#a78bfa", amber: "#fbbf24",
              emerald: "#34d399", rose: "#fb7185",
            };
            const c = colorMap[cat.color] ?? "#38bdf8";
            return (
              <motion.div
                key={cat.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 hover:border-white/20 transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${c}18`, border: `1px solid ${c}30` }}>
                    <Icon className="w-5 h-5" style={{ color: c }} />
                  </div>
                  <div>
                    <div className="font-bold text-sm">{cat.title}</div>
                    <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: c }}>{cat.count}</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{cat.desc}</p>
              </motion.div>
            );
          })}
          {/* Outros */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: CATEGORIES.length * 0.07 }}
            className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 hover:border-white/20 transition-all flex flex-col items-center justify-center text-center"
          >
            <Shield className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <div className="font-bold text-sm mb-1">Outros módulos</div>
            <p className="text-xs text-muted-foreground">Telegram, Score, CNS/SUS, CrediLink, Catálogo, Faculdades e mais.</p>
          </motion.div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="px-6 py-20" style={{ background: "rgba(56,189,248,0.03)", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="max-w-3xl mx-auto text-center mb-12">
          <h2 className="text-3xl font-black mb-3" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.08em" }}>
            COMO FUNCIONA
          </h2>
          <p className="text-muted-foreground text-sm">Do zero ao acesso em menos de 5 minutos</p>
        </div>
        <div className="max-w-3xl mx-auto grid sm:grid-cols-3 gap-6">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="relative text-center"
            >
              {i < STEPS.length - 1 && (
                <ChevronRight className="hidden sm:block absolute top-6 -right-3 w-5 h-5 text-muted-foreground/20 z-10" />
              )}
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 font-black text-lg"
                style={{ background: "color-mix(in srgb, #38bdf8 15%, transparent)", border: "1px solid color-mix(in srgb, #38bdf8 30%, transparent)", color: "#38bdf8", fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.1em" }}>
                {step.num}
              </div>
              <h3 className="font-bold mb-2">{step.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-black mb-3" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.08em" }}>
            O QUE DIZEM OS USUÁRIOS
          </h2>
          <p className="text-muted-foreground text-sm">Profissionais que já usam a Hydra no dia a dia</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 flex flex-col gap-4 hover:border-white/20 transition-all"
            >
              <Quote className="w-5 h-5 opacity-30 shrink-0" style={{ color: t.color }} />
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t.text}</p>
              <div className="flex items-center gap-1 mt-1">
                {Array.from({ length: t.stars }).map((_, s) => (
                  <Star key={s} className="w-3 h-3 fill-current" style={{ color: "#fbbf24" }} />
                ))}
              </div>
              <div className="flex items-center gap-3 pt-3 border-t border-white/5">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                  style={{ background: `${t.color}22`, border: `1px solid ${t.color}40`, color: t.color }}
                >
                  {t.avatar}
                </div>
                <div>
                  <div className="text-sm font-bold">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground">{t.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="px-6 py-20 max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-black mb-3" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.08em" }}>
            PLANOS
          </h2>
          <p className="text-muted-foreground text-sm">Escolha o plano ideal para sua operação. Sem mensalidade, pague só quando precisar.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {PLANS.map((plan, i) => {
            const Icon = plan.icon;
            const isVip = plan.tier === "vip";
            const isUltra = plan.tier === "ultra";
            const accentColor = isUltra ? "#fb7185" : isVip ? "#fbbf24" : "#38bdf8";
            const pricePerQuery = (parseFloat(plan.price.replace(",", ".")) / plan.consultas).toFixed(2).replace(".", ",");

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="relative rounded-2xl border p-6 flex flex-col"
                style={{
                  background: plan.highlight
                    ? "color-mix(in srgb, #38bdf8 6%, rgba(255,255,255,0.02))"
                    : isUltra
                    ? "color-mix(in srgb, #fb7185 5%, rgba(255,255,255,0.02))"
                    : isVip
                    ? "color-mix(in srgb, #fbbf24 5%, rgba(255,255,255,0.02))"
                    : "rgba(255,255,255,0.02)",
                  borderColor: `${accentColor}35`,
                }}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-[0.3em] font-bold text-black bg-sky-400 px-3 py-1 rounded-full whitespace-nowrap">
                    Mais Popular
                  </span>
                )}
                <div className="flex items-center gap-2 mb-4">
                  <Icon className="w-5 h-5" style={{ color: accentColor }} />
                  {isUltra && <span className="text-[8px] font-black uppercase tracking-widest bg-rose-500/20 border border-rose-500/40 text-rose-300 px-2 py-0.5 rounded-full">ULTRA</span>}
                  {isVip && <span className="text-[8px] font-black uppercase tracking-widest bg-amber-400/15 border border-amber-400/35 text-amber-300 px-2 py-0.5 rounded-full">VIP</span>}
                </div>
                <div className="font-bold text-base mb-1">{plan.label}</div>
                <div className="mb-1">
                  <span className="text-3xl font-black" style={{ color: accentColor }}>R$ {plan.price}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mb-1">
                  <span className="font-semibold text-foreground">{plan.consultas}</span> consultas incluídas
                </div>
                <div className="text-[10px] text-muted-foreground/60 mb-4">
                  ≈ R$ {pricePerQuery} / consulta
                </div>
                <div className="space-y-1.5 flex-1 mb-5">
                  {plan.features.map(f => (
                    <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 shrink-0" style={{ color: accentColor }} />
                      {f}
                    </div>
                  ))}
                </div>
                <Link href="/registro">
                  <button
                    className="w-full py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
                    style={plan.highlight ? {
                      background: "linear-gradient(135deg, #38bdf8, #818cf8)",
                      color: "#000",
                    } : {
                      background: `${accentColor}18`,
                      border: `1px solid ${accentColor}35`,
                      color: accentColor,
                    }}
                  >
                    Escolher plano
                  </button>
                </Link>
              </motion.div>
            );
          })}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-6">
          Planos de 1, 7, 14 e 30 dias disponíveis para todos os tipos. <Link href="/registro" className="text-sky-400 hover:underline">Criar conta e acessar todos →</Link>
        </p>
      </section>

      {/* ── Features highlights ── */}
      <section className="px-6 py-16" style={{ background: "rgba(255,255,255,0.02)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="max-w-4xl mx-auto grid sm:grid-cols-3 gap-6 text-center">
          {[
            { icon: Zap, title: "Resposta instantânea", desc: "Dados retornados em segundos via bases atualizadas." },
            { icon: Lock, title: "100% seguro", desc: "Autenticação com PIN, 2FA TOTP e sessão protegida." },
            { icon: Users, title: "Comunidade ativa", desc: "Chat em tempo real, DMs e compartilhamento de insights." },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="flex flex-col items-center gap-3">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
                  style={{ background: "color-mix(in srgb, #38bdf8 12%, transparent)", border: "1px solid color-mix(in srgb, #38bdf8 25%, transparent)" }}>
                  <Icon className="w-5 h-5 text-sky-400" />
                </div>
                <div className="font-bold text-sm">{item.title}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── FAQ ── */}
      <FaqSection />

      {/* ── CTA final ── */}
      <section className="px-6 py-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-4xl font-black mb-4" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.08em" }}>
            PRONTO PARA COMEÇAR?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto text-sm">
            Cadastre-se agora, pague via PIX e tenha acesso imediato aos 92+ módulos da Hydra Consultoria.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/registro">
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2.5 px-10 py-4 rounded-2xl font-bold text-base text-black"
                style={{ background: "linear-gradient(135deg, #38bdf8, #818cf8)", boxShadow: "0 8px 40px #38bdf840" }}
              >
                Criar conta — a partir de R$ 15
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            </Link>
            <a href="https://t.me/hydraconsultoria" target="_blank" rel="noopener noreferrer">
              <button className="flex items-center gap-2 px-6 py-4 rounded-2xl font-medium text-sm text-muted-foreground hover:text-foreground border border-white/10 hover:border-white/20 transition-all">
                <Clock className="w-4 h-4" />
                Falar com suporte
              </button>
            </a>
          </div>
        </motion.div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-muted-foreground/50">
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="Hydra" className="w-5 h-5 object-contain opacity-60" />
          <span>© {new Date().getFullYear()} Hydra Consultoria. Todos os direitos reservados.</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="https://t.me/hydraconsultoria" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Suporte</a>
          <Link href="/login" className="hover:text-foreground transition-colors">Login</Link>
          <Link href="/registro" className="hover:text-foreground transition-colors">Cadastro</Link>
        </div>
      </footer>
    </div>
  );
}
