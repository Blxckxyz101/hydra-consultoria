export const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN ?? "";
export const APPLICATION_ID = "1493775313749151754";
export const GUILD_ID       = "1493780674031779951";
// All guilds where commands should be registered instantly
export const ALL_GUILD_IDS  = ["1493780674031779951"];
export const API_BASE       = "http://localhost:8080";
export const AUTHOR         = "Made by blxckxyz";
export const BOT_NAME       = "Lelouch Britannia";

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
