import VideoWithControls from "@/components/video/VideoWithControls";
import { motion } from "framer-motion";

export default function App() {
  return (
    <div className="relative w-full h-screen bg-[#020408] overflow-hidden flex items-center justify-center">
      {/* ── Deep space background ── */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Radial dark glow center */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 70% at 50% 50%, #0a1628 0%, #020408 70%)",
          }}
        />

        {/* Hex grid overlay */}
        <svg
          className="absolute inset-0 w-full h-full opacity-[0.04]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="hexgrid" x="0" y="0" width="60" height="52" patternUnits="userSpaceOnUse">
              <polygon
                points="30,2 55,15 55,37 30,50 5,37 5,15"
                fill="none"
                stroke="#0ea5e9"
                strokeWidth="0.8"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hexgrid)" />
        </svg>

        {/* Animated scan line sweeping across the whole page */}
        <motion.div
          className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#0ea5e9]/40 to-transparent"
          initial={{ top: "-2px" }}
          animate={{ top: ["0%", "100%"] }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
        />

        {/* Left side circuit decoration */}
        <div className="absolute left-0 top-0 bottom-0 w-[calc((100vw-56.25vh)/2)] flex flex-col justify-center items-end pr-6 gap-4 opacity-30">
          {["CPF", "CNPJ", "PLACA", "NOME", "TELEFONE", "EMAIL"].map((label, i) => (
            <motion.div
              key={label}
              className="flex items-center gap-2"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: [0.2, 0.7, 0.2], x: 0 }}
              transition={{ delay: i * 0.3, duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <span className="text-[10px] font-mono text-[#0ea5e9]/60 tracking-widest">{label}</span>
              <motion.div
                className="w-8 h-px bg-[#0ea5e9]"
                animate={{ scaleX: [0, 1, 0] }}
                transition={{ delay: i * 0.3, duration: 2, repeat: Infinity }}
              />
              <div className="w-1.5 h-1.5 rounded-full bg-[#0ea5e9]" />
            </motion.div>
          ))}
        </div>

        {/* Right side circuit decoration */}
        <div className="absolute right-0 top-0 bottom-0 w-[calc((100vw-56.25vh)/2)] flex flex-col justify-center items-start pl-6 gap-4 opacity-30">
          {["VEÍCULO", "EMPRESA", "SAÚDE", "SCORE", "RENDA", "IRPF"].map((label, i) => (
            <motion.div
              key={label}
              className="flex items-center gap-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: [0.2, 0.7, 0.2], x: 0 }}
              transition={{ delay: i * 0.3 + 0.15, duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[#0ea5e9]" />
              <motion.div
                className="w-8 h-px bg-[#0ea5e9]"
                animate={{ scaleX: [0, 1, 0] }}
                transition={{ delay: i * 0.3 + 0.15, duration: 2, repeat: Infinity }}
              />
              <span className="text-[10px] font-mono text-[#0ea5e9]/60 tracking-widest">{label}</span>
            </motion.div>
          ))}
        </div>

        {/* Corner brackets */}
        {[
          "top-4 left-4 border-t-2 border-l-2",
          "top-4 right-4 border-t-2 border-r-2",
          "bottom-4 left-4 border-b-2 border-l-2",
          "bottom-4 right-4 border-b-2 border-r-2",
        ].map((cls, i) => (
          <div key={i} className={`absolute w-8 h-8 border-[#0ea5e9]/30 ${cls}`} />
        ))}
      </div>

      {/* ── The video player ── */}
      <VideoWithControls />
    </div>
  );
}
