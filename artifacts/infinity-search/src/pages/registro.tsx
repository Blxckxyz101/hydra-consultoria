import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Clock, Shield, Star, Zap, ArrowLeft, Copy, Check, Loader2, QrCode, User, Lock, UserPlus } from "lucide-react";
import { Link, useLocation } from "wouter";
import logoUrl from "@/assets/logo.png";
import { AnimatedBackground } from "@/components/ui/AnimatedBackground";

interface Plan {
  id: string;
  label: string;
  days: number;
  amountBrl: string;
  amountCents: number;
  highlight?: boolean;
}

const PLAN_ICONS: Record<string, React.ElementType> = {
  "1d":  Clock,
  "7d":  Zap,
  "14d": Star,
  "30d": Shield,
};

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const apiFetch = (path: string, opts?: RequestInit) =>
  fetch(`${BASE}/api/infinity${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });

type Step = "plans" | "register" | "payment" | "success";

interface PaymentData {
  paymentId: string;
  txid: string;
  pixCopiaECola: string;
  qrcode_base64: string;
  amountBrl: string;
  taxa?: number;
  plan: { id: string; label: string; days: number };
  username: string;
}

function PlanCard({ plan, selected, onSelect }: { plan: Plan; selected: boolean; onSelect: () => void }) {
  const Icon = PLAN_ICONS[plan.id] ?? Zap;
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onSelect}
      className={`relative w-full text-left rounded-2xl border p-5 transition-all duration-200 ${
        selected
          ? "bg-primary/10 border-primary/60 shadow-[0_0_30px_-8px_var(--color-primary)]"
          : plan.highlight
          ? "bg-amber-400/5 border-amber-400/30 hover:border-amber-400/50"
          : "bg-black/30 border-white/10 hover:border-white/25"
      }`}
    >
      {plan.highlight && !selected && (
        <span className="absolute -top-2.5 left-4 text-[9px] uppercase tracking-[0.3em] font-bold text-black bg-amber-400 px-2 py-0.5 rounded-full">
          Mais popular
        </span>
      )}
      {selected && (
        <span className="absolute -top-2.5 right-4 text-[9px] uppercase tracking-[0.3em] font-bold text-black px-2 py-0.5 rounded-full" style={{ background: "var(--color-primary)" }}>
          Selecionado
        </span>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <Icon className={`w-5 h-5 mb-2 ${selected ? "text-primary" : plan.highlight ? "text-amber-400" : "text-muted-foreground"}`} />
          <div className="font-bold text-base">{plan.label}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-[0.2em]">acesso completo</div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${selected ? "text-primary" : plan.highlight ? "text-amber-300" : "text-foreground"}`}>
            R$ {plan.amountBrl}
          </div>
          <div className="text-[10px] text-muted-foreground">pagamento único</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
        {["24 tipos de consulta OSINT", "Assistente IA incluso", "Dossiê e histórico completo"].map(f => (
          <div key={f} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> {f}
          </div>
        ))}
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

const STEPS = [
  { key: "plans",    label: "Plano" },
  { key: "register", label: "Conta" },
  { key: "payment",  label: "Pagamento" },
  { key: "success",  label: "Pronto" },
];

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.findIndex(s => s.key === current);
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2 flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                i < idx ? "text-black" : i === idx ? "text-black" : "text-muted-foreground border border-white/15 bg-transparent"
              }`}
              style={i <= idx ? { background: "var(--color-primary)" } : {}}
            >
              {i < idx ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className={`text-[9px] uppercase tracking-[0.2em] font-semibold ${i <= idx ? "text-primary" : "text-muted-foreground/50"}`}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className="flex-1 h-px mb-4 transition-colors" style={{ background: i < idx ? "var(--color-primary)" : "rgba(255,255,255,0.1)" }} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function Registro() {
  const [, setLocation] = useLocation();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("14d");
  const [step, setStep] = useState<Step>("plans");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  const [payment, setPayment] = useState<PaymentData | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [polling, setPolling] = useState(false);
  const [countdown, setCountdown] = useState(180);

  useEffect(() => {
    apiFetch("/plans").then(r => r.json()).then((d: Plan[]) => {
      setPlans(d);
      if (!d.find(p => p.id === "14d") && d.length > 0) setSelectedPlanId(d[0].id);
    }).catch(() => {});
  }, []);

  const selectedPlan = plans.find(p => p.id === selectedPlanId);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password.trim()) { setError("Preencha todos os campos"); return; }
    if (username.length < 3) { setError("Usuário deve ter ao menos 3 caracteres"); return; }
    if (password.length < 6) { setError("Senha deve ter ao menos 6 caracteres"); return; }
    setRegLoading(true);
    try {
      const r = await apiFetch("/payments/create", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          password,
          email: email.trim() || undefined,
          planId: selectedPlanId,
        }),
      });
      const data = await r.json() as PaymentData & { error?: string };
      if (!r.ok) { setError(data.error ?? "Erro ao gerar pagamento"); setRegLoading(false); return; }
      setPayment({ ...data, username: username.trim().toLowerCase() });
      setStep("payment");
      startPolling(data.txid, username.trim().toLowerCase());
    } catch {
      setError("Falha na conexão");
    } finally {
      setRegLoading(false);
    }
  };

  const startPolling = useCallback((txid: string, user: string) => {
    setPolling(true);
    setCountdown(180);
    let ticks = 0;
    const cdInt = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    pollRef.current = setInterval(async () => {
      ticks++;
      if (ticks > 60) { clearInterval(pollRef.current!); clearInterval(cdInt); setPolling(false); return; }
      try {
        const r = await apiFetch(`/payments/verify?txid=${txid}&username=${user}`);
        const d = await r.json() as { confirmed?: boolean; error?: string };
        if (d.confirmed) {
          clearInterval(pollRef.current!);
          clearInterval(cdInt);
          setPolling(false);
          setStep("success");
        }
      } catch {}
    }, 3000);
    return () => { clearInterval(pollRef.current!); clearInterval(cdInt); };
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handlePix = async () => {
    if (!selectedPlan || payLoading) return;
    setPayLoading(true);
    setPayError("");
    try {
      const r = await apiFetch("/payments/create", {
        method: "POST",
        body: JSON.stringify({ planId: selectedPlanId }),
      });
      const data = await r.json() as PaymentData & { error?: string };
      if (!r.ok) { setPayError(data.error ?? "Erro ao gerar PIX"); setPayLoading(false); return; }
      setPayment(data);
      setStep("payment");
      startPolling(data.txid, "");
    } catch {
      setPayError("Falha na conexão");
    } finally {
      setPayLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <AnimatedBackground />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-lg z-10"
      >
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src={logoUrl} alt="" className="w-10 h-10 object-contain" style={{ filter: "drop-shadow(0 0 12px color-mix(in srgb, var(--color-primary) 60%, transparent))" }} />
          <div>
            <div className="font-bold tracking-[0.3em] text-lg">INFINITY</div>
            <div className="text-[9px] uppercase tracking-[0.5em] text-primary/60">SEARCH</div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/50 backdrop-blur-2xl p-7 shadow-2xl">
          <StepIndicator current={step} />

          <AnimatePresence mode="wait">
            {/* STEP 1: choose plan */}
            {step === "plans" && (
              <motion.div key="plans" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-xl font-bold mb-1">Escolha seu plano</h2>
                <p className="text-sm text-muted-foreground mb-6">Todos os planos incluem acesso completo ao painel</p>
                {plans.length === 0 ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    {plans.map(p => (
                      <PlanCard key={p.id} plan={p} selected={selectedPlanId === p.id} onSelect={() => setSelectedPlanId(p.id)} />
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setStep("register")}
                  disabled={!selectedPlan}
                  className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black disabled:opacity-40 transition-all"
                  style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}
                >
                  Continuar com {selectedPlan?.label ?? "—"} → R$ {selectedPlan?.amountBrl ?? ""}
                </button>
                <p className="text-center mt-4 text-xs text-muted-foreground">
                  Já tem conta?{" "}
                  <Link href="/login" className="text-primary hover:underline">Entrar</Link>
                </p>
              </motion.div>
            )}

            {/* STEP 2: register */}
            {step === "register" && (
              <motion.div key="register" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <button onClick={() => setStep("plans")} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5" /> Voltar
                </button>
                <h2 className="text-xl font-bold mb-1">Criar sua conta</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Plano selecionado: <span className="text-primary font-semibold">{selectedPlan?.label} — R$ {selectedPlan?.amountBrl}</span>
                </p>
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                    <input
                      type="text"
                      placeholder="Nome de usuário"
                      value={username}
                      onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                    <input
                      type="password"
                      placeholder="Senha (mín. 6 caracteres)"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                      autoComplete="new-password"
                      required
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-sm">@</span>
                    <input
                      type="email"
                      placeholder="E-mail (opcional — para recibo)"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-8 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                      autoComplete="email"
                    />
                  </div>
                  {error && (
                    <p className="text-xs text-rose-400 bg-rose-400/8 border border-rose-400/20 rounded-lg px-3 py-2">{error}</p>
                  )}
                  <button
                    type="submit"
                    disabled={regLoading}
                    className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                    style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}
                  >
                    {regLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando PIX...</> : <><QrCode className="w-4 h-4" /> Gerar PIX</>}
                  </button>
                </form>
                <p className="text-center mt-4 text-[11px] text-muted-foreground/60">
                  Anote seu usuário e senha — você vai precisar para entrar.
                </p>
              </motion.div>
            )}

            {/* STEP 3: payment */}
            {step === "payment" && payment && (
              <motion.div key="payment" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-xl font-bold mb-1">Pague via PIX</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  Escaneie o QR Code ou use o código abaixo · sua conta será criada automaticamente
                </p>

                {/* QR */}
                <div className="flex flex-col items-center gap-4 mb-5">
                  {payment.qrcode_base64 ? (
                    <div className="p-3 rounded-2xl bg-white shadow-xl">
                      <img src={`data:image/png;base64,${payment.qrcode_base64}`} alt="QR Code PIX" className="w-48 h-48" />
                    </div>
                  ) : (
                    <div className="w-48 h-48 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                      <QrCode className="w-12 h-12 text-muted-foreground/30" />
                    </div>
                  )}
                  <div
                    className="text-2xl font-bold"
                    style={{ background: "linear-gradient(to right, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
                  >
                    R$ {payment.amountBrl}
                  </div>
                </div>

                {/* Copia e cola */}
                <div className="rounded-xl bg-white/5 border border-white/10 p-3 mb-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">Pix Copia e Cola</span>
                    <CopyButton text={payment.pixCopiaECola} />
                  </div>
                  <p className="font-mono text-xs text-muted-foreground break-all line-clamp-2">{payment.pixCopiaECola}</p>
                </div>

                {/* Status */}
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 flex items-center gap-3">
                  {polling ? (
                    <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <div className="text-xs">
                    <span className="text-amber-300 font-semibold">Aguardando pagamento</span>
                    {polling && (
                      <span className="text-muted-foreground ml-2">· expira em {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</span>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 4: success */}
            {step === "success" && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-4">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", delay: 0.1 }}
                  className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "2px solid var(--color-primary)" }}
                >
                  <CheckCircle2 className="w-10 h-10 text-primary" />
                </motion.div>
                <h2 className="text-2xl font-bold mb-2">Pagamento confirmado!</h2>
                <p className="text-sm text-muted-foreground mb-2">
                  Sua conta <span className="text-primary font-semibold">{payment?.username}</span> está ativa.
                </p>
                <p className="text-xs text-muted-foreground mb-6">
                  Plano: <span className="font-semibold">{payment?.plan?.label}</span>
                </p>
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 mb-6 text-left">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 mb-2">Seus dados de acesso</p>
                  <p className="text-sm"><span className="text-muted-foreground">Usuário:</span> <span className="font-mono font-semibold text-foreground">{payment?.username}</span></p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Use a senha que você cadastrou para entrar.</p>
                </div>
                <button
                  onClick={() => setLocation("/login")}
                  className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black transition-all"
                  style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}
                >
                  Entrar no Painel →
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center mt-5 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/40">
          by infinity search · pagamento seguro via pix
        </p>
      </motion.div>
    </div>
  );
}
