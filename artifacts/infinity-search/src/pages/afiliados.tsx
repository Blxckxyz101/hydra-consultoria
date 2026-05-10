import { motion } from "framer-motion";
import { ShieldCheck, ArrowRight } from "lucide-react";

export default function Afiliados() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm flex flex-col items-center gap-6 text-center"
      >
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: "color-mix(in srgb, #38bdf8 12%, transparent)", border: "1px solid color-mix(in srgb, #38bdf8 25%, transparent)" }}>
          <ShieldCheck className="w-8 h-8 text-sky-400" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white tracking-tight">Seja um Revendedor</h1>
          <p className="text-sm text-white/50 leading-relaxed">
            Quer revender o Infinity Search? Entre em contato com nosso suporte e saiba como se tornar um parceiro.
          </p>
        </div>

        <a
          href="https://t.me/Blxckxyz"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl font-semibold text-sm transition-all active:scale-95"
          style={{
            background: "linear-gradient(135deg, #38bdf8, #818cf8)",
            color: "#fff",
            boxShadow: "0 4px 24px color-mix(in srgb, #38bdf8 30%, transparent)",
          }}
        >
          Falar com Suporte
          <ArrowRight className="w-4 h-4" />
        </a>
      </motion.div>
    </div>
  );
}
