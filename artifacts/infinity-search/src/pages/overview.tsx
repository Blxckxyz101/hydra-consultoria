import { useInfinityOverview, getInfinityOverviewQueryKey } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Activity, Users, Search, Clock, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function Overview() {
  const { data, isLoading, error } = useInfinityOverview({
    query: { queryKey: getInfinityOverviewQueryKey() }
  });

  if (isLoading) {
    return <div className="animate-pulse flex space-x-4">Carregando dados...</div>;
  }

  if (error || !data) {
    return <div className="text-destructive">Erro ao carregar dados.</div>;
  }

  const statCards = [
    { label: "Total de Consultas", value: data.totalConsultas, icon: Activity },
    { label: "Consultas Hoje", value: data.consultasHoje, icon: Clock },
    { label: "Consultas na Semana", value: data.consultasSemana, icon: Search },
    { label: "Operadores Ativos", value: data.usuariosAtivos, icon: Users },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-widest neon-text uppercase mb-8">Centro de Comando</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {statCards.map((stat, idx) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="glass-panel p-6 rounded-xl flex items-center justify-between"
          >
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">{stat.label}</p>
              <p className="text-3xl font-bold text-foreground">{stat.value}</p>
            </div>
            <stat.icon className="w-8 h-8 text-primary/50" />
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="glass-panel p-6 rounded-xl"
        >
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-6">Distribuição de Consultas</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.consultasPorTipo}>
                <XAxis dataKey="tipo" stroke="rgba(255,255,255,0.5)" fontSize={12} />
                <YAxis stroke="rgba(255,255,255,0.5)" fontSize={12} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: 'rgba(10,15,25,0.9)', border: '1px solid rgba(255,255,255,0.1)' }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="glass-panel p-6 rounded-xl overflow-hidden flex flex-col"
        >
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-6">Atividade Recente</h2>
          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {data.recentes.map((item) => (
              <div key={item.id} className="bg-black/30 border border-white/5 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase text-primary bg-primary/10 px-2 py-0.5 rounded">{item.tipo}</span>
                    <span className="font-mono text-sm">{item.query}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Operador: {item.username} • {new Date(item.createdAt).toLocaleString('pt-BR')}
                  </div>
                </div>
                {!item.success && <AlertTriangle className="w-5 h-5 text-destructive" />}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
