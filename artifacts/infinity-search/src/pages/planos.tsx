import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Clock, Shield, Star, Zap, ArrowLeft, Copy, Check, Loader2, QrCode, User, Lock, Tag, X, Battery, BatteryFull, BatteryMedium, BatteryLow, Wallet, Crown, Flame, Sparkles, BarChart3, Minus, Camera, Coins, BookOpen, Palette, Bot, FolderOpen } from "lucide-react";

interface Plan {
  id: string;
  label: string;
  days: number;
  amountBrl: string;
  amountCents: number;
  queryQuota: number;
  tier?: "padrao" | "vip" | "ultra";
  dailyModuleLimit?: number;
  photoDailyLimit?: number;
  freeCredits?: number;
  highlight?: boolean;
}

interface RechargePack {
  id: string;
  label: string;
  credits: number;
  consultas: number;
  amountBrl: string;
  amountCents: number;
  highlight?: boolean;
}

const PLAN_ICONS: Record<string, React.ElementType> = {
  "1d":        Clock,
  "7d":        Zap,
  "14d":       Star,
  "30d":       Shield,
  "1d_vip":    Crown,
  "7d_vip":    Crown,
  "14d_vip":   Crown,
  "30d_vip":   Crown,
  "ultra_14d": Flame,
};

const RECHARGE_ICONS: RechargePack["id"][] = ["rc_micro", "rc_basico", "rc_padrao", "rc_avancado", "rc_pro"];
const RECHARGE_ICON_COMPONENTS = [BatteryLow, Battery, BatteryMedium, BatteryFull, BatteryFull];

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const apiFetch = (path: string, opts?: RequestInit) => {
  const token = localStorage.getItem("infinity_token");
  return fetch(`${BASE}/api/infinity${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
};

type Step = "plans" | "register" | "payment" | "success";
type PageMode = "plans" | "recharges";

interface PaymentData {
  paymentId: string;
  txid: string;
  pixCopiaECola: string;
  qrcode_base64: string;
  amountBrl: string;
  taxa?: number;
  plan?: { id: string; label: string; days: number };
  pack?: { id: string; label: string; credits: number; consultas: number };
  username?: string;
  mode: PageMode;
}

/* ─── Tier card (side-by-side comparison) ─── */
type TierKey = "padrao" | "vip" | "ultra";

interface TierFeature { icon: React.ElementType; label: string; padrao: string | null; vip: string | null; ultra: string | null; }

const TIER_FEATURES: TierFeature[] = [
  { icon: Zap,       label: "Consultas/dia",       padrao: "30 / módulo",  vip: "60 / módulo",   ultra: "200 / módulo" },
  { icon: Camera,    label: "Fotos/dia",            padrao: "10 fotos",     vip: "25 fotos",      ultra: "200 fotos"    },
  { icon: Coins,     label: "Créditos bônus",       padrao: null,           vip: "incluso",       ultra: "500 créditos" },
  { icon: BookOpen,  label: "Processos jurídicos",  padrao: null,           vip: "incluso",       ultra: "incluso"      },
  { icon: Palette,   label: "Temas de perfil",      padrao: "1 tema",       vip: "5 temas",       ultra: "todos"        },
  { icon: Bot,       label: "Assistente IA",        padrao: "incluso",      vip: "incluso",       ultra: "incluso"      },
  { icon: FolderOpen,label: "Dossiê e histórico",   padrao: "incluso",      vip: "incluso",       ultra: "incluso"      },
];

function TierCard({
  plan, tier, selected, disabled, onSelect, onSwitchDays,
}: { plan: Plan | null; tier: TierKey; selected: boolean; disabled: boolean; onSelect: () => void; onSwitchDays?: () => void }) {
  const isUltra = tier === "ultra";
  const isVip   = tier === "vip";

  const accentBorder = selected
    ? "border-primary/70 bg-primary/8 shadow-[0_0_28px_-6px_var(--color-primary)]"
    : disabled
    ? isUltra ? "border-rose-500/20 bg-rose-500/5 cursor-pointer hover:border-rose-500/40 transition-all"
    : isVip   ? "border-amber-400/20 bg-amber-500/5 cursor-pointer hover:border-amber-400/40 transition-all"
    :           "border-white/6 bg-black/20 opacity-40 cursor-not-allowed"
    : isUltra ? "border-rose-500/35 bg-rose-500/5 hover:border-rose-500/55"
    : isVip   ? "border-amber-400/35 bg-amber-500/5 hover:border-amber-400/55"
    :           "border-sky-500/25 bg-sky-500/3 hover:border-sky-500/45";

  const accentText = isUltra ? "text-rose-300" : isVip ? "text-amber-300" : "text-sky-300";
  const accentCheck = isUltra ? "text-rose-400" : isVip ? "text-amber-400" : "text-sky-400";
  const Icon = isUltra ? Flame : isVip ? Crown : Shield;

  const tierLabel = isUltra ? "Ultra" : isVip ? "VIP" : "Padrão";
  const tierSub = isUltra ? "Acesso máximo" : isVip ? "Acesso premium" : "Acesso completo";

  const featureValues: (string | null)[] = TIER_FEATURES.map(f =>
    tier === "ultra" ? f.ultra : tier === "vip" ? f.vip : f.padrao
  );

  const handleClick = () => {
    if (!disabled) { onSelect(); return; }
    if ((isUltra || isVip) && onSwitchDays) onSwitchDays();
  };

  return (
    <motion.button
      whileHover={{ scale: disabled && !onSwitchDays ? 1 : 1.015 }}
      whileTap={{ scale: disabled && !onSwitchDays ? 1 : 0.985 }}
      onClick={handleClick}
      className={`relative flex flex-col rounded-2xl border p-3 sm:p-4 transition-all duration-200 text-left w-full ${accentBorder}`}
    >
      {isVip && plan?.highlight && !selected && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[0.25em] font-black text-black bg-amber-400 px-2.5 py-0.5 rounded-full whitespace-nowrap">
          Mais popular
        </span>
      )}
      {selected && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[0.25em] font-black text-black px-2.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: "var(--color-primary)" }}>
          Selecionado
        </span>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-4 h-4 ${accentText}`} />
        {isUltra && <span className="text-[7px] font-black uppercase tracking-wider bg-rose-500/20 border border-rose-500/40 text-rose-300 px-1.5 py-0.5 rounded-full">ULTRA</span>}
        {isVip   && <span className="text-[7px] font-black uppercase tracking-wider bg-amber-400/15 border border-amber-400/35 text-amber-300 px-1.5 py-0.5 rounded-full">VIP</span>}
      </div>
      <div className={`font-black text-sm tracking-wide ${accentText}`}>{tierLabel}</div>
      <div className="text-[9px] text-muted-foreground uppercase tracking-[0.2em] mb-3">{tierSub}</div>

      {/* Price */}
      {plan ? (
        <div className="mb-3">
          <div className={`text-xl sm:text-2xl font-black leading-none ${accentText}`}>
            R$&nbsp;{plan.amountBrl}
          </div>
          <div className="text-[9px] text-muted-foreground mt-0.5">
            {plan.queryQuota} consultas · R$ {(plan.amountCents / plan.queryQuota / 100).toFixed(2).replace(".", ",")} cada
          </div>
        </div>
      ) : (
        <div className="mb-3">
          {(isUltra || isVip) && onSwitchDays ? (
            <div className={`text-[9px] font-semibold ${isUltra ? "text-rose-300/70" : "text-amber-300/70"}`}>
              ↩ Clique para ver em outro período
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground/60 italic">Indisponível<br/>neste período</div>
          )}
        </div>
      )}

      {/* Features */}
      <div className="space-y-1.5 pt-3 border-t border-white/5 flex-1">
        {featureValues.map((val, i) => {
          const Ico = TIER_FEATURES[i].icon;
          return (
            <div key={i} className="flex items-center gap-1.5">
              {val ? (
                <CheckCircle2 className={`w-2.5 h-2.5 shrink-0 ${accentCheck}`} />
              ) : (
                <Minus className="w-2.5 h-2.5 shrink-0 text-muted-foreground/25" />
              )}
              <Ico className="w-2.5 h-2.5 shrink-0 text-muted-foreground/40" />
              <span className={`text-[9px] leading-tight ${val ? "text-foreground/80" : "text-muted-foreground/35 line-through"}`}>
                {val ?? TIER_FEATURES[i].label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Select button */}
      <div className={`mt-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider text-center transition-all ${
        selected
          ? "bg-primary text-black"
          : disabled
          ? "bg-white/5 text-muted-foreground/40"
          : isUltra ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
          : isVip   ? "bg-amber-400/15 text-amber-300 border border-amber-400/30"
          :           "bg-sky-500/15 text-sky-300 border border-sky-500/30"
      }`}>
        {selected ? "✓ Selecionado" : disabled ? "Indisponível" : "Selecionar"}
      </div>
    </motion.button>
  );
}

/* ─── Comparison modal ─── */
function ComparisonModal({ plans, onClose }: { plans: Plan[]; onClose: () => void }) {
  const tiers: TierKey[] = ["padrao", "vip", "ultra"];
  const tierMeta: Record<TierKey, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
    padrao: { label: "Padrão",  color: "text-sky-300",   bg: "bg-sky-500/10",   Icon: Shield },
    vip:    { label: "VIP",     color: "text-amber-300", bg: "bg-amber-500/10", Icon: Crown  },
    ultra:  { label: "Ultra",   color: "text-rose-300",  bg: "bg-rose-500/10",  Icon: Flame  },
  };

  const durations = [1, 7, 14, 30];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-2xl max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#0c0f14] border border-white/10 shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-white/8 bg-[#0c0f14]/95 backdrop-blur">
          <div>
            <div className="font-bold text-sm">Comparar planos</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">Todos os recursos lado a lado</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Tier headers */}
          <div className="grid grid-cols-4 gap-2">
            <div />
            {tiers.map(t => {
              const m = tierMeta[t];
              return (
                <div key={t} className={`rounded-xl ${m.bg} border border-white/8 p-2.5 text-center`}>
                  <m.Icon className={`w-4 h-4 ${m.color} mx-auto mb-1`} />
                  <div className={`text-[10px] font-black uppercase tracking-wider ${m.color}`}>{m.label}</div>
                </div>
              );
            })}
          </div>

          {/* Feature rows */}
          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/60 mb-2">Recursos</div>
            {TIER_FEATURES.map((f, i) => (
              <div key={i} className={`grid grid-cols-4 gap-2 py-2.5 px-1 rounded-lg ${i % 2 === 0 ? "bg-white/2" : ""}`}>
                <div className="flex items-center gap-1.5">
                  <f.icon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                  <span className="text-[10px] text-muted-foreground leading-tight">{f.label}</span>
                </div>
                {(["padrao", "vip", "ultra"] as TierKey[]).map(t => {
                  const val = t === "ultra" ? f.ultra : t === "vip" ? f.vip : f.padrao;
                  const m = tierMeta[t];
                  return (
                    <div key={t} className="flex items-center justify-center">
                      {val ? (
                        <span className={`text-[10px] font-semibold ${m.color} text-center leading-tight`}>{val}</span>
                      ) : (
                        <Minus className="w-3 h-3 text-muted-foreground/25" />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Prices by duration */}
          <div className="space-y-2">
            <div className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/60 mb-2">Preços por período</div>
            {durations.map(days => (
              <div key={days} className="grid grid-cols-4 gap-2 items-center">
                <div className="text-[10px] text-muted-foreground font-medium">{days === 1 ? "1 dia" : `${days} dias`}</div>
                {tiers.map(t => {
                  const p = plans.find(pl => pl.days === days && (pl.tier === t || (t === "padrao" && !pl.tier)));
                  const m = tierMeta[t];
                  return (
                    <div key={t} className="text-center">
                      {p ? (
                        <div className={`text-[11px] font-bold ${m.color}`}>R$ {p.amountBrl}</div>
                      ) : (
                        <span className="text-[9px] text-muted-foreground/30">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function RechargeCard({ pack, selected, onSelect, idx }: { pack: RechargePack; selected: boolean; onSelect: () => void; idx: number }) {
  const Icon = RECHARGE_ICON_COMPONENTS[idx] ?? BatteryMedium;
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onSelect}
      className={`relative w-full text-left rounded-2xl border p-5 transition-all duration-200 ${
        selected
          ? "bg-primary/10 border-primary/60 shadow-[0_0_30px_-8px_var(--color-primary)]"
          : pack.highlight
          ? "bg-cyan-400/5 border-cyan-400/30 hover:border-cyan-400/50"
          : "bg-black/30 border-white/10 hover:border-white/25"
      }`}
    >
      {pack.highlight && !selected && (
        <span className="absolute -top-2.5 left-4 text-[9px] uppercase tracking-[0.3em] font-bold text-black bg-cyan-400 px-2 py-0.5 rounded-full">
          Melhor custo
        </span>
      )}
      {selected && (
        <span className="absolute -top-2.5 right-4 text-[9px] uppercase tracking-[0.3em] font-bold text-black px-2 py-0.5 rounded-full" style={{ background: "var(--color-primary)" }}>
          Selecionado
        </span>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <Icon className={`w-5 h-5 mb-2 ${selected ? "text-primary" : pack.highlight ? "text-cyan-400" : "text-muted-foreground"}`} />
          <div className="font-bold text-base">{pack.label}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-[0.2em]">{pack.credits} créditos</div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${selected ? "text-primary" : pack.highlight ? "text-cyan-300" : "text-foreground"}`}>
            R$ {pack.amountBrl}
          </div>
          <div className="text-[10px] text-muted-foreground">pagamento único</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 text-cyan-400" />
          <span className="text-foreground font-semibold">{pack.consultas} consultas</span>
          <span>· Sem prazo de validade</span>
        </div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 text-cyan-400/60" />
          R$ {(pack.amountCents / pack.consultas / 100).toFixed(2).replace(".", ",")} por consulta · acumula com planos
        </div>
        <div className="text-[10px] text-muted-foreground/50 flex items-center gap-1.5 pt-1 border-t border-white/5 mt-1">
          <span className="italic">Créditos são a unidade interna do sistema. Cada consulta consome 5 créditos, e cada módulo pode ter custo diferente.</span>
        </div>
      </div>
    </motion.button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-muted-foreground hover:text-foreground transition-all"
    >
      {copied ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado!</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
    </button>
  );
}

export default function Planos() {
  const [pageMode, setPageMode] = useState<PageMode>("plans");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [rechargePacks, setRechargePacks] = useState<RechargePack[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("14d_vip");
  const [selectedPackId, setSelectedPackId] = useState<string>("rc_padrao");
  const [step, setStep] = useState<Step>("plans");
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [selectedDays, setSelectedDays] = useState<number>(14);
  const [showComparison, setShowComparison] = useState(false);

  // Register form
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");

  // Coupon state (only for plans)
  const [couponInput, setCouponInput] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponInfo, setCouponInfo] = useState<{ discountPercent: number; description: string | null } | null>(null);
  const [couponError, setCouponError] = useState("");

  // Payment state
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "paid" | "failed">("pending");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("infinity_token");
    setIsLoggedIn(!!token);

    apiFetch("/plans").then(r => r.json()).then((data: Plan[]) => {
      if (Array.isArray(data)) {
        const mapped = data.map(p => ({ ...p, amountBrl: Number(p.amountBrl ?? p.amountCents / 100).toFixed(2).replace(".", ",") }));
        setPlans(mapped);
        const def = mapped.find(p => p.highlight) ?? mapped.find(p => p.tier === "vip") ?? mapped[1];
        if (def) { setSelectedPlanId(def.id); setSelectedDays(def.days); }
      }
    }).catch(() => {
      setPlans([
        { id: "1d",  label: "1 Dia Padrão",   days: 1,  amountCents: 1500,  amountBrl: "15,00", queryQuota: 30,  tier: "padrao", dailyModuleLimit: 30, photoDailyLimit: 10, freeCredits: 0 },
        { id: "7d",  label: "7 Dias Padrão",  days: 7,  amountCents: 4000,  amountBrl: "40,00", queryQuota: 210, tier: "padrao", dailyModuleLimit: 30, photoDailyLimit: 10, freeCredits: 0 },
        { id: "14d", label: "14 Dias Padrão", days: 14, amountCents: 7000,  amountBrl: "70,00", queryQuota: 420, tier: "padrao", dailyModuleLimit: 30, photoDailyLimit: 10, freeCredits: 0 },
        { id: "30d", label: "30 Dias Padrão", days: 30, amountCents: 10000, amountBrl: "100,00", queryQuota: 900, tier: "padrao", dailyModuleLimit: 30, photoDailyLimit: 10, freeCredits: 0 },
        { id: "1d_vip",  label: "1 Dia VIP",   days: 1,  amountCents: 3000,  amountBrl: "30,00",  queryQuota: 60,   tier: "vip", dailyModuleLimit: 60, photoDailyLimit: 25, freeCredits: 50 },
        { id: "7d_vip",  label: "7 Dias VIP",  days: 7,  amountCents: 8000,  amountBrl: "80,00",  queryQuota: 420,  tier: "vip", dailyModuleLimit: 60, photoDailyLimit: 25, freeCredits: 100 },
        { id: "14d_vip", label: "14 Dias VIP", days: 14, amountCents: 15000, amountBrl: "150,00", queryQuota: 840,  tier: "vip", dailyModuleLimit: 60, photoDailyLimit: 25, freeCredits: 200, highlight: true },
        { id: "30d_vip", label: "30 Dias VIP", days: 30, amountCents: 22000, amountBrl: "220,00", queryQuota: 1800, tier: "vip", dailyModuleLimit: 60, photoDailyLimit: 25, freeCredits: 300 },
        { id: "ultra_14d", label: "ULTRA 14 Dias", days: 14, amountCents: 50000, amountBrl: "500,00", queryQuota: 2800, tier: "ultra", dailyModuleLimit: 200, photoDailyLimit: 200, freeCredits: 500 },
      ]);
    });

    apiFetch("/recharges").then(r => r.json()).then((data: RechargePack[]) => {
      if (Array.isArray(data)) {
        const mapped = data.map(p => ({ ...p, amountBrl: Number(p.amountBrl ?? p.amountCents / 100).toFixed(2).replace(".", ",") }));
        setRechargePacks(mapped);
        const def = mapped.find(p => p.highlight) ?? mapped[2];
        if (def) setSelectedPackId(def.id);
      }
    }).catch(() => {
      setRechargePacks([
        { id: "rc_micro",    label: "Micro",    credits: 100,  consultas: 20,  amountCents:  1990, amountBrl: "19,90" },
        { id: "rc_basico",   label: "Básico",   credits: 300,  consultas: 60,  amountCents:  4990, amountBrl: "49,90" },
        { id: "rc_padrao",   label: "Padrão",   credits: 600,  consultas: 120, amountCents:  8990, amountBrl: "89,90", highlight: true },
        { id: "rc_avancado", label: "Avançado", credits: 1500, consultas: 300, amountCents: 19990, amountBrl: "199,90" },
        { id: "rc_pro",      label: "Pro",      credits: 3000, consultas: 600, amountCents: 39990, amountBrl: "399,90" },
      ]);
    });
  }, []);

  const stopPolling = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; }, []);

  const startPolling = useCallback((paymentId: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        const r = await fetch(`${BASE}/api/infinity/payments/${paymentId}/watch`, { signal: ctrl.signal });
        if (!r.ok || !r.body) return;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find(l => l.startsWith("data: "));
            if (!line) continue;
            try {
              const data = JSON.parse(line.slice(6)) as { status: string };
              if (data.status === "paid") { setPaymentStatus("paid"); setStep("success"); return; }
              if (data.status === "failed" || data.status === "expired") { setPaymentStatus("failed"); return; }
            } catch {}
          }
        }
      } catch {}
    })();
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleValidateCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponLoading(true);
    setCouponError("");
    setCouponInfo(null);
    try {
      const r = await apiFetch("/coupons/validate", { method: "POST", body: JSON.stringify({ code }) });
      const data = await r.json() as { valid: boolean; discountPercent?: number; description?: string | null; error?: string };
      if (data.valid && data.discountPercent) {
        setCouponInfo({ discountPercent: data.discountPercent, description: data.description ?? null });
      } else {
        setCouponError(data.error ?? "Cupom inválido.");
      }
    } catch {
      setCouponError("Erro ao validar cupom.");
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponInfo(null);
    setCouponInput("");
    setCouponError("");
  };

  const handleProceed = () => {
    if (pageMode === "recharges") {
      handleCreateRechargePayment();
    } else if (isLoggedIn) {
      handleCreatePayment();
    } else {
      setStep("register");
    }
  };

  const handleCreateRechargePayment = async () => {
    if (!isLoggedIn) { setError("Faça login para comprar recargas."); return; }
    setLoading(true);
    setError("");
    try {
      const r = await apiFetch("/recharges/create", { method: "POST", body: JSON.stringify({ packId: selectedPackId }) });
      const data = await r.json() as { paymentId: string; txid: string; pixCopiaECola: string; qrcode_base64: string; amountBrl: string; taxa?: number; pack: { id: string; label: string; credits: number; consultas: number }; error?: string };
      if (!r.ok) { setError(data.error ?? "Erro ao gerar pagamento"); setLoading(false); return; }
      setPaymentData({ ...data, mode: "recharges" });
      setPaymentStatus("pending");
      setStep("payment");
      startPolling(data.paymentId);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    }
    setLoading(false);
  };

  const handleCreatePayment = async () => {
    setLoading(true);
    setError("");
    try {
      let r: Response;
      const couponCode = couponInfo ? couponInput.trim().toUpperCase() : undefined;
      if (isLoggedIn) {
        r = await apiFetch("/payments/create", { method: "POST", body: JSON.stringify({ planId: selectedPlanId, couponCode }) });
      } else {
        if (!username || !password) { setFormError("Preencha usuário e senha"); setLoading(false); return; }
        r = await apiFetch("/payments/create-guest", {
          method: "POST",
          body: JSON.stringify({ planId: selectedPlanId, username: username.trim().toLowerCase(), password, couponCode }),
        });
      }
      const data = await r.json() as PaymentData & { plan: { id: string; label: string; days: number }; error?: string };
      if (!r.ok) { setError((data as { error?: string }).error ?? "Erro ao gerar pagamento"); setLoading(false); return; }
      setPaymentData({ ...data, mode: "plans" });
      setPaymentStatus("pending");
      setStep("payment");
      startPolling(data.paymentId);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    }
    setLoading(false);
  };

  const plan = plans.find(p => p.id === selectedPlanId);
  const pack = rechargePacks.find(p => p.id === selectedPackId);

  const switchMode = (mode: PageMode) => {
    if (step !== "plans") return;
    setPageMode(mode);
    setError("");
  };

  const handleSelectDays = (days: number) => {
    setSelectedDays(days);
    const currentPlan = plans.find(p => p.id === selectedPlanId);
    const currentTier: TierKey = (currentPlan?.tier as TierKey) ?? "vip";
    const match = plans.find(p => p.days === days && (p.tier === currentTier || (currentTier === "padrao" && !p.tier)))
      ?? plans.find(p => p.days === days && (p.tier === "vip" || !p.tier));
    if (match) setSelectedPlanId(match.id);
  };

  const handleSelectTier = (tier: TierKey, days: number) => {
    const match = plans.find(p => p.days === days && (p.tier === tier || (tier === "padrao" && !p.tier)));
    if (match) setSelectedPlanId(match.id);
  };

  const availDays = [...new Set(plans.map(p => p.days))].sort((a, b) => a - b);
  const planForTier = (tier: TierKey, days: number) =>
    plans.find(p => p.days === days && (p.tier === tier || (tier === "padrao" && !p.tier))) ?? null;
  const selectedTier: TierKey = (plan?.tier as TierKey) ?? "padrao";

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-gradient-to-r from-sky-300 to-cyan-200 bg-clip-text text-transparent"
        >
          {pageMode === "recharges" && step === "plans" ? "Recargas" : "Planos"}
        </motion.h1>
        <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
          {pageMode === "recharges" && step === "plans"
            ? "Créditos sem prazo de validade · Ativação imediata"
            : "Acesso completo à plataforma OSINT · Ativação automática"}
        </p>

        {/* Tab switcher — only visible on step "plans" */}
        {step === "plans" && (
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => switchMode("plans")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-widest transition-all ${
                pageMode === "plans"
                  ? "text-black"
                  : "bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground"
              }`}
              style={pageMode === "plans" ? { background: "var(--color-primary)" } : {}}
            >
              <Shield className="w-3.5 h-3.5" /> Planos
            </button>
            <button
              onClick={() => switchMode("recharges")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-widest transition-all ${
                pageMode === "recharges"
                  ? "text-black"
                  : "bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground"
              }`}
              style={pageMode === "recharges" ? { background: "var(--color-primary)" } : {}}
            >
              <Wallet className="w-3.5 h-3.5" /> Recargas
            </button>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">

        {/* ── Step 1: Plan/Recharge selection ── */}
        {step === "plans" && (
          <motion.div key={`plans-${pageMode}`} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} className="space-y-4">
            <div className="space-y-4">
              {pageMode === "plans" ? (
                <>
                  {/* Duration tabs */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] uppercase tracking-[0.35em] text-muted-foreground">Período de acesso</span>
                      <button
                        onClick={() => setShowComparison(true)}
                        className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                      >
                        <BarChart3 className="w-3 h-3" /> Comparar planos
                      </button>
                    </div>
                    <div className="flex gap-2">
                      {(availDays.length > 0 ? availDays : [1, 7, 14, 30]).map(d => (
                        <button
                          key={d}
                          onClick={() => handleSelectDays(d)}
                          className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                            selectedDays === d
                              ? "text-black shadow-lg"
                              : "bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground hover:border-white/25"
                          }`}
                          style={selectedDays === d ? { background: "var(--color-primary)" } : {}}
                        >
                          {d === 1 ? "1 dia" : `${d}d`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 3-column tier cards */}
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    {(["padrao", "vip", "ultra"] as TierKey[]).map(t => {
                      const tierPlan = planForTier(t, selectedDays);
                      const altDays = !tierPlan
                        ? availDays.find(d => !!planForTier(t, d))
                        : undefined;
                      return (
                        <TierCard
                          key={t}
                          tier={t}
                          plan={tierPlan}
                          selected={selectedTier === t && !!tierPlan}
                          disabled={!tierPlan}
                          onSelect={() => handleSelectTier(t, selectedDays)}
                          onSwitchDays={altDays !== undefined ? () => handleSelectDays(altDays) : undefined}
                        />
                      );
                    })}
                  </div>

                  {/* Selected plan summary bar */}
                  {plan && (
                    <motion.div
                      key={plan.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        {plan.tier === "ultra" ? <Flame className="w-3.5 h-3.5 text-rose-400" /> : plan.tier === "vip" ? <Crown className="w-3.5 h-3.5 text-amber-400" /> : <Shield className="w-3.5 h-3.5 text-sky-400" />}
                        <div>
                          <span className="text-sm font-bold">{plan.label}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">· {plan.queryQuota} consultas · {plan.days} {plan.days === 1 ? "dia" : "dias"}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-sm" style={{ color: "var(--color-primary)" }}>R$ {plan.amountBrl}</span>
                      </div>
                    </motion.div>
                  )}
                </>
              ) : (
                <div className="grid gap-2">
                  {rechargePacks.map((p) => (
                    <RechargeCard key={p.id} pack={p} idx={RECHARGE_ICONS.indexOf(p.id)} selected={selectedPackId === p.id} onSelect={() => setSelectedPackId(p.id)} />
                  ))}
                </div>
              )}
            </div>

            {/* ── Coupon (plans only) ── */}
            {pageMode === "plans" && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-1.5">
                  <Tag className="w-3 h-3" /> Cupom de Desconto
                </p>
                {couponInfo ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <span className="font-mono font-bold text-emerald-300 text-sm">{couponInput.toUpperCase()}</span>
                        <span className="ml-2 text-xs text-emerald-400 font-semibold">−{couponInfo.discountPercent}% de desconto</span>
                        {couponInfo.description && (
                          <p className="text-[10px] text-emerald-400/70 mt-0.5">{couponInfo.description}</p>
                        )}
                      </div>
                    </div>
                    <button onClick={handleRemoveCoupon} className="p-1 rounded-md text-muted-foreground hover:text-destructive transition-colors" title="Remover cupom">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(""); }}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleValidateCoupon(); } }}
                      placeholder="Ex: HYDRA20"
                      maxLength={30}
                      className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono uppercase tracking-widest focus:outline-none focus:border-primary/50 transition-colors placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/50"
                    />
                    <button
                      onClick={() => void handleValidateCoupon()}
                      disabled={couponLoading || !couponInput.trim()}
                      className="px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-white/25 disabled:opacity-50 transition-all"
                    >
                      {couponLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Aplicar"}
                    </button>
                  </div>
                )}
                {couponError && <p className="text-xs text-destructive">{couponError}</p>}
              </div>
            )}

            {/* ── Price summary (with coupon) ── */}
            {pageMode === "plans" && couponInfo && plan && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total com desconto</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground line-through">R$ {plan.amountBrl}</span>
                  <span className="text-lg font-bold text-primary">
                    R$ {(plan.amountCents * (1 - couponInfo.discountPercent / 100) / 100).toFixed(2).replace(".", ",")}
                  </span>
                </div>
              </div>
            )}

            {/* ── Recharges info note ── */}
            {pageMode === "recharges" && !isLoggedIn && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
                Recargas são exclusivas para usuários já cadastrados. Faça login antes de comprar.
              </div>
            )}

            {error && <p className="text-xs text-red-400 text-center">{error}</p>}
            <button
              onClick={handleProceed}
              disabled={(pageMode === "plans" ? !selectedPlanId : !selectedPackId) || loading || (pageMode === "recharges" && !isLoggedIn)}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-sm uppercase tracking-[0.25em] text-black transition-all disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              {pageMode === "recharges"
                ? (isLoggedIn ? "Pagar com PIX" : "Faça login primeiro")
                : (isLoggedIn ? "Pagar com PIX" : "Criar conta e pagar")}
            </button>
            <p className="text-center text-[10px] text-muted-foreground">
              ✅ {pageMode === "recharges" ? "Créditos adicionados automaticamente após confirmação" : "Ativação automática após confirmação do pagamento"}
            </p>
          </motion.div>
        )}

        {/* ── Step 2: Register (new users only, plan mode only) ── */}
        {step === "register" && (
          <motion.div key="register" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep("plans")} className="p-2 rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="font-bold text-sm">Criar conta — Plano {plan?.label}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">R$ {plan?.amountBrl} · {plan?.days} {plan?.days === 1 ? "dia" : "dias"} · {plan?.queryQuota} consultas</div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6 space-y-4">
              <p className="text-xs text-muted-foreground">Crie sua conta e pague na próxima etapa. O acesso é liberado automaticamente após a confirmação do PIX.</p>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Usuário</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={username}
                      onChange={e => { setUsername(e.target.value); setFormError(""); }}
                      placeholder="seu_usuario"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-black/40 border border-white/10 text-sm focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/40"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="password"
                      value={password}
                      onChange={e => { setPassword(e.target.value); setFormError(""); }}
                      placeholder="mínimo 6 caracteres"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-black/40 border border-white/10 text-sm focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/40"
                    />
                  </div>
                </div>
              </div>

              {formError && <p className="text-xs text-red-400">{formError}</p>}
              {error && <p className="text-xs text-red-400">{error}</p>}

              <button
                onClick={handleCreatePayment}
                disabled={loading || !username || !password}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm uppercase tracking-[0.2em] text-black disabled:opacity-50 transition-all"
                style={{ background: "var(--color-primary)" }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                Gerar PIX
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Step 3: Payment ── */}
        {step === "payment" && paymentData && (
          <motion.div key="payment" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => { stopPolling(); setStep(isLoggedIn ? "plans" : "register"); }} className="p-2 rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="font-bold text-sm">Pague o PIX</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  R$ {paymentData.amountBrl} ·{" "}
                  {paymentData.mode === "recharges" && paymentData.pack
                    ? `Recarga ${paymentData.pack.label} (${paymentData.pack.consultas} consultas)`
                    : `Plano ${paymentData.plan?.label}`}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6 space-y-5">
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-2xl p-2 sm:p-3 bg-white mx-auto">
                  <img
                    src={
                      !paymentData.qrcode_base64 ? "" :
                      paymentData.qrcode_base64.startsWith("http") ? paymentData.qrcode_base64 :
                      paymentData.qrcode_base64.startsWith("data:") ? paymentData.qrcode_base64 :
                      `data:image/png;base64,${paymentData.qrcode_base64}`
                    }
                    alt="QR Code PIX"
                    className="w-36 h-36 sm:w-48 sm:h-48 block"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Escaneie o QR Code com seu banco</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/5" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">ou</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>

              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Pix Copia e Cola</div>
                <div className="flex flex-col sm:flex-row items-stretch gap-2">
                  <div className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2.5 text-[11px] text-muted-foreground font-mono break-all leading-relaxed overflow-hidden" style={{ maxHeight: "72px", overflowY: "auto" }}>
                    {paymentData.pixCopiaECola}
                  </div>
                  <div className="sm:self-start">
                    <CopyButton text={paymentData.pixCopiaECola} />
                  </div>
                </div>
              </div>

              {paymentStatus === "pending" && (
                <div className="flex items-center gap-2 justify-center py-2 rounded-xl bg-amber-500/5 border border-amber-500/20">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  <span className="text-xs text-amber-300">Aguardando confirmação do pagamento...</span>
                </div>
              )}
              {paymentStatus === "failed" && (
                <div className="text-center text-xs text-red-400 py-2 rounded-xl bg-red-500/5 border border-red-500/20">
                  Pagamento expirado ou cancelado. <button className="underline" onClick={() => setStep("plans")}>Tentar novamente</button>
                </div>
              )}

              {paymentData.taxa !== undefined && (
                <p className="text-center text-[10px] text-muted-foreground/50">
                  Taxa da plataforma: R$ {paymentData.taxa?.toFixed(2)} · {paymentData.mode === "recharges" ? "Créditos adicionados automaticamente" : "Acesso ativado automaticamente"} após confirmação
                </p>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Step 4: Success ── */}
        {step === "success" && paymentData && (
          <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 backdrop-blur-2xl p-8 flex flex-col items-center text-center gap-4">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 15 }}>
                <CheckCircle2 className="w-16 h-16 text-emerald-400" />
              </motion.div>
              <div>
                <div className="text-xl font-bold text-emerald-300">Pagamento confirmado!</div>
                {paymentData.mode === "recharges" && paymentData.pack ? (
                  <div className="text-sm text-muted-foreground mt-1">
                    <span className="text-foreground font-medium">{paymentData.pack.consultas} consultas</span> ({paymentData.pack.credits} créditos) adicionadas à sua conta.
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground mt-1">
                    Plano <span className="text-foreground font-medium">{paymentData.plan?.label}</span> ativado com sucesso.
                  </div>
                )}
              </div>
              {paymentData.username && (
                <div className="rounded-xl bg-black/30 border border-white/10 px-5 py-3 text-sm">
                  Sua conta <span className="text-primary font-bold">@{paymentData.username}</span> está ativa por <span className="font-bold">{paymentData.plan?.days} {paymentData.plan?.days === 1 ? "dia" : "dias"}</span>.
                </div>
              )}
              <a
                href="/login"
                className="flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-bold text-sm uppercase tracking-[0.2em] text-black transition-all"
                style={{ background: "var(--color-primary)" }}
              >
                {isLoggedIn ? "Ir para o painel" : "Fazer login"}
              </a>
            </div>
          </motion.div>
        )}

      </AnimatePresence>

      {/* Comparison modal */}
      <AnimatePresence>
        {showComparison && (
          <ComparisonModal plans={plans} onClose={() => setShowComparison(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
