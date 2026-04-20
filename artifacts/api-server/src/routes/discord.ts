import { Router, type IRouter } from "express";
import fs   from "fs";
import path from "path";

const router: IRouter = Router();

const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN ?? "";
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID ?? "1493775313749151754";
const DISCORD_API    = "https://discord.com/api/v10";

// ── Account store (JSON file persistence) ─────────────────────────────────────
const DATA_DIR      = path.join(import.meta.dirname, "..", "..", "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "discord-accounts.json");

interface StoredAccount {
  id:          string;    // Discord user ID
  username:    string;
  discriminator: string;
  avatar:      string | null;
  token:       string;
  addedAt:     number;    // unix ms
  status:      "ok" | "invalid" | "unknown";
}

function readAccounts(): StoredAccount[] {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8")) as StoredAccount[];
  } catch { return []; }
}

function writeAccounts(list: StoredAccount[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function botHeaders() {
  return { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" };
}

function userHeaders(token: string) {
  return {
    Authorization: token,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "X-Super-Properties": Buffer.from(JSON.stringify({
      os: "Windows", browser: "Chrome", device: "",
      system_locale: "en-US", browser_user_agent: "Chrome/124",
      browser_version: "124.0.0.0", os_version: "10",
      release_channel: "stable", client_build_number: 300000,
    })).toString("base64"),
    "X-Discord-Locale": "en-US",
  };
}

async function fetchUserInfo(token: string): Promise<{
  id: string; username: string; discriminator: string; avatar: string | null;
} | null> {
  try {
    const r = await fetch(`${DISCORD_API}/users/@me`, {
      headers: userHeaders(token),
    });
    if (!r.ok) return null;
    const d = await r.json() as { id: string; username: string; discriminator: string; avatar: string | null };
    return d;
  } catch { return null; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ══════════════════════════════════════════════════════════════════════════════
//  BOT ENDPOINTS (existing)
// ══════════════════════════════════════════════════════════════════════════════

router.get("/discord/guilds", async (_req, res) => {
  try {
    if (!BOT_TOKEN) { res.status(503).json({ error: "DISCORD_BOT_TOKEN not configured" }); return; }
    const r = await fetch(`${DISCORD_API}/users/@me/guilds`, { headers: botHeaders() });
    if (!r.ok) { res.status(r.status).json({ error: `Discord API error: ${r.status}` }); return; }
    const guilds = await r.json() as Array<{
      id: string; name: string; icon: string | null; owner: boolean; permissions: string;
    }>;
    const result = guilds.map(g => ({
      id: g.id, name: g.name,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
      memberCount: null,
    }));
    res.json({ guilds: result, applicationId: APPLICATION_ID });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.delete("/discord/guilds/:id", async (req, res) => {
  try {
    if (!BOT_TOKEN) { res.status(503).json({ error: "DISCORD_BOT_TOKEN not configured" }); return; }
    const { id } = req.params;
    const r = await fetch(`${DISCORD_API}/users/@me/guilds/${id}`, { method: "DELETE", headers: botHeaders() });
    if (r.status === 204 || r.status === 200) { res.json({ ok: true }); return; }
    const body = await r.text();
    res.status(r.status).json({ error: `Discord API error: ${r.status}`, detail: body });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/discord/invite-link", (_req, res) => {
  const url = `https://discord.com/oauth2/authorize?client_id=${APPLICATION_ID}&permissions=8&scope=bot%20applications.commands`;
  res.json({ url, applicationId: APPLICATION_ID });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ACCOUNT MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/discord/accounts — list all accounts (without token)
router.get("/discord/accounts", (_req, res) => {
  const accounts = readAccounts().map(a => ({ ...a, token: a.token.slice(0, 10) + "…" }));
  res.json({ accounts });
});

// POST /api/discord/accounts — add one or more tokens
router.post("/discord/accounts", async (req, res) => {
  const body  = req.body as { tokens?: string | string[] };
  const raw   = Array.isArray(body.tokens)
    ? body.tokens
    : String(body.tokens ?? "").split(/[\n,;]+/);
  const tokens = raw.map(t => t.trim()).filter(Boolean);

  if (!tokens.length) { res.status(400).json({ error: "Nenhum token fornecido" }); return; }

  const existing = readAccounts();
  const results: Array<{ token: string; status: string; username?: string; id?: string }> = [];

  for (const token of tokens) {
    const alreadyHas = existing.find(a => a.token === token);
    if (alreadyHas) { results.push({ token: token.slice(0, 10) + "…", status: "duplicate", username: alreadyHas.username, id: alreadyHas.id }); continue; }

    const info = await fetchUserInfo(token);
    if (!info) {
      existing.push({ id: `unknown_${Date.now()}`, username: "Token inválido", discriminator: "0000", avatar: null, token, addedAt: Date.now(), status: "invalid" });
      results.push({ token: token.slice(0, 10) + "…", status: "invalid" });
    } else {
      const acc: StoredAccount = { ...info, token, addedAt: Date.now(), status: "ok" };
      existing.push(acc);
      results.push({ token: token.slice(0, 10) + "…", status: "ok", username: info.username, id: info.id });
    }
    await sleep(500);
  }

  writeAccounts(existing);
  res.json({ added: results.filter(r => r.status !== "duplicate").length, results });
});

// DELETE /api/discord/accounts/:id — remove account by ID
router.delete("/discord/accounts/:id", (req, res) => {
  const list = readAccounts().filter(a => a.id !== req.params.id);
  writeAccounts(list);
  res.json({ ok: true });
});

// POST /api/discord/accounts/verify — re-verify status of all (or selected) accounts
router.post("/discord/accounts/verify", async (_req, res) => {
  const list = readAccounts();
  for (const acc of list) {
    const info = await fetchUserInfo(acc.token);
    if (info) {
      acc.status = "ok";
      acc.username = info.username;
      acc.discriminator = info.discriminator;
      acc.avatar = info.avatar;
    } else {
      acc.status = "invalid";
    }
    await sleep(400);
  }
  writeAccounts(list);
  res.json({ ok: true, accounts: list.map(a => ({ ...a, token: a.token.slice(0, 10) + "…" })) });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ACCOUNT ACTIONS — JOIN SERVER
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/discord/accounts/join
// body: { accountIds: string[], inviteCode: string, delay?: number }
router.post("/discord/accounts/join", async (req, res) => {
  const { accountIds, inviteCode, delay = 1500 } = req.body as {
    accountIds: string[]; inviteCode: string; delay?: number;
  };

  if (!accountIds?.length) { res.status(400).json({ error: "Nenhuma conta selecionada" }); return; }
  const code = (inviteCode ?? "").trim().replace(/^https?:\/\/discord\.(gg|com\/invite)\//, "");
  if (!code) { res.status(400).json({ error: "Código de convite inválido" }); return; }

  const all = readAccounts();
  const selected = all.filter(a => accountIds.includes(a.id) && a.status === "ok");
  if (!selected.length) { res.status(400).json({ error: "Nenhuma conta válida selecionada" }); return; }

  const results: Array<{ id: string; username: string; status: string; detail: string }> = [];

  for (const acc of selected) {
    try {
      const r = await fetch(`${DISCORD_API}/invites/${code}`, {
        method: "POST",
        headers: { ...userHeaders(acc.token), "Content-Length": "0" },
        body: "{}",
      });
      const text = await r.text();
      let guildName = "";
      try { guildName = (JSON.parse(text) as { guild?: { name?: string } }).guild?.name ?? ""; } catch { /**/ }

      if (r.status === 200) {
        results.push({ id: acc.id, username: acc.username, status: "ok", detail: guildName ? `Entrou em: ${guildName}` : "Entrou com sucesso" });
      } else if (r.status === 204) {
        results.push({ id: acc.id, username: acc.username, status: "ok", detail: "Entrou com sucesso" });
      } else {
        let errMsg = `HTTP ${r.status}`;
        try { errMsg = (JSON.parse(text) as { message?: string }).message ?? errMsg; } catch { /**/ }
        results.push({ id: acc.id, username: acc.username, status: "error", detail: errMsg });
      }
    } catch (e) {
      results.push({ id: acc.id, username: acc.username, status: "error", detail: String(e).slice(0, 80) });
    }
    if (selected.indexOf(acc) < selected.length - 1) await sleep(delay);
  }

  res.json({ ok: true, results });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ACCOUNT ACTIONS — SEND MESSAGE
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/discord/accounts/message
// body: { accountIds, channelId, message, count?, delay? }
router.post("/discord/accounts/message", async (req, res) => {
  const { accountIds, channelId, message, count = 1, delay = 2000 } = req.body as {
    accountIds: string[]; channelId: string; message: string; count?: number; delay?: number;
  };

  if (!accountIds?.length) { res.status(400).json({ error: "Nenhuma conta selecionada" }); return; }
  if (!channelId?.trim())  { res.status(400).json({ error: "ID do canal inválido" }); return; }
  if (!message?.trim())    { res.status(400).json({ error: "Mensagem vazia" }); return; }

  const safeCount = Math.max(1, Math.min(count, 50));
  const safeDelay = Math.max(500, Math.min(delay, 30_000));

  const all = readAccounts();
  const selected = all.filter(a => accountIds.includes(a.id) && a.status === "ok");
  if (!selected.length) { res.status(400).json({ error: "Nenhuma conta válida selecionada" }); return; }

  const results: Array<{ username: string; sent: number; errors: number; lastError?: string }> = [];

  for (const acc of selected) {
    let sent = 0, errors = 0, lastError: string | undefined;
    for (let i = 0; i < safeCount; i++) {
      try {
        const r = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
          method: "POST",
          headers: userHeaders(acc.token),
          body: JSON.stringify({ content: message }),
        });
        if (r.status === 200 || r.status === 201) { sent++; }
        else {
          errors++;
          try { lastError = ((await r.json()) as { message?: string }).message ?? `HTTP ${r.status}`; } catch { lastError = `HTTP ${r.status}`; }
        }
      } catch (e) { errors++; lastError = String(e).slice(0, 80); }
      if (i < safeCount - 1) await sleep(safeDelay);
    }
    results.push({ username: acc.username, sent, errors, lastError });
    if (selected.indexOf(acc) < selected.length - 1) await sleep(safeDelay);
  }

  res.json({ ok: true, results });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ACCOUNT ACTIONS — GET DM CHANNEL
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/discord/accounts/dm-channel
// body: { accountId, targetUserId }
router.post("/discord/accounts/dm-channel", async (req, res) => {
  const { accountId, targetUserId } = req.body as { accountId: string; targetUserId: string };
  const acc = readAccounts().find(a => a.id === accountId && a.status === "ok");
  if (!acc) { res.status(404).json({ error: "Conta não encontrada" }); return; }
  try {
    const r = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: "POST",
      headers: userHeaders(acc.token),
      body: JSON.stringify({ recipient_id: targetUserId }),
    });
    const data = await r.json() as { id?: string; message?: string };
    if (!r.ok) { res.status(r.status).json({ error: data.message ?? `HTTP ${r.status}` }); return; }
    res.json({ channelId: data.id });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

export default router;
