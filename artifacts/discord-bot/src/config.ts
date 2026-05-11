export const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN ?? "";
export const APPLICATION_ID = "1493775313749151754";
export const GUILD_ID       = "1493780674031779951";
// All guilds where commands should be registered instantly
export const ALL_GUILD_IDS  = ["1493780674031779951"];
export const API_BASE       = "http://localhost:8080";
export const AUTHOR         = "Made by blxckxyz";
export const BOT_NAME       = "Hydra";

export const COLORS = {
  CRIMSON:  0xC0392B,
  GOLD:     0xD4AF37,
  PURPLE:   0x8E44AD,
  TEAL:     0x1ABC9C,
  DARK:     0x1A001A,
  GREEN:    0x27AE60,
  RED:      0xE74C3C,
  ORANGE:   0xE67E22,
  BLUE:     0x3498DB,
  GRAY:     0x2C2F33,
} as const;

// ── Dynamic theme color (synced from Infinity panel Personalizar) ──────────────
const THEME_HEX_MAP: Record<string, number> = {
  sky: 0x38BDF8, violeta: 0xA78BFA, esmeralda: 0x34D399, ambar: 0xFBBF24,
  rosa: 0xF472B6, vermelho: 0xF87171, indigo: 0x818CF8, laranja: 0xFB923C,
  lima: 0xA3E635, coral: 0xFB7185, ciano: 0x22D3EE, roxo: 0xC084FC,
};

let _themePrimary: number = COLORS.CRIMSON;
let _themeLastFetch = 0;

export function getPrimaryColor(): number { return _themePrimary; }

export async function getThemeColor(): Promise<number> {
  if (Date.now() - _themeLastFetch < 120_000) return _themePrimary;
  try {
    const r = await fetch(`${API_BASE}/api/infinity/theme`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const j = await r.json() as { theme?: string };
      if (j.theme && THEME_HEX_MAP[j.theme]) _themePrimary = THEME_HEX_MAP[j.theme]!;
      _themeLastFetch = Date.now();
    }
  } catch { /* keep cached */ }
  return _themePrimary;
}

export async function refreshTheme(): Promise<void> { await getThemeColor(); }

export const TIER_COLORS: Record<string, number> = {
  S: COLORS.RED,
  A: COLORS.ORANGE,
  B: COLORS.GOLD,
  C: COLORS.BLUE,
  D: COLORS.GRAY,
};

export const METHOD_EMOJIS: Record<string, string> = {
  "http-flood":          "🌊",
  "http-bypass":         "🔓",
  "http2-flood":         "⚛️",
  "http2-continuation":  "🩻",
  "waf-bypass":          "👁️",
  "conn-flood":          "🔌",
  "slowloris":           "🐢",
  "tls-renego":          "🔐",
  "ws-flood":            "🕸️",
  "graphql-dos":         "🔮",
  "quic-flood":          "⚡",
  "cache-poison":        "☠️",
  "rudy-v2":             "🩸",
  "ssl-death":           "💀",
  "rudy":                "💧",
  "syn-flood":           "🔨",
  "tcp-flood":           "🌐",
  "udp-flood":           "💥",
  "udp-bypass":          "🚀",
  "dns-amp":             "📡",
  "ntp-amp":             "☢️",
  "mem-amp":             "🧨",
  "hpack-bomb":          "💣",
  "h2-settings-storm":   "⛈️",
  "ssdp-amp":            "📻",
  "icmp-flood":          "🔴",
  "http-pipeline":       "🚇",
  "geass-override":      "👁",
  "slow-read":           "🐌",
  "range-flood":         "📐",
  "xml-bomb":            "💾",
  "h2-ping-storm":       "🏓",
  "http-smuggling":      "🎭",
  "doh-flood":           "🌐",
  "keepalive-exhaust":    "⛓️",
  "app-smart-flood":      "🎯",
  "large-header-bomb":    "💣",
  "http2-priority-storm": "🌀",
};
