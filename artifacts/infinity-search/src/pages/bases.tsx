import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Activity, RefreshCw, Wifi, WifiOff, Clock, Database,
  Syringe, Building2, Server, AlertTriangle, CheckCircle2,
} from "lucide-react";

type BaseStatus = {
  id: string;
  name: string;
  description: string;
  online: boolean;
  ms: number;
  http: number;
};

const BASE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; accent: string }> = {
  geass: { icon: Database, color: "from-sky-500/20 to-cyan-400/5", accent: "text-sky-300" },
  sipni: { icon: Syringe, color: "from-violet-500/20 to-fuchsia-400/5", accent: "text-violet-300" },
  sisreg: { icon: Building2, color: "from-rose-500/20 to-pink-400/5", accent: "text-rose-300" },
};

function latencyColor(ms: number, online: boolean): string {
  if (!online) return "text-rose-400";
  if (ms < 400) return "text-emerald-400";
  if (ms < 1200) return "text-amber-400";
  return "text-rose-400";
}

function latencyLabel(ms: number, online: boolean): string {
  if (!online) return "Offline";
  if (ms < 400) return "Rápido";
  if (ms < 1200) return "Normal";
  return "Lento";
}

export default function Bases() {
  const [bases, setBases] = useState<BaseStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/bases/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const data = await r.json();
        setBases(data);
        setLastChecked(new Date());
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, []);

  const online = bases.filter((b) => b.online).length;
  const total = bases.length;

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
            Monitor de Bases
          </motion.h1>
          <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
            Status em tempo real de todas as fontes de dados
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastChecked && (
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {lastChecked.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-400/10 border border-sky-400/30 text-sky-300 text-xs font-bold uppercase tracking-widest hover:bg-sky-400/20 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Verificar
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5"
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${online === total && total > 0 ? "bg-emerald-400/10 border-emerald-400/30" : online === 0 ? "bg-rose-400/10 border-rose-400/30" : "bg-amber-400/10 border-amber-400/30"}`}>
              <Server className={`w-5 h-5 ${online === total && total > 0 ? "text-emerald-300" : online === 0 ? "text-rose-300" : "text-amber-300"}`} />
            </div>
            <div>
              <div className="text-2xl font-bold">
                <span className="text-emerald-300">{online}</span>
                <span className="text-muted-foreground text-lg"> / {total}</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">bases online</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-400/10 border border-emerald-400/20">
              <div className="relative">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              </div>
              <span className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">Monitorando</span>
            </div>
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">Atualiza a cada 60s</span>
          </div>
        </div>

        {/* Progress bar */}
        {total > 0 && (
          <div className="mt-4 h-1.5 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(online / total) * 100}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className={`h-full rounded-full ${online === total ? "bg-emerald-400" : online === 0 ? "bg-rose-400" : "bg-amber-400"}`}
            />
          </div>
        )}
      </motion.div>

      {/* Base cards */}
      {loading && bases.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl p-6 animate-pulse h-48" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bases.map((base, i) => {
            const meta = BASE_META[base.id] ?? { icon: Activity, color: "from-white/10 to-white/0", accent: "text-primary" };
            const Icon = meta.icon;
            return (
              <motion.div
                key={base.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${meta.color} backdrop-blur-xl p-5 ${base.online ? "border-white/10" : "border-rose-500/20"}`}
              >
                <div className="absolute inset-0 bg-black/30" />
                <div className="relative space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className={`p-2.5 rounded-xl bg-white/5 border border-white/10`}>
                      <Icon className={`w-5 h-5 ${meta.accent}`} />
                    </div>
                    {base.online ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25">
                        <div className="relative">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        </div>
                        <span className="text-[9px] uppercase tracking-wider text-emerald-300 font-semibold">Online</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/25">
                        <WifiOff className="w-2.5 h-2.5 text-rose-400" />
                        <span className="text-[9px] uppercase tracking-wider text-rose-400 font-semibold">Offline</span>
                      </div>
                    )}
                  </div>

                  {/* Name & description */}
                  <div>
                    <p className={`text-sm font-bold uppercase tracking-[0.2em] ${meta.accent}`}>{base.name}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">{base.description}</p>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                      <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground/60 mb-1">Latência</p>
                      <p className={`text-lg font-bold ${latencyColor(base.ms, base.online)}`}>
                        {base.online ? `${base.ms}ms` : "—"}
                      </p>
                      <p className={`text-[9px] mt-0.5 ${latencyColor(base.ms, base.online)}`}>
                        {latencyLabel(base.ms, base.online)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                      <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground/60 mb-1">HTTP</p>
                      <p className={`text-lg font-bold ${base.online ? "text-emerald-300" : "text-rose-400"}`}>
                        {base.http || "—"}
                      </p>
                      <p className="text-[9px] mt-0.5 text-muted-foreground/40">
                        {base.online ? "Respondendo" : "Sem resposta"}
                      </p>
                    </div>
                  </div>

                  {/* Status message */}
                  {!base.online && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/5 border border-rose-500/15">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <p className="text-[10px] text-rose-300/80">
                        {base.id === "sisreg"
                          ? "Bloqueado por IP — requer rede residencial brasileira"
                          : "Base indisponível no momento"}
                      </p>
                    </div>
                  )}
                  {base.online && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <p className="text-[10px] text-emerald-300/80">Operacional e respondendo normalmente</p>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Info note */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 flex items-start gap-3"
      >
        <Wifi className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground/70 leading-relaxed">
          <span className="text-sky-300 font-semibold">Nota:</span> O SISREG-III está inacessível a partir de IPs do datacenter (Replit/cloud).
          O acesso requer uma rede residencial brasileira. O SIPNI/DATASUS está operacional mas pode apresentar
          instabilidade intermitente. A Geass API é a fonte primária recomendada.
        </div>
      </motion.div>

      <div className="text-center text-[10px] uppercase tracking-[0.5em] text-muted-foreground/60 pt-2">
        Made by blxckxyz · Infinity Search
      </div>
    </div>
  );
}
