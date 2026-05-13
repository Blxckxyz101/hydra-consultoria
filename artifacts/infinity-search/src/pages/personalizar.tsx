import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Palette, Check, Waves, Zap, Leaf, Crown, Heart, Flame, Moon,
  Terminal, Sparkles, Droplets, Radio, Monitor, Sun, Activity,
  Search, User, Smartphone, Type, type LucideIcon,
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
  { key: "sky",        name: "Hydra Ocean",    icon: Waves,    desc: "Padrão · oceano de dados",      primary: "195 90% 55%",  accent: "195 90% 20%",  ring: "195 90% 55%"  },
  { key: "violeta",    name: "Violeta Zero",   icon: Zap,      desc: "Poder dos dados",               primary: "270 80% 65%",  accent: "270 80% 20%",  ring: "270 80% 65%"  },
  { key: "esmeralda",  name: "Esmeralda",      icon: Leaf,     desc: "Vida nos dados",                primary: "160 70% 50%",  accent: "160 70% 18%",  ring: "160 70% 50%"  },
  { key: "ambar",      name: "Âmbar Real",     icon: Crown,    desc: "Nobreza dourada",               primary: "38 95% 58%",   accent: "38 95% 18%",   ring: "38 95% 58%"   },
  { key: "rosa",       name: "Rosa Sakura",    icon: Heart,    desc: "Beleza letal",                  primary: "330 90% 65%",  accent: "330 90% 20%",  ring: "330 90% 65%"  },
  { key: "vermelho",   name: "Escarlate",      icon: Flame,    desc: "Fogo e precisão",               primary: "0 84% 60%",    accent: "0 84% 18%",    ring: "0 84% 60%"    },
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
  const bgHsl   = t.bgOverride     ?? "0 0% 2%";
  const cardHsl = t.cardOverride   ?? "0 0% 4%";
  const brdHsl  = t.borderOverride ?? `${hue} 18% 12%`;
  const mutHsl  = t.mutedOverride  ?? `${hue} 14% 13%`;

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

// ── Font Definitions ──────────────────────────────────────────────────────────
const FONTS = [
  { key: "inter",         name: "Inter",          family: "'Inter', sans-serif",             category: "Sem-serifa" },
  { key: "space-grotesk", name: "Space Grotesk",  family: "'Space Grotesk', sans-serif",     category: "Geométrica" },
  { key: "plus-jakarta",  name: "Plus Jakarta",   family: "'Plus Jakarta Sans', sans-serif",  category: "Moderna" },
  { key: "outfit",        name: "Outfit",         family: "'Outfit', sans-serif",             category: "Sem-serifa" },
  { key: "sora",          name: "Sora",           family: "'Sora', sans-serif",               category: "Limpa" },
  { key: "raleway",       name: "Raleway",        family: "'Raleway', sans-serif",            category: "Elegante" },
  { key: "nunito",        name: "Nunito",         family: "'Nunito', sans-serif",             category: "Arredondada" },
  { key: "jetbrains",     name: "JetBrains Mono", family: "'JetBrains Mono', monospace",      category: "Monospace" },
];

export function applyFont(key: string) {
  const f = FONTS.find(x => x.key === key) ?? FONTS[0]!;
  document.documentElement.style.setProperty("--app-font-sans", f.family);
  document.documentElement.style.setProperty("--font-sans", f.family);
  localStorage.setItem("infinity_font", key);
}

export function initSavedFont() {
  const key = localStorage.getItem("infinity_font") ?? "inter";
  applyFont(key);
}

const VIP_THEME_KEYS = new Set(["amoled", "sky", "violeta", "esmeralda", "ambar"]);

function getPadraoThemeKeys(username: string): Set<string> {
  let h = 0;
  for (const c of username) h = (h * 31 + c.charCodeAt(0)) | 0;
  const n = THEMES.length;
  const indices = new Set<number>([1]); // sky (index 1) always available
  let seed = Math.abs(h);
  while (indices.size < 3) {
    indices.add(Math.abs(seed) % n);
    seed = Math.imul(seed, 1664525) + 1013904223;
  }
  return new Set([...indices].map(i => THEMES[i]?.key ?? "sky"));
}

function getAvailableThemeKeys(planTier: string, username: string, isAdmin: boolean): Set<string> {
  if (isAdmin || planTier === "ultra") return new Set(THEMES.map(t => t.key));
  if (planTier === "vip") return VIP_THEME_KEYS;
  return getPadraoThemeKeys(username);
}

export default function Personalizar() {
  const [currentKey, setCurrentKey] = useState(loadThemeKey);
  const [currentFont, setCurrentFont] = useState(() => localStorage.getItem("infinity_font") ?? "inter");
  const [planTier, setPlanTier] = useState<string>("free");
  const [username, setUsername] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const t = THEMES.find(x => x.key === currentKey) ?? THEMES[0]!;
    applyTheme(t);
    const token = localStorage.getItem("infinity_token");
    if (token) {
      fetch("/api/infinity/me", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then((d: { planTier?: string; username?: string; role?: string }) => {
          setPlanTier(d.planTier ?? "free");
          setUsername(d.username ?? "");
          setIsAdmin(d.role === "admin");
        })
        .catch(() => {});
    }
  }, []);

  const availableKeys = getAvailableThemeKeys(planTier, username, isAdmin);

  const handleSelect = (t: ThemeDef) => {
    if (!availableKeys.has(t.key)) return;
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

  const tierLabel = isAdmin || planTier === "ultra" ? null : planTier === "vip" ? "VIP" : "VIP";

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

        {/* Tier info pill */}
        {!isAdmin && planTier !== "ultra" && username && (
          <div className="flex items-center gap-2 mb-4 text-[10px] text-muted-foreground">
            <Crown className="w-3 h-3 text-amber-400" />
            {planTier === "vip"
              ? <span>Plano <span className="text-amber-300 font-bold">VIP</span> — 5 temas desbloqueados (amoled, sky, violeta, esmeralda, âmbar)</span>
              : <span>Plano <span className="text-sky-300 font-bold">Padrão</span> — 3 temas disponíveis baseados em seu usuário · Faça <a href="/planos" className="text-amber-300 hover:underline">upgrade para VIP</a> para mais</span>
            }
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3">
          {THEMES.map((t, i) => {
            const isActive = t.key === currentKey;
            const isLocked = !availableKeys.has(t.key);
            const hslPrimary = `hsl(${t.primary})`;
            const hslAccent = `hsl(${t.accent})`;
            const Icon = t.icon;
            return (
              <motion.button
                key={t.key}
                initial={{ opacity: 0, scale: 0.93 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.035, type: "spring", stiffness: 260, damping: 20 }}
                whileHover={isLocked ? undefined : { y: -3, transition: { duration: 0.15 } }}
                whileTap={isLocked ? undefined : { scale: 0.97 }}
                onClick={() => handleSelect(t)}
                className={`relative flex flex-col items-start gap-4 p-4 rounded-2xl border text-left transition-colors overflow-hidden ${isLocked ? "cursor-not-allowed opacity-50" : ""}`}
                style={{
                  borderColor: isActive ? hslPrimary : "rgba(255,255,255,0.07)",
                  background: isActive
                    ? `linear-gradient(135deg, ${hslPrimary}18, ${hslAccent}10)`
                    : "rgba(0,0,0,0.28)",
                  boxShadow: isActive ? `0 0 28px -6px ${hslPrimary}50` : "none",
                }}
              >
                {/* Lock overlay for restricted themes */}
                {isLocked && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-black/60 rounded-2xl backdrop-blur-[1px]">
                    <Crown className="w-4 h-4 text-amber-400" />
                    <span className="text-[8px] font-black uppercase tracking-widest text-amber-300 bg-amber-400/20 border border-amber-400/40 px-2 py-0.5 rounded-full">VIP</span>
                  </div>
                )}

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
                {t.key === "amoled" && !isActive && !isLocked && (
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
              <div className="text-xs font-semibold truncate">HYDRA CONSULTORIA</div>
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

      {/* ── Font Picker ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <Type className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Fonte do Painel</h2>
          <span
            className="ml-auto text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border"
            style={{ background: `hsl(${current.primary} / 0.12)`, borderColor: `hsl(${current.primary} / 0.35)`, color: `hsl(${current.primary})` }}
          >
            {FONTS.find(f => f.key === currentFont)?.name ?? "Inter"}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {FONTS.map((f, i) => {
            const isActive = f.key === currentFont;
            const hslP = `hsl(${current.primary})`;
            return (
              <motion.button
                key={f.key}
                initial={{ opacity: 0, scale: 0.93 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04, type: "spring", stiffness: 260, damping: 20 }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => { setCurrentFont(f.key); applyFont(f.key); }}
                className="relative flex flex-col items-start gap-2.5 p-4 rounded-2xl border text-left transition-colors overflow-hidden"
                style={{
                  borderColor: isActive ? hslP : "rgba(255,255,255,0.07)",
                  background: isActive ? `linear-gradient(135deg, hsl(${current.primary}/0.16), hsl(${current.accent}/0.08))` : "rgba(0,0,0,0.28)",
                  boxShadow: isActive ? `0 0 22px -6px hsl(${current.primary}/0.45)` : "none",
                }}
              >
                {isActive && (
                  <div className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: hslP }}>
                    <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />
                  </div>
                )}
                <span className="text-2xl font-bold leading-none" style={{ fontFamily: f.family, color: isActive ? hslP : "rgba(255,255,255,0.55)" }}>Aa</span>
                <div>
                  <p className="text-[11px] font-semibold leading-tight" style={{ fontFamily: f.family, color: isActive ? hslP : "rgba(255,255,255,0.7)" }}>{f.name}</p>
                  <p className="text-[9px] text-white/25 uppercase tracking-wide mt-0.5">{f.category}</p>
                </div>
              </motion.button>
            );
          })}
        </div>
        <p className="text-[9px] text-white/20 uppercase tracking-widest mt-4">Afeta todo o painel · Salvo automaticamente</p>
      </motion.div>
    </div>
  );
}
