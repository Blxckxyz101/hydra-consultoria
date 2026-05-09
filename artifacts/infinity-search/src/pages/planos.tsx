import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Clock, Shield, Star, Zap, ArrowLeft, Copy, Check, Loader2, QrCode, User, Lock } from "lucide-react";

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

interface PaymentData {
  paymentId: string;
  txid: string;
  pixCopiaECola: string;
  qrcode_base64: string;
  amountBrl: string;
  taxa?: number;
  plan: { id: string; label: string; days: number };
  username?: string;
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

export default function Planos() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("14d");
  const [step, setStep] = useState<Step>("plans");
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Register form
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");

  // Payment state
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "paid" | "failed">("pending");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("infinity_token");
    setIsLoggedIn(!!token);

    apiFetch("/plans").then(r => r.json()).then((data: Plan[]) => {
      if (Array.isArray(data)) {
        const mapped = data.map(p => ({ ...p, amountBrl: Number(p.amountBrl ?? p.amountCents / 100).toFixed(2).replace(".", ",") }));
        setPlans(mapped);
        const def = mapped.find(p => p.highlight) ?? mapped[1];
        if (def) setSelectedPlanId(def.id);
      }
    }).catch(() => {
      setPlans([
        { id: "1d",  label: "1 Dia",   days: 1,  amountCents: 1500,  amountBrl: "15,00" },
        { id: "7d",  label: "7 Dias",  days: 7,  amountCents: 4000,  amountBrl: "40,00" },
        { id: "14d", label: "14 Dias", days: 14, amountCents: 7000,  amountBrl: "70,00", highlight: true },
        { id: "30d", label: "30 Dias", days: 30, amountCents: 10000, amountBrl: "100,00" },
      ]);
    });
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback((paymentId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiFetch(`/payments/${paymentId}/status`);
        const data = await r.json() as { status: string };
        if (data.status === "paid") {
          setPaymentStatus("paid");
          setStep("success");
          stopPolling();
        } else if (data.status === "failed" || data.status === "expired") {
          setPaymentStatus("failed");
          stopPolling();
        }
      } catch {}
    }, 3000);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleProceed = () => {
    if (isLoggedIn) {
      handleCreatePayment();
    } else {
      setStep("register");
    }
  };

  const handleCreatePayment = async () => {
    setLoading(true);
    setError("");
    try {
      let r: Response;
      if (isLoggedIn) {
        r = await apiFetch("/payments/create", { method: "POST", body: JSON.stringify({ planId: selectedPlanId }) });
      } else {
        if (!username || !password) { setFormError("Preencha usuário e senha"); setLoading(false); return; }
        r = await apiFetch("/payments/create-guest", {
          method: "POST",
          body: JSON.stringify({ planId: selectedPlanId, username: username.trim().toLowerCase(), password }),
        });
      }
      const data = await r.json() as PaymentData & { error?: string };
      if (!r.ok) { setError(data.error ?? "Erro ao gerar pagamento"); setLoading(false); return; }
      setPaymentData(data);
      setPaymentStatus("pending");
      setStep("payment");
      startPolling(data.paymentId);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    }
    setLoading(false);
  };

  const plan = plans.find(p => p.id === selectedPlanId);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-gradient-to-r from-sky-300 to-cyan-200 bg-clip-text text-transparent"
        >
          Planos
        </motion.h1>
        <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
          Acesso completo à plataforma OSINT · Ativação automática
        </p>
      </div>

      <AnimatePresence mode="wait">

        {/* ── Step 1: Plan selection ── */}
        {step === "plans" && (
          <motion.div key="plans" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} className="space-y-4">
            <div className="grid gap-3">
              {plans.map(p => (
                <PlanCard key={p.id} plan={p} selected={selectedPlanId === p.id} onSelect={() => setSelectedPlanId(p.id)} />
              ))}
            </div>
            {error && <p className="text-xs text-red-400 text-center">{error}</p>}
            <button
              onClick={handleProceed}
              disabled={!selectedPlanId || loading}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-sm uppercase tracking-[0.25em] text-black transition-all disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              {isLoggedIn ? "Pagar com PIX" : "Criar conta e pagar"}
            </button>
            <p className="text-center text-[10px] text-muted-foreground">
              ✅ Ativação automática após confirmação do pagamento
            </p>
          </motion.div>
        )}

        {/* ── Step 2: Register (new users only) ── */}
        {step === "register" && (
          <motion.div key="register" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep("plans")} className="p-2 rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="font-bold text-sm">Criar conta — Plano {plan?.label}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">R$ {plan?.amountBrl} · {plan?.days} {plan?.days === 1 ? "dia" : "dias"} de acesso</div>
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
                  R$ {paymentData.amountBrl} · Plano {paymentData.plan.label}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6 space-y-5">
              {/* QR Code */}
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-2xl p-2 sm:p-3 bg-white mx-auto">
                  <img
                    src={paymentData.qrcode_base64.startsWith("data:") ? paymentData.qrcode_base64 : `data:image/png;base64,${paymentData.qrcode_base64}`}
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

              {/* Pix Copia e Cola */}
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

              {/* Status */}
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
                  Taxa da plataforma: R$ {paymentData.taxa?.toFixed(2)} · Acesso ativado automaticamente após confirmação
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
                <div className="text-sm text-muted-foreground mt-1">
                  Plano <span className="text-foreground font-medium">{paymentData.plan.label}</span> ativado com sucesso.
                </div>
              </div>
              {paymentData.username && (
                <div className="rounded-xl bg-black/30 border border-white/10 px-5 py-3 text-sm">
                  Sua conta <span className="text-primary font-bold">@{paymentData.username}</span> está ativa por <span className="font-bold">{paymentData.plan.days} {paymentData.plan.days === 1 ? "dia" : "dias"}</span>.
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
    </div>
  );
}
