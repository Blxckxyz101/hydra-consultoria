import { useState } from "react";
import { useLocation } from "wouter";
import logoUrl from "@/assets/hydra-icon.png";
import { AnimatedBackground } from "@/components/ui/AnimatedBackground";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, KeyRound, UserRound, ShieldAlert, ShieldCheck, Lock } from "lucide-react";

type Step = "credentials" | "setup-pin" | "verify-pin";

export default function Login() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("credentials");
  const [tempToken, setTempToken] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const r = await fetch("/api/infinity/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json() as { step?: string; tempToken?: string; error?: string };
      if (!r.ok) {
        setError(data.error ?? "Credenciais inválidas");
        return;
      }
      setTempToken(data.tempToken ?? "");
      setStep((data.step as Step) ?? "verify-pin");
    } catch {
      setError("Falha na conexão");
    } finally {
      setPending(false);
    }
  };

  const handleSetupPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(pin)) { setError("PIN deve ter exatamente 4 dígitos numéricos"); return; }
    if (pin !== confirmPin) { setError("Os PINs não coincidem"); return; }
    setPending(true);
    try {
      const r = await fetch("/api/infinity/setup-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempToken, pin }),
      });
      const data = await r.json() as { token?: string; error?: string };
      if (!r.ok) {
        setError(data.error ?? "Erro ao configurar PIN");
        return;
      }
      localStorage.setItem("infinity_token", data.token ?? "");
      setLocation("/");
    } catch {
      setError("Falha na conexão");
    } finally {
      setPending(false);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(pin)) { setError("PIN deve ter exatamente 4 dígitos numéricos"); return; }
    setPending(true);
    try {
      const r = await fetch("/api/infinity/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempToken, pin }),
      });
      const data = await r.json() as { token?: string; error?: string };
      if (!r.ok) {
        setError(data.error ?? "PIN incorreto");
        return;
      }
      localStorage.setItem("infinity_token", data.token ?? "");
      setLocation("/");
    } catch {
      setError("Falha na conexão");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden p-4">
      <AnimatedBackground />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md relative z-10"
      >
        <div className="rounded-3xl border border-white/10 bg-black/30 backdrop-blur-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(56,189,248,0.4)] overflow-hidden">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

          <div className="px-10 pt-10 pb-8">
            <div className="flex flex-col items-center mb-8">
              <motion.div
                initial={{ scale: 0.5, opacity: 0, rotate: -10 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ delay: 0.15, type: "spring", stiffness: 180, damping: 14 }}
                className="relative mb-4"
              >
                <div className="absolute inset-0 rounded-2xl bg-primary/25 blur-2xl scale-125" />
                <div className="relative w-24 h-24 flex items-center justify-center">
                  <img
                    src={logoUrl}
                    alt="Hydra Consultoria"
                    className="w-24 h-24 object-contain"
                  />
                </div>
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="text-2xl font-bold tracking-[0.3em] text-foreground neon-text"
              >
                HYDRA CONSULTORIA
              </motion.h1>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
                className="flex items-center gap-2 text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-3"
              >
                {step === "credentials" && <><ShieldAlert className="w-3 h-3" /> Acesso Restrito</>}
                {step === "setup-pin" && <><Lock className="w-3 h-3" /> Criar PIN de Acesso</>}
                {step === "verify-pin" && <><ShieldCheck className="w-3 h-3" /> Verificação PIN</>}
              </motion.div>
            </div>

            <AnimatePresence mode="wait">
              {step === "credentials" && (
                <motion.form
                  key="credentials"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  onSubmit={handleCredentials}
                  className="space-y-5"
                >
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2"
                    >
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      {error}
                    </motion.div>
                  )}

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-2">
                      <UserRound className="w-3 h-3" /> Usuário
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/40"
                      placeholder="Digite seu usuário"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-2">
                      <KeyRound className="w-3 h-3" /> Senha
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/40"
                      placeholder="Digite sua senha"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={pending}
                    className="w-full relative group bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold uppercase tracking-[0.3em] text-xs py-4 rounded-xl hover:shadow-[0_0_30px_rgba(56,189,248,0.6)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                  >
                    <LogIn className="w-4 h-4" />
                    {pending ? "Verificando..." : "Entrar"}
                  </button>
                </motion.form>
              )}

              {step === "setup-pin" && (
                <motion.form
                  key="setup-pin"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  onSubmit={handleSetupPin}
                  className="space-y-5"
                >
                  <div className="px-4 py-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-300 text-sm">
                    <p className="font-semibold text-[11px] uppercase tracking-widest mb-1">Primeiro acesso</p>
                    <p className="text-[11px] text-muted-foreground">Crie um PIN de 4 dígitos para proteger sua conta. Ele será solicitado a cada login.</p>
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2"
                    >
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      {error}
                    </motion.div>
                  )}

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-2">
                      <Lock className="w-3 h-3" /> Novo PIN (4 dígitos)
                    </label>
                    <input
                      type="password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      inputMode="numeric"
                      maxLength={4}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-foreground font-mono tracking-[0.5em] text-center text-xl focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/40 placeholder:tracking-normal"
                      placeholder="••••"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-2">
                      <Lock className="w-3 h-3" /> Confirmar PIN
                    </label>
                    <input
                      type="password"
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      inputMode="numeric"
                      maxLength={4}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-foreground font-mono tracking-[0.5em] text-center text-xl focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/40 placeholder:tracking-normal"
                      placeholder="••••"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={pending || pin.length !== 4 || confirmPin.length !== 4}
                    className="w-full relative group bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold uppercase tracking-[0.3em] text-xs py-4 rounded-xl hover:shadow-[0_0_30px_rgba(56,189,248,0.6)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                  >
                    <Lock className="w-4 h-4" />
                    {pending ? "Configurando..." : "Criar PIN e Entrar"}
                  </button>
                </motion.form>
              )}

              {step === "verify-pin" && (
                <motion.form
                  key="verify-pin"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  onSubmit={handleVerifyPin}
                  className="space-y-5"
                >
                  <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-muted-foreground text-sm">
                    <p className="text-[11px]">Olá <strong className="text-foreground">{username}</strong>! Insira seu PIN de 4 dígitos para continuar.</p>
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2"
                    >
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      {error}
                    </motion.div>
                  )}

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-2">
                      <Lock className="w-3 h-3" /> PIN de Acesso
                    </label>
                    <input
                      type="password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      inputMode="numeric"
                      maxLength={4}
                      autoFocus
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-foreground font-mono tracking-[0.5em] text-center text-xl focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/40 placeholder:tracking-normal"
                      placeholder="••••"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={pending || pin.length !== 4}
                    className="w-full relative group bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold uppercase tracking-[0.3em] text-xs py-4 rounded-xl hover:shadow-[0_0_30px_rgba(56,189,248,0.6)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {pending ? "Verificando..." : "Confirmar PIN"}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setStep("credentials"); setPin(""); setError(""); }}
                    className="w-full text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ← Voltar ao início
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          <div className="px-10 py-5 border-t border-white/5 bg-black/20 space-y-3">
            {step === "credentials" && (
              <div className="flex gap-2">
                <a
                  href="/registro"
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-black text-xs font-bold uppercase tracking-[0.2em] transition-all"
                  style={{ background: "var(--color-primary)" }}
                >
                  Criar conta
                </a>
                <a
                  href="/planos"
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary hover:bg-primary/15 hover:border-primary/50 transition-all text-xs font-bold uppercase tracking-[0.2em]"
                >
                  Ver planos
                </a>
              </div>
            )}
            <div className="flex gap-2">
              <a
                href="https://t.me/hydraconsultoria"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl transition-all text-[11px] font-medium"
                style={{ background: "rgba(0,136,204,0.12)", border: "1px solid rgba(0,136,204,0.3)", color: "#29b6f6" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,136,204,0.22)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,136,204,0.55)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,136,204,0.12)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,136,204,0.3)"; }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.08 14.07l-2.95-.924c-.642-.2-.657-.642.136-.953l11.57-4.461c.537-.194 1.006.131.726.516z"/></svg>
                Suporte no Telegram
              </a>
              <a
                href="https://t.me/Blxckxyz"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:bg-primary/10 hover:border-primary/30 transition-all text-[11px] font-medium"
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--color-primary)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = ""; }}
                title="Telegram"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.08 14.07l-2.95-.924c-.642-.2-.657-.642.136-.953l11.57-4.461c.537-.194 1.006.131.726.516z"/></svg>
              </a>
            </div>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.35em] text-muted-foreground/60">
              <span>Hydra Consultoria</span>
              <span className="text-primary/60">v1.0</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
