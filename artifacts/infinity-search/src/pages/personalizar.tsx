import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Palette, Lightbulb } from "lucide-react";

interface ThemeDef {
  key: string;
  name: string;
  emoji: string;
  desc: string;
  primary: string;   // HSL values: "H S% L%"
  accent: string;    // HSL values
  ring: string;
  logoHue: number;   // hue-rotate degrees for logo glow
}

const THEMES: ThemeDef[] = [
  { key: "sky",      name: "Sky Infinity",   emoji: "🌊", desc: "Padrão — oceano de dados",    primary: "195 90% 55%", accent: "195 90% 20%", ring: "195 90% 55%", logoHue: 0 },
  { key: "violeta",  name: "Violeta Zero",   emoji: "🟣", desc: "Poder do Geass",               primary: "270 80% 65%", accent: "270 80% 20%", ring: "270 80% 65%", logoHue: 75 },
  { key: "esmeralda",name: "Esmeralda",      emoji: "💚", desc: "Vida nos dados",               primary: "160 70% 50%", accent: "160 70% 18%", ring: "160 70% 50%", logoHue: -35 },
  { key: "ambar",    name: "Âmbar Real",     emoji: "✨", desc: "Nobleza dourada",              primary: "38 95% 58%",  accent: "38 95% 18%",  ring: "38 95% 58%",  logoHue: -157 },
  { key: "rosa",     name: "Rosa Sakura",    emoji: "🌸", desc: "Beleza letal",                 primary: "330 90% 65%", accent: "330 90% 20%", ring: "330 90% 65%", logoHue: 135 },
  { key: "vermelho", name: "Escarlate",      emoji: "🔴", desc: "Sangue britânico",             primary: "0 84% 60%",   accent: "0 84% 18%",   ring: "0 84% 60%",   logoHue: -195 },
  { key: "indigo",   name: "Índigo Void",    emoji: "🌌", desc: "Trevas absolutas",             primary: "240 80% 65%", accent: "240 80% 20%", ring: "240 80% 65%", logoHue: 45 },
  { key: "laranja",  name: "Laranja Fênix",  emoji: "🔥", desc: "Renascendo das cinzas",        primary: "20 95% 60%",  accent: "20 95% 18%",  ring: "20 95% 60%",  logoHue: -175 },
  { key: "lima",     name: "Lima Neon",      emoji: "⚡", desc: "Matrix mode ativado",          primary: "80 80% 55%",  accent: "80 80% 18%",  ring: "80 80% 55%",  logoHue: -115 },
  { key: "coral",    name: "Coral Inferno",  emoji: "🪸", desc: "Lindo e destruidor",            primary: "15 90% 65%",  accent: "15 90% 20%",  ring: "15 90% 65%",  logoHue: -180 },
  { key: "ciano",    name: "Ciano Profundo", emoji: "🧊", desc: "Gélido como a verdade",        primary: "185 100% 45%",accent: "185 100% 16%",ring: "185 100% 45%",logoHue: -10 },
  { key: "roxo",     name: "Roxo Neon",      emoji: "💜", desc: "Frequência proibida",          primary: "290 85% 65%", accent: "290 85% 20%", ring: "290 85% 65%", logoHue: 95 },
];

const LS_KEY = "infinity_theme";

function applyTheme(t: ThemeDef) {
  let el = document.getElementById("infinity-custom-theme") as HTMLStyleElement | null;
  if (!el) { el = document.createElement("style"); el.id = "infinity-custom-theme"; document.head.appendChild(el); }
  el.textContent = `
    :root {
      --primary: ${t.primary};
      --accent: ${t.accent};
      --ring: ${t.ring};
      --sidebar-primary: ${t.primary};
      --sidebar-ring: ${t.ring};
      --chart-1: ${t.primary};
    }
  `;
}

function loadThemeKey(): string { return localStorage.getItem(LS_KEY) ?? "sky"; }
export function initSavedTheme() {
  const key = loadThemeKey();
  const t = THEMES.find(x => x.key === key) ?? THEMES[0]!;
  applyTheme(t);
}

const SUGGESTIONS = [
  { icon: "🌧️", name: "Matrix Rain de Código",  text: "Canvas de fundo com caracteres kanji/katakana caindo. Quando uma busca retorna resultados, os chars ficam verdes. Quando não acha nada, viram vermelho sangrento." },
  { icon: "👁️", name: "Raio-X do Alvo",          text: "Ao abrir o dossiê de um CPF, um overlay estilo 'escaneando' aparece com linhas verdes varrendo a foto antes de revelar os dados. Som de scanner incluído." },
  { icon: "🎙️", name: "Comando de Voz Completo", text: '"Infinity, consulte o CPF 123 456 789 00" — a IA reconhece e dispara a consulta automaticamente. Nem precisa digitar.' },
  { icon: "🗺️", name: "Mapa de Calor Nacional",  text: "Mapa do Brasil 3D (Three.js) com pontos brilhando nas cidades dos CPFs/CNPJs pesquisados. Clica no ponto e abre o dossiê." },
  { icon: "⚡", name: "Velocidade de Consulta",   text: 'Contador de "registros por segundo" ao estilo F1 durante cada consulta. Chega a 10k rec/s? Toast: "VELOCIDADE DE CRUZEIRO".' },
  { icon: "🧠", name: "IA Narra Tudo",            text: "Cada resultado lido em voz alta: 'CPF válido, nome José da Silva, nascido em...' Voz grave, tom de noticeiro policial. 100% acessível." },
  { icon: "🎭", name: "Modo Incógnito Visual",    text: "Layout vira terminal hacker com CRT scanlines, fonte verde monoespaçada e todos os nomes são substituídos por ██████ até você clicar para revelar." },
  { icon: "📡", name: "Radar de Conexões",        text: "Grafo interativo mostrando conexões entre CPFs/CNPJs pesquisados. Cada nó é uma pessoa, as arestas são vínculos societários ou familiares." },
  { icon: "🐉", name: "Score de Risco Visual",    text: "Barra de saúde estilo RPG para cada CPF consultado. Baixo risco = verde cheio. Alto risco = vermelho piscando com efeito de dano." },
  { icon: "🔮", name: "Assistente Preditivo",     text: 'Após 3 consultas do mesmo tipo, a IA pergunta: "Parece que você está investigando X. Quer que eu monte um relatório completo automaticamente?"' },
];

export default function Personalizar() {
  const [currentKey, setCurrentKey] = useState(loadThemeKey);

  // Apply on mount
  useEffect(() => {
    const t = THEMES.find(x => x.key === currentKey) ?? THEMES[0]!;
    applyTheme(t);
  }, []);

  const handleSelect = (t: ThemeDef) => {
    setCurrentKey(t.key);
    localStorage.setItem(LS_KEY, t.key);
    applyTheme(t);
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
          <span className="ml-auto text-[10px] uppercase tracking-widest text-primary/70 bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full">
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
                className={`relative flex flex-col items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                  isActive
                    ? "border-primary/60 bg-primary/10 shadow-[0_0_20px_-4px_var(--tw-shadow-color)]"
                    : "border-white/8 bg-black/30 hover:border-white/20 hover:bg-white/5"
                }`}
                style={isActive ? { "--tw-shadow-color": hslPrimary } as React.CSSProperties : {}}
              >
                {isActive && (
                  <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full" style={{ background: hslPrimary, boxShadow: `0 0 6px ${hslPrimary}` }} />
                )}
                <div className="text-xl">{t.emoji}</div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest" style={{ color: hslPrimary }}>{t.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</div>
                </div>
                <div className="w-full h-1.5 rounded-full" style={{ background: `linear-gradient(90deg, ${hslPrimary}, ${hslAccent})` }} />
              </motion.button>
            );
          })}
        </div>

        {/* Live preview strip */}
        <div className="mt-6 p-4 rounded-xl border border-white/8 bg-black/30">
          <div className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground mb-4">Preview — {current.emoji} {current.name}</div>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest border" style={{ background: `hsl(${current.primary} / 0.15)`, borderColor: `hsl(${current.primary} / 0.4)`, color: `hsl(${current.primary})` }}>
              ● Ativo
            </span>
            <span className="px-3 py-1.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest border" style={{ background: `hsl(${current.primary} / 0.1)`, borderColor: `hsl(${current.primary} / 0.25)`, color: `hsl(${current.primary} / 0.8)` }}>
              🔍 Consultar
            </span>
            <span className="px-3 py-1.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest border border-white/10 text-muted-foreground bg-white/5">
              ○ Inativo
            </span>
            <div className="w-full mt-2 h-1.5 rounded-full overflow-hidden bg-white/5">
              <div className="h-full w-3/5 rounded-full" style={{ background: `linear-gradient(90deg, hsl(${current.primary}), hsl(${current.accent}))` }} />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Absurd suggestions */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6"
      >
        <div className="flex items-center gap-2 mb-5">
          <Lightbulb className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Ideias Absurdas Pro Sistema</h2>
          <span className="ml-auto text-[10px] text-muted-foreground/50">sugestões de features</span>
        </div>

        <div className="space-y-3">
          {SUGGESTIONS.map((s, i) => (
            <motion.div
              key={s.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.05 }}
              className="flex gap-4 p-4 rounded-xl border border-white/6 bg-black/20 hover:bg-white/3 transition-colors"
            >
              <div className="text-xl shrink-0">{s.icon}</div>
              <div>
                <div
                  className="text-xs font-bold uppercase tracking-widest mb-1"
                  style={{ color: `hsl(${current.primary})` }}
                >
                  {s.name}
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">{s.text}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
