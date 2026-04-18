export const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const API_BASE    = process.env.API_BASE ?? "http://localhost:8080";
export const BOT_NAME    = "Geass Command Center";
export const AUTHOR      = "LelouchBritannia";
// URL of the Telegram Mini App served from the checker-panel public folder
export const MINIAPP_URL = process.env.MINIAPP_URL
  ?? (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/checker-panel/miniapp.html`
    : "");

// Checker targets available
export const CHECKER_TARGETS = [
  { id: "github",        label: "🐙 GitHub PAT",       cat: "Dev/Cloud"     },
  { id: "aws",           label: "☁️ AWS IAM",           cat: "Dev/Cloud"     },
  { id: "vultr",         label: "💎 Vultr",             cat: "VPS/Hosting"   },
  { id: "hetzner",       label: "🟠 Hetzner",           cat: "VPS/Hosting"   },
  { id: "digitalocean",  label: "🌊 DigitalOcean",      cat: "VPS/Hosting"   },
  { id: "linode",        label: "🟢 Linode/Akamai",     cat: "VPS/Hosting"   },
  { id: "ovh",           label: "🔵 OVH",               cat: "VPS/Hosting"   },
  { id: "netflix",       label: "🎬 Netflix",           cat: "Streaming"     },
  { id: "crunchyroll",   label: "🍥 Crunchyroll",       cat: "Streaming"     },
  { id: "hbomax",        label: "👑 HBO Max",           cat: "Streaming"     },
  { id: "disney",        label: "🏰 Disney+",           cat: "Streaming"     },
  { id: "amazon",        label: "📦 Amazon Prime",      cat: "Streaming"     },
  { id: "paramount",     label: "⭐ Paramount+",        cat: "Streaming"     },
  { id: "spotify",       label: "🎵 Spotify",           cat: "Streaming"     },
  { id: "paypal",        label: "💰 PayPal",            cat: "Financeiro"    },
  { id: "roblox",        label: "🎮 Roblox",            cat: "Gaming"        },
  { id: "steam",         label: "🎮 Steam",             cat: "Gaming"        },
  { id: "epic",          label: "🎮 Epic Games",        cat: "Gaming"        },
  { id: "playstation",   label: "🎮 PlayStation",       cat: "Gaming"        },
  { id: "instagram",     label: "📸 Instagram",         cat: "Social"        },
  { id: "serasa",        label: "📊 Serasa",            cat: "Governo BR"    },
  { id: "cpf",           label: "🪪 CPF/CNPJ",          cat: "Governo BR"    },
  { id: "iseek",         label: "🌐 iSeek",             cat: "Governo BR"    },
  { id: "serpro",        label: "🛡️ SERPRO",            cat: "Governo BR"    },
  { id: "sinesp",        label: "🚔 SINESP",            cat: "Governo BR"    },
] as const;
