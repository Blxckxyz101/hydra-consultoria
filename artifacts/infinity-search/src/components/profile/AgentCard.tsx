import { motion } from "framer-motion";

export const CARD_ANIMS = [
  { id: "none",    label: "Estático",   desc: "Sem efeito" },
  { id: "pulse",   label: "Pulso Neon", desc: "Borda que pulsa" },
  { id: "shimmer", label: "Shimmer",    desc: "Luz deslizante" },
  { id: "glitch",  label: "Glitch",     desc: "Distorção ocasional" },
  { id: "holo",    label: "Holograma",  desc: "Arco-íris iridescente" },
] as const;

export type CardAnimId = typeof CARD_ANIMS[number]["id"];
export const LS_CARD_ANIM = "infinity_card_animation";

function stableNum(s: string): number {
  return s.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0x7fffffff, 0);
}

interface AgentCardProps {
  username: string;
  displayName?: string | null;
  role?: string;
  photo?: string | null;
  anim?: CardAnimId;
}

export function AgentCard({ username, displayName, role = "user", photo, anim = "none" }: AgentCardProps) {
  const name = (displayName || username).toUpperCase();
  const hash = stableNum(username);
  const agentCode = `AG-${username.slice(0, 4).toUpperCase().padEnd(4, "X")}-${String((hash % 9000) + 1000)}`;
  const issued = new Date().toLocaleDateString("pt-BR");

  const barHeights = [8,14,10,6,14,8,12,6,14,10,8,6,10,14,8,6,12,10,14,8,6,14,10,8];

  const roleLabel = role === "admin" ? "Administrador" : role === "vip" ? "VIP" : "Usuário";

  return (
    <motion.div
      className="relative rounded-2xl overflow-hidden select-none"
      animate={anim === "pulse" ? {
        boxShadow: [
          "0 0 20px -8px var(--color-primary), 0 8px 40px rgba(0,0,0,0.7)",
          "0 0 55px -4px var(--color-primary), 0 8px 40px rgba(0,0,0,0.7)",
          "0 0 20px -8px var(--color-primary), 0 8px 40px rgba(0,0,0,0.7)",
        ],
      } : {
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
      }}
      transition={anim === "pulse" ? { duration: 2.5, repeat: Infinity, ease: "easeInOut" } : {}}
      style={{
        background: "linear-gradient(145deg, #03060f 0%, #0b1530 55%, #03060f 100%)",
        border: `1px solid ${anim === "pulse" ? "color-mix(in srgb, var(--color-primary) 55%, transparent)" : "rgba(255,255,255,0.07)"}`,
      }}
    >
      {/* Holo overlay */}
      {anim === "holo" && (
        <motion.div
          className="absolute inset-0 pointer-events-none rounded-2xl"
          animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          style={{
            background: "linear-gradient(135deg, #ff008080, #00ffff60, #ff800060, #8000ff60, #00ff8060, #ff008080)",
            backgroundSize: "400% 400%",
            opacity: 0.18,
          }}
        />
      )}

      {/* Shimmer sweep */}
      {anim === "shimmer" && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
          <motion.div
            animate={{ x: ["-100%", "300%"] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
            style={{
              position: "absolute", top: 0, bottom: 0, width: "35%",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)",
            }}
          />
        </div>
      )}

      {/* Glitch */}
      {anim === "glitch" && (
        <motion.div
          className="absolute inset-0 pointer-events-none rounded-2xl"
          animate={{
            opacity: [0, 0, 0, 0.7, 0, 0.5, 0, 0, 0],
            x: [0, 0, 0, -4, 4, -2, 0, 0, 0],
          }}
          transition={{ duration: 5, repeat: Infinity, times: [0, 0.7, 0.85, 0.87, 0.89, 0.91, 0.93, 0.96, 1] }}
          style={{
            background: "linear-gradient(transparent 28%, rgba(255,0,128,0.14) 28%, rgba(255,0,128,0.14) 34%, rgba(0,255,255,0.08) 34%, rgba(0,255,255,0.08) 38%, transparent 38%)",
          }}
        />
      )}

      {/* Scan line */}
      <motion.div
        className="absolute inset-x-0 pointer-events-none z-10"
        animate={{ top: ["-2px", "102%"] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "linear" }}
        style={{
          height: 1.5,
          background: "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--color-primary) 90%, transparent) 50%, transparent 100%)",
          opacity: 0.6,
        }}
      />

      {/* Grid pattern */}
      <div className="absolute inset-0 opacity-[0.018] pointer-events-none"
        style={{ backgroundImage: "linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)", backgroundSize: "24px 24px" }}
      />

      {/* Content */}
      <div className="relative z-20 p-5 sm:p-6">
        {/* Top strip */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-7 rounded-full" style={{ background: "linear-gradient(to bottom, var(--color-primary), color-mix(in srgb, var(--color-primary) 40%, transparent))" }} />
            <div>
              <p className="text-[7px] font-black uppercase tracking-[0.6em]" style={{ color: "var(--color-primary)" }}>
                Hydra Consultoria
              </p>
              <p className="text-[6px] uppercase tracking-[0.5em] text-white/20">Sistema de Inteligência</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[7px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border text-rose-400/60 border-rose-400/25">
              CLASSIFICADO
            </span>
            <span className="text-[6px] text-white/15 font-mono">{agentCode}</span>
          </div>
        </div>

        {/* Photo + info row */}
        <div className="flex items-start gap-4 sm:gap-5">
          {/* Photo with corner brackets */}
          <div className="relative shrink-0">
            <div className="w-[72px] h-[88px] sm:w-20 sm:h-24 rounded-xl overflow-hidden"
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: `0 0 28px -6px color-mix(in srgb, var(--color-primary) 50%, transparent)`,
              }}
            >
              {photo ? (
                <img src={photo} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl font-black"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 12%, rgba(0,0,0,0.6))", color: "var(--color-primary)" }}>
                  {name[0] ?? "?"}
                </div>
              )}
            </div>
            {/* Corner brackets */}
            {([["top-0 left-0", "t", "l"], ["top-0 right-0", "t", "r"], ["bottom-0 left-0", "b", "l"], ["bottom-0 right-0", "b", "r"]] as const).map(([pos, v, h], i) => (
              <div key={i} className={`absolute ${pos} w-3 h-3 pointer-events-none`} style={{
                borderTop:    v === "t" ? `1.5px solid var(--color-primary)` : undefined,
                borderBottom: v === "b" ? `1.5px solid var(--color-primary)` : undefined,
                borderLeft:   h === "l" ? `1.5px solid var(--color-primary)` : undefined,
                borderRight:  h === "r" ? `1.5px solid var(--color-primary)` : undefined,
              }} />
            ))}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <p className="text-[7px] uppercase tracking-[0.5em] text-muted-foreground/30 mb-0.5">Nome do Agente</p>
              <p className="text-base sm:text-lg font-black tracking-wide leading-tight truncate" style={{ color: "var(--color-primary)" }}>
                {name}
              </p>
              <p className="text-[9px] text-white/25 font-mono">@{username}</p>
            </div>

            <div className="space-y-2">
              <span className="inline-block text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md text-black"
                style={{ background: "var(--color-primary)" }}>
                {roleLabel}
              </span>

              <div className="flex items-center gap-4">
                <div>
                  <p className="text-[6px] uppercase tracking-widest text-white/20">Emissão</p>
                  <p className="text-[9px] font-mono text-white/40">{issued}</p>
                </div>
                <div>
                  <p className="text-[6px] uppercase tracking-widest text-white/20">Plataforma</p>
                  <p className="text-[9px] font-mono text-white/40">HYDRA v2</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Barcode footer */}
        <div className="mt-5 pt-3 border-t border-white/[0.04]">
          <div className="flex items-end gap-[2px] overflow-hidden mb-1.5">
            {Array.from({ length: 52 }, (_, i) => {
              const h = barHeights[i % barHeights.length];
              const w = i % 4 === 0 ? 2 : 1;
              const opacity = 0.25 + (i % 5) * 0.08;
              return (
                <div key={i} className="shrink-0 rounded-[1px]"
                  style={{ width: w, height: h, background: `var(--color-primary)`, opacity }} />
              );
            })}
          </div>
          <p className="text-[6px] font-mono text-white/15 tracking-[0.25em] uppercase">
            {agentCode} · ACESSO RESTRITO · {new Date().getFullYear()} · HYDRA CONSULTORIA
          </p>
        </div>
      </div>
    </motion.div>
  );
}
