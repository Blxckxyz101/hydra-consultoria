export const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const API_BASE    = process.env.API_BASE ?? "http://localhost:8080";
export const BOT_NAME    = "Geass Command Center";
export const AUTHOR      = "LelouchBritannia";
export const MINIAPP_URL = process.env.MINIAPP_URL ?? "";

// Checker targets — must match IDs in api-server checker.ts
export const CHECKER_TARGETS = [
  // Dev / Cloud
  { id: "github",       label: "🐙 GitHub PAT",    cat: "Dev / Cloud"    },
  { id: "aws",          label: "☁️ AWS IAM",         cat: "Dev / Cloud"    },
  // VPS / Hosting
  { id: "vultr",        label: "💎 Vultr",           cat: "VPS / Hosting"  },
  { id: "hetzner",      label: "🔴 Hetzner",         cat: "VPS / Hosting"  },
  { id: "digitalocean", label: "🌊 DigitalOcean",    cat: "VPS / Hosting"  },
  { id: "linode",       label: "🟢 Linode/Akamai",   cat: "VPS / Hosting"  },
  { id: "hostinger",    label: "🌐 Hostinger",       cat: "VPS / Hosting"  },
  // Streaming
  { id: "netflix",      label: "🎬 Netflix",         cat: "Streaming"      },
  { id: "crunchyroll",  label: "🍥 Crunchyroll",     cat: "Streaming"      },
  { id: "hbomax",       label: "👑 HBO Max",          cat: "Streaming"      },
  { id: "disney",       label: "🏰 Disney+",          cat: "Streaming"      },
  { id: "amazon",       label: "📦 Prime Video",      cat: "Streaming"      },
  { id: "paramount",    label: "⭐ Paramount+",       cat: "Streaming"      },
  { id: "spotify",      label: "🎵 Spotify",          cat: "Streaming"      },
  // Gaming
  { id: "roblox",       label: "🟥 Roblox",           cat: "Gaming"         },
  { id: "steam",        label: "🎲 Steam",            cat: "Gaming"         },
  { id: "epicgames",    label: "⚫ Epic Games",        cat: "Gaming"         },
  { id: "playstation",  label: "🎮 PlayStation",      cat: "Gaming"         },
  { id: "xbox",         label: "🟩 Xbox",              cat: "Gaming"         },
  { id: "riot",         label: "⚔️ Riot Games",        cat: "Gaming"         },
  // Financeiro
  { id: "paypal",       label: "💳 PayPal",            cat: "Financeiro"     },
  { id: "mercadopago",  label: "💙 Mercado Pago",      cat: "Financeiro"     },
  { id: "ifood",        label: "🍔 iFood",             cat: "Financeiro"     },
  // Social
  { id: "instagram",    label: "📸 Instagram",         cat: "Social"         },
  // Governo BR
  { id: "serasa",       label: "📊 Serasa Empr.",      cat: "Governo BR"     },
  { id: "iseek",        label: "🌐 iSeek",             cat: "Governo BR"     },
  { id: "serpro",       label: "🛡️ SERPRO",            cat: "Governo BR"     },
  { id: "sinesp",       label: "🚔 SINESP",            cat: "Governo BR"     },
  // Financeiro BR
  { id: "privacy",      label: "🔒 Privacy.com.br",    cat: "Financeiro"     },
  { id: "checkok",      label: "✅ CheckOK",            cat: "Financeiro"     },
] as const;

export type CheckerTargetId = (typeof CHECKER_TARGETS)[number]["id"];
