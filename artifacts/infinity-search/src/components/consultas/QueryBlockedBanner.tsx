import { Lock, Zap, AlertTriangle, ArrowRight } from "lucide-react";

interface QueryBlockedBannerProps {
  upgradeNeeded?: boolean;
  moduleLimited?: boolean;
  message?: string | null;
  limitInfo?: { used?: number; limit?: number } | null;
  onDismiss?: () => void;
}

export function QueryBlockedBanner({
  upgradeNeeded,
  moduleLimited,
  message,
  limitInfo,
  onDismiss,
}: QueryBlockedBannerProps) {
  const goTo = (path: string) => { window.location.hash = path; };

  if (moduleLimited) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-amber-300 text-sm">Limite diário do módulo atingido</div>
            <p className="text-xs text-amber-400/80 mt-1">
              {message ?? "Você atingiu o limite de 45 consultas por módulo hoje."}
              {limitInfo?.limit != null && (
                <span className="block mt-0.5 font-mono">
                  {limitInfo.used ?? "—"} / {limitInfo.limit} consultas hoje neste módulo
                </span>
              )}
            </p>
            <p className="text-xs text-amber-400/60 mt-1">O limite é resetado à meia-noite (BRT).</p>
          </div>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
            Fechar
          </button>
        )}
      </div>
    );
  }

  if (upgradeNeeded) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-sm" style={{ color: "var(--color-primary)" }}>
              Sem consultas disponíveis
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {message ?? "Você esgotou suas consultas gratuitas, créditos e cota do plano."}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Assine um plano ou recarregue créditos para continuar consultando.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => goTo("/planos")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-black transition-all"
            style={{ background: "var(--color-primary)" }}
          >
            <Zap className="w-3.5 h-3.5" /> Ver planos
          </button>
          <button
            onClick={() => { goTo("/planos"); setTimeout(() => window.dispatchEvent(new CustomEvent("planos:recharges")), 300); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-widest border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground transition-all"
          >
            <ArrowRight className="w-3.5 h-3.5" /> Comprar créditos
          </button>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
            Fechar
          </button>
        )}
      </div>
    );
  }

  // generic rate limit
  return (
    <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4 flex items-start gap-3">
      <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
      <div>
        <div className="font-semibold text-orange-300 text-sm">Limite temporário atingido</div>
        <p className="text-xs text-orange-400/80 mt-1">{message ?? "Aguarde e tente novamente."}</p>
      </div>
    </div>
  );
}
