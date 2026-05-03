import { useInfinityOverview, useInfinityMe, getInfinityOverviewQueryKey, getInfinityMeQueryKey } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Activity, Users, Search, Clock, AlertTriangle, TrendingUp, Sparkles, ArrowUpRight, Zap } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { Link } from "wouter";
import { InfinityLoader } from "@/components/ui/InfinityLoader";
import { ExpiryBadge } from "@/components/ui/ExpiryBadge";

const TIPO_LABEL: Record<string, string> = {
  cpf: "CPF", cnpj: "CNPJ", telefone: "Telefone", sipni: "SIPNI",
};

const TIPO_GRADIENT: Record<string, string> = {
  cpf: "from-sky-400 to-cyan-300",
  cnpj: "from-violet-400 to-fuchsia-300",
  telefone: "from-emerald-400 to-teal-300",
  sipni: "from-amber-400 to-orange-300",
};

function buildHeatmap(recentes: Array<{ createdAt: string }>) {
  const today = new Date();
  const days: Array<{ date: Date; count: number; iso: string }> = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    d.setHours(0, 0, 0, 0);
    days.push({ date: d, count: 0, iso: d.toISOString().slice(0, 10) });
  }
  const idx = new Map(days.map((d, i) => [d.iso, i]));
  for (const r of recentes) {
    const iso = new Date(r.createdAt).toISOString().slice(0, 10);
    const i = idx.get(iso);
    if (i !== undefined) days[i].count++;
  }
  return days;
}

function buildTrend(recentes: Array<{ createdAt: string }>) {
  const buckets = new Array(7).fill(0).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { day: d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3), v: 0 };
  });
  const today = new Date();
  for (const r of recentes) {
    const diff = Math.floor((today.getTime() - new Date(r.createdAt).getTime()) / 86400000);
    if (diff >= 0 && diff < 7) buckets[6 - diff].v++;
  }
  return buckets;
}

export default function Overview() {
  const { data, isLoading, error } = useInfinityOverview({
    query: { queryKey: getInfinityOverviewQueryKey() },
  });
  const { data: me } = useInfinityMe({ query: { queryKey: getInfinityMeQueryKey() } });

  if (isLoading) {
    return (
      <div className="py-24 flex items-center justify-center">
        <InfinityLoader label="Sincronizando comando" />
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

  const heatmap = buildHeatmap(data.recentes);
  const trend = buildTrend(data.recentes);
  const maxHeat = Math.max(1, ...heatmap.map((h) => h.count));
  const successRate = data.totalConsultas > 0
    ? Math.round((data.recentes.filter((r) => r.success).length / data.recentes.length) * 100)
    : 0;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  const statCards = [
    { label: "Consultas Totais", value: data.totalConsultas, icon: Activity, hint: "histórico completo", color: "from-sky-500/30 to-cyan-400/10", iconColor: "text-sky-300" },
    { label: "Hoje", value: data.consultasHoje, icon: Clock, hint: "últimas 24h", color: "from-violet-500/30 to-fuchsia-400/10", iconColor: "text-violet-300" },
    { label: "Esta Semana", value: data.consultasSemana, icon: Search, hint: "últimos 7 dias", color: "from-emerald-500/30 to-teal-400/10", iconColor: "text-emerald-300" },
    { label: "Operadores", value: data.usuariosAtivos, icon: Users, hint: "contas ativas", color: "from-amber-500/30 to-orange-400/10", iconColor: "text-amber-300" },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-sky-500/15 via-cyan-400/5 to-violet-500/10 p-6 sm:p-10 backdrop-blur-2xl"
      >
        <motion.div
          aria-hidden
          className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-sky-400/20 blur-3xl"
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-violet-400/15 blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.5em] text-primary/80 mb-3">
              <Sparkles className="w-3 h-3" /> Centro de Comando
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
              {greet}, <span className="bg-gradient-to-r from-sky-300 via-cyan-200 to-violet-300 bg-clip-text text-transparent">{me?.username ?? "operador"}</span>
            </h1>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-xl">
              Aqui está o panorama da sua operação. {data.consultasHoje > 0
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
              <div className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mb-1">Tendência 7d</div>
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
      </motion.div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {statCards.map((stat, idx) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + idx * 0.07 }}
            whileHover={{ y: -3 }}
            className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${stat.color} p-4 sm:p-5 backdrop-blur-xl transition-all hover:border-white/20`}
          >
            <div className="absolute inset-0 bg-black/30" />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2 truncate">{stat.label}</p>
                <p className="text-2xl sm:text-3xl font-bold">{stat.value.toLocaleString("pt-BR")}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1">{stat.hint}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center ${stat.iconColor} group-hover:scale-110 transition-transform`}>
                <stat.icon className="w-5 h-5" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Heatmap */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-foreground">Atividade · Últimos 84 dias</h2>
            <p className="text-[10px] text-muted-foreground mt-1">Cada quadrado é um dia. Mais escuro = mais consultas.</p>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">
            <span>menos</span>
            {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
              <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgba(56,189,248,${0.1 + v * 0.6})` }} />
            ))}
            <span>mais</span>
          </div>
        </div>
        <div className="grid grid-rows-7 grid-flow-col gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar">
          {heatmap.map((d) => {
            const intensity = d.count / maxHeat;
            return (
              <motion.div
                key={d.iso}
                whileHover={{ scale: 1.4 }}
                className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-sm cursor-help relative group"
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

      {/* Charts row */}
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
              <div className="text-xs text-muted-foreground text-center py-8">Sem dados ainda. Realize sua primeira consulta.</div>
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
          <h2 className="text-sm font-semibold uppercase tracking-[0.3em] mb-5">Volume por Categoria</h2>
          <div className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.consultasPorTipo.map((p) => ({ ...p, tipo: TIPO_LABEL[p.tipo] ?? p.tipo }))}>
                <defs>
                  <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(56,189,248)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="rgb(139,92,246)" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="tipo" stroke="rgba(255,255,255,0.5)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  contentStyle={{
                    backgroundColor: "rgba(10,15,25,0.95)",
                    border: "1px solid rgba(56,189,248,0.3)",
                    borderRadius: 12,
                    backdropFilter: "blur(12px)",
                  }}
                />
                <Bar dataKey="count" fill="url(#bar-grad)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Recent activity */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.3em]">Atividade Recente</h2>
          <Link href="/consultas" className="text-[10px] uppercase tracking-widest text-primary hover:text-primary/80 flex items-center gap-1">
            Ver todas <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        {data.recentes.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">Nenhuma consulta registrada ainda.</div>
        ) : (
          <div className="space-y-2">
            {data.recentes.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.55 + i * 0.04 }}
                className="group flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${TIPO_GRADIENT[item.tipo] ?? "from-primary to-primary"} flex items-center justify-center text-black font-bold text-[10px] uppercase shrink-0`}>
                    {(TIPO_LABEL[item.tipo] ?? item.tipo).slice(0, 3)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-sm truncate">{item.query}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                      {item.username} · {new Date(item.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
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
