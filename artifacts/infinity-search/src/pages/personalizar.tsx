import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Palette, Check, Waves, Zap, Leaf, Crown, Heart, Flame, Moon,
  Terminal, Sparkles, Droplets, Radio, Monitor, Sun, Activity,
  Search, User, Smartphone, type LucideIcon,
} from "lucide-react";

interface ThemeDef {
  key: string;
  name: string;
  icon: LucideIcon;
  desc: string;
  primary: string;
  accent: string;
  ring: string;
  bgOverride?: string;
  cardOverride?: string;
  borderOverride?: string;
  mutedOverride?: string;
}

const THEMES: ThemeDef[] = [
  {
    key: "amoled",
    name: "AMOLED Black",
    icon: Smartphone,
    desc: "Preto puro · ciano elétrico",
    primary: "191 100% 50%",
    accent:  "191 100% 11%",
    ring:    "191 100% 50%",
    bgOverride:     "0 0% 0%",
    cardOverride:   "0 0% 4%",
    borderOverride: "0 0% 10%",
    mutedOverride:  "0 0% 13%",
  },
  { key: "sky",        name: "Sky Infinity",   icon: Waves,    desc: "Padrão · oceano de dados",      primary: "195 90% 55%",  accent: "195 90% 20%",  ring: "195 90% 55%"  },
  { key: "violeta",    name: "Violeta Zero",   icon: Zap,      desc: "Poder do Geass",                primary: "270 80% 65%",  accent: "270 80% 20%",  ring: "270 80% 65%"  },
  { key: "esmeralda",  name: "Esmeralda",      icon: Leaf,     desc: "Vida nos dados",                primary: "160 70% 50%",  accent: "160 70% 18%",  ring: "160 70% 50%"  },
  { key: "ambar",      name: "Âmbar Real",     icon: Crown,    desc: "Nobreza dourada",               primary: "38 95% 58%",   accent: "38 95% 18%",   ring: "38 95% 58%"   },
  { key: "rosa",       name: "Rosa Sakura",    icon: Heart,    desc: "Beleza letal",                  primary: "330 90% 65%",  accent: "330 90% 20%",  ring: "330 90% 65%"  },
  { key: "vermelho",   name: "Escarlate",      icon: Flame,    desc: "Sangue britânico",              primary: "0 84% 60%",    accent: "0 84% 18%",    ring: "0 84% 60%"    },
  { key: "indigo",     name: "Índigo Void",    icon: Moon,     desc: "Trevas absolutas",              primary: "240 80% 65%",  accent: "240 80% 20%",  ring: "240 80% 65%"  },
  { key: "laranja",    name: "Laranja Fênix",  icon: Sparkles, desc: "Renascendo das cinzas",         primary: "20 95% 60%",   accent: "20 95% 18%",   ring: "20 95% 60%"   },
  { key: "lima",       name: "Lima Neon",      icon: Terminal, desc: "Matrix mode ativado",           primary: "80 80% 55%",   accent: "80 80% 18%",   ring: "80 80% 55%"   },
  { key: "coral",      name: "Coral Inferno",  icon: Sun,      desc: "Lindo e destruidor",            primary: "15 90% 65%",   accent: "15 90% 20%",   ring: "15 90% 65%"   },
  { key: "ciano",      name: "Ciano Profundo", icon: Droplets, desc: "Gélido como a verdade",         primary: "185 100% 45%", accent: "185 100% 16%", ring: "185 100% 45%" },
  { key: "roxo",       name: "Roxo Neon",      icon: Radio,    desc: "Frequência proibida",           primary: "290 85% 65%",  accent: "290 85% 20%",  ring: "290 85% 65%"  },
  { key: "monochrome", name: "Preto & Cinza",  icon: Monitor,  desc: "Puro, limpo, sem cores",        primary: "0 0% 68%",     accent: "0 0% 22%",     ring: "0 0% 68%"     },
];

const LS_KEY = "infinity_theme";

export { THEMES };
export type { ThemeDef };

export function applyTheme(t: ThemeDef) {
  const root = document.documentElement;
  const p = `hsl(${t.primary})`;
  const a = `hsl(${t.accent})`;
  const r = `hsl(${t.ring})`;

  const parts = t.primary.split(" ");
  const hue = parts[0]!;
  const sat = parseFloat(parts[1] ?? "50");
  const bgSat = sat < 8 ? 0 : 22;
  const cardSat = sat < 8 ? 0 : 18;

  const bgHsl   = t.bgOverride     ?? `${hue} ${bgSat}% 6%`;
  const cardHsl = t.cardOverride   ?? `${hue} ${cardSat}% 9%`;
  const brdHsl  = t.borderOverride ?? `${hue} 25% 15%`;
  const mutHsl  = t.mutedOverride  ?? `${hue} 20% 15%`;

  root.style.setProperty("--primary", t.primary);
  root.style.setProperty("--accent", t.accent);
  root.style.setProperty("--ring", t.ring);
  root.style.setProperty("--sidebar-primary", t.primary);
  root.style.setProperty("--sidebar-ring", t.ring);
  root.style.setProperty("--chart-1", t.primary);

  root.style.setProperty("--background", bgHsl);
  root.style.setProperty("--sidebar", bgHsl);
  root.style.setProperty("--card", cardHsl);
  root.style.setProperty("--popover", cardHsl);
  root.style.setProperty("--border", brdHsl);
  root.style.setProperty("--input", brdHsl);
  root.style.setProperty("--muted", mutHsl);
  root.style.setProperty("--sidebar-border", brdHsl);
  root.style.setProperty("--sidebar-accent", mutHsl);

  root.style.setProperty("--color-primary", p);
  root.style.setProperty("--color-primary-foreground", "hsl(220 30% 10%)");
  root.style.setProperty("--color-accent", a);
  root.style.setProperty("--color-accent-foreground", p);
  root.style.setProperty("--color-ring", r);
  root.style.setProperty("--color-sidebar-primary", p);
  root.style.setProperty("--color-sidebar-ring", r);
  root.style.setProperty("--color-chart-1", p);
  root.style.setProperty("--color-primary-border", p);
  root.style.setProperty("--color-background", `hsl(${bgHsl})`);
  root.style.setProperty("--color-sidebar", `hsl(${bgHsl})`);
  root.style.setProperty("--color-card", `hsl(${cardHsl})`);
  root.style.setProperty("--color-popover", `hsl(${cardHsl})`);
  root.style.setProperty("--color-border", `hsl(${brdHsl})`);
  root.style.setProperty("--color-input", `hsl(${brdHsl})`);
  root.style.setProperty("--color-muted", `hsl(${mutHsl})`);

  root.setAttribute("data-theme-hsl", t.primary);
  root.setAttribute("data-theme", t.key);
}

function loadThemeKey(): string { return localStorage.getItem(LS_KEY) ?? "sky"; }

export function initSavedTheme() {
  const key = loadThemeKey();
  const t = THEMES.find(x => x.key === key) ?? THEMES[0]!;
  applyTheme(t);
}

export default function Personalizar() {
  const [currentKey, setCurrentKey] = useState(loadThemeKey);

  useEffect(() => {
    const t = THEMES.find(x => x.key === currentKey) ?? THEMES[0]!;
    applyTheme(t);
  }, []);

  const handleSelect = (t: ThemeDef) => {
    setCurrentKey(t.key);
    localStorage.setItem(LS_KEY, t.key);
    applyTheme(t);
    const token = localStorage.getItem("infinity_token");
    if (token) {
      fetch("/api/infinity/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ theme: t.key }),
      }).catch(() => {});
    }
  };

  const current = THEMES.find(t => t.key === currentKey) ?? THEMES[0]!;
  const CurrentIcon = current.icon;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent"
        >
          Personalizar
        </motion.h1>
        <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
          Tema de cor do sistema · Salvo automaticamente
        </p>
      </div>

      {/* Theme grid */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <Palette className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Temas de Cor</h2>
          <span
            className="ml-auto inline-flex items-center gap-2 text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border"
            style={{
              background: `hsl(${current.primary} / 0.12)`,
              borderColor: `hsl(${current.primary} / 0.35)`,
              color: `hsl(${current.primary})`,
            }}
          >
            <CurrentIcon className="w-3 h-3" />
            {current.name}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3">
          {THEMES.map((t, i) => {
            const isActive = t.key === currentKey;
            const hslPrimary = `hsl(${t.primary})`;
            const hslAccent = `hsl(${t.accent})`;
            const Icon = t.icon;
            return (
              <motion.button
                key={t.key}
                initial={{ opacity: 0, scale: 0.93 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.035, type: "spring", stiffness: 260, damping: 20 }}
                whileHover={{ y: -3, transition: { duration: 0.15 } }}
                whileTap={{ scale: 0.97 }}
                onClick={() => handleSelect(t)}
                className="relative flex flex-col items-start gap-4 p-4 rounded-2xl border text-left transition-colors overflow-hidden"
                style={{
                  borderColor: isActive ? hslPrimary : "rgba(255,255,255,0.07)",
                  background: isActive
                    ? `linear-gradient(135deg, ${hslPrimary}18, ${hslAccent}10)`
                    : "rgba(0,0,0,0.28)",
                  boxShadow: isActive ? `0 0 28px -6px ${hslPrimary}50` : "none",
                }}
              >
                {/* Radial glow on active */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: `radial-gradient(circle at 50% -10%, ${hslPrimary}22, transparent 65%)`,
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* AMOLED "NOVO" pill — shown when not active */}
                {t.key === "amoled" && !isActive && (
                  <div
                    className="absolute top-3 right-3 text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full z-10"
                    style={{
                      background: "linear-gradient(90deg,hsl(191 100% 50%/0.18),hsl(191 100% 50%/0.08))",
                      border: "1px solid hsl(191 100% 50%/0.4)",
                      color: "hsl(191 100% 60%)",
                    }}
                  >
                    NOVO
                  </div>
                )}

                {/* Check badge */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center z-10"
                      style={{ background: hslPrimary, boxShadow: `0 0 10px ${hslPrimary}80` }}
                    >
                      <Check className="w-3 h-3 text-black" strokeWidth={3} />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Icon */}
                <div
                  className="relative w-11 h-11 rounded-xl flex items-center justify-center transition-transform"
                  style={{
                    background: `${hslPrimary}20`,
                    border: `1px solid ${hslPrimary}38`,
                    boxShadow: isActive ? `0 0 14px -4px ${hslPrimary}55` : "none",
                  }}
                >
                  <Icon className="w-5 h-5" style={{ color: hslPrimary }} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 pr-5">
                  <div
                    className="text-[11px] font-bold uppercase tracking-[0.18em] leading-tight"
                    style={{ color: hslPrimary }}
                  >
                    {t.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{t.desc}</div>
                </div>

                {/* Color gradient bar */}
                <div
                  className="w-full h-1 rounded-full"
                  style={{ background: `linear-gradient(90deg, ${hslPrimary}, ${hslAccent}88)` }}
                />
              </motion.button>
            );
          })}
        </div>

        {/* Live preview */}
        <motion.div
          key={current.key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-6 p-5 rounded-2xl border border-white/8 bg-black/20 space-y-4"
        >
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.45em] text-muted-foreground">
            <div
              className="w-4 h-4 rounded flex items-center justify-center"
              style={{ background: `hsl(${current.primary} / 0.2)` }}
            >
              <CurrentIcon className="w-2.5 h-2.5" style={{ color: `hsl(${current.primary})` }} />
            </div>
            Pré-visualização · {current.name}
          </div>

          {/* Mini stat cards */}
          <div className="flex flex-wrap gap-2">
            <div
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border"
              style={{
                background: `hsl(${current.primary} / 0.10)`,
                borderColor: `hsl(${current.primary} / 0.28)`,
              }}
            >
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ background: `hsl(${current.primary} / 0.18)` }}
              >
                <Activity className="w-3.5 h-3.5" style={{ color: `hsl(${current.primary})` }} />
              </div>
              <div>
                <div className="text-[8px] text-muted-foreground uppercase tracking-wider">Consultas</div>
                <div className="text-sm font-bold" style={{ color: `hsl(${current.primary})` }}>1.247</div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-white/8 bg-black/30">
              <div className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div>
                <div className="text-[8px] text-muted-foreground uppercase tracking-wider">Hoje</div>
                <div className="text-sm font-bold text-foreground">28</div>
              </div>
            </div>

            <div
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-[10px] font-semibold uppercase tracking-wider self-center"
              style={{
                background: `hsl(${current.primary} / 0.12)`,
                borderColor: `hsl(${current.primary} / 0.38)`,
                color: `hsl(${current.primary})`,
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: `hsl(${current.primary})` }}
              />
              Ativo
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-[9px] text-muted-foreground mb-1.5 uppercase tracking-widest">
              <span>Cota Diária</span>
              <span style={{ color: `hsl(${current.primary})` }}>724 / 1000</span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                key={current.key}
                initial={{ width: 0 }}
                animate={{ width: "72%" }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, hsl(${current.primary}), hsl(${current.accent}))`,
                }}
              />
            </div>
          </div>

          {/* Field row preview */}
          <div
            className="flex items-center gap-3 p-3 rounded-xl border border-white/5"
            style={{ background: "rgba(0,0,0,0.22)" }}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: `hsl(${current.primary} / 0.15)`,
                border: `1px solid hsl(${current.primary} / 0.28)`,
              }}
            >
              <User className="w-3.5 h-3.5" style={{ color: `hsl(${current.primary})` }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[8px] text-muted-foreground uppercase tracking-wider mb-0.5">Nome</div>
              <div className="text-xs font-semibold truncate">LELOUCH LAMPEROUGE</div>
            </div>
            <div
              className="text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-lg border font-semibold shrink-0"
              style={{
                color: `hsl(${current.primary})`,
                borderColor: `hsl(${current.primary} / 0.3)`,
                background: `hsl(${current.primary} / 0.1)`,
              }}
            >
              copiar
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
