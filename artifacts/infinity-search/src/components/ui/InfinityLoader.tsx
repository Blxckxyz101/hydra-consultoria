import { motion } from "framer-motion";

type Props = {
  label?: string;
  size?: number;
  fullscreen?: boolean;
};

export function InfinityLoader({ label = "Carregando", size = 96, fullscreen = false }: Props) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-5">
      <div
        className="relative"
        style={{ width: size, height: size }}
        aria-label="Carregando"
      >
        {/* Pulsing halo */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(56,189,248,0.35) 0%, rgba(56,189,248,0) 70%)",
            filter: "blur(8px)",
          }}
          animate={{ scale: [1, 1.25, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />

        <svg
          viewBox="0 0 100 50"
          className="relative w-full h-full"
          style={{ filter: "drop-shadow(0 0 14px rgba(56,189,248,0.85))" }}
        >
          <defs>
            <linearGradient id="infgrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0ea5e9" />
              <stop offset="50%" stopColor="#67e8f9" />
              <stop offset="100%" stopColor="#0ea5e9" />
            </linearGradient>
          </defs>
          {/* Faint trail */}
          <path
            d="M25,25 C25,10 45,10 50,25 C55,40 75,40 75,25 C75,10 55,10 50,25 C45,40 25,40 25,25 Z"
            fill="none"
            stroke="rgba(56,189,248,0.12)"
            strokeWidth={3}
          />
          {/* Animated stroke */}
          <motion.path
            d="M25,25 C25,10 45,10 50,25 C55,40 75,40 75,25 C75,10 55,10 50,25 C45,40 25,40 25,25 Z"
            fill="none"
            stroke="url(#infgrad)"
            strokeWidth={3}
            strokeLinecap="round"
            initial={{ pathLength: 0, pathOffset: 0 }}
            animate={{ pathLength: [0.15, 0.55, 0.15], pathOffset: [0, 1, 2] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          />
        </svg>
      </div>
      {label && (
        <motion.div
          className="flex items-center gap-1 text-xs uppercase tracking-[0.5em] text-primary/80"
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          {label}
        </motion.div>
      )}
    </div>
  );

  if (!fullscreen) return content;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">{content}</div>
  );
}
