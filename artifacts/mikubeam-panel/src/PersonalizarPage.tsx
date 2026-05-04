import { useState, useRef } from "react";

/* ── Media localStorage keys (exported for App.tsx) ── */
export const LS_PANEL_BANNER = "lb_custom_banner";
export const LS_PANEL_AVATAR = "lb_custom_avatar";

/** Hook: reads/writes custom banner & avatar GIF from localStorage */
export function useMediaSettings() {
  const [banner, setBannerState] = useState<string | null>(
    () => localStorage.getItem(LS_PANEL_BANNER)
  );
  const [avatar, setAvatarState] = useState<string | null>(
    () => localStorage.getItem(LS_PANEL_AVATAR)
  );
  const setBanner = (url: string | null) => {
    setBannerState(url);
    if (url) localStorage.setItem(LS_PANEL_BANNER, url);
    else localStorage.removeItem(LS_PANEL_BANNER);
  };
  const setAvatar = (url: string | null) => {
    setAvatarState(url);
    if (url) localStorage.setItem(LS_PANEL_AVATAR, url);
    else localStorage.removeItem(LS_PANEL_AVATAR);
  };
  return { banner, avatar, setBanner, setAvatar };
}

export type CustomThemeKey =
  | "crimson" | "azul" | "sakura" | "violeta"
  | "laranja" | "rosa" | "cyber" | "dourado"
  | "sangue" | "matrix" | "abyss" | "coral";

export interface CustomThemeDef {
  key: CustomThemeKey;
  name: string;
  emoji: string;
  desc: string;
  accent: string;
  gold: string;
  bg: string;
  bgMid: string;
  symbolHue: number;
  symbolSaturate: number;
  cardBorder: string;
  inputFocus: string;
  titleGrad: string;
}

export const CUSTOM_THEMES: CustomThemeDef[] = [
  {
    key: "crimson", name: "Crimson", emoji: "🔴", desc: "Original Lelouch",
    accent: "#C0392B", gold: "#D4AF37", bg: "#07000E", bgMid: "#120018",
    symbolHue: 0, symbolSaturate: 1,
    cardBorder: "rgba(212,175,55,0.2)", inputFocus: "rgba(212,175,55,0.5)",
    titleGrad: "linear-gradient(135deg,#D4AF37 0%,#F7E898 45%,#C0392B 100%)",
  },
  {
    key: "azul", name: "Azul Geass", emoji: "🔵", desc: "Frio como Suzaku",
    accent: "#1a7abf", gold: "#38bdf8", bg: "#000A14", bgMid: "#001226",
    symbolHue: 200, symbolSaturate: 1.3,
    cardBorder: "rgba(56,189,248,0.2)", inputFocus: "rgba(56,189,248,0.5)",
    titleGrad: "linear-gradient(135deg,#38bdf8 0%,#bae6fd 45%,#1a7abf 100%)",
  },
  {
    key: "sakura", name: "Sakuradite", emoji: "💚", desc: "Energia verde de Sakuradite",
    accent: "#10b981", gold: "#34d399", bg: "#000E08", bgMid: "#001a0e",
    symbolHue: 148, symbolSaturate: 1.4,
    cardBorder: "rgba(52,211,153,0.2)", inputFocus: "rgba(52,211,153,0.5)",
    titleGrad: "linear-gradient(135deg,#34d399 0%,#a7f3d0 45%,#10b981 100%)",
  },
  {
    key: "violeta", name: "Violeta", emoji: "🟣", desc: "Poder do Geass",
    accent: "#8E44AD", gold: "#c4b5fd", bg: "#080014", bgMid: "#0f0024",
    symbolHue: 270, symbolSaturate: 1.3,
    cardBorder: "rgba(196,181,253,0.2)", inputFocus: "rgba(139,92,246,0.5)",
    titleGrad: "linear-gradient(135deg,#c4b5fd 0%,#ede9fe 45%,#8E44AD 100%)",
  },
  {
    key: "laranja", name: "Laranja Zero", emoji: "🟠", desc: "Chama da revolução",
    accent: "#E67E22", gold: "#fcd34d", bg: "#0e0700", bgMid: "#1c0d00",
    symbolHue: 28, symbolSaturate: 1.2,
    cardBorder: "rgba(252,211,77,0.2)", inputFocus: "rgba(230,126,34,0.5)",
    titleGrad: "linear-gradient(135deg,#fcd34d 0%,#fef3c7 45%,#E67E22 100%)",
  },
  {
    key: "rosa", name: "Rosa Britannia", emoji: "🌸", desc: "Delicado mas letal",
    accent: "#E91E8C", gold: "#f9a8d4", bg: "#100010", bgMid: "#1c0022",
    symbolHue: 322, symbolSaturate: 1.4,
    cardBorder: "rgba(249,168,212,0.2)", inputFocus: "rgba(233,30,140,0.5)",
    titleGrad: "linear-gradient(135deg,#f9a8d4 0%,#fce7f3 45%,#E91E8C 100%)",
  },
  {
    key: "cyber", name: "Cyber Aqua", emoji: "🌐", desc: "Interface do futuro",
    accent: "#00d4aa", gold: "#67e8f9", bg: "#000e10", bgMid: "#001a1c",
    symbolHue: 172, symbolSaturate: 1.5,
    cardBorder: "rgba(103,232,249,0.2)", inputFocus: "rgba(0,212,170,0.5)",
    titleGrad: "linear-gradient(135deg,#67e8f9 0%,#cffafe 45%,#00d4aa 100%)",
  },
  {
    key: "dourado", name: "Dourado Puro", emoji: "✨", desc: "Nobleza absoluta",
    accent: "#D4AF37", gold: "#fde68a", bg: "#0a0800", bgMid: "#160f00",
    symbolHue: 42, symbolSaturate: 1.1,
    cardBorder: "rgba(253,230,138,0.2)", inputFocus: "rgba(212,175,55,0.6)",
    titleGrad: "linear-gradient(135deg,#fde68a 0%,#fef9c3 45%,#D4AF37 100%)",
  },
  {
    key: "sangue", name: "Sangue Real", emoji: "🩸", desc: "Escarlate da nobreza",
    accent: "#ff1744", gold: "#ff8a80", bg: "#080000", bgMid: "#160000",
    symbolHue: 10, symbolSaturate: 1.6,
    cardBorder: "rgba(255,138,128,0.2)", inputFocus: "rgba(255,23,68,0.5)",
    titleGrad: "linear-gradient(135deg,#ff8a80 0%,#ffcdd2 45%,#ff1744 100%)",
  },
  {
    key: "matrix", name: "Matrix Zero", emoji: "💾", desc: "I know kung fu",
    accent: "#00ff41", gold: "#39ff14", bg: "#000500", bgMid: "#000d00",
    symbolHue: 118, symbolSaturate: 2,
    cardBorder: "rgba(57,255,20,0.2)", inputFocus: "rgba(0,255,65,0.5)",
    titleGrad: "linear-gradient(135deg,#39ff14 0%,#ccff90 45%,#00ff41 100%)",
  },
  {
    key: "abyss", name: "Abismo Void", emoji: "⬛", desc: "Trevas absolutas",
    accent: "#6b21a8", gold: "#a855f7", bg: "#040006", bgMid: "#0a0014",
    symbolHue: 282, symbolSaturate: 1.8,
    cardBorder: "rgba(168,85,247,0.2)", inputFocus: "rgba(107,33,168,0.5)",
    titleGrad: "linear-gradient(135deg,#a855f7 0%,#e9d5ff 45%,#6b21a8 100%)",
  },
  {
    key: "coral", name: "Coral Inferno", emoji: "🪸", desc: "Belo e destruidor",
    accent: "#ff6b6b", gold: "#ffd93d", bg: "#0e0600", bgMid: "#1a0a00",
    symbolHue: 15, symbolSaturate: 1.3,
    cardBorder: "rgba(255,217,61,0.2)", inputFocus: "rgba(255,107,107,0.5)",
    titleGrad: "linear-gradient(135deg,#ffd93d 0%,#fff3b0 45%,#ff6b6b 100%)",
  },
];

export function getThemeDef(key: string): CustomThemeDef {
  return CUSTOM_THEMES.find(t => t.key === key) ?? CUSTOM_THEMES[0]!;
}

export function getSymbolFilter(t: CustomThemeDef): string {
  if (t.key === "crimson") return "none";
  return `hue-rotate(${t.symbolHue}deg) saturate(${t.symbolSaturate}) brightness(1.1)`;
}

export function buildThemeStyle(t: CustomThemeDef): string {
  return `
    --crimson:     ${t.accent};
    --crimson-dk:  ${t.accent}cc;
    --crimson-fnt: ${t.accent}33;
    --gold:        ${t.gold};
    --gold-dim:    ${t.gold}bb;
    --gold-faint:  ${t.gold}20;
    --gold-border: ${t.gold}4d;
    --bg:          ${t.bg};
    --bg-mid:      ${t.bgMid};
    --card-border: ${t.cardBorder};
    --input-focus: ${t.inputFocus};
    --input-brd:   ${t.cardBorder};
  `;
}

const STYLES = `
/* ── Media section ── */
.pz-media-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 600px) { .pz-media-grid { grid-template-columns: 1fr; } }
.pz-media-card { border-radius: 14px; border: 1px solid rgba(255,255,255,0.09); background: rgba(0,0,0,0.3); overflow: hidden; }
.pz-media-preview { position: relative; width: 100%; height: 140px; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; overflow: hidden; cursor: pointer; }
.pz-media-preview:hover .pz-media-overlay { opacity: 1; }
.pz-media-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pz-media-placeholder { display: flex; flex-direction: column; align-items: center; gap: 8px; color: rgba(230,216,255,0.3); font-size: 11px; letter-spacing: 2px; text-transform: uppercase; }
.pz-media-placeholder-icon { font-size: 28px; opacity: 0.5; }
.pz-media-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; gap: 8px; opacity: 0; transition: opacity 0.2s; }
.pz-media-overlay-btn { padding: 6px 14px; border-radius: 8px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); color: #fff; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; cursor: pointer; }
.pz-media-overlay-btn:hover { background: rgba(255,255,255,0.22); }
.pz-media-overlay-btn--danger { background: rgba(192,57,43,0.25); border-color: rgba(192,57,43,0.5); color: #ff8a80; }
.pz-media-overlay-btn--danger:hover { background: rgba(192,57,43,0.45); }
.pz-media-footer { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.pz-media-label { font-size: 9px; letter-spacing: 4px; text-transform: uppercase; color: rgba(230,216,255,0.5); margin-bottom: 2px; }
.pz-media-url-row { display: flex; gap: 6px; }
.pz-media-url-input { flex: 1; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12); border-radius: 7px; padding: 6px 10px; font-size: 11px; color: #e6d8ff; outline: none; font-family: monospace; }
.pz-media-url-input:focus { border-color: rgba(212,175,55,0.5); }
.pz-media-url-input::placeholder { color: rgba(230,216,255,0.25); }
.pz-media-url-btn { padding: 6px 12px; border-radius: 7px; background: rgba(212,175,55,0.15); border: 1px solid rgba(212,175,55,0.35); color: #D4AF37; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; white-space: nowrap; }
.pz-media-url-btn:hover { background: rgba(212,175,55,0.28); }
.pz-media-hint { font-size: 9px; color: rgba(230,216,255,0.3); font-family: 'Crimson Text', serif; }
/* ── avatar preview (round) ── */
.pz-avatar-preview img { border-radius: 50%; width: 80px; height: 80px; object-fit: cover; }
/* ────────────────────────── */
.pz-wrap { padding: 24px; color: #e6d8ff; font-family: 'Cinzel','Georgia',serif; }
.pz-title { font-size: 11px; letter-spacing: 5px; text-transform: uppercase; color: var(--gold, #D4AF37); margin-bottom: 8px; }
.pz-desc { font-size: 12px; color: rgba(230,216,255,0.45); margin-bottom: 28px; font-family: 'Crimson Text', serif; }
.pz-section { margin-bottom: 32px; }
.pz-section-label { font-size: 9px; letter-spacing: 4px; text-transform: uppercase; color: rgba(230,216,255,0.4); margin-bottom: 14px; }
.pz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.pz-theme-card { padding: 16px 14px; border-radius: 12px; cursor: pointer; transition: all 0.2s; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 8px; }
.pz-theme-card:hover { transform: translateY(-2px); }
.pz-theme-card--active { border-width: 2px; box-shadow: 0 0 20px currentColor; }
.pz-emoji { font-size: 22px; }
.pz-theme-name { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
.pz-theme-desc { font-size: 10px; opacity: 0.55; font-family: 'Crimson Text', serif; }
.pz-swatch { width: 100%; height: 4px; border-radius: 2px; margin-top: 4px; }
.pz-preview { margin-top: 24px; padding: 20px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.4); }
.pz-preview-title { font-size: 9px; letter-spacing: 4px; text-transform: uppercase; color: rgba(230,216,255,0.4); margin-bottom: 16px; }
.pz-preview-logo { display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 20px; }
.pz-preview-h1 { font-size: 24px; letter-spacing: 6px; text-transform: uppercase; font-family: 'Cinzel', serif; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.pz-preview-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; }
.pz-suggestions { display: flex; flex-direction: column; gap: 10px; }
.pz-sug { padding: 14px 16px; border-radius: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.07); display: flex; gap: 12px; align-items: flex-start; }
.pz-sug-icon { font-size: 20px; flex-shrink: 0; }
.pz-sug-name { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 3px; }
.pz-sug-text { font-size: 12px; color: rgba(230,216,255,0.55); font-family: 'Crimson Text', serif; }
@media (max-width: 600px) {
  .pz-grid { grid-template-columns: repeat(2, 1fr); }
  .pz-wrap { padding: 14px; }
}
`;

const SUGGESTIONS = [
  { icon: "🌧️", name: "Matrix Rain de Código", text: "Canvas de fundo com caracteres kanji/katakana caindo em verde. Quando ataque inicia, os chars mudam para vermelho sangrento." },
  { icon: "👁️", name: "Geass Eye Tracker", text: "Câmera rastreia o olho do usuário via WebRTC — quando pisca, o ataque para. Perigo total." },
  { icon: "🎙️", name: "Comando de Voz", text: "\"Lelouch, ataque google.com por 60 segundos\" — Web Speech API reconhece o comando e dispara tudo automaticamente." },
  { icon: "🗺️", name: "Mapa de Calor Global", text: "Mapa 3D do mundo girando (Three.js) com pontos pulsando nos IPs sendo atacados. Parece sala de guerra da Britannia." },
  { icon: "⚡", name: "Modo Turbo Sakuradite", text: "Ao atingir 100k req/s, o painel inteiro pisca dourado e toca uma buzina de trem. Toast: 'SAKURADITE OVERDRIVE'." },
  { icon: "🧠", name: "Lelouch Fala Tudo", text: "TTS em pt-BR narrando cada evento: 'Alvo eliminado', 'Ataque iniciado', 'Warning: target respondendo'... Voz grave, dramática." },
  { icon: "☠️", name: "Kill Counter Dramático", text: "Contador de domínios derrubados com som de sino a cada kill. Chega em 10: toca o tema de Lelouch vi Britannia." },
  { icon: "🎭", name: "Modo Teatro", text: "Layout vira um painel de controle com CRT scanlines, fonte de terminal verde e todos os sons viram beeps retro." },
  { icon: "🌀", name: "Requiem Apocalipse", text: "Tema especial que inverte as cores do painel, toca uma música épica e mostra uma contagem regressiva. Ativado com código secreto." },
  { icon: "🐉", name: "HP Bar do Alvo", text: "Barra de HP animada do domínio atacado baseada no % de requests com erro. Quando chega a zero: tela de 'GAME OVER' épica." },
];

/* ── MediaCard — single banner or avatar uploader ── */
interface MediaCardProps {
  label: string;
  icon: string;
  hint: string;
  value: string | null;
  round?: boolean;
  onChange: (url: string | null) => void;
}
function MediaCard({ label, icon, hint, value, round, onChange }: MediaCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState("");

  function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await readFile(file);
    onChange(url);
    e.target.value = "";
  }

  function handleUrl() {
    const u = urlInput.trim();
    if (!u) return;
    onChange(u);
    setUrlInput("");
  }

  return (
    <div className="pz-media-card">
      <div
        className={`pz-media-preview${round ? " pz-avatar-preview" : ""}`}
        onClick={() => fileRef.current?.click()}
        title="Clique para enviar arquivo"
      >
        {value ? (
          <img src={value} alt={label} />
        ) : (
          <div className="pz-media-placeholder">
            <span className="pz-media-placeholder-icon">{icon}</span>
            <span>Sem {label.toLowerCase()}</span>
          </div>
        )}
        <div className="pz-media-overlay">
          <button className="pz-media-overlay-btn" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
            📁 Arquivo
          </button>
          {value && (
            <button
              className="pz-media-overlay-btn pz-media-overlay-btn--danger"
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
            >
              ✕ Remover
            </button>
          )}
        </div>
      </div>

      <div className="pz-media-footer">
        <div className="pz-media-label">{label}</div>
        <div className="pz-media-url-row">
          <input
            className="pz-media-url-input"
            placeholder="https://exemplo.com/banner.gif"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUrl()}
          />
          <button className="pz-media-url-btn" onClick={handleUrl}>OK</button>
        </div>
        <div className="pz-media-hint">{hint} · GIF, MP4, JPG, PNG suportados</div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/gif,video/mp4"
        style={{ display: "none" }}
        onChange={handleFile}
      />
    </div>
  );
}

interface Props {
  currentKey: string;
  onSelect: (key: CustomThemeKey) => void;
  symbolFilter: string;
  mediaBanner: string | null;
  mediaAvatar: string | null;
  onBannerChange: (url: string | null) => void;
  onAvatarChange: (url: string | null) => void;
}

export function PersonalizarPage({ currentKey, onSelect, symbolFilter, mediaBanner, mediaAvatar, onBannerChange, onAvatarChange }: Props) {
  const t = getThemeDef(currentKey);

  return (
    <>
      <style>{STYLES}</style>
      <div className="pz-wrap">
        <div className="pz-title">⚙ Personalizar Painel</div>
        <div className="pz-desc">Escolha um tema e a logo se adapta automaticamente. As cores do painel mudam em tempo real.</div>

        <div className="pz-section">
          <div className="pz-section-label">Temas de Cor</div>
          <div className="pz-grid">
            {CUSTOM_THEMES.map(theme => {
              const isActive = theme.key === currentKey;
              return (
                <div
                  key={theme.key}
                  className={`pz-theme-card ${isActive ? "pz-theme-card--active" : ""}`}
                  onClick={() => onSelect(theme.key)}
                  style={{
                    borderColor: isActive ? theme.accent : "rgba(255,255,255,0.08)",
                    color: theme.accent,
                    boxShadow: isActive ? `0 0 16px ${theme.accent}44` : "none",
                  }}
                >
                  <div className="pz-emoji">{theme.emoji}</div>
                  <div>
                    <div className="pz-theme-name" style={{ color: theme.gold }}>{theme.name}</div>
                    <div className="pz-theme-desc">{theme.desc}</div>
                  </div>
                  <div className="pz-swatch" style={{ background: `linear-gradient(90deg, ${theme.accent}, ${theme.gold})` }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Live preview */}
        <div className="pz-preview">
          <div className="pz-preview-title">Preview — {t.emoji} {t.name}</div>
          <div className="pz-preview-logo">
            <div className="pz-preview-h1" style={{ backgroundImage: t.titleGrad }}>
              Lelouch Painel
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <span className="pz-preview-badge" style={{ background: `${t.accent}22`, border: `1px solid ${t.accent}55`, color: t.accent }}>⚔ Ataque</span>
            <span className="pz-preview-badge" style={{ background: `${t.gold}22`, border: `1px solid ${t.gold}55`, color: t.gold }}>👑 VIP</span>
            <span className="pz-preview-badge" style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.4)", color: "#6ee7b7" }}>● ACTIVE</span>
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 8 }}>
            <div style={{ width: 180, height: 6, borderRadius: 3, background: `linear-gradient(90deg, ${t.accent}, ${t.gold})`, boxShadow: `0 0 12px ${t.accent}88` }} />
          </div>
        </div>

        {/* ── Mídia ── */}
        <div className="pz-section" style={{ marginTop: 36 }}>
          <div className="pz-section-label">🖼️ Mídia do Painel</div>
          <div className="pz-media-grid">
            <MediaCard
              label="Banner (GIF do Card)"
              icon="🎞️"
              hint="Substitui o GIF do Lelouch no card principal"
              value={mediaBanner}
              onChange={onBannerChange}
            />
            <MediaCard
              label="Perfil / Avatar"
              icon="👁️"
              hint="Aparece no header ao lado do título"
              value={mediaAvatar}
              round
              onChange={onAvatarChange}
            />
          </div>
        </div>

        {/* Suggestions */}
        <div className="pz-section" style={{ marginTop: 36 }}>
          <div className="pz-section-label">💡 Sugestões Absurdas Pro Painel</div>
          <div className="pz-suggestions">
            {SUGGESTIONS.map(s => (
              <div key={s.name} className="pz-sug">
                <div className="pz-sug-icon">{s.icon}</div>
                <div>
                  <div className="pz-sug-name" style={{ color: t.accent }}>{s.name}</div>
                  <div className="pz-sug-text">{s.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
