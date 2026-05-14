import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, RefreshCw, Wifi, WifiOff, Clock, Database,
  Server, AlertTriangle, CheckCircle2, ShieldAlert, Zap,
  Layers, Search, Car, User, Building2, Heart, Image,
  MapPin, FileText, CreditCard, ChevronDown, ChevronUp,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────
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

type ModuleInfo = {
  tipo: string;
  label: string;
  category: string;
  modulo: string;
  provider: string;
  special: boolean;
};

// ─── Category metadata ────────────────────────────────────────────────────────
const CAT_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  Pessoa:     { icon: User,      color: "text-sky-300",     bg: "bg-sky-500/10 border-sky-500/25" },
  Veículo:    { icon: Car,       color: "text-violet-300",  bg: "bg-violet-500/10 border-violet-500/25" },
  Empresa:    { icon: Building2, color: "text-amber-300",   bg: "bg-amber-500/10 border-amber-500/25" },
  Saúde:      { icon: Heart,     color: "text-rose-300",    bg: "bg-rose-500/10 border-rose-500/25" },
  Financeiro: { icon: CreditCard,color: "text-orange-300",  bg: "bg-orange-500/10 border-orange-500/25" },
  Endereço:   { icon: MapPin,    color: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/25" },
  Foto:       { icon: Image,     color: "text-pink-300",    bg: "bg-pink-500/10 border-pink-500/25" },
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
  brasilapi: { icon: Activity,  color: "from-green-500/20 to-emerald-400/5",   accent: "text-green-300",   offlineColor: "from-rose-500/15 to-rose-400/5" },
  cnpjws:    { icon: Building2, color: "from-orange-500/20 to-amber-400/5",    accent: "text-orange-300",  offlineColor: "from-rose-500/15 to-rose-400/5" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function latencyColor(ms: number, online: boolean) {
  if (!online) return "text-rose-400";
  if (ms < 400) return "text-emerald-400";
  if (ms < 1500) return "text-amber-400";
  return "text-rose-400";
}

function latencyLabel(ms: number, online: boolean) {
  if (!online) return "Offline";
  if (ms < 400) return "Rápido";
  if (ms < 1500) return "Normal";
  return "Lento";
}

function StatusBadge({ base }: { base: BaseStatus }) {
  if (!base.online) return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/25">
      <WifiOff className="w-2.5 h-2.5 text-rose-400" />
      <span className="text-[9px] uppercase tracking-wider text-rose-400 font-semibold">Offline</span>
    </div>
  );
  if (base.circuitOpen) return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25">
      <ShieldAlert className="w-2.5 h-2.5 text-amber-400" />
      <span className="text-[9px] uppercase tracking-wider text-amber-400 font-semibold">Proteção</span>
    </div>
  );
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
  if (!base.online && base.circuitOpen) return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/5 border border-rose-500/15">
      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
      <p className="text-[10px] text-rose-300/80">Base offline — circuit breaker ativo, requisições bloqueadas por até 90s</p>
    </div>
  );
  if (!base.online) return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/5 border border-rose-500/15">
      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
      <p className="text-[10px] text-rose-300/80">
        {base.id === "geass"
          ? "API offline — sistema usando Skylers como fallback"
          : "Base indisponível — usando bases alternativas"}
      </p>
    </div>
  );
  if (base.circuitOpen) return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
      <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <p className="text-[10px] text-amber-300/80">Circuit breaker ativo — aguardando estabilização (90s)</p>
    </div>
  );
  return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      <p className="text-[10px] text-emerald-300/80">Operacional e respondendo normalmente</p>
    </div>
  );
}

// ─── Module card ─────────────────────────────────────────────────────────────
function ModuleCard({ mod, skyOnline, hydraOnline }: { mod: ModuleInfo; skyOnline: boolean; hydraOnline: boolean }) {
  const isOnline = mod.provider === "skylers" ? skyOnline : hydraOnline;
  const catMeta = CAT_META[mod.category] ?? { icon: Activity, color: "text-primary", bg: "bg-white/5 border-white/10" };
  const CatIcon = catMeta.icon;

  return (
    <div className={`relative rounded-xl border p-3 transition-all ${
      isOnline
        ? mod.special
          ? "border-amber-500/20 bg-amber-500/[0.04]"
          : "border-white/8 bg-white/[0.025]"
        : "border-rose-500/20 bg-rose-500/[0.04]"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-lg border ${catMeta.bg} shrink-0`}>
            <CatIcon className={`w-3 h-3 ${catMeta.color}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{mod.label}</p>
            <p className="text-[9px] text-muted-foreground/50 font-mono truncate">{mod.tipo}</p>
          </div>
        </div>
        <div className="shrink-0">
          {!isOnline ? (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20">
              <WifiOff className="w-2 h-2 text-rose-400" />
              <span className="text-[8px] text-rose-400 font-bold uppercase tracking-wide">Off</span>
            </div>
          ) : mod.special ? (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
              <ShieldAlert className="w-2 h-2 text-amber-400" />
              <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wide">Especial</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1 h-1 rounded-full bg-emerald-400" />
              <span className="text-[8px] text-emerald-400 font-bold uppercase tracking-wide">On</span>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 px-1">
        <p className="text-[8px] font-mono text-muted-foreground/40 truncate">{mod.modulo}</p>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function Bases() {
  const [bases, setBases] = useState<BaseStatus[]>([]);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [tab, setTab] = useState<"bases" | "modulos">("bases");
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState("Todos");
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});

  const fetchAll = async () => {
    setLoading(true);
    const token = localStorage.getItem("infinity_token");
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/infinity/bases/status", { headers }),
        fetch("/api/infinity/bases/modules", { headers }),
      ]);
      if (r1.ok) setBases(await r1.json());
      if (r2.ok) setModules(await r2.json());
      setLastChecked(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 60_000);
    return () => clearInterval(iv);
  }, []);

  // ── Base stats ─────────────────────────────────────────────────────────────
  const online   = bases.filter((b) => b.online && !b.circuitOpen).length;
  const degraded = bases.filter((b) => b.online && b.circuitOpen).length;
  const offline  = bases.filter((b) => !b.online).length;
  const total    = bases.length;
  const overallStatus = offline === total && total > 0 ? "critical"
    : offline > 0 || degraded > 0 ? "degraded" : "ok";

  // ── Module filtering ──────────────────────────────────────────────────────
  const skyOnline   = bases.find((b) => b.id === "skylers")?.online ?? true;
  const hydraOnline = bases.find((b) => b.id === "geass")?.online ?? false;

  const categories = useMemo(() => {
    const cats = new Set(modules.map((m) => m.category));
    return ["Todos", ...Array.from(cats)];
  }, [modules]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return modules.filter((m) => {
      const matchCat = activeCat === "Todos" || m.category === activeCat;
      const matchQ = !q || m.label.toLowerCase().includes(q) || m.tipo.toLowerCase().includes(q) || m.modulo.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }, [modules, activeCat, search]);

  // Group by category
  const grouped = useMemo(() => {
    const map: Record<string, ModuleInfo[]> = {};
    for (const m of filtered) {
      if (!map[m.category]) map[m.category] = [];
      map[m.category].push(m);
    }
    return map;
  }, [filtered]);

  const modOnline  = modules.filter((m) => m.provider === "skylers" ? skyOnline : hydraOnline).length;
  const modSpecial = modules.filter((m) => m.special).length;
  const modTotal   = modules.length;

  const toggleCat = (cat: string) =>
    setExpandedCats((prev) => ({ ...prev, [cat]: !prev[cat] }));

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
            Status em tempo real · APIs · Módulos OSINT
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
            onClick={fetchAll}
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
            {/* APIs */}
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

            {/* Módulos */}
            {modTotal > 0 && (
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center border bg-violet-400/10 border-violet-400/30">
                  <Layers className="w-5 h-5 text-violet-300" />
                </div>
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-violet-300">{modOnline}</span>
                    <span className="text-muted-foreground text-lg"> / {modTotal}</span>
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">módulos ativos</div>
                </div>
              </div>
            )}

            {/* Pills */}
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
              {modSpecial > 0 && (
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-1">
                  <ShieldAlert className="w-3 h-3" /> {modSpecial} acesso especial
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

      {/* Tab switcher */}
      <div className="flex gap-2">
        {(["bases", "modulos"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl border text-xs font-bold uppercase tracking-widest transition-all ${
              tab === t
                ? "bg-sky-400/15 border-sky-400/40 text-sky-300"
                : "bg-white/[0.03] border-white/10 text-muted-foreground hover:bg-white/[0.06]"
            }`}
          >
            {t === "bases" ? <Server className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5" />}
            {t === "bases" ? `Bases (${total})` : `Módulos (${modTotal})`}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── BASES TAB ─────────────────────────────────────────────────────── */}
        {tab === "bases" && (
          <motion.div
            key="bases"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {loading && bases.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[0,1,2,3,4,5].map((i) => (
                  <div key={i} className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl p-6 animate-pulse h-52" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {bases.map((base, i) => {
                  const meta = BASE_META[base.id] ?? { icon: Activity, color: "from-white/10 to-white/0", accent: "text-primary", offlineColor: "from-rose-500/15 to-rose-400/5" };
                  const Icon = meta.icon;
                  const grad = !base.online ? meta.offlineColor : meta.color;
                  const border = !base.online ? "border-rose-500/20" : base.circuitOpen ? "border-amber-500/20" : "border-white/10";
                  return (
                    <motion.div
                      key={base.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.07 }}
                      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${grad} backdrop-blur-xl p-5 ${border}`}
                    >
                      <div className="absolute inset-0 bg-black/30" />
                      <div className="relative space-y-4">
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
                        <div>
                          <p className={`text-sm font-bold uppercase tracking-[0.2em] ${meta.accent}`}>{base.name}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">{base.description}</p>
                        </div>
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
              className="mt-6 rounded-2xl border border-white/8 bg-white/[0.02] p-5 flex items-start gap-3"
            >
              <Wifi className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground/70 leading-relaxed space-y-1.5">
                <p>
                  <span className="text-rose-300 font-semibold">Hydra API</span> está offline — o sistema usa a{" "}
                  <span className="text-violet-300 font-semibold">Skylers API</span> como fallback para 80+ tipos.
                </p>
                <p>
                  <span className="text-emerald-300 font-semibold">ViaCEP</span> → fallback automático CEP.{" "}
                  <span className="text-amber-300 font-semibold">ReceitaWS</span> →{" "}
                  <span className="text-green-300 font-semibold">BrasilAPI</span> →{" "}
                  <span className="text-orange-300 font-semibold">CNPJ.ws</span> em cascata para CNPJ.
                </p>
                <p className="text-muted-foreground/50">
                  <span className="font-semibold">Circuit breaker:</span> após 3 falhas de rede, requisições bloqueadas por 90s. Badge "Proteção" indica esse estado.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* ── MÓDULOS TAB ────────────────────────────────────────────────────── */}
        {tab === "modulos" && (
          <motion.div
            key="modulos"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            {/* Legend */}
            <div className="flex flex-wrap gap-3 text-[10px]">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-muted-foreground">Online — módulo acessível</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="w-3 h-3 text-amber-400" />
                <span className="text-muted-foreground">Acesso especial — token premium necessário</span>
              </div>
              <div className="flex items-center gap-1.5">
                <WifiOff className="w-3 h-3 text-rose-400" />
                <span className="text-muted-foreground">Offline — API provedor fora do ar</span>
              </div>
            </div>

            {/* Search + Category filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar módulo… (ex: cpf, placa, foto)"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-sky-400/40 focus:bg-white/[0.06] transition-all"
                />
              </div>
            </div>

            {/* Category pills */}
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const meta = CAT_META[cat];
                const Icon = meta?.icon;
                const count = cat === "Todos" ? modules.length : modules.filter((m) => m.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCat(cat)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-all ${
                      activeCat === cat
                        ? "bg-sky-400/15 border-sky-400/40 text-sky-300"
                        : "bg-white/[0.03] border-white/10 text-muted-foreground hover:bg-white/[0.07]"
                    }`}
                  >
                    {Icon && <Icon className="w-3 h-3" />}
                    {cat} <span className="opacity-60">({count})</span>
                  </button>
                );
              })}
            </div>

            {/* Skylers / Hydra status banners */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className={`flex items-center gap-3 p-3 rounded-xl border ${skyOnline ? "bg-violet-500/5 border-violet-500/20" : "bg-rose-500/5 border-rose-500/20"}`}>
                <Zap className={`w-4 h-4 ${skyOnline ? "text-violet-400" : "text-rose-400"}`} />
                <div>
                  <p className="text-xs font-bold text-foreground">Skylers API</p>
                  <p className="text-[10px] text-muted-foreground/60">
                    {skyOnline ? "Online — todos os módulos Skylers acessíveis" : "Offline — módulos Skylers indisponíveis"}
                  </p>
                </div>
                <div className="ml-auto">
                  {skyOnline
                    ? <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    : <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  }
                </div>
              </div>
              <div className={`flex items-center gap-3 p-3 rounded-xl border ${hydraOnline ? "bg-sky-500/5 border-sky-500/20" : "bg-rose-500/5 border-rose-500/20"}`}>
                <Database className={`w-4 h-4 ${hydraOnline ? "text-sky-400" : "text-rose-400"}`} />
                <div>
                  <p className="text-xs font-bold text-foreground">Hydra API</p>
                  <p className="text-[10px] text-muted-foreground/60">
                    {hydraOnline ? "Online — módulos Hydra acessíveis" : "Offline — usando Skylers como fallback"}
                  </p>
                </div>
                <div className="ml-auto">
                  {hydraOnline
                    ? <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    : <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  }
                </div>
              </div>
            </div>

            {/* Module grid grouped by category */}
            {loading && modules.length === 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-white/8 bg-black/20 h-20 animate-pulse" />
                ))}
              </div>
            ) : Object.keys(grouped).length === 0 ? (
              <div className="text-center py-16 text-muted-foreground/40 text-sm">
                Nenhum módulo encontrado para "{search}"
              </div>
            ) : (
              <div className="space-y-5">
                {Object.entries(grouped).map(([cat, mods]) => {
                  const meta = CAT_META[cat];
                  const CatIcon = meta?.icon ?? Activity;
                  const catOnline = mods.filter((m) => m.provider === "skylers" ? skyOnline : hydraOnline).length;
                  const isExpanded = expandedCats[cat] !== false; // default expanded
                  return (
                    <div key={cat} className="rounded-2xl border border-white/8 bg-white/[0.015] overflow-hidden">
                      {/* Category header */}
                      <button
                        onClick={() => toggleCat(cat)}
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.03] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`p-1.5 rounded-lg border ${meta?.bg ?? "bg-white/5 border-white/10"}`}>
                            <CatIcon className={`w-4 h-4 ${meta?.color ?? "text-primary"}`} />
                          </div>
                          <span className={`text-sm font-bold uppercase tracking-[0.15em] ${meta?.color ?? "text-primary"}`}>{cat}</span>
                          <span className="text-[10px] text-muted-foreground/50">{mods.length} módulos</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-emerald-400 font-semibold">{catOnline}/{mods.length} on</span>
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4 text-muted-foreground/40" />
                            : <ChevronDown className="w-4 h-4 text-muted-foreground/40" />
                          }
                        </div>
                      </button>
                      {/* Module grid */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 p-4 pt-0">
                              {mods.map((mod) => (
                                <ModuleCard
                                  key={mod.tipo}
                                  mod={mod}
                                  skyOnline={skyOnline}
                                  hydraOnline={hydraOnline}
                                />
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Note about special modules */}
            <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.03] p-5 flex items-start gap-3">
              <ShieldAlert className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground/70 leading-relaxed space-y-1">
                <p>
                  <span className="text-amber-300 font-semibold">Módulos com acesso especial</span> (Placa SERPRO, Placa FIPE, CNH Full, Vistoria, CrediLink) requerem um token Skylers com permissão premium.
                </p>
                <p className="text-muted-foreground/50">
                  Se esses módulos retornam erro de autenticação, o token atual não cobre esse endpoint. Renove o <code className="text-amber-300/70 bg-amber-500/10 px-1 rounded">SKYLERS_TOKEN</code> ou use uma consulta alternativa.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="text-center text-[10px] uppercase tracking-[0.5em] text-muted-foreground/60 pt-2">
        Hydra Consultoria
      </div>
    </div>
  );
}
