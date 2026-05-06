import { motion } from "framer-motion";
import { Camera, CreditCard, Zap, Gem, Lock, Infinity, Bot, MessageCircle, Star } from "lucide-react";

const FEATURES = [
  { Icon: Camera,   label: "Foto Nacional",   check: true },
  { Icon: CreditCard, label: "Foto CNH",      check: true },
  { Icon: Zap,      label: "Alta Performance", check: true },
  { Icon: Gem,      label: "Preços Incríveis", check: true },
  { Icon: Lock,     label: "+20 Tipos de API", check: true },
  { Icon: Infinity, label: "E muito mais!",    check: false },
];

export default function SkylersPromo() {
  return (
    <div className="flex flex-col items-center py-10 px-4 gap-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl overflow-hidden"
        style={{ boxShadow: "0 0 60px -10px color-mix(in srgb, var(--color-primary) 25%, transparent)" }}
      >
        {/* Top glow bar */}
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, transparent, var(--color-primary), transparent)" }} />

        <div className="p-8 sm:p-10 text-center">
          {/* Icon burst */}
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)" }}>
              <Star className="w-8 h-8" style={{ color: "var(--color-primary)" }} />
            </div>
          </div>

          <h1
            className="text-3xl sm:text-4xl font-black tracking-[0.15em] uppercase mb-2"
            style={{ color: "var(--color-primary)" }}
          >
            SKYLERS APIs
          </h1>
          <p className="text-[11px] uppercase tracking-[0.4em] text-muted-foreground mb-8">
            As melhores APIs exclusivas do mercado · Alta performance
          </p>

          {/* Main pitch */}
          <div
            className="rounded-xl border p-6 mb-8 text-left"
            style={{
              background: "color-mix(in srgb, var(--color-primary) 6%, transparent)",
              borderColor: "color-mix(in srgb, var(--color-primary) 25%, transparent)",
            }}
          >
            <p className="text-base sm:text-lg leading-relaxed text-foreground/90 mb-4">
              Deseja ter as <span style={{ color: "var(--color-primary)", fontWeight: 700 }}>melhores APIs do mercado</span> integradas nos seus sistemas?
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Aqui nós temos <strong className="text-foreground">MUITAS apis exclusivas!</strong> Aqui você encontra preços incríveis e acesso a dados que ninguém mais tem.
            </p>
          </div>

          {/* Feature chips */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
            {FEATURES.map(({ Icon, label, check }) => (
              <div
                key={label}
                className="flex items-center gap-2.5 rounded-xl border px-3 py-3"
                style={{
                  background: "color-mix(in srgb, var(--color-primary) 5%, transparent)",
                  borderColor: "color-mix(in srgb, var(--color-primary) 20%, transparent)",
                }}
              >
                <Icon className="w-4 h-4 shrink-0" style={{ color: "var(--color-primary)" }} />
                <span className="text-xs font-semibold text-foreground/80 leading-tight">
                  {label}{check && <span style={{ color: "var(--color-primary)" }}> ✓</span>}
                </span>
              </div>
            ))}
          </div>

          {/* Purchase note */}
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-5 py-4 mb-8 text-sm text-muted-foreground leading-relaxed">
            Compre pelo nosso{" "}
            <span className="font-bold text-foreground">robô oficial</span> ou pelo{" "}
            <span className="font-bold text-foreground">suporte</span> caso queira mais requisições.
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="https://t.me/SkylersApisBot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-sm font-bold transition-all hover:opacity-85"
              style={{
                background: "var(--color-primary)",
                color: "color-mix(in srgb, var(--color-primary) 10%, #000)",
                boxShadow: "0 4px 24px -4px color-mix(in srgb, var(--color-primary) 50%, transparent)",
              }}
            >
              <Bot className="w-4 h-4" />
              @SkylersApisBot
            </a>
            <a
              href="https://t.me/SkylersSuporte"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-sm font-bold border transition-all hover:opacity-75"
              style={{
                color: "var(--color-primary)",
                borderColor: "color-mix(in srgb, var(--color-primary) 40%, transparent)",
                background: "color-mix(in srgb, var(--color-primary) 8%, transparent)",
              }}
            >
              <MessageCircle className="w-4 h-4" />
              @SkylersSuporte
            </a>
          </div>
        </div>

        {/* Bottom footer bar */}
        <div
          className="px-8 py-3 border-t border-white/5 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.35em]"
          style={{ color: "color-mix(in srgb, var(--color-primary) 45%, transparent)" }}
        >
          <Star className="w-3 h-3" />
          <span>Skylers APIs · Exclusividade · Performance · Cobertura Nacional</span>
        </div>
      </motion.div>
    </div>
  );
}
