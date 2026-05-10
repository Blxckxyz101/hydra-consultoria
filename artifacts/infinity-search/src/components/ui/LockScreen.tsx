import { motion } from "framer-motion";
import { Lock, ShoppingCart, MessageCircle, RefreshCw } from "lucide-react";

export function LockScreen() {
  const handleLogout = () => {
    localStorage.removeItem("infinity_token");
    window.location.href = "/login";
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#06091a]/95 backdrop-blur-2xl"
    >
      {/* Ambient glows */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(239,68,68,0.08) 0%, transparent 70%)" }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(56,189,248,0.05) 0%, transparent 70%)" }}
          animate={{ scale: [1.1, 1, 1.1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.15, type: "spring", stiffness: 260, damping: 28 }}
        className="relative w-full max-w-md mx-4"
      >
        {/* Card */}
        <div className="rounded-3xl border border-red-500/20 bg-black/60 backdrop-blur-2xl p-8 sm:p-10 text-center shadow-[0_0_80px_rgba(239,68,68,0.12)]">

          {/* Lock icon */}
          <motion.div
            className="mx-auto mb-6 w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center"
            animate={{ boxShadow: ["0 0 20px rgba(239,68,68,0.2)", "0 0 40px rgba(239,68,68,0.4)", "0 0 20px rgba(239,68,68,0.2)"] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <motion.div
              animate={{ rotate: [0, -5, 5, -3, 3, 0] }}
              transition={{ duration: 0.6, delay: 0.5, repeat: Infinity, repeatDelay: 4 }}
            >
              <Lock className="w-9 h-9 text-red-400" />
            </motion.div>
          </motion.div>

          {/* Title */}
          <div className="text-[10px] uppercase tracking-[0.5em] text-red-400/80 mb-3">Acesso Bloqueado</div>
          <h1 className="text-2xl font-bold tracking-wide mb-3 text-white">
            Sua conta expirou
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-xs mx-auto">
            Seu período de acesso ao <span className="text-sky-400 font-semibold">Infinity Search</span> encerrou.
            Renove agora para continuar usando as consultas e a IA.
          </p>

          {/* Actions */}
          <div className="space-y-3">
            <motion.a
              href="https://t.me/Blxckxyz"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center justify-center gap-2.5 w-full py-4 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold text-sm uppercase tracking-widest shadow-[0_0_30px_rgba(56,189,248,0.35)] hover:shadow-[0_0_50px_rgba(56,189,248,0.6)] transition-all"
            >
              <ShoppingCart className="w-4 h-4" />
              Renovar acesso — @Blxckxyz
            </motion.a>

            <div className="flex gap-2">
              <motion.a
                href="https://t.me/Blxckxyz"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.02 }}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-sm text-muted-foreground hover:text-white hover:bg-white/10 transition-all"
              >
                <MessageCircle className="w-4 h-4" />
                @Blxckxyz
              </motion.a>
              <motion.a
                href="https://t.me/xxmathexx"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.02 }}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-sm text-muted-foreground hover:text-white hover:bg-white/10 transition-all"
              >
                <MessageCircle className="w-4 h-4" />
                @xxmathexx
              </motion.a>
              <motion.a
                href="https://t.me/piancooz"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.02 }}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-sm text-muted-foreground hover:text-white hover:bg-white/10 transition-all"
              >
                <MessageCircle className="w-4 h-4" />
                @piancooz
              </motion.a>
            </div>

            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-2 w-full py-3 text-[11px] uppercase tracking-[0.4em] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Trocar de conta
            </button>
          </div>

          {/* Footer */}
          <div className="mt-8 pt-5 border-t border-white/5 text-[9px] uppercase tracking-[0.4em] text-muted-foreground/30">
            Infinity Search
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
