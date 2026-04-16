/**
 * BOT PERSISTENT CONFIG
 * Stores per-guild log channel IDs and other bot settings.
 */
import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = path.join(process.cwd(), "data", "bot-config.json");

interface BotConfig {
  logChannels: Record<string, string>;   // guildId → channelId
  attackCooldownMs: number;
}

let config: BotConfig = {
  logChannels: {},
  attackCooldownMs: 30_000,
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

export function getLogChannelId(guildId: string): string | undefined {
  return config.logChannels[guildId];
}

export function setLogChannelId(guildId: string, channelId: string): void {
  config.logChannels[guildId] = channelId;
  saveBotConfig();
}

export function getAttackCooldownMs(): number {
  return config.attackCooldownMs;
}

loadBotConfig();
