import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { CreditCard, CheckCircle2, Clock, Copy, QrCode, ArrowLeft, Zap, Shield, Star, RefreshCw, AlertCircle, Check } from "lucide-react";
import { useInfinityMe } from "@workspace/api-client-react";

interface Plan {
  id: string;
  label: string;
  days: number;
  amountBrl: string;
  highlight: boolean;
}

interface PaymentResult {
  paymentId: string;
  pixCode: string | null;
  pixQr: string | null;
  amountBrl: string;
  plan: { id: string; label: string; days: number };
  expiresAt: string;
  username?: string;
}

const PLAN_ICONS: Record<string, React.ElementType> = {
  "7d": Clock,
  "30d": Star,
  "90d": Shield,
};

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
          <div className="text-[10px] text-muted-foreground">único pagamento</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-white/5">
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> 24 tipos de consulta OSINT
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Assistente IA incluso
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Dossiê e histórico completo
        </div>
      </div>
    </motion.button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button
      onClick={copy}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
        copied
          ? "bg-emerald-400/15 border border-emerald-400/40 text-emerald-300"
          : "bg-white/5 border border-white/15 text-muted-foreground hover:text-foreground hover:border-white/30"
      }`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copiado!" : "Copiar"}
    </button>
  );
}

type Step = "plans" | "register" | "payment" | "waiting" | "success";

export default function Planos() {
  const { data: me } = useInfinityMe({});
  const [, setLocation] = useLocation();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [step, setStep] = useState<Step>("plans");

  // Registration fields (guests only)
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [regError, setRegError] = useState("");

  // Payment state
  const [payment, setPayment] = useState<PaymentResult | null>(null);
  const [payStatus, setPayStatus] = useState<"pending" | "paid" | "failed">("pending");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    fetch("/api/infinity/plans")
      .then(r => r.json())
      .then((data: Plan[]) => {
        setPlans(data);
        const highlight = data.find(p => p.highlight);
        if (highlight) setSelectedPlan(highlight.id);
        else if (data.length > 0) setSelectedPlan(data[0].id);
      })
      .catch(() => {});
  }, []);

  const isLoggedIn = !!me;

  const handlePlanNext = () => {
    if (!selectedPlan) return;
    if (isLoggedIn) {
      void createPaymentLoggedIn();
    } else {
      setStep("register");
    }
  };

  const createPaymentLoggedIn = async () => {
    setCreating(true);
    setCreateError("");
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId: selectedPlan }),
      });
      const data = await r.json() as PaymentResult & { error?: string };
      if (!r.ok) { setCreateError(data.error ?? "Falha ao criar pagamento"); return; }
      setPayment(data);
      setStep("payment");
    } catch {
      setCreateError("Falha na conexão");
    } finally {
      setCreating(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError("");
    if (!username.trim() || !password) { setRegError("Usuário e senha obrigatórios"); return; }
    setCreating(true);
    try {
      const r = await fetch("/api/infinity/payments/create-guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: selectedPlan, username: username.trim(), password, email: email.trim() || undefined }),
      });
      const data = await r.json() as PaymentResult & { error?: string };
      if (!r.ok) { setRegError(data.error ?? "Falha ao criar pagamento"); return; }
      setPayment(data);
      setStep("payment");
    } catch {
      setRegError("Falha na conexão");
    } finally {
      setCreating(false);
    }
  };

  const checkPaymentStatus = useCallback(async () => {
    if (!payment?.paymentId) return;
    setPolling(true);
    try {
      const r = await fetch(`/api/infinity/payments/${payment.paymentId}/status`);
      const data = await r.json() as { status: string; paidAt?: string };
      if (data.status === "paid") {
        setPayStatus("paid");
        if (isLoggedIn) {
          setStep("success");
        } else {
          setStep("waiting");
          startPollingApproval();
        }
      } else if (data.status === "failed" || data.status === "expired") {
        setPayStatus("failed");
      }
    } catch {} finally {
      setPolling(false);
    }
  }, [payment, isLoggedIn]);

  let approvalInterval: ReturnType<typeof setInterval> | null = null;
  const startPollingApproval = () => {
    if (approvalInterval) return;
    approvalInterval = setInterval(async () => {
      if (!payment?.username) return;
      try {
        const r = await fetch(`/api/infinity/pending-account/status?username=${encodeURIComponent(payment.username)}`);
        const data = await r.json() as { status: string };
        if (data.status === "approved") {
          if (approvalInterval) clearInterval(approvalInterval);
          setStep("success");
        }
      } catch {}
    }, 5000);
  };

  useEffect(() => {
    if (step !== "payment") return;
    const id = setInterval(checkPaymentStatus, 8000);
    return () => clearInterval(id);
  }, [step, checkPaymentStatus]);

  const plan = plans.find(p => p.id === selectedPlan);

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
          Acesso completo à plataforma OSINT
        </p>
      </div>

      <AnimatePresence mode="wait">
        {/* ── Step 1: Plan selection ───────────────────────────── */}
        {step === "plans" && (
          <motion.div key="plans" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} className="space-y-4">
            <div className="grid gap-3">
              {plans.map(p => (
                <PlanCard key={p.id} plan={p} selected={selectedPlan === p.id} onSelect={() => setSelectedPlan(p.id)} />
              ))}
            </div>
            {createError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" /> {createError}
              </div>
            )}
            <button
              onClick={handlePlanNext}
              disabled={!selectedPlan || creating}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-sm uppercase tracking-[0.25em] text-black transition-all disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              <CreditCard className="w-4 h-4" />
              {creating ? "Gerando PIX..." : isLoggedIn ? "Pagar com PIX" : "Continuar"}
            </button>
            {!isLoggedIn && (
              <p className="text-center text-[11px] text-muted-foreground">
                Já tem uma conta?{" "}
                <button onClick={() => setLocation("/login")} className="text-primary hover:underline">
                  Fazer login
                </button>
              </p>
            )}
          </motion.div>
        )}

        {/* ── Step 2: Registration (guests only) ──────────────── */}
        {step === "register" && (
          <motion.div key="register" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep("plans")} className="p-2 rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="font-bold text-sm">Criar conta — Plano {plan?.label}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">R$ {plan?.amountBrl} • pagamento único</div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6">
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground block mb-1.5">Usuário</label>
                  <input
                    value={username}
                    onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    placeholder="3-30 caracteres (letras, números, _)"
                    maxLength={30}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground block mb-1.5">Senha</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground block mb-1.5">
                    E-mail <span className="text-muted-foreground/50">(opcional, para notificações)</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                {regError && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {regError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={creating || username.length < 3 || password.length < 6}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-sm uppercase tracking-[0.25em] text-black transition-all disabled:opacity-50"
                  style={{ background: "var(--color-primary)" }}
                >
                  <QrCode className="w-4 h-4" />
                  {creating ? "Gerando PIX..." : "Gerar QR Code PIX"}
                </button>
              </form>
            </div>
          </motion.div>
        )}

        {/* ── Step 3: Payment ──────────────────────────────────── */}
        {step === "payment" && payment && (
          <motion.div key="payment" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
            {payStatus === "failed" ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center space-y-3">
                <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
                <h3 className="font-bold text-lg uppercase tracking-widest">Pagamento expirado</h3>
                <p className="text-sm text-muted-foreground">O QR Code expirou. Gere um novo pagamento.</p>
                <button onClick={() => { setPayment(null); setPayStatus("pending"); setStep("plans"); }} className="px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest text-black" style={{ background: "var(--color-primary)" }}>
                  Tentar novamente
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-lg">Pagamento PIX</div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-widest">Plano {payment.plan.label} · R$ {payment.amountBrl}</div>
                  </div>
                  <div className="flex items-center gap-2 text-amber-400 text-xs animate-pulse">
                    <Clock className="w-3.5 h-3.5" />
                    Aguardando
                  </div>
                </div>

                {payment.pixQr ? (
                  <div className="flex justify-center">
                    <div className="p-3 rounded-2xl bg-white">
                      <img src={payment.pixQr} alt="QR Code PIX" className="w-48 h-48 object-contain" />
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-center">
                    <div className="w-48 h-48 rounded-2xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center gap-2">
                      <QrCode className="w-12 h-12 text-muted-foreground/30" />
                      <span className="text-[11px] text-muted-foreground">QR Code indisponível</span>
                    </div>
                  </div>
                )}

                {payment.pixCode && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Código PIX copia e cola</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-[11px] font-mono break-all text-muted-foreground">
                        {payment.pixCode.slice(0, 60)}...
                      </div>
                      <CopyButton text={payment.pixCode} />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={checkPaymentStatus}
                    disabled={polling}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] border border-white/15 bg-white/5 text-muted-foreground hover:text-foreground hover:border-white/30 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${polling ? "animate-spin" : ""}`} />
                    {polling ? "Verificando..." : "Verificar pagamento"}
                  </button>
                </div>

                <div className="text-[10px] text-muted-foreground text-center space-y-1">
                  <p>O sistema verifica automaticamente a cada 8 segundos.</p>
                  <p>Expira em: {new Date(payment.expiresAt).toLocaleTimeString("pt-BR")}</p>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Step 4: Waiting for approval (guests) ────────────── */}
        {step === "waiting" && (
          <motion.div key="waiting" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-8 text-center space-y-4">
              <div className="flex items-center justify-center">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-4 border-amber-400/20" />
                  <div className="absolute inset-0 rounded-full border-4 border-t-amber-400 animate-spin" />
                  <Clock className="absolute inset-0 m-auto w-7 h-7 text-amber-400" />
                </div>
              </div>
              <div>
                <h3 className="font-bold text-lg uppercase tracking-widest text-amber-300">Pagamento confirmado!</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Sua conta <strong className="text-foreground">@{payment?.username}</strong> está aguardando aprovação de um administrador.
                </p>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Você será notificado assim que a conta for aprovada. Esta página atualiza automaticamente.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 text-[10px] text-amber-400/70 animate-pulse">
                <RefreshCw className="w-3 h-3" /> Verificando a cada 5 segundos...
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Step 5: Success ──────────────────────────────────── */}
        {step === "success" && (
          <motion.div key="success" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-8 text-center space-y-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="w-16 h-16 rounded-full bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center mx-auto"
              >
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </motion.div>
              <div>
                <h3 className="font-bold text-xl uppercase tracking-widest text-emerald-300">Conta ativada!</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  {isLoggedIn
                    ? `Seu plano ${plan?.label} foi ativado com sucesso!`
                    : `Sua conta foi aprovada e está pronta para uso.`}
                </p>
              </div>
              <button
                onClick={() => isLoggedIn ? setLocation("/") : setLocation("/login")}
                className="px-8 py-3 rounded-xl font-bold text-sm uppercase tracking-[0.25em] text-black transition-all"
                style={{ background: "var(--color-primary)" }}
              >
                {isLoggedIn ? "Ir para o painel" : "Fazer login"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
