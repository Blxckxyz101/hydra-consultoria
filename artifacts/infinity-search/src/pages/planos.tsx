import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Clock, Shield, Star, Zap, ArrowLeft, MessageCircle } from "lucide-react";

interface Plan {
  id: string;
  label: string;
  days: number;
  amountBrl: string;
  highlight?: boolean;
}

const PLANS: Plan[] = [
  { id: "1d",  label: "1 Dia",    days: 1,  amountBrl: "15,00" },
  { id: "7d",  label: "7 Dias",   days: 7,  amountBrl: "40,00" },
  { id: "14d", label: "14 Dias",  days: 14, amountBrl: "70,00", highlight: true },
  { id: "30d", label: "30 Dias",  days: 30, amountBrl: "100,00" },
];

const PLAN_ICONS: Record<string, React.ElementType> = {
  "1d":  Clock,
  "7d":  Zap,
  "14d": Star,
  "30d": Shield,
};

const CONTACTS = [
  { handle: "@Blxckxyz",  url: "https://t.me/Blxckxyz" },
  { handle: "@xxmathexx", url: "https://t.me/xxmathexx" },
  { handle: "@piancooz",  url: "https://t.me/piancooz" },
];

const TG_ICON = (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.08 14.07l-2.95-.924c-.642-.2-.657-.642.136-.953l11.57-4.461c.537-.194 1.006.131.726.516z" />
  </svg>
);

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
        <span
          className="absolute -top-2.5 right-4 text-[9px] uppercase tracking-[0.3em] font-bold text-black px-2 py-0.5 rounded-full"
          style={{ background: "var(--color-primary)" }}
        >
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
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> 24 tipos de consulta OSINT
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Assistente IA incluso
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Dossiê e histórico completo
        </div>
      </div>
    </motion.button>
  );
}

type Step = "plans" | "contact";

export default function Planos() {
  const [selectedPlan, setSelectedPlan] = useState<string>("14d");
  const [step, setStep] = useState<Step>("plans");

  const plan = PLANS.find(p => p.id === selectedPlan);

  const tgMessage = (handle: string) => {
    const msg = encodeURIComponent(`Olá ${handle}! Quero contratar o plano ${plan?.label ?? ""} (R$ ${plan?.amountBrl ?? ""}) do Infinity Search.`);
    return `https://t.me/${handle.replace("@", "")}?text=${msg}`;
  };

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
        {step === "plans" && (
          <motion.div
            key="plans"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            className="space-y-4"
          >
            <div className="grid gap-3">
              {PLANS.map(p => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  selected={selectedPlan === p.id}
                  onSelect={() => setSelectedPlan(p.id)}
                />
              ))}
            </div>

            <button
              onClick={() => setStep("contact")}
              disabled={!selectedPlan}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-sm uppercase tracking-[0.25em] text-black transition-all disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              <MessageCircle className="w-4 h-4" />
              Contratar plano
            </button>
          </motion.div>
        )}

        {step === "contact" && plan && (
          <motion.div
            key="contact"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => setStep("plans")}
                className="p-2 rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="font-bold text-sm">Plano {plan.label} selecionado</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  R$ {plan.amountBrl} · {plan.days} {plan.days === 1 ? "dia" : "dias"} de acesso
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6 space-y-5">
              <div>
                <p className="text-sm text-foreground font-medium">Escolha um suporte para continuar</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Fale com um dos nossos atendentes no Telegram. A mensagem já será preenchida automaticamente.
                </p>
              </div>

              <div className="grid gap-3">
                {CONTACTS.map(c => (
                  <motion.a
                    key={c.handle}
                    href={tgMessage(c.handle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-black/30 hover:bg-sky-500/10 hover:border-sky-500/30 hover:text-sky-300 text-muted-foreground transition-all"
                  >
                    <div className="w-9 h-9 rounded-full bg-sky-500/15 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
                      {TG_ICON}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-foreground">{c.handle}</div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">Suporte Telegram</div>
                    </div>
                    <svg className="w-4 h-4 shrink-0 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M7 17L17 7M17 7H7M17 7v10" />
                    </svg>
                  </motion.a>
                ))}
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">Mensagem que será enviada</div>
                <p className="text-xs text-muted-foreground/80 italic">
                  "Olá! Quero contratar o plano <span className="text-foreground font-medium">{plan.label}</span> (R$ <span className="text-foreground font-medium">{plan.amountBrl}</span>) do Infinity Search."
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
