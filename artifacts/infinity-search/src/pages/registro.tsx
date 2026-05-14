import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Clock, Shield, Star, Zap, ArrowLeft, Copy, Check, Loader2,
  QrCode, User, Lock, Gift, KeyRound, UserPlus, Crown, Flame, Tag, X,
  BatteryLow, Battery, BatteryMedium, BatteryFull,
  BarChart3, Minus, Camera, Coins, BookOpen, Palette, Bot, FolderOpen,
} from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import logoUrl from "@/assets/hydra-icon.png";
import { AnimatedBackground } from "@/components/ui/AnimatedBackground";

interface Plan {
  id: string; label: string; days: number;
  amountBrl: string; amountCents: number; highlight?: boolean;
  tier?: "padrao" | "vip" | "ultra";
  queryQuota?: number; dailyModuleLimit?: number; photoDailyLimit?: number; freeCredits?: number;
}

type TierKey = "padrao" | "vip" | "ultra";
interface TierFeature { icon: React.ElementType; label: string; padrao: string | null; vip: string | null; ultra: string | null; }
const TIER_FEATURES: TierFeature[] = [
  { icon: Zap,        label: "Consultas/dia",      padrao: "30 / módulo", vip: "60 / módulo",  ultra: "200 / módulo" },
  { icon: Camera,     label: "Fotos/dia",           padrao: "10 fotos",    vip: "25 fotos",     ultra: "200 fotos"    },
  { icon: Coins,      label: "Créditos bônus",      padrao: null,          vip: "incluso",      ultra: "500 créditos" },
  { icon: BookOpen,   label: "Processos jurídicos", padrao: null,          vip: "incluso",      ultra: "incluso"      },
  { icon: Palette,    label: "Temas de perfil",     padrao: "1 tema",      vip: "5 temas",      ultra: "todos"        },
  { icon: Bot,        label: "Assistente IA",       padrao: "incluso",     vip: "incluso",      ultra: "incluso"      },
  { icon: FolderOpen, label: "Dossiê e histórico",  padrao: "incluso",     vip: "incluso",      ultra: "incluso"      },
];

interface RechargePack {
  id: string; label: string; credits: number; consultas: number;
  amountBrl: string; amountCents: number; highlight?: boolean;
}

const RECHARGE_ICONS: Record<string, React.ElementType> = {
  rc_micro: BatteryLow, rc_basico: Battery,
  rc_padrao: BatteryMedium, rc_avancado: BatteryFull, rc_pro: BatteryFull,
};

function TierCard({ plan, tier, selected, disabled, onSelect, onSwitchDays }: { plan: Plan | null; tier: TierKey; selected: boolean; disabled: boolean; onSelect: () => void; onSwitchDays?: () => void }) {
  const isUltra = tier === "ultra"; const isVip = tier === "vip";
  const switchable = disabled && (isUltra || isVip) && !!onSwitchDays;
  const accentBorder = selected
    ? "border-primary/70 bg-primary/8 shadow-[0_0_28px_-6px_var(--color-primary)]"
    : disabled
      ? switchable
        ? isUltra ? "border-rose-500/20 bg-rose-500/5 cursor-pointer hover:border-rose-500/40"
                  : "border-amber-400/20 bg-amber-500/5 cursor-pointer hover:border-amber-400/40"
        : "border-white/6 bg-black/20 opacity-40 cursor-not-allowed"
    : isUltra ? "border-rose-500/35 bg-rose-500/5 hover:border-rose-500/55"
    : isVip   ? "border-amber-400/35 bg-amber-500/5 hover:border-amber-400/55"
    :           "border-sky-500/25 bg-sky-500/3 hover:border-sky-500/45";
  const accentText  = isUltra ? "text-rose-300"  : isVip ? "text-amber-300" : "text-sky-300";
  const accentCheck = isUltra ? "text-rose-400"  : isVip ? "text-amber-400" : "text-sky-400";
  const Icon = isUltra ? Flame : isVip ? Crown : Shield;
  const tierLabel = isUltra ? "Ultra" : isVip ? "VIP" : "Padrão";
  const tierSub   = isUltra ? "Acesso máximo" : isVip ? "Acesso premium" : "Acesso completo";
  const featureValues = TIER_FEATURES.map(f => tier === "ultra" ? f.ultra : tier === "vip" ? f.vip : f.padrao);
  const handleClick = () => { if (!disabled) { onSelect(); } else if (switchable) { onSwitchDays!(); } };
  return (
    <motion.button
      whileHover={{ scale: disabled && !switchable ? 1 : 1.015 }}
      whileTap={{ scale: disabled && !switchable ? 1 : 0.985 }}
      onClick={handleClick}
      className={`relative flex flex-col rounded-2xl border p-3 sm:p-4 transition-all duration-200 text-left w-full ${accentBorder}`}>
      {isVip && plan?.highlight && !selected && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[0.25em] font-black text-black bg-amber-400 px-2.5 py-0.5 rounded-full whitespace-nowrap">Mais popular</span>
      )}
      {selected && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[0.25em] font-black text-black px-2.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: "var(--color-primary)" }}>Selecionado</span>
      )}
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-4 h-4 ${accentText}`} />
        {isUltra && <span className="text-[7px] font-black uppercase tracking-wider bg-rose-500/20 border border-rose-500/40 text-rose-300 px-1.5 py-0.5 rounded-full">ULTRA</span>}
        {isVip   && <span className="text-[7px] font-black uppercase tracking-wider bg-amber-400/15 border border-amber-400/35 text-amber-300 px-1.5 py-0.5 rounded-full">VIP</span>}
      </div>
      <div className={`font-black text-sm tracking-wide ${accentText}`}>{tierLabel}</div>
      <div className="text-[9px] text-muted-foreground uppercase tracking-[0.2em] mb-3">{tierSub}</div>
      {plan ? (
        <div className="mb-3">
          <div className={`text-xl sm:text-2xl font-black leading-none ${accentText}`}>R$&nbsp;{plan.amountBrl}</div>
          {plan.queryQuota && <div className="text-[9px] text-muted-foreground mt-0.5">{plan.queryQuota} consultas</div>}
        </div>
      ) : (
        <div className="mb-3">
          {switchable ? (
            <div className={`text-[9px] font-semibold ${isUltra ? "text-rose-300/70" : "text-amber-300/70"}`}>↩ Ver em outro período</div>
          ) : (
            <div className="text-[10px] text-muted-foreground/60 italic">Indisponível<br/>neste período</div>
          )}
        </div>
      )}
      <div className="space-y-1.5 pt-3 border-t border-white/5 flex-1">
        {featureValues.map((val, i) => {
          const Ico = TIER_FEATURES[i].icon;
          return (
            <div key={i} className="flex items-center gap-1.5">
              {val ? <CheckCircle2 className={`w-2.5 h-2.5 shrink-0 ${accentCheck}`} /> : <Minus className="w-2.5 h-2.5 shrink-0 text-muted-foreground/25" />}
              <Ico className="w-2.5 h-2.5 shrink-0 text-muted-foreground/40" />
              <span className={`text-[9px] leading-tight ${val ? "text-foreground/80" : "text-muted-foreground/35 line-through"}`}>{val ?? TIER_FEATURES[i].label}</span>
            </div>
          );
        })}
      </div>
      <div className={`mt-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider text-center transition-all ${
        selected ? "bg-primary text-black"
        : disabled && !switchable ? "bg-white/5 text-muted-foreground/40"
        : switchable
          ? isUltra ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                    : "bg-amber-400/15 text-amber-300 border border-amber-400/30"
        : isUltra ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
        : isVip   ? "bg-amber-400/15 text-amber-300 border border-amber-400/30"
        :           "bg-sky-500/15 text-sky-300 border border-sky-500/30"
      }`}>
        {selected ? "✓ Selecionado" : switchable ? "↩ Mudar período" : disabled ? "Indisponível" : "Selecionar"}
      </div>
    </motion.button>
  );
}

function PlanComparisonModal({ plans, onClose }: { plans: Plan[]; onClose: () => void }) {
  const tiers: TierKey[] = ["padrao", "vip", "ultra"];
  const tierMeta = {
    padrao: { label: "Padrão", color: "text-sky-300",   bg: "bg-sky-500/10",   Icon: Shield },
    vip:    { label: "VIP",    color: "text-amber-300", bg: "bg-amber-500/10", Icon: Crown  },
    ultra:  { label: "Ultra",  color: "text-rose-300",  bg: "bg-rose-500/10",  Icon: Flame  },
  };
  const durations = [...new Set(plans.map(p => p.days))].sort((a, b) => a - b);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-2xl max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#0c0f14] border border-white/10 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-white/8 bg-[#0c0f14]/95 backdrop-blur">
          <div>
            <div className="font-bold text-sm">Comparar planos</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">Todos os recursos lado a lado</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-6">
          <div className="grid grid-cols-4 gap-2">
            <div />
            {tiers.map(t => { const m = tierMeta[t]; return (
              <div key={t} className={`rounded-xl ${m.bg} border border-white/8 p-2.5 text-center`}>
                <m.Icon className={`w-4 h-4 ${m.color} mx-auto mb-1`} />
                <div className={`text-[10px] font-black uppercase tracking-wider ${m.color}`}>{m.label}</div>
              </div>
            ); })}
          </div>
          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/60 mb-2">Recursos</div>
            {TIER_FEATURES.map((f, i) => (
              <div key={i} className={`grid grid-cols-4 gap-2 py-2.5 px-1 rounded-lg ${i % 2 === 0 ? "bg-white/2" : ""}`}>
                <div className="flex items-center gap-1.5">
                  <f.icon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                  <span className="text-[10px] text-muted-foreground leading-tight">{f.label}</span>
                </div>
                {tiers.map(t => {
                  const val = t === "ultra" ? f.ultra : t === "vip" ? f.vip : f.padrao;
                  const m = tierMeta[t];
                  return (
                    <div key={t} className="flex items-center justify-center">
                      {val ? <span className={`text-[10px] font-semibold ${m.color} text-center leading-tight`}>{val}</span>
                           : <Minus className="w-3 h-3 text-muted-foreground/25" />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {durations.length > 0 && (
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
                        {p ? <div className={`text-[11px] font-bold ${m.color}`}>R$ {p.amountBrl}</div>
                           : <span className="text-[9px] text-muted-foreground/30">—</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const apiFetch = (path: string, opts?: RequestInit) =>
  fetch(`${BASE}/api/infinity${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });

type Step = "plans" | "register" | "payment" | "success" | "gift" | "gift-success";
type PurchaseMode = "plan" | "recharge";

interface PaymentData {
  paymentId: string; txid: string; pixCopiaECola: string; qrcode_base64: string;
  amountBrl: string; taxa?: number;
  plan?: { id: string; label: string; days: number };
  pack?: { id: string; label: string; credits: number; consultas: number };
  username: string;
}


function RechargeCard({ pack, selected, onSelect }: { pack: RechargePack; selected: boolean; onSelect: () => void }) {
  const Icon = RECHARGE_ICONS[pack.id] ?? BatteryMedium;
  return (
    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onSelect}
      className={`relative w-full text-left rounded-2xl border p-5 transition-all duration-200 ${
        selected ? "bg-primary/10 border-primary/60 shadow-[0_0_30px_-8px_var(--color-primary)]"
        : pack.highlight ? "bg-cyan-400/5 border-cyan-400/30 hover:border-cyan-400/50"
        : "bg-black/30 border-white/10 hover:border-white/25"
      }`}>
      {pack.highlight && !selected && (
        <span className="absolute -top-2.5 left-4 text-[9px] uppercase tracking-[0.3em] font-bold text-black bg-cyan-400 px-2 py-0.5 rounded-full">Melhor custo</span>
      )}
      {selected && (
        <span className="absolute -top-2.5 right-4 text-[9px] uppercase tracking-[0.3em] font-bold text-black px-2 py-0.5 rounded-full" style={{ background: "var(--color-primary)" }}>Selecionado</span>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <Icon className={`w-5 h-5 mb-2 ${selected ? "text-primary" : pack.highlight ? "text-cyan-400" : "text-muted-foreground"}`} />
          <div className="font-bold text-base">{pack.label}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{pack.consultas} consultas · sem prazo</div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${selected ? "text-primary" : pack.highlight ? "text-cyan-300" : "text-foreground"}`}>R$ {pack.amountBrl}</div>
          <div className="text-[10px] text-muted-foreground">
            R$ {(pack.amountCents / pack.consultas / 100).toFixed(2).replace(".", ",")} / cx
          </div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
        {[`${pack.credits} créditos inclusos`, "Não expira", "Acumula com planos"].map(f => (
          <div key={f} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-cyan-400" /> {f}
          </div>
        ))}
      </div>
    </motion.button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-muted-foreground hover:text-foreground transition-all">
      {copied ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado!</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
    </button>
  );
}

const STEPS = [
  { key: "plans", label: "Plano" },
  { key: "register", label: "Conta" },
  { key: "payment", label: "Pagamento" },
  { key: "success", label: "Pronto" },
];

function StepIndicator({ current }: { current: Step }) {
  const gift = current === "gift" || current === "gift-success";
  const steps = gift
    ? [{ key: "gift", label: "Código" }, { key: "gift-success", label: "Pronto" }]
    : STEPS;
  const idx = steps.findIndex(s => s.key === current);
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2 flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${i < idx ? "text-black" : i === idx ? "text-black" : "text-muted-foreground border border-white/15 bg-transparent"}`}
              style={i <= idx ? { background: "var(--color-primary)" } : {}}>
              {i < idx ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className={`text-[9px] uppercase tracking-[0.2em] font-semibold ${i <= idx ? "text-primary" : "text-muted-foreground/50"}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className="flex-1 h-px mb-4 transition-colors" style={{ background: i < idx ? "var(--color-primary)" : "rgba(255,255,255,0.1)" }} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function Registro() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const refCode = params.get("ref") ?? "";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [rechargePacks, setRechargePacks] = useState<RechargePack[]>([]);
  const [purchaseMode, setPurchaseMode] = useState<PurchaseMode>("plan");

  const [selectedPlanId, setSelectedPlanId] = useState<string>("14d_vip");
  const [selectedPackId, setSelectedPackId] = useState<string>("rc_padrao");
  const [step, setStep] = useState<Step>("plans");
  const [selectedDays, setSelectedDays] = useState<number>(14);
  const [showComparison, setShowComparison] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  const [couponInput, setCouponInput] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponInfo, setCouponInfo] = useState<{ discountPercent: number; description: string | null } | null>(null);
  const [couponError, setCouponError] = useState("");

  const [payment, setPayment] = useState<PaymentData | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [polling, setPolling] = useState(false);
  const [countdown, setCountdown] = useState(180);

  // Gift card state
  const [giftCode, setGiftCode] = useState("");
  const [giftUser, setGiftUser] = useState("");
  const [giftPass, setGiftPass] = useState("");
  const [giftError, setGiftError] = useState("");
  const [giftLoading, setGiftLoading] = useState(false);
  const [giftResult, setGiftResult] = useState<{ username: string; days: number; expiresAt: string } | null>(null);

  useEffect(() => {
    apiFetch("/plans").then(r => r.json()).then((d: Plan[]) => {
      setPlans(d);
      const def = d.find(p => p.highlight) ?? d.find(p => p.tier === "vip") ?? d.find(p => p.days === 14);
      if (def) { setSelectedPlanId(def.id); setSelectedDays(def.days); }
      else if (d.length > 0) setSelectedPlanId(d[0].id);
    }).catch(() => {});
    apiFetch("/recharges").then(r => r.json()).then((d: RechargePack[]) => {
      if (Array.isArray(d)) {
        setRechargePacks(d.map(p => ({
          ...p,
          amountBrl: Number(p.amountBrl ?? p.amountCents / 100).toFixed(2).replace(".", ","),
        })));
        const highlight = d.find(p => p.highlight);
        if (highlight) setSelectedPackId(highlight.id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const selectedPlan = plans.find(p => p.id === selectedPlanId);
  const selectedPack = rechargePacks.find(p => p.id === selectedPackId);

  const availDays = [...new Set(plans.map(p => p.days))].sort((a, b) => a - b);
  const planForTier = (tier: TierKey, days: number) =>
    plans.find(p => p.days === days && (p.tier === tier || (tier === "padrao" && !p.tier))) ?? null;
  const selectedTier: TierKey = (selectedPlan?.tier as TierKey) ?? "padrao";

  const handleSelectDays = (days: number) => {
    setSelectedDays(days);
    const curTier: TierKey = (selectedPlan?.tier as TierKey) ?? "vip";
    const match = plans.find(p => p.days === days && (p.tier === curTier || (curTier === "padrao" && !p.tier)))
      ?? plans.find(p => p.days === days);
    if (match) setSelectedPlanId(match.id);
  };

  const handleSelectTier = (tier: TierKey) => {
    const match = plans.find(p => p.days === selectedDays && (p.tier === tier || (tier === "padrao" && !p.tier)));
    if (match) setSelectedPlanId(match.id);
  };

  const startPolling = useCallback((paymentId: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPolling(true);
    setCountdown(180);
    const cdInt = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);

    const MAX_RETRIES = 8;
    const watchSSE = async (attempt: number): Promise<void> => {
      if (ctrl.signal.aborted) return;
      try {
        const r = await fetch(`${BASE}/api/infinity/payments/${paymentId}/watch`, { signal: ctrl.signal });
        if (!r.ok || !r.body) throw new Error("bad response");
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
              const d = JSON.parse(line.slice(6)) as { status: string };
              if (d.status === "paid") { clearInterval(cdInt); setPolling(false); setStep("success"); return; }
              if (d.status === "expired" || d.status === "failed") { clearInterval(cdInt); setPolling(false); return; }
            } catch {}
          }
        }
        // SSE stream ended without a terminal event — reconnect
        throw new Error("stream ended");
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 1s, 2s, 4s … capped at 8s
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
          await new Promise(r => setTimeout(r, delay));
          return watchSSE(attempt + 1);
        }
      }
      clearInterval(cdInt);
      setPolling(false);
    };

    void watchSSE(1);
  }, []);

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

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password.trim()) { setError("Preencha todos os campos"); return; }
    if (username.length < 3) { setError("Usuário deve ter ao menos 3 caracteres"); return; }
    if (password.length < 6) { setError("Senha deve ter ao menos 6 caracteres"); return; }

    const planIdToSend = purchaseMode === "plan" ? selectedPlanId : selectedPackId;
    const couponCode = couponInfo && purchaseMode === "plan" ? couponInput.trim().toUpperCase() : undefined;

    setRegLoading(true);
    try {
      const r = await apiFetch("/payments/create-guest", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim().toLowerCase(), password,
          email: email.trim() || undefined,
          planId: planIdToSend,
          referralCode: refCode || undefined,
          ...(couponCode ? { couponCode } : {}),
        }),
      });
      const data = await r.json() as PaymentData & { error?: string };
      if (!r.ok) { setError(data.error ?? "Erro ao gerar pagamento"); setRegLoading(false); return; }
      setPayment({ ...data, username: username.trim().toLowerCase() });
      setStep("payment");
      startPolling(data.paymentId);
    } catch { setError("Falha na conexão"); }
    finally { setRegLoading(false); }
  };

  const handleGiftRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setGiftError("");
    if (!giftCode.trim() || !giftUser.trim() || !giftPass.trim()) {
      setGiftError("Preencha todos os campos"); return;
    }
    setGiftLoading(true);
    try {
      const r = await apiFetch("/gift/redeem", {
        method: "POST",
        body: JSON.stringify({
          code: giftCode.trim().toUpperCase(),
          username: giftUser.trim().toLowerCase(),
          password: giftPass,
        }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; username?: string; days?: number; expiresAt?: string };
      if (!r.ok) { setGiftError(d.error ?? "Código inválido"); setGiftLoading(false); return; }
      setGiftResult({ username: d.username!, days: d.days!, expiresAt: d.expiresAt! });
      setStep("gift-success");
    } catch { setGiftError("Falha na conexão"); }
    finally { setGiftLoading(false); }
  };

  // Label shown in register step
  const selectedLabel = purchaseMode === "plan"
    ? `${selectedPlan?.label ?? "—"} — R$ ${selectedPlan?.amountBrl ?? ""}`
    : `${selectedPack?.label ?? "—"} — R$ ${selectedPack?.amountBrl ?? ""}`;

  const canContinue = purchaseMode === "plan" ? !!selectedPlan : !!selectedPack;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <AnimatedBackground />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-lg z-10"
      >
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src={logoUrl} alt="" className="w-10 h-10 object-contain" />
          <div>
            <div className="font-bold tracking-[0.3em] text-lg">HYDRA</div>
            <div className="text-[9px] uppercase tracking-[0.5em] text-primary/60">CONSULTORIA</div>
          </div>
        </div>

        {refCode && step !== "success" && step !== "gift-success" && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3 flex items-center gap-3">
            <UserPlus className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-300">
              Você foi convidado por <span className="font-bold">@{refCode}</span>. Ao finalizar, seu convite será registrado.
            </p>
          </motion.div>
        )}

        <div className="rounded-3xl border border-white/10 bg-black/50 backdrop-blur-2xl p-7 shadow-2xl">
          <StepIndicator current={step} />

          <AnimatePresence mode="wait">
            {/* PLANOS / RECARGAS */}
            {step === "plans" && (
              <motion.div key="plans" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-xl font-bold mb-1">Escolha como começar</h2>
                <p className="text-sm text-muted-foreground mb-5">Plano com acesso por tempo ou pacote de consultas avulsas</p>

                {/* Mode toggle */}
                <div className="flex rounded-xl border border-white/10 overflow-hidden mb-6 p-1 bg-white/5 gap-1">
                  {([["plan", "Assinar Plano"], ["recharge", "Comprar Recarga"]] as [PurchaseMode, string][]).map(([mode, label]) => (
                    <button key={mode} onClick={() => setPurchaseMode(mode)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-[0.15em] transition-all ${purchaseMode === mode ? "text-black" : "text-muted-foreground hover:text-foreground"}`}
                      style={purchaseMode === mode ? { background: "var(--color-primary)" } : {}}>
                      {label}
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {purchaseMode === "plan" ? (
                    <motion.div key="plan-grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4 mb-4">
                      {plans.length === 0 ? (
                        <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                      ) : (
                        <>
                          {/* Duration tabs */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] uppercase tracking-[0.35em] text-muted-foreground">Período de acesso</span>
                              <button type="button" onClick={() => setShowComparison(true)}
                                className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-white/5">
                                <BarChart3 className="w-3 h-3" /> Comparar
                              </button>
                            </div>
                            <div className="flex gap-2">
                              {(availDays.length > 0 ? availDays : [1, 7, 14, 30]).map(d => (
                                <button key={d} type="button" onClick={() => handleSelectDays(d)}
                                  className={`flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                                    selectedDays === d ? "text-black shadow-md" : "bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground hover:border-white/25"
                                  }`}
                                  style={selectedDays === d ? { background: "var(--color-primary)" } : {}}>
                                  {d === 1 ? "1d" : `${d}d`}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 3-column tier cards */}
                          <div className="grid grid-cols-3 gap-2">
                            {(["padrao", "vip", "ultra"] as TierKey[]).map(t => {
                              const tp = planForTier(t, selectedDays);
                              const altDays = !tp
                                ? availDays.find(d => !!planForTier(t, d))
                                : undefined;
                              return (
                                <TierCard key={t} tier={t} plan={tp}
                                  selected={selectedTier === t && !!tp}
                                  disabled={!tp}
                                  onSelect={() => handleSelectTier(t)}
                                  onSwitchDays={altDays !== undefined ? () => setSelectedDays(altDays) : undefined} />
                              );
                            })}
                          </div>

                          {/* Selected plan summary */}
                          {selectedPlan && (
                            <motion.div key={selectedPlan.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {selectedPlan.tier === "ultra" ? <Flame className="w-3.5 h-3.5 text-rose-400" /> : selectedPlan.tier === "vip" ? <Crown className="w-3.5 h-3.5 text-amber-400" /> : <Shield className="w-3.5 h-3.5 text-sky-400" />}
                                <span className="text-xs font-bold">{selectedPlan.label}</span>
                                {selectedPlan.queryQuota && <span className="text-[10px] text-muted-foreground">· {selectedPlan.queryQuota} consultas</span>}
                              </div>
                              <span className="font-bold text-sm" style={{ color: "var(--color-primary)" }}>R$ {selectedPlan.amountBrl}</span>
                            </motion.div>
                          )}
                        </>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div key="recharge-grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      {rechargePacks.length === 0 ? (
                        <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                          {rechargePacks.map(p => (
                            <RechargeCard key={p.id} pack={p} selected={selectedPackId === p.id} onSelect={() => setSelectedPackId(p.id)} />
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button onClick={() => setStep("register")} disabled={!canContinue}
                  className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black disabled:opacity-40 transition-all"
                  style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}>
                  {purchaseMode === "plan"
                    ? `Continuar com ${selectedPlan?.label ?? "—"} → R$ ${selectedPlan?.amountBrl ?? ""}`
                    : `Continuar com ${selectedPack?.label ?? "—"} → R$ ${selectedPack?.amountBrl ?? ""}`}
                </button>

                <button onClick={() => setStep("gift")}
                  className="w-full mt-3 py-3 rounded-xl font-medium text-sm text-muted-foreground hover:text-foreground border border-white/10 hover:border-primary/30 hover:bg-primary/5 transition-all flex items-center justify-center gap-2">
                  <Gift className="w-4 h-4 text-primary/70" /> Tenho um código Gift Card
                </button>
                <p className="text-center mt-4 text-xs text-muted-foreground">
                  Já tem conta? <Link href="/login" className="text-primary hover:underline">Entrar</Link>
                </p>
              </motion.div>
            )}

            {/* CADASTRO */}
            {step === "register" && (
              <motion.div key="register" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <button onClick={() => setStep("plans")} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5" /> Voltar
                </button>
                <h2 className="text-xl font-bold mb-1">Criar sua conta</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  {purchaseMode === "plan" ? "Plano:" : "Pacote:"} <span className="text-primary font-semibold">{selectedLabel}</span>
                </p>
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                    <input type="text" placeholder="Nome de usuário" value={username}
                      onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                      autoComplete="username" required />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                    <input type="password" placeholder="Senha (mín. 6 caracteres)" value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                      autoComplete="new-password" required />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-sm">@</span>
                    <input type="email" placeholder="E-mail (opcional — para recibo)" value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-8 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                      autoComplete="email" />
                  </div>
                  {/* Cupom de desconto — apenas para planos */}
                  {purchaseMode === "plan" && (
                    <div className="space-y-2">
                      {couponInfo ? (
                        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                            <div>
                              <span className="font-mono font-bold text-emerald-300 text-xs">{couponInput.toUpperCase()}</span>
                              <span className="ml-2 text-xs text-emerald-400 font-semibold">−{couponInfo.discountPercent}% de desconto</span>
                              {couponInfo.description && <p className="text-[10px] text-emerald-400/70 mt-0.5">{couponInfo.description}</p>}
                            </div>
                          </div>
                          <button type="button" onClick={() => { setCouponInfo(null); setCouponInput(""); setCouponError(""); }}
                            className="p-1 rounded-md text-muted-foreground hover:text-destructive transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                            <input type="text" placeholder="Cupom de desconto (opcional)"
                              value={couponInput}
                              onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(""); }}
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleValidateCoupon(); } }}
                              maxLength={30}
                              className="w-full pl-9 pr-3 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors" />
                          </div>
                          <button type="button" onClick={() => void handleValidateCoupon()}
                            disabled={couponLoading || !couponInput.trim()}
                            className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-white/25 disabled:opacity-50 transition-all">
                            {couponLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Aplicar"}
                          </button>
                        </div>
                      )}
                      {couponError && <p className="text-xs text-rose-400">{couponError}</p>}
                    </div>
                  )}
                  {error && <p className="text-xs text-rose-400 bg-rose-400/8 border border-rose-400/20 rounded-lg px-3 py-2">{error}</p>}
                  <button type="submit" disabled={regLoading}
                    className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                    style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}>
                    {regLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando PIX...</> : <><QrCode className="w-4 h-4" /> Gerar PIX</>}
                  </button>
                </form>
                <p className="text-center mt-4 text-[11px] text-muted-foreground/60">Anote seu usuário e senha — você vai precisar para entrar.</p>
              </motion.div>
            )}

            {/* PAGAMENTO */}
            {step === "payment" && payment && (
              <motion.div key="payment" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-xl font-bold mb-1">Pague via PIX</h2>
                <p className="text-sm text-muted-foreground mb-5">Escaneie o QR Code ou use o código · conta criada automaticamente</p>
                <div className="flex flex-col items-center gap-4 mb-5">
                  {payment.qrcode_base64 ? (
                    <div className="p-3 rounded-2xl bg-white shadow-xl">
                      <img
                        src={
                          payment.qrcode_base64.startsWith("http") ? payment.qrcode_base64 :
                          payment.qrcode_base64.startsWith("data:") ? payment.qrcode_base64 :
                          `data:image/png;base64,${payment.qrcode_base64}`
                        }
                        alt="QR Code PIX" className="w-48 h-48"
                      />
                    </div>
                  ) : (
                    <div className="w-48 h-48 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                      <QrCode className="w-12 h-12 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="text-center">
                    <div className="text-2xl font-bold"
                      style={{ background: "linear-gradient(to right, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                      R$ {payment.amountBrl}
                    </div>
                    {payment.pack && (
                      <div className="text-xs text-muted-foreground mt-1">{payment.pack.consultas} consultas · {payment.pack.label}</div>
                    )}
                    {payment.plan && (
                      <div className="text-xs text-muted-foreground mt-1">{payment.plan.label} · acesso completo</div>
                    )}
                  </div>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3 mb-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">Pix Copia e Cola</span>
                    <CopyButton text={payment.pixCopiaECola} />
                  </div>
                  <p className="font-mono text-xs text-muted-foreground break-all line-clamp-2">{payment.pixCopiaECola}</p>
                </div>
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 flex items-center gap-3">
                  {polling ? <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" /> : <Clock className="w-4 h-4 text-amber-400 shrink-0" />}
                  <div className="text-xs">
                    <span className="text-amber-300 font-semibold">Aguardando pagamento</span>
                    {polling && <span className="text-muted-foreground ml-2">· expira em {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</span>}
                  </div>
                </div>
              </motion.div>
            )}

            {/* SUCESSO */}
            {step === "success" && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-4">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.1 }}
                  className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "2px solid var(--color-primary)" }}>
                  <CheckCircle2 className="w-10 h-10 text-primary" />
                </motion.div>
                <h2 className="text-2xl font-bold mb-2">Pagamento confirmado!</h2>
                {payment?.pack ? (
                  <p className="text-sm text-muted-foreground mb-2">
                    Conta <span className="text-primary font-semibold">{payment.username}</span> criada com <span className="font-semibold">{payment.pack.consultas} consultas</span>.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mb-2">
                    Sua conta <span className="text-primary font-semibold">{payment?.username}</span> está ativa.
                  </p>
                )}
                <p className="text-xs text-muted-foreground mb-6">
                  {payment?.plan ? `Plano: ${payment.plan.label}` : payment?.pack ? `Recarga: ${payment.pack.label}` : ""}
                </p>
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 mb-6 text-left">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 mb-2">Seus dados de acesso</p>
                  <p className="text-sm"><span className="text-muted-foreground">Usuário:</span> <span className="font-mono font-semibold">{payment?.username}</span></p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Use a senha que você cadastrou para entrar.</p>
                </div>
                <button onClick={() => setLocation("/login")}
                  className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black transition-all"
                  style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}>
                  Entrar no Painel →
                </button>
              </motion.div>
            )}

            {/* GIFT CODE */}
            {step === "gift" && (
              <motion.div key="gift" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <button onClick={() => setStep("plans")} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5" /> Voltar
                </button>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)" }}>
                    <Gift className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold leading-tight">Resgatar Gift Card</h2>
                    <p className="text-xs text-muted-foreground">Crie sua conta usando um código de afiliado</p>
                  </div>
                </div>
                <form onSubmit={handleGiftRedeem} className="space-y-4">
                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/50" />
                    <input type="text" placeholder="Código (ex: INFY-XXXX-XXXX-XXXX)" value={giftCode}
                      onChange={e => setGiftCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors" required />
                  </div>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                    <input type="text" placeholder="Escolha um usuário" value={giftUser}
                      onChange={e => setGiftUser(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors" required />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                    <input type="password" placeholder="Crie uma senha" value={giftPass}
                      onChange={e => setGiftPass(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors" required />
                  </div>
                  {giftError && <p className="text-xs text-rose-400 bg-rose-400/8 border border-rose-400/20 rounded-lg px-3 py-2">{giftError}</p>}
                  <button type="submit" disabled={giftLoading}
                    className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                    style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}>
                    {giftLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Resgatando...</> : "Resgatar Gift Card"}
                  </button>
                </form>
              </motion.div>
            )}

            {/* GIFT SUCCESS */}
            {step === "gift-success" && giftResult && (
              <motion.div key="gift-success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-4">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.1 }}
                  className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "2px solid var(--color-primary)" }}>
                  <CheckCircle2 className="w-10 h-10 text-primary" />
                </motion.div>
                <h2 className="text-2xl font-bold mb-2">Gift Card resgatado!</h2>
                <p className="text-sm text-muted-foreground mb-2">
                  Conta <span className="text-primary font-semibold">{giftResult.username}</span> criada com {giftResult.days} dias de acesso.
                </p>
                <p className="text-xs text-muted-foreground mb-6">
                  Expira em {new Date(giftResult.expiresAt).toLocaleDateString("pt-BR")}
                </p>
                <button onClick={() => setLocation("/login")}
                  className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black transition-all"
                  style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}>
                  Entrar no Painel →
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Plan comparison modal */}
      <AnimatePresence>
        {showComparison && (
          <PlanComparisonModal plans={plans} onClose={() => setShowComparison(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
