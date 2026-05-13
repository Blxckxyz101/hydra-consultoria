import { motion } from "framer-motion";
import logoUrl from "@/assets/hydra-icon.png";

type Props = {
  label?: string;
  size?: number;
  fullscreen?: boolean;
};

export function InfinityLoader({ label = "Carregando", size = 96, fullscreen = false }: Props) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-6">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Outer glow ring */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(circle, color-mix(in srgb, var(--color-primary) 30%, transparent) 0%, transparent 70%)",
            filter: "blur(12px)",
          }}
          animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Rotating ring */}
        <motion.div
          className="absolute inset-[-6px] rounded-full"
          style={{
            border: "1.5px solid transparent",
            background: "linear-gradient(#000, #000) padding-box, linear-gradient(to right, color-mix(in srgb, var(--color-primary) 80%, transparent), transparent, color-mix(in srgb, var(--color-primary) 40%, transparent)) border-box",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
        {/* Logo */}
        <motion.img
          src={logoUrl}
          alt="Hydra"
          className="relative w-full h-full object-contain"
          style={{ zIndex: 1 }}
          animate={{ scale: [1, 1.06, 1], opacity: [0.85, 1, 0.85] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {label && (
        <div className="flex flex-col items-center gap-2">
          <motion.div
            className="text-[10px] uppercase tracking-[0.6em] font-semibold"
            style={{ color: "var(--color-primary)" }}
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          >
            {label}
          </motion.div>
          {/* Dot loader */}
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-1 h-1 rounded-full"
                style={{ background: "var(--color-primary)" }}
                animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (!fullscreen) return content;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-background/80 backdrop-blur-md">
      {content}
    </div>
  );
}
