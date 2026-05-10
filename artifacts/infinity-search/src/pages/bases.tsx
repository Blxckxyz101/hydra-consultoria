import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Activity, RefreshCw, Wifi, WifiOff, Clock, Database,
  Building2, Server, AlertTriangle, CheckCircle2,
  MapPin, FileText, Building, Globe, ShieldAlert, Zap,
} from "lucide-react";

type BaseStatus = {
  id: string;
  name: string;
  description: string;
  online: boolean;
  ms: number;
  http: number;
  circuitOpen?: boolean;
  role?: string;
};

const BASE_META: Record<string, {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  accent: string;
  offlineColor: string;
}> = {
  geass:     { icon: Database,  color: "from-sky-500/20 to-cyan-400/5",        accent: "text-sky-300",     offlineColor: "from-rose-500/15 to-rose-400/5" },
  skylers:   { icon: Zap,       color: "from-violet-500/20 to-purple-400/5",   accent: "text-violet-300",  offlineColor: "from-amber-500/15 to-amber-400/5" },
  viacep:    { icon: MapPin,    color: "from-emerald-500/20 to-teal-400/5",    accent: "text-emerald-300", offlineColor: "from-rose-500/15 to-rose-400/5" },
  receitaws: { icon: FileText,  color: "from-amber-500/20 to-yellow-400/5",    accent: "text-amber-300",   offlineColor: "from-rose-500/15 to-rose-400/5" },
  brasilapi: { icon: Globe,     color: "from-green-500/20 to-emerald-400/5",   accent: "text-green-300",   offlineColor: "from-rose-500/15 to-rose-400/5" },
  cnpjws:    { icon: Building,  color: "from-orange-500/20 to-amber-400/5",    accent: "text-orange-300",  offlineColor: "from-rose-500/15 to-rose-400/5" },
};

function latencyColor(ms: number, online: boolean): string {
  if (!online) return "text-rose-400";
  if (ms < 400)  return "text-emerald-400";
  if (ms < 1500) return "text-amber-400";
  return "text-rose-400";
}

function latencyLabel(ms: number, online: boolean): string {
  if (!online) return "Offline";
  if (ms < 400)  return "Rápido";
  if (ms < 1500) return "Normal";
  return "Lento";
}

function StatusBadge({ base }: { base: BaseStatus }) {
  if (!base.online) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/25">
        <WifiOff className="w-2.5 h-2.5 text-rose-400" />
        <span className="text-[9px] uppercase tracking-wider text-rose-400 font-semibold">Offline</span>
      </div>
    );
  }
  if (base.circuitOpen) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25">
        <ShieldAlert className="w-2.5 h-2.5 text-amber-400" />
        <span className="text-[9px] uppercase tracking-wider text-amber-400 font-semibold">Proteção</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25">
      <div className="relative">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
      </div>
      <span className="text-[9px] uppercase tracking-wider text-emerald-300 font-semibold">Online</span>
    </div>
  );
}

function StatusMessage({ base }: { base: BaseStatus }) {
  if (!base.online && base.circuitOpen) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/5 border border-rose-500/15">
        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
        <p className="text-[10px] text-rose-300/80">
          Base offline — circuit breaker ativo, requisições bloqueadas por até 90s
        </p>
      </div>
    );
  }
  if (!base.online) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/5 border border-rose-500/15">
        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
        <p className="text-[10px] text-rose-300/80">
          {base.id === "geass"
            ? "API offline permanentemente — sistema usando Skylers como fallback"
            : "Base indisponível no momento — usando bases alternativas"}
        </p>
      </div>
    );
  }
  if (base.circuitOpen) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
        <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <p className="text-[10px] text-amber-300/80">
          Servidor respondendo, mas circuit breaker ativo — aguardando estabilização (90s)
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      <p className="text-[10px] text-emerald-300/80">Operacional e respondendo normalmente</p>
    </div>
  );
}

function borderClass(base: BaseStatus): string {
  if (!base.online) return "border-rose-500/20";
  if (base.circuitOpen) return "border-amber-500/20";
  return "border-white/10";
}

function gradientClass(base: BaseStatus): string {
  const meta = BASE_META[base.id];
  if (!meta) return "from-white/5 to-white/0";
  if (!base.online) return meta.offlineColor;
  return meta.color;
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

  const online  = bases.filter((b) => b.online && !b.circuitOpen).length;
  const degraded = bases.filter((b) => b.online && b.circuitOpen).length;
  const offline = bases.filter((b) => !b.online).length;
  const total   = bases.length;

  const overallStatus = offline === total && total > 0
    ? "critical" : offline > 0 || degraded > 0
    ? "degraded" : "ok";

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
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
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border ${
                overallStatus === "ok" ? "bg-emerald-400/10 border-emerald-400/30"
                : overallStatus === "degraded" ? "bg-amber-400/10 border-amber-400/30"
                : "bg-rose-400/10 border-rose-400/30"
              }`}>
                <Server className={`w-5 h-5 ${
                  overallStatus === "ok" ? "text-emerald-300"
                  : overallStatus === "degraded" ? "text-amber-300"
                  : "text-rose-300"
                }`} />
              </div>
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-emerald-300">{online}</span>
                  {degraded > 0 && <span className="text-lg font-bold text-amber-300">+{degraded}⚠</span>}
                  <span className="text-muted-foreground text-lg"> / {total}</span>
                </div>
                <div className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">bases online</div>
              </div>
            </div>

            {/* Status pills */}
            <div className="flex items-center gap-2 flex-wrap">
              {offline > 0 && (
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-rose-400 bg-rose-400/10 border border-rose-400/20 rounded-full px-2.5 py-1">
                  <WifiOff className="w-3 h-3" /> {offline} offline
                </span>
              )}
              {degraded > 0 && (
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-1">
                  <ShieldAlert className="w-3 h-3" /> {degraded} protegido
                </span>
              )}
              {online === total && total > 0 && (
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2.5 py-1">
                  <CheckCircle2 className="w-3 h-3" /> Todas operacionais
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-400/10 border border-sky-400/20">
            <div className="relative">
              <div className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
            </div>
            <span className="text-[10px] uppercase tracking-widest text-sky-300 font-semibold">Monitorando · 60s</span>
          </div>
        </div>

        {/* Progress bar */}
        {total > 0 && (
          <div className="mt-4 h-1.5 rounded-full bg-white/5 overflow-hidden flex">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(online / total) * 100}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="h-full bg-emerald-400"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(degraded / total) * 100}%` }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
              className="h-full bg-amber-400"
            />
          </div>
        )}
      </motion.div>

      {/* Base cards */}
      {loading && bases.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl p-6 animate-pulse h-52" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bases.map((base, i) => {
            const meta = BASE_META[base.id] ?? { icon: Activity, color: "from-white/10 to-white/0", accent: "text-primary", offlineColor: "from-rose-500/15 to-rose-400/5" };
            const Icon = meta.icon;
            return (
              <motion.div
                key={base.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${gradientClass(base)} backdrop-blur-xl p-5 ${borderClass(base)}`}
              >
                <div className="absolute inset-0 bg-black/30" />
                <div className="relative space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
                        <Icon className={`w-5 h-5 ${meta.accent}`} />
                      </div>
                      {base.role && (
                        <span className={`text-[8px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full border ${
                          base.role === "primary"
                            ? "text-sky-300 bg-sky-400/10 border-sky-400/20"
                            : "text-white/30 bg-white/5 border-white/10"
                        }`}>
                          {base.role === "primary" ? "Primária" : "Fallback"}
                        </span>
                      )}
                    </div>
                    <StatusBadge base={base} />
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
                      <p className={`text-lg font-bold ${
                        !base.online ? "text-rose-400"
                        : base.http < 300 ? "text-emerald-300"
                        : base.http < 500 ? "text-amber-300"
                        : "text-rose-400"
                      }`}>
                        {base.http || "—"}
                      </p>
                      <p className="text-[9px] mt-0.5 text-muted-foreground/40">
                        {!base.online ? "Sem resposta" : base.http < 300 ? "OK" : "Respondendo"}
                      </p>
                    </div>
                  </div>

                  <StatusMessage base={base} />
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
        <div className="text-xs text-muted-foreground/70 leading-relaxed space-y-1.5">
          <p>
            <span className="text-rose-300 font-semibold">Geass API</span> está offline — o sistema usa automaticamente a{" "}
            <span className="text-violet-300 font-semibold">Skylers API</span> como fallback para CPF, Nome, Placa, Telefone, Email e outros 80+ tipos.
          </p>
          <p>
            <span className="text-emerald-300 font-semibold">ViaCEP</span> é fallback automático para consultas de CEP.{" "}
            <span className="text-amber-300 font-semibold">ReceitaWS</span>{" "}→{" "}
            <span className="text-green-300 font-semibold">BrasilAPI</span>{" "}→{" "}
            <span className="text-orange-300 font-semibold">CNPJ.ws</span> atuam em cascata para CNPJ.
          </p>
          <p className="text-muted-foreground/50">
            <span className="font-semibold">Circuit breaker:</span> após 3 falhas consecutivas de rede, requisições são bloqueadas por 90s para proteger o sistema. O badge "Proteção" indica esse estado.
          </p>
        </div>
      </motion.div>

      <div className="text-center text-[10px] uppercase tracking-[0.5em] text-muted-foreground/60 pt-2">
        Infinity Search
      </div>
    </div>
  );
}
