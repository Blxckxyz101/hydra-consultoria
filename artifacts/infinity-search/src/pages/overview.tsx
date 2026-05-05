import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, Users, Search, Clock, AlertTriangle, TrendingUp, Sparkles, ArrowUpRight, Zap, Trophy, Gauge, Medal } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { Link } from "wouter";
import { InfinityLoader } from "@/components/ui/InfinityLoader";
import { ExpiryBadge } from "@/components/ui/ExpiryBadge";
import { Skeleton } from "@/components/ui/skeleton";

const TIPO_LABEL: Record<string, string> = {
  cpf: "CPF", cpfbasico: "CPF Básico", cpffull: "CPF Full",
  nome: "Nome", rg: "RG", mae: "Mãe", pai: "Pai",
  nasc: "Nascimento", parentes: "Parentes", obito: "Óbito",
  email: "Email", telefone: "Telefone", pix: "PIX",
  endereco: "Endereço", cep: "CEP", nis: "NIS/PIS",
  titulo: "Título", score: "Score", score2: "Score 2",
  irpf: "IRPF", beneficios: "Benefícios", mandado: "Mandado",
  dividas: "Dívidas", bens: "Bens", certidoes: "Certidões",
  vacinas: "Vacinas", rais: "RAIS", faculdades: "Faculdades",
  assessoria: "Assessoria", registro: "Registro",
  spc: "CPF SPC", credilink: "CrediLink", cns: "CNS/SUS",
  foto: "Foto CNH", biometria: "Biometria",
  placa: "Placa", chassi: "Chassi", renavam: "Renavam",
  motor: "Motor", veiculos: "Veículos/CPF", cnh: "CNH",
  cnhfull: "CNH Full", cnham: "CNH AM", cnhnc: "CNH NC",
  cnhrs: "CNH RS", cnhrr: "CNH RR", frota: "Frota",
  fotodetran: "Foto Detran", crlvto: "CRLV TO", crlvmt: "CRLV MT",
  placafipe: "Placa FIPE", placaserpro: "Placa Serpro", vistoria: "Vistoria",
  cnpj: "CNPJ", fucionarios: "Funcionários", socios: "Sócios",
  empregos: "Empregos", iptu: "IPTU",
  processo: "Processo", processos: "Processos/CPF",
  advogadooab: "Adv. por OAB", advogadooabuf: "Adv. OAB/UF",
  advogadocpf: "Adv. por CPF", oab: "OAB",
  matricula: "Matrícula", cheque: "Cheque",
  telegram: "Telegram", likes: "Likes",
  catcpf: "Catálogo CPF", catnumero: "Catálogo Nº",
  fotoma: "Foto MA", fotoce: "Foto CE", fotosp: "Foto SP",
  fotorj: "Foto RJ", fotoms: "Foto MS", fotonc: "Foto Nacional",
  fotoes: "Foto ES", fototo: "Foto TO", fotoro: "Foto RO",
  fotomapresos: "Foto MA Presos", fotopi: "Foto PI", fotopr: "Foto PR",
  fotodf: "Foto DF", fotoal: "Foto AL", fotogo: "Foto GO",
  fotopb: "Foto PB", fotope: "Foto PE", fotorn: "Foto RN",
  fotoba: "Foto BA", fotomg: "Foto MG",
  crlvtofoto: "CRLV TO Foto", crlvmtfoto: "CRLV MT Foto",
};

const TIPO_GRADIENT: Record<string, string> = {
  cpf: "from-sky-400 to-cyan-300",
  cnpj: "from-violet-400 to-fuchsia-300",
  telefone: "from-emerald-400 to-teal-300",
  sipni: "from-amber-400 to-orange-300",
};

const PERIOD_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1 ano", days: 365 },
];

type RecentItem = { id: number; tipo: string; query: string; username: string; success: boolean; createdAt: string };
type TipoPct = { tipo: string; count: number };
type OperadorPct = { username: string; count: number };

type OverviewData = {
  totalConsultas: number;
  consultasHoje: number;
  consultasSemana: number;
  usuariosAtivos: number;
  consultasPorTipo: TipoPct[];
  consultasPorOperador: OperadorPct[];
  rateLimitHoje: number;
  rateLimitMax: number;
  recentes: RecentItem[];
};

type MeData = {
  username: string;
  displayName?: string | null;
  role: string;
  accountExpiresAt?: string | null;
  skylersTotal?: number;
  skylersLimit?: number;
};

function buildHeatmap(recentes: RecentItem[], days: number) {
  const today = new Date();
  const result: Array<{ date: Date; count: number; iso: string }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    d.setHours(0, 0, 0, 0);
    result.push({ date: d, count: 0, iso: d.toISOString().slice(0, 10) });
  }
  const idx = new Map(result.map((d, i) => [d.iso, i]));
  for (const r of recentes) {
    const iso = new Date(r.createdAt).toISOString().slice(0, 10);
    const i = idx.get(iso);
    if (i !== undefined) result[i].count++;
  }
  return result;
}

function buildTrend(recentes: RecentItem[], days: number) {
  const bucketCount = Math.min(days, 14);
  const buckets = new Array(bucketCount).fill(0).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const label = bucketCount <= 7
      ? d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3)
      : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    return { day: label, v: 0 };
  });
  const now = new Date();
  for (const r of recentes) {
    const diff = Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / 86400000);
    if (diff >= 0 && diff < bucketCount) buckets[bucketCount - 1 - diff].v++;
  }
  return buckets;
}

function useOverview(days: number) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const token = localStorage.getItem("infinity_token");
    fetch(`/api/infinity/overview?days=${days}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [days]);

  return { data, loading, error };
}

function useMe() {
  const [me, setMe] = useState<MeData | null>(null);
  useEffect(() => {
    const token = localStorage.getItem("infinity_token");
    fetch("/api/infinity/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {});
  }, []);
  return me;
}

export default function Overview() {
  const [period, setPeriod] = useState(30);
  const { data, loading, error } = useOverview(period);
  const me = useMe();
  const [profilePhoto] = useState<string | null>(() => localStorage.getItem("infinity_profile_photo"));
  const [profileBanner] = useState<string | null>(() => localStorage.getItem("infinity_profile_banner"));

  const isAdmin = me?.role === "admin";

  if (loading) {
    return (
      <div className="space-y-6 sm:space-y-8">
        <Skeleton className="h-72 rounded-3xl bg-white/5" />
        <Skeleton className="h-10 rounded-2xl bg-white/5 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl bg-white/5" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-52 rounded-2xl bg-white/5" />
          <Skeleton className="h-52 rounded-2xl bg-white/5" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-destructive flex items-center gap-2">
        <AlertTriangle className="w-5 h-5" /> Erro ao carregar dados.
      </div>
    );
  }

  const heatmap = buildHeatmap(data.recentes, period);
  const trend = buildTrend(data.recentes, period);
  const maxHeat = Math.max(1, ...heatmap.map((h) => h.count));
  const successRate = data.recentes.length > 0
    ? Math.round((data.recentes.filter((r) => r.success).length / data.recentes.length) * 100)
    : 0;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  const rateLimitPct = data.rateLimitMax > 0 ? (data.rateLimitHoje / data.rateLimitMax) * 100 : 0;
  const rateLimitColor = rateLimitPct >= 90 ? "text-rose-300" : rateLimitPct >= 70 ? "text-amber-300" : "text-emerald-300";
  const mySuccessRate = data.recentes.length > 0
    ? Math.round((data.recentes.filter((r) => r.success).length / data.recentes.length) * 100)
    : 0;

  const adminStatCards = [
    { label: "Consultas Totais", value: data.totalConsultas, icon: Activity, hint: "minhas consultas", color: "from-sky-500/30 to-cyan-400/10", iconColor: "text-sky-300", glowColor: "rgba(56,189,248,0.35)" },
    { label: "Hoje", value: data.consultasHoje, icon: Clock, hint: "últimas 24h", color: "from-violet-500/30 to-fuchsia-400/10", iconColor: "text-violet-300", glowColor: "rgba(167,139,250,0.35)" },
    { label: "Esta Semana", value: data.consultasSemana, icon: Search, hint: "últimos 7 dias", color: "from-emerald-500/30 to-teal-400/10", iconColor: "text-emerald-300", glowColor: "rgba(52,211,153,0.35)" },
    { label: "Operadores Ativos", value: data.usuariosAtivos, icon: Users, hint: "contas na plataforma", color: "from-amber-500/30 to-orange-400/10", iconColor: "text-amber-300", glowColor: "rgba(251,191,36,0.35)" },
  ];

  const clientStatCards = [
    { label: "Minhas Consultas", value: data.totalConsultas, icon: Activity, hint: "histórico completo", color: "from-sky-500/30 to-cyan-400/10", iconColor: "text-sky-300", glowColor: "rgba(56,189,248,0.35)" },
    { label: "Hoje", value: data.consultasHoje, icon: Clock, hint: "últimas 24h", color: "from-violet-500/30 to-fuchsia-400/10", iconColor: "text-violet-300", glowColor: "rgba(167,139,250,0.35)" },
    { label: "Esta Semana", value: data.consultasSemana, icon: Search, hint: "últimos 7 dias", color: "from-emerald-500/30 to-teal-400/10", iconColor: "text-emerald-300", glowColor: "rgba(52,211,153,0.35)" },
    { label: "Taxa de Sucesso", value: mySuccessRate, icon: TrendingUp, hint: "no período selecionado", color: "from-emerald-500/30 to-teal-400/10", iconColor: "text-emerald-300", glowColor: "rgba(52,211,153,0.35)", suffix: "%" },
  ];

  const statCards = isAdmin ? adminStatCards : clientStatCards;

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-sky-500/15 via-cyan-400/5 to-violet-500/10 backdrop-blur-2xl"
      >
        <div className="relative h-32 sm:h-40 w-full overflow-hidden rounded-t-3xl">
          {profileBanner ? (
            <img src={profileBanner} alt="banner" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-r from-sky-600/40 via-cyan-500/30 to-violet-600/40" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
          <motion.div
            aria-hidden
            className="absolute -top-10 -right-10 w-56 h-56 rounded-full bg-sky-400/25 blur-3xl"
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <div className="relative px-6 sm:px-10 -mt-10 mb-2 flex items-end gap-4">
          <div className="relative shrink-0">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border-4 border-[#06091a] overflow-hidden bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center text-black font-bold text-2xl shadow-[0_0_30px_rgba(56,189,248,0.4)]">
              {profilePhoto ? (
                <img src={profilePhoto} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span>{me?.username?.[0]?.toUpperCase() ?? "?"}</span>
              )}
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-400 border-2 border-[#06091a] shadow" />
          </div>
          <div className="pb-2 min-w-0">
            <div className="font-bold text-lg sm:text-xl tracking-tight truncate">{me?.displayName ?? me?.username ?? "operador"}</div>
            {me?.displayName && (
              <div className="text-[10px] text-muted-foreground/60 font-mono truncate">@{me?.username}</div>
            )}
            <div className="text-[10px] uppercase tracking-[0.35em] text-primary/70">{me?.role === "vip" ? "VIP" : me?.role ?? "user"}</div>
          </div>
        </div>

        <div className="px-6 sm:px-10 pb-6 sm:pb-10 pt-2">
          <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.5em] text-primary/80 mb-3">
                <Sparkles className="w-3 h-3" /> Centro de Comando
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                {greet}, <span className="bg-gradient-to-r from-sky-300 via-cyan-200 to-violet-300 bg-clip-text text-transparent">{me?.displayName ?? me?.username ?? "operador"}</span>
              </h1>
              <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-xl">
                {data.consultasHoje > 0
                  ? `Você já realizou ${data.consultasHoje} consulta${data.consultasHoje === 1 ? "" : "s"} hoje.`
                  : "Nenhuma consulta hoje ainda — comece pelo módulo de Consultas."}
              </p>
              <div className="mt-4">
                <ExpiryBadge
                  accountExpiresAt={(me as any)?.accountExpiresAt ?? null}
                  role={me?.role ?? "user"}
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/consultas"
                  className="group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-400 to-cyan-300 text-black font-semibold text-xs uppercase tracking-widest shadow-[0_0_30px_rgba(56,189,248,0.4)] hover:shadow-[0_0_40px_rgba(56,189,248,0.7)] transition-all"
                >
                  Nova consulta <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </Link>
                <Link
                  href="/ia"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-foreground text-xs uppercase tracking-widest hover:bg-white/10 transition-all"
                >
                  <Zap className="w-3.5 h-3.5 text-violet-300" /> Conversar com a IA
                </Link>
              </div>
            </div>

            <div className="flex items-center gap-6 self-start lg:self-end">
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mb-1">Tendência</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-emerald-300">{successRate}%</span>
                  <TrendingUp className="w-4 h-4 text-emerald-300" />
                </div>
                <div className="text-[10px] text-muted-foreground">taxa de sucesso</div>
              </div>
              <div className="w-32 h-16">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
                    <defs>
                      <linearGradient id="hero-spark" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(56,189,248)" stopOpacity={0.7} />
                        <stop offset="100%" stopColor="rgb(56,189,248)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="v" stroke="rgb(56,189,248)" strokeWidth={2} fill="url(#hero-spark)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Security notice */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="flex items-start gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/8 backdrop-blur-xl px-4 py-3.5"
      >
        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <p className="text-xs text-rose-300/90 leading-relaxed">
          <span className="font-bold uppercase tracking-wide">Aviso importante — </span>
          É estritamente proibido compartilhar o acesso da sua conta com terceiros. Qualquer identificação de uso indevido — incluindo compartilhamento de credenciais, acesso simultâneo de IPs distintos, uso de bots ou automações não autorizadas — resultará em medidas imediatas contra a conta.
        </p>
      </motion.div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {statCards.map((stat, idx) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + idx * 0.07 }}
            whileHover={{ y: -4 }}
            className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${stat.color} p-4 sm:p-5 backdrop-blur-xl transition-all duration-200 cursor-default`}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.boxShadow = `0 0 40px -8px ${stat.glowColor}, 0 4px 20px -4px ${stat.glowColor}`;
              (e.currentTarget as HTMLElement).style.borderColor = `${stat.glowColor.replace("0.35", "0.5")}`;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.boxShadow = "";
              (e.currentTarget as HTMLElement).style.borderColor = "";
            }}
          >
            <div className="absolute inset-0 bg-black/30" />
            {/* Inner radial glow on hover */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl"
              style={{ background: `radial-gradient(ellipse at 50% 0%, ${stat.glowColor.replace("0.35","0.12")} 0%, transparent 70%)` }} />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2 truncate">{stat.label}</p>
                <p className="text-2xl sm:text-3xl font-bold">{stat.value.toLocaleString("pt-BR")}{(stat as { suffix?: string }).suffix ?? ""}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1">{stat.hint}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center ${stat.iconColor} group-hover:scale-110 group-hover:border-white/20 transition-all duration-200`}>
                <stat.icon className="w-5 h-5" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Rate limit bar — admin only */}
      {isAdmin && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">Cota Diária Global</span>
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground bg-white/5 border border-white/10 px-2 py-0.5 rounded-md">Admin</span>
            </div>
            <span className={`text-sm font-bold ${rateLimitColor}`}>
              {data.rateLimitHoje.toLocaleString("pt-BR")} <span className="text-muted-foreground font-normal text-xs">/ {data.rateLimitMax.toLocaleString("pt-BR")}</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(rateLimitPct, 100)}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              className={`h-full rounded-full ${rateLimitPct >= 90 ? "bg-rose-400" : rateLimitPct >= 70 ? "bg-amber-400" : "bg-emerald-400"}`}
            />
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-2">
            {(data.rateLimitMax - data.rateLimitHoje).toLocaleString("pt-BR")} consultas restantes hoje · Reinicia à meia-noite
          </p>
        </motion.div>
      )}

      {/* Heatmap with period filter */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6"
      >
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-foreground">{isAdmin ? "Atividade da Plataforma" : "Minha Atividade"} · {period} dias</h2>
            <p className="text-[10px] text-muted-foreground mt-1">Cada quadrado é um dia. Mais escuro = mais consultas.</p>
          </div>
          <div className="flex items-center gap-2">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setPeriod(opt.days)}
                className={`px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-widest font-semibold transition-all border ${
                  period === opt.days
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground mb-3 justify-end">
          <span>menos</span>
          {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
            <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgba(56,189,248,${0.1 + v * 0.6})` }} />
          ))}
          <span>mais</span>
        </div>
        <div className="grid grid-rows-7 grid-flow-col gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar">
          {heatmap.map((d) => {
            const intensity = d.count / maxHeat;
            return (
              <motion.div
                key={d.iso}
                whileHover={{ scale: 1.4 }}
                className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-sm cursor-help"
                style={{
                  backgroundColor: d.count > 0
                    ? `rgba(56,189,248,${0.2 + intensity * 0.7})`
                    : "rgba(255,255,255,0.04)",
                  border: d.count > 0 ? "1px solid rgba(56,189,248,0.3)" : "1px solid rgba(255,255,255,0.04)",
                }}
                title={`${d.date.toLocaleDateString("pt-BR")} — ${d.count} consulta${d.count === 1 ? "" : "s"}`}
              />
            );
          })}
        </div>
      </motion.div>

      {/* Charts + Ranking row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="lg:col-span-2 rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6"
        >
          <h2 className="text-sm font-semibold uppercase tracking-[0.3em] mb-5">Por Tipo de Consulta</h2>
          <div className="space-y-3">
            {data.consultasPorTipo.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-8">Sem dados ainda.</div>
            )}
            {data.consultasPorTipo.map((p) => {
              const total = data.consultasPorTipo.reduce((a, b) => a + b.count, 0);
              const pct = total > 0 ? (p.count / total) * 100 : 0;
              return (
                <div key={p.tipo}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold uppercase tracking-widest">{TIPO_LABEL[p.tipo] ?? p.tipo}</span>
                    <span className="text-muted-foreground">{p.count} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
                      className={`h-full rounded-full bg-gradient-to-r ${TIPO_GRADIENT[p.tipo] ?? "from-primary to-primary"}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="lg:col-span-3 rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6"
        >
          <h2 className="text-sm font-semibold uppercase tracking-[0.3em] mb-5">Volume por Período</h2>
          <div className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend}>
                <defs>
                  <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(56,189,248)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="rgb(139,92,246)" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" stroke="rgba(255,255,255,0.5)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.5)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  contentStyle={{ backgroundColor: "rgba(10,15,25,0.95)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: 12, backdropFilter: "blur(12px)" }}
                />
                <Bar dataKey="v" name="Consultas" fill="url(#bar-grad)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Operator ranking — admin only */}
      {isAdmin && data.consultasPorOperador && data.consultasPorOperador.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6"
        >
          <div className="flex items-center gap-2 mb-5">
            <Trophy className="w-4 h-4 text-amber-300" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.3em]">Ranking de Operadores</h2>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground bg-white/5 border border-white/10 px-2 py-0.5 rounded-md ml-1">Admin</span>
          </div>
          <div className="space-y-2">
            {data.consultasPorOperador.map((op, i) => {
              const maxCount = data.consultasPorOperador[0].count;
              const pct = maxCount > 0 ? (op.count / maxCount) * 100 : 0;
              const medalColors = [
                "bg-amber-400/20 border-amber-400/40 text-amber-300",
                "bg-slate-400/20 border-slate-400/40 text-slate-300",
                "bg-orange-700/20 border-orange-700/40 text-orange-600",
              ];
              const MedalIcon = i === 0 ? Trophy : Medal;
              return (
                <motion.div
                  key={op.username}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.55 + i * 0.04 }}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all"
                >
                  {i < 3 ? (
                    <div className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 ${medalColors[i]}`}>
                      <MedalIcon className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <span className="text-xs font-bold text-muted-foreground w-6 text-center shrink-0">{i + 1}</span>
                  )}
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-500/40 to-cyan-400/20 border border-white/10 flex items-center justify-center text-xs font-bold shrink-0">
                    {op.username[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold truncate">{op.username}</span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">{op.count.toLocaleString("pt-BR")}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, delay: 0.6 + i * 0.04, ease: "easeOut" }}
                        className={`h-full rounded-full ${i === 0 ? "bg-amber-400" : i === 1 ? "bg-slate-300" : i === 2 ? "bg-amber-600" : "bg-primary/60"}`}
                      />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Recent activity */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.3em]">{isAdmin ? "Atividade Recente" : "Minhas Consultas Recentes"}</h2>
          <Link href="/consultas" className="text-[10px] uppercase tracking-widest text-primary hover:text-primary/80 flex items-center gap-1">
            Ver todas <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        {data.recentes.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">Nenhuma consulta registrada ainda.</div>
        ) : (
          <div className="space-y-2">
            {data.recentes.slice(0, isAdmin ? 10 : 8).map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + i * 0.04 }}
                className="group flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${TIPO_GRADIENT[item.tipo] ?? "from-primary to-primary"} flex items-center justify-center text-black font-bold text-[10px] uppercase shrink-0`}>
                    {(TIPO_LABEL[item.tipo] ?? item.tipo).slice(0, 3)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-sm truncate">{item.query}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                      {isAdmin && <span>{item.username} · </span>}
                      {new Date(item.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {!isAdmin && <span className="ml-1 text-primary/50 font-semibold">{TIPO_LABEL[item.tipo] ?? item.tipo}</span>}
                    </div>
                  </div>
                </div>
                <div className="shrink-0">
                  {item.success ? (
                    <span className="text-[10px] uppercase tracking-widest text-emerald-300 bg-emerald-400/10 border border-emerald-400/30 px-2 py-1 rounded-md">Sucesso</span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-widest text-amber-300 bg-amber-400/10 border border-amber-400/30 px-2 py-1 rounded-md flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Falha
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      <div className="text-center text-[10px] uppercase tracking-[0.5em] text-muted-foreground/60 pt-4">
        Made by blxckxyz · Infinity Search
      </div>
    </div>
  );
}
