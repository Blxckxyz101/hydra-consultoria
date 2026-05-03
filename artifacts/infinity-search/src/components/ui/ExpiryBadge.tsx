import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, AlertTriangle, ShieldCheck, Infinity as InfinityIcon } from "lucide-react";

function useCountdown(expiresAt: string | null) {
  const [ms, setMs] = useState(() =>
    expiresAt ? new Date(expiresAt).getTime() - Date.now() : null
  );

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setMs(new Date(expiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return ms;
}

function formatRemaining(ms: number) {
  if (ms <= 0) return { text: "Expirado", days: 0, urgent: true };
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return { text: `${days}d ${hours}h restantes`, days, urgent: days <= 3 };
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return { text: `${hours}h ${mins}m restantes`, days: 0, urgent: true };
}

type Props = { accountExpiresAt: string | null; role: string };

export function ExpiryBadge({ accountExpiresAt, role }: Props) {
  const ms = useCountdown(accountExpiresAt);

  if (role === "admin") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
        <ShieldCheck className="w-4 h-4 shrink-0" />
        <span className="text-xs font-semibold">Admin — Acesso permanente</span>
      </div>
    );
  }

  if (!accountExpiresAt) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-300">
        <InfinityIcon className="w-4 h-4 shrink-0" />
        <span className="text-xs font-semibold">Sem expiração definida</span>
      </div>
    );
  }

  if (ms === null) return null;
  const { text, days, urgent } = formatRemaining(ms);
  const expired = ms <= 0;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={expired ? "expired" : urgent ? "urgent" : "ok"}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs font-semibold ${
          expired
            ? "bg-red-500/10 border-red-500/30 text-red-300"
            : urgent
            ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
            : "bg-sky-500/10 border-sky-500/20 text-sky-300"
        }`}
      >
        {expired || urgent ? (
          <motion.div
            animate={urgent && !expired ? { opacity: [1, 0.4, 1] } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
          </motion.div>
        ) : (
          <Clock className="w-4 h-4 shrink-0" />
        )}
        <div>
          <span>{expired ? "Acesso expirado!" : text}</span>
          {!expired && (
            <span className="ml-2 text-[10px] opacity-60 font-normal">
              {new Date(accountExpiresAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </span>
          )}
        </div>
        {(days <= 3 && !expired) && (
          <a
            href="https://t.me/Blxckxyz"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[10px] uppercase tracking-widest underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity whitespace-nowrap"
          >
            Renovar
          </a>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
