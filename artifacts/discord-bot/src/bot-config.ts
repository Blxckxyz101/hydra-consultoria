/**
 * BOT PERSISTENT CONFIG
 * Stores per-guild log channel IDs, attack settings, owner panel access.
 */
import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = path.join(process.cwd(), "data", "bot-config.json");

interface BotConfig {
  logChannels:     Record<string, string>; // guildId → channelId
  attackCooldownMs: number;
  panelOwners:     string[];               // Discord user IDs with FULL owner access
  panelMods:       string[];               // Discord user IDs with limited mod access
}

// blxckxyz. is always hardcoded as bootstrap owner (new Discord username system — note the period)
export const BOOTSTRAP_OWNER_USERNAME = "blxckxyz.";

let config: BotConfig = {
  logChannels:     {},
  attackCooldownMs: 30_000,
  panelOwners:     [],
  panelMods:       [],
};

export function loadBotConfig(): void {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    config = { ...config, ...(JSON.parse(raw) as Partial<BotConfig>) };
  } catch { /* no config yet */ }
}

export function saveBotConfig(): void {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch { /* non-fatal */ }
}

// ── Log channels ──────────────────────────────────────────────────────────────
export function getLogChannelId(guildId: string): string | undefined {
  return config.logChannels[guildId];
}

export function setLogChannelId(guildId: string, channelId: string): void {
  config.logChannels[guildId] = channelId;
  saveBotConfig();
}

// ── Attack cooldown ────────────────────────────────────────────────────────────
export function getAttackCooldownMs(): number {
  return config.attackCooldownMs;
}

// ── Panel access control ───────────────────────────────────────────────────────
export function isOwner(userId: string, username: string): boolean {
  return username === BOOTSTRAP_OWNER_USERNAME || config.panelOwners.includes(userId);
}

export function isMod(userId: string, username: string): boolean {
  return isOwner(userId, username) || config.panelMods.includes(userId);
}

export function addPanelOwner(userId: string): void {
  if (!config.panelOwners.includes(userId)) {
    config.panelOwners.push(userId);
    saveBotConfig();
  }
}

export function removePanelOwner(userId: string): void {
  config.panelOwners = config.panelOwners.filter(id => id !== userId);
  saveBotConfig();
}

export function addPanelMod(userId: string): void {
  if (!config.panelMods.includes(userId)) {
    config.panelMods.push(userId);
    saveBotConfig();
  }
}

export function removePanelMod(userId: string): void {
  config.panelMods = config.panelMods.filter(id => id !== userId);
  saveBotConfig();
}

export function listPanelOwners(): string[] {
  return [...config.panelOwners];
}

export function listPanelMods(): string[] {
  return [...config.panelMods];
}

loadBotConfig();
