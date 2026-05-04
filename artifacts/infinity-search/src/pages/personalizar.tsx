import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Palette } from "lucide-react";

interface ThemeDef {
  key: string;
  name: string;
  emoji: string;
  desc: string;
  primary: string;   // HSL: "H S% L%"
  accent: string;
  ring: string;
}

const THEMES: ThemeDef[] = [
  { key: "sky",       name: "Sky Infinity",   emoji: "🌊", desc: "Padrão — oceano de dados",   primary: "195 90% 55%",  accent: "195 90% 20%",  ring: "195 90% 55%"  },
  { key: "violeta",   name: "Violeta Zero",   emoji: "🟣", desc: "Poder do Geass",              primary: "270 80% 65%",  accent: "270 80% 20%",  ring: "270 80% 65%"  },
  { key: "esmeralda", name: "Esmeralda",      emoji: "💚", desc: "Vida nos dados",              primary: "160 70% 50%",  accent: "160 70% 18%",  ring: "160 70% 50%"  },
  { key: "ambar",     name: "Âmbar Real",     emoji: "✨", desc: "Nobreza dourada",             primary: "38 95% 58%",   accent: "38 95% 18%",   ring: "38 95% 58%"   },
  { key: "rosa",      name: "Rosa Sakura",    emoji: "🌸", desc: "Beleza letal",                primary: "330 90% 65%",  accent: "330 90% 20%",  ring: "330 90% 65%"  },
  { key: "vermelho",  name: "Escarlate",      emoji: "🔴", desc: "Sangue britânico",            primary: "0 84% 60%",    accent: "0 84% 18%",    ring: "0 84% 60%"    },
  { key: "indigo",    name: "Índigo Void",    emoji: "🌌", desc: "Trevas absolutas",            primary: "240 80% 65%",  accent: "240 80% 20%",  ring: "240 80% 65%"  },
  { key: "laranja",   name: "Laranja Fênix",  emoji: "🔥", desc: "Renascendo das cinzas",       primary: "20 95% 60%",   accent: "20 95% 18%",   ring: "20 95% 60%"   },
  { key: "lima",      name: "Lima Neon",      emoji: "⚡", desc: "Matrix mode ativado",         primary: "80 80% 55%",   accent: "80 80% 18%",   ring: "80 80% 55%"   },
  { key: "coral",     name: "Coral Inferno",  emoji: "🪸", desc: "Lindo e destruidor",          primary: "15 90% 65%",   accent: "15 90% 20%",   ring: "15 90% 65%"   },
  { key: "ciano",     name: "Ciano Profundo", emoji: "🧊", desc: "Gélido como a verdade",       primary: "185 100% 45%", accent: "185 100% 16%", ring: "185 100% 45%" },
  { key: "roxo",      name: "Roxo Neon",      emoji: "💜", desc: "Frequência proibida",         primary: "290 85% 65%",  accent: "290 85% 20%",  ring: "290 85% 65%"  },
];

const LS_KEY = "infinity_theme";

function applyTheme(t: ThemeDef) {
  // Use inline style on <html> — highest priority in CSS cascade, beats any stylesheet
  const root = document.documentElement;
  const p = `hsl(${t.primary})`;
  const a = `hsl(${t.accent})`;
  const r = `hsl(${t.ring})`;

  // Extract just the hue for background tinting
  const hue = t.primary.split(" ")[0]!;

  // Raw HSL vars (for hsl(var(--primary)) patterns)
  root.style.setProperty("--primary", t.primary);
  root.style.setProperty("--accent", t.accent);
  root.style.setProperty("--ring", t.ring);
  root.style.setProperty("--sidebar-primary", t.primary);
  root.style.setProperty("--sidebar-ring", t.ring);
  root.style.setProperty("--chart-1", t.primary);

  // Background, card, sidebar tinted with theme hue — keeps it very dark, just shifts hue
  root.style.setProperty("--background", `${hue} 22% 6%`);
  root.style.setProperty("--sidebar", `${hue} 22% 6%`);
  root.style.setProperty("--card", `${hue} 18% 9%`);
  root.style.setProperty("--popover", `${hue} 18% 9%`);

  // Computed --color-* vars used by Tailwind v4 @theme inline utilities
  root.style.setProperty("--color-primary", p);
  root.style.setProperty("--color-primary-foreground", "hsl(220 30% 10%)");
  root.style.setProperty("--color-accent", a);
  root.style.setProperty("--color-accent-foreground", p);
  root.style.setProperty("--color-ring", r);
  root.style.setProperty("--color-sidebar-primary", p);
  root.style.setProperty("--color-sidebar-ring", r);
  root.style.setProperty("--color-chart-1", p);
  root.style.setProperty("--color-primary-border", p);
  root.style.setProperty("--color-background", `hsl(${hue} 22% 6%)`);
  root.style.setProperty("--color-sidebar", `hsl(${hue} 22% 6%)`);
  root.style.setProperty("--color-card", `hsl(${hue} 18% 9%)`);
  root.style.setProperty("--color-popover", `hsl(${hue} 18% 9%)`);

  // Canvas particle color exposed as a data attribute for AnimatedBackground to read
  root.setAttribute("data-theme-hsl", t.primary);
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
        <div className="flex items-center gap-2 mb-5">
          <Palette className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Temas de Cor</h2>
          <span className="ml-auto text-[10px] uppercase tracking-widest bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full" style={{ color: `hsl(${current.primary})` }}>
            {current.emoji} {current.name}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {THEMES.map((t, i) => {
            const isActive = t.key === currentKey;
            const hslPrimary = `hsl(${t.primary})`;
            const hslAccent = `hsl(${t.accent})`;
            return (
              <motion.button
                key={t.key}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => handleSelect(t)}
                className="relative flex flex-col items-start gap-3 p-4 rounded-xl border text-left transition-all"
                style={{
                  borderColor: isActive ? hslPrimary : "rgba(255,255,255,0.08)",
                  background: isActive ? `${hslPrimary}18` : "rgba(0,0,0,0.3)",
                  boxShadow: isActive ? `0 0 20px -4px ${hslPrimary}55` : "none",
                }}
              >
                {isActive && (
                  <div
                    className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full"
                    style={{ background: hslPrimary, boxShadow: `0 0 6px ${hslPrimary}` }}
                  />
                )}
                <div className="text-xl">{t.emoji}</div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest" style={{ color: hslPrimary }}>
                    {t.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</div>
                </div>
                <div
                  className="w-full h-1.5 rounded-full"
                  style={{ background: `linear-gradient(90deg, ${hslPrimary}, ${hslAccent})` }}
                />
              </motion.button>
            );
          })}
        </div>

        {/* Live preview strip */}
        <div className="mt-6 p-4 rounded-xl border border-white/8 bg-black/20">
          <div className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground mb-4">
            Preview ao vivo — {current.emoji} {current.name}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span
              className="px-3 py-1.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest border"
              style={{
                background: `hsl(${current.primary} / 0.15)`,
                borderColor: `hsl(${current.primary} / 0.4)`,
                color: `hsl(${current.primary})`,
              }}
            >
              ● Ativo
            </span>
            <span
              className="px-3 py-1.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest border"
              style={{
                background: `hsl(${current.primary} / 0.1)`,
                borderColor: `hsl(${current.primary} / 0.25)`,
                color: `hsl(${current.primary} / 0.8)`,
              }}
            >
              🔍 Consultar
            </span>
            <span className="px-3 py-1.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest border border-white/10 text-muted-foreground bg-white/5">
              ○ Inativo
            </span>
            <div className="w-full mt-2 h-2 rounded-full overflow-hidden bg-white/5">
              <div
                className="h-full w-3/5 rounded-full"
                style={{ background: `linear-gradient(90deg, hsl(${current.primary}), hsl(${current.accent}))` }}
              />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
