import { Router, type IRouter } from "express";
import fs   from "fs";
import path from "path";

const router: IRouter = Router();

const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN ?? "";
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID ?? "1493775313749151754";
const DISCORD_API_V10 = "https://discord.com/api/v10";
const DISCORD_API_V9  = "https://discord.com/api/v9";

// ── Account store (JSON file persistence) ─────────────────────────────────────
const DATA_DIR      = path.join(import.meta.dirname, "..", "..", "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "discord-accounts.json");

interface StoredAccount {
  id:            string;
  username:      string;
  discriminator: string;
  avatar:        string | null;
  token:         string;
  email?:        string;
  addedAt:       number;
  status:        "ok" | "invalid" | "unknown";
  createdAuto?:  boolean;
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

// ── Generic helpers ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function botHeaders() {
  return { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" };
}

function userHeaders(token: string) {
  return {
    Authorization: token,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "X-Super-Properties": Buffer.from(JSON.stringify({
      os: "Windows", browser: "Chrome", device: "",
      system_locale: "en-US", browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      browser_version: "124.0.0.0", os_version: "10",
      release_channel: "stable", client_build_number: 300000,
    })).toString("base64"),
    "X-Discord-Locale": "en-US",
    "X-Discord-Timezone": "America/Sao_Paulo",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://discord.com",
    "Referer": "https://discord.com/register",
  };
}

function registerHeaders(fingerprint: string) {
  return {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "X-Super-Properties": Buffer.from(JSON.stringify({
      os: "Windows", browser: "Chrome", device: "",
      system_locale: "en-US", browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      browser_version: "124.0.0.0", os_version: "10",
      release_channel: "stable", client_build_number: 300000,
    })).toString("base64"),
    "X-Fingerprint": fingerprint,
    "X-Discord-Locale": "en-US",
    "X-Discord-Timezone": "America/Sao_Paulo",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://discord.com",
    "Referer": "https://discord.com/register",
  };
}

async function fetchUserInfo(token: string): Promise<{
  id: string; username: string; discriminator: string; avatar: string | null;
} | null> {
  try {
    const r = await fetch(`${DISCORD_API_V10}/users/@me`, { headers: userHeaders(token) });
    if (!r.ok) return null;
    return await r.json() as { id: string; username: string; discriminator: string; avatar: string | null };
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════════════════
//  TEMP-MAIL helpers (1secmail)
// ══════════════════════════════════════════════════════════════════════════════
const SECMAIL_DOMAINS = ["1secmail.com", "1secmail.net", "1secmail.org", "kzccv.com", "qiott.com", "wwjmp.com"];

async function getTempEmail(): Promise<{ login: string; domain: string; full: string } | null> {
  try {
    const r = await fetch("https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const arr = await r.json() as string[];
    const full = arr[0];
    const [login, domain] = full.split("@");
    return { login, domain, full };
  } catch {
    // fallback: generate manually
    const login  = "user" + Math.random().toString(36).slice(2, 10);
    const domain = SECMAIL_DOMAINS[Math.floor(Math.random() * SECMAIL_DOMAINS.length)];
    return { login, domain, full: `${login}@${domain}` };
  }
}

async function waitForDiscordEmail(
  login: string, domain: string, maxWaitMs = 90_000
): Promise<string | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(4000);
    try {
      const r = await fetch(`https://www.1secmail.com/api/v1/?action=getMessages&login=${login}&domain=${domain}`);
      if (!r.ok) continue;
      const msgs = await r.json() as Array<{ id: number; from: string; subject: string }>;
      const dMail = msgs.find(m => m.from.includes("discord") || m.subject.toLowerCase().includes("discord") || m.subject.toLowerCase().includes("verify"));
      if (!dMail) continue;

      // Get mail body
      const mr = await fetch(`https://www.1secmail.com/api/v1/?action=readMessage&login=${login}&domain=${domain}&id=${dMail.id}`);
      if (!mr.ok) continue;
      const mail = await mr.json() as { body?: string; htmlBody?: string };
      const body = mail.htmlBody ?? mail.body ?? "";

      // Extract verify token — Discord uses links like:
      // https://click.discord.com/ls/click?...  or
      // https://discord.com/verify#token=xxx
      const tokenMatch = body.match(/verify#token=([A-Za-z0-9._-]+)/);
      if (tokenMatch) return tokenMatch[1];

      // Some Discord emails have a direct /api/v9/auth/verify endpoint link
      const linkMatch = body.match(/https?:\/\/[^"'\s]+(?:verify|confirm)[^"'\s]*/i);
      if (linkMatch) return linkMatch[0];
    } catch { /* retry */ }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
//  CAPTCHA SOLVER helpers
// ══════════════════════════════════════════════════════════════════════════════
const DISCORD_HCAPTCHA_SITEKEY = "a9b5fb07-92ff-493f-86fe-352a2803b3df";

async function solveCaptcha2captcha(
  apiKey: string, sitekey: string, pageUrl: string, rqdata?: string
): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      key: apiKey, method: "hcaptcha", sitekey, pageurl: pageUrl, json: "1",
      ...(rqdata ? { data: rqdata } : {}),
    });
    const r = await fetch("https://2captcha.com/in.php", { method: "POST", body });
    const d = await r.json() as { status: number; request: string };
    if (d.status !== 1) return null;
    const id = d.request;

    // Poll for solution (up to 120s)
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const p = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${id}&json=1`);
      const pd = await p.json() as { status: number; request: string };
      if (pd.status === 1) return pd.request;
      if (pd.request !== "CAPCHA_NOT_READY") return null;
    }
    return null;
  } catch { return null; }
}

async function solveCaptchaCapmonster(
  apiKey: string, sitekey: string, pageUrl: string, rqdata?: string
): Promise<string | null> {
  try {
    const taskBody: Record<string, unknown> = {
      type: "HCaptchaTaskProxyless",
      websiteURL: pageUrl,
      websiteKey: sitekey,
    };
    if (rqdata) taskBody["data"] = rqdata;

    const r = await fetch("https://api.capmonster.cloud/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, task: taskBody }),
    });
    const d = await r.json() as { taskId?: number; errorId?: number };
    if (!d.taskId) return null;

    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const p = await fetch("https://api.capmonster.cloud/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId: d.taskId }),
      });
      const pd = await p.json() as { status?: string; solution?: { gRecaptchaResponse?: string } };
      if (pd.status === "ready") return pd.solution?.gRecaptchaResponse ?? null;
      if (pd.status === "failed") return null;
    }
    return null;
  } catch { return null; }
}

async function solveCaptcha(
  service: string, apiKey: string, sitekey: string, pageUrl: string, rqdata?: string
): Promise<string | null> {
  if (service === "capmonster") return solveCaptchaCapmonster(apiKey, sitekey, pageUrl, rqdata);
  return solveCaptcha2captcha(apiKey, sitekey, pageUrl, rqdata);
}

// ══════════════════════════════════════════════════════════════════════════════
//  DISCORD FINGERPRINT
// ══════════════════════════════════════════════════════════════════════════════
async function getDiscordFingerprint(): Promise<string | null> {
  try {
    const r = await fetch(`${DISCORD_API_V9}/experiments`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://discord.com/register",
        "Origin": "https://discord.com",
      },
    });
    if (!r.ok) return null;
    const d = await r.json() as { fingerprint?: string };
    return d.fingerprint ?? null;
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════════════════
//  RANDOM DATA GENERATORS
// ══════════════════════════════════════════════════════════════════════════════
const ADJ  = ["cool","fast","dark","blue","red","gold","epic","wild","bold","iron","sage","storm","blade","sky","neo","cyber","pixel","echo","ghost","nova"];
const NOUN = ["wolf","fox","hawk","bear","lion","dragon","knight","wizard","raven","cobra","tiger","eagle","viper","panda","lynx","falcon","orca","mantis","phoenix","crow"];

function randomUsername(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${a}${n}${num}`;
}

function randomPassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";
  let pw = "";
  for (let i = 0; i < 16; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

function randomDOB(): string {
  const year  = 1990 + Math.floor(Math.random() * 20); // 1990-2009 (14-33 yo)
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const day   = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ── Error extraction from Discord API responses ───────────────────────────────
function extractDiscordError(body: Record<string, unknown>, httpStatus: number): string {
  // Field-specific errors like { "email": { "_errors": [{ "message": "..." }] } }
  const fieldErrors: string[] = [];
  for (const key of ["email", "username", "password", "date_of_birth"]) {
    const fieldErr = body[key] as { _errors?: Array<{ message: string }> } | undefined;
    if (fieldErr?._errors?.[0]?.message) fieldErrors.push(`${key}: ${fieldErr._errors[0].message}`);
  }
  if (fieldErrors.length) return fieldErrors.join(", ");

  // Top-level message
  if (typeof body.message === "string") return body.message;

  // captcha info
  if (body.captcha_key) return "captcha-required";

  // Errors array
  if (Array.isArray(body.errors)) return String(body.errors[0]);

  return `HTTP ${httpStatus}`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  SINGLE ACCOUNT CREATION
// ══════════════════════════════════════════════════════════════════════════════
interface CreateResult {
  status:   "ok" | "error" | "captcha_needed";
  username?: string;
  email?:   string;
  token?:   string;
  detail:   string;
}

async function createOneAccount(
  captchaService: string, captchaApiKey: string
): Promise<CreateResult> {
  // 1. Get temp email
  const mail = await getTempEmail();
  if (!mail) return { status: "error", detail: "Falha ao obter email temporário" };

  // 2. Get fingerprint
  const fingerprint = await getDiscordFingerprint();
  if (!fingerprint) return { status: "error", detail: "Falha ao obter fingerprint do Discord" };

  const username = randomUsername();
  const password = randomPassword();
  const dob      = randomDOB();

  const registerPayload: Record<string, unknown> = {
    username,
    email:         mail.full,
    password,
    date_of_birth: dob,
    consent:       true,
  };

  // 3. First registration attempt (may trigger captcha)
  const attempt1 = await fetch(`${DISCORD_API_V9}/auth/register`, {
    method: "POST",
    headers: registerHeaders(fingerprint),
    body: JSON.stringify(registerPayload),
  });

  const body1 = await attempt1.json() as Record<string, unknown>;

  // Token returned on first try (clean residential IP)
  if (body1.token && typeof body1.token === "string") {
    return { status: "ok", token: body1.token as string, username, email: mail.full, detail: "Conta criada (sem captcha)" };
  }

  // Captcha required
  const captchaKeys = body1.captcha_key as string[] | string | undefined;
  const isCaptchaNeeded = Array.isArray(captchaKeys)
    ? captchaKeys.some(k => k === "captcha-required" || k.startsWith("captcha"))
    : typeof captchaKeys === "string" && captchaKeys.includes("captcha");

  if (isCaptchaNeeded || body1.captcha_sitekey) {
    if (!captchaApiKey) {
      return { status: "captcha_needed", username, email: mail.full, detail: "Captcha necessário — configure a API key de captcha" };
    }

    const sitekey = (body1.captcha_sitekey as string | undefined) ?? DISCORD_HCAPTCHA_SITEKEY;
    const rqdata  = body1.captcha_rqdata as string | undefined;

    const captchaSolution = await solveCaptcha(captchaService, captchaApiKey, sitekey, "https://discord.com/register", rqdata);
    if (!captchaSolution) return { status: "error", username, email: mail.full, detail: "Falha ao resolver captcha" };

    // 4. Retry registration with captcha solution
    const attempt2 = await fetch(`${DISCORD_API_V9}/auth/register`, {
      method: "POST",
      headers: registerHeaders(fingerprint),
      body: JSON.stringify({ ...registerPayload, captcha_key: captchaSolution }),
    });

    const body2 = await attempt2.json() as Record<string, unknown>;

    if (body2.token && typeof body2.token === "string") {
      return { status: "ok", token: body2.token as string, username, email: mail.full, detail: "Conta criada (captcha resolvido)" };
    }

    const errMsg2 = extractDiscordError(body2, attempt2.status);
    return { status: "error", username, email: mail.full, detail: `Registro falhou: ${errMsg2}` };
  }

  // Other error (username taken, rate limit, etc.)
  const errMsg = extractDiscordError(body1, attempt1.status);
  return { status: "error", username, email: mail.full, detail: `Registro falhou: ${errMsg}` };
}

// ══════════════════════════════════════════════════════════════════════════════
//  BOT ENDPOINTS (existing)
// ══════════════════════════════════════════════════════════════════════════════

router.get("/discord/guilds", async (_req, res) => {
  try {
    if (!BOT_TOKEN) { res.status(503).json({ error: "DISCORD_BOT_TOKEN not configured" }); return; }
    const r = await fetch(`${DISCORD_API_V10}/users/@me/guilds`, { headers: botHeaders() });
    if (!r.ok) { res.status(r.status).json({ error: `Discord API error: ${r.status}` }); return; }
    const guilds = await r.json() as Array<{ id: string; name: string; icon: string | null; owner: boolean; permissions: string }>;
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
    const r = await fetch(`${DISCORD_API_V10}/users/@me/guilds/${id}`, { method: "DELETE", headers: botHeaders() });
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

// GET /api/discord/accounts
router.get("/discord/accounts", (_req, res) => {
  const accounts = readAccounts().map(a => ({ ...a, token: a.token.slice(0, 10) + "…" }));
  res.json({ accounts });
});

// POST /api/discord/accounts — add token(s) manually
router.post("/discord/accounts", async (req, res) => {
  const body   = req.body as { tokens?: string | string[] };
  const raw    = Array.isArray(body.tokens) ? body.tokens : String(body.tokens ?? "").split(/[\n,;]+/);
  const tokens = raw.map(t => t.trim()).filter(Boolean);

  if (!tokens.length) { res.status(400).json({ error: "Nenhum token fornecido" }); return; }

  const existing = readAccounts();
  const results: Array<{ token: string; status: string; username?: string; id?: string }> = [];

  for (const token of tokens) {
    if (existing.find(a => a.token === token)) {
      results.push({ token: token.slice(0, 10) + "…", status: "duplicate" }); continue;
    }
    const info = await fetchUserInfo(token);
    if (!info) {
      existing.push({ id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`, username: "Token inválido", discriminator: "0000", avatar: null, token, addedAt: Date.now(), status: "invalid" });
      results.push({ token: token.slice(0, 10) + "…", status: "invalid" });
    } else {
      existing.push({ ...info, token, addedAt: Date.now(), status: "ok" });
      results.push({ token: token.slice(0, 10) + "…", status: "ok", username: info.username, id: info.id });
    }
    await sleep(500);
  }

  writeAccounts(existing);
  res.json({ added: results.filter(r => r.status !== "duplicate").length, results });
});

// DELETE /api/discord/accounts/:id
router.delete("/discord/accounts/:id", (req, res) => {
  writeAccounts(readAccounts().filter(a => a.id !== req.params.id));
  res.json({ ok: true });
});

// POST /api/discord/accounts/verify — re-verify all accounts
router.post("/discord/accounts/verify", async (_req, res) => {
  const list = readAccounts();
  for (const acc of list) {
    const info = await fetchUserInfo(acc.token);
    if (info) { acc.status = "ok"; acc.username = info.username; acc.discriminator = info.discriminator; acc.avatar = info.avatar; }
    else acc.status = "invalid";
    await sleep(400);
  }
  writeAccounts(list);
  res.json({ ok: true, accounts: list.map(a => ({ ...a, token: a.token.slice(0, 10) + "…" })) });
});

// ══════════════════════════════════════════════════════════════════════════════
//  AUTO ACCOUNT CREATION
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/discord/accounts/create
// body: { count, captchaService, captchaApiKey, delay }
router.post("/discord/accounts/create", async (req, res) => {
  const {
    count          = 1,
    captchaService = "2captcha",
    captchaApiKey  = "",
    delay          = 3000,
  } = req.body as { count?: number; captchaService?: string; captchaApiKey?: string; delay?: number };

  const safeCount = Math.max(1, Math.min(count, 20));
  const safeDelay = Math.max(2000, delay);

  const existing = readAccounts();
  const results: Array<CreateResult & { saved: boolean }> = [];

  for (let i = 0; i < safeCount; i++) {
    const result = await createOneAccount(captchaService, captchaApiKey.trim());
    let saved = false;

    if (result.status === "ok" && result.token) {
      // Verify & get full user info
      const info = await fetchUserInfo(result.token);
      const acc: StoredAccount = {
        id:            info?.id ?? `auto_${Date.now()}`,
        username:      info?.username ?? result.username ?? "unknown",
        discriminator: info?.discriminator ?? "0",
        avatar:        info?.avatar ?? null,
        token:         result.token,
        email:         result.email,
        addedAt:       Date.now(),
        status:        info ? "ok" : "unknown",
        createdAuto:   true,
      };
      existing.push(acc);
      writeAccounts(existing);
      saved = true;
    }

    results.push({ ...result, saved });

    if (i < safeCount - 1) await sleep(safeDelay);
  }

  const created = results.filter(r => r.saved).length;
  res.json({ created, total: safeCount, results: results.map(r => ({ ...r, token: r.token ? r.token.slice(0, 10) + "…" : undefined })) });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ACCOUNT ACTIONS — JOIN SERVER
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/discord/accounts/join
router.post("/discord/accounts/join", async (req, res) => {
  const { accountIds, inviteCode, delay = 1500 } = req.body as {
    accountIds: string[]; inviteCode: string; delay?: number;
  };

  if (!accountIds?.length) { res.status(400).json({ error: "Nenhuma conta selecionada" }); return; }
  const code = (inviteCode ?? "").trim().replace(/^https?:\/\/discord\.(gg|com\/invite)\//, "");
  if (!code) { res.status(400).json({ error: "Código de convite inválido" }); return; }

  const all      = readAccounts();
  const selected = all.filter(a => accountIds.includes(a.id) && a.status === "ok");
  if (!selected.length) { res.status(400).json({ error: "Nenhuma conta válida selecionada" }); return; }

  const results: Array<{ id: string; username: string; status: string; detail: string }> = [];

  for (const acc of selected) {
    try {
      const r = await fetch(`${DISCORD_API_V10}/invites/${code}`, {
        method: "POST",
        headers: { ...userHeaders(acc.token), "Content-Length": "2" },
        body: "{}",
      });
      const text = await r.text();
      let guildName = "";
      try { guildName = (JSON.parse(text) as { guild?: { name?: string } }).guild?.name ?? ""; } catch { /**/ }

      if (r.status === 200) {
        results.push({ id: acc.id, username: acc.username, status: "ok", detail: guildName ? `Entrou: ${guildName}` : "Entrou com sucesso" });
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
router.post("/discord/accounts/message", async (req, res) => {
  const { accountIds, channelId, message, count = 1, delay = 2000 } = req.body as {
    accountIds: string[]; channelId: string; message: string; count?: number; delay?: number;
  };

  if (!accountIds?.length) { res.status(400).json({ error: "Nenhuma conta selecionada" }); return; }
  if (!channelId?.trim())  { res.status(400).json({ error: "ID do canal inválido" }); return; }
  if (!message?.trim())    { res.status(400).json({ error: "Mensagem vazia" }); return; }

  const safeCount = Math.max(1, Math.min(count, 50));
  const safeDelay = Math.max(500, Math.min(delay, 30_000));

  const all      = readAccounts();
  const selected = all.filter(a => accountIds.includes(a.id) && a.status === "ok");
  if (!selected.length) { res.status(400).json({ error: "Nenhuma conta válida selecionada" }); return; }

  const results: Array<{ username: string; sent: number; errors: number; lastError?: string }> = [];

  for (const acc of selected) {
    let sent = 0, errors = 0, lastError: string | undefined;
    for (let i = 0; i < safeCount; i++) {
      try {
        const r = await fetch(`${DISCORD_API_V10}/channels/${channelId}/messages`, {
          method: "POST", headers: userHeaders(acc.token),
          body: JSON.stringify({ content: message }),
        });
        if (r.status === 200 || r.status === 201) { sent++; }
        else {
          errors++;
          try { lastError = ((await r.json()) as { message?: string }).message ?? `HTTP ${r.status}`; }
          catch { lastError = `HTTP ${r.status}`; }
        }
      } catch (e) { errors++; lastError = String(e).slice(0, 80); }
      if (i < safeCount - 1) await sleep(safeDelay);
    }
    results.push({ username: acc.username, sent, errors, lastError });
    if (selected.indexOf(acc) < selected.length - 1) await sleep(safeDelay);
  }

  res.json({ ok: true, results });
});

// POST /api/discord/accounts/dm-channel
router.post("/discord/accounts/dm-channel", async (req, res) => {
  const { accountId, targetUserId } = req.body as { accountId: string; targetUserId: string };
  const acc = readAccounts().find(a => a.id === accountId && a.status === "ok");
  if (!acc) { res.status(404).json({ error: "Conta não encontrada" }); return; }
  try {
    const r = await fetch(`${DISCORD_API_V10}/users/@me/channels`, {
      method: "POST", headers: userHeaders(acc.token),
      body: JSON.stringify({ recipient_id: targetUserId }),
    });
    const data = await r.json() as { id?: string; message?: string };
    if (!r.ok) { res.status(r.status).json({ error: data.message ?? `HTTP ${r.status}` }); return; }
    res.json({ channelId: data.id });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

export default router;
