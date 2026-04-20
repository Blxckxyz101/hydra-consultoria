import { Router, type IRouter } from "express";
import fs   from "fs";
import path from "path";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { solveHCaptchaWithAI } from "../services/hcaptcha-ai-solver.js";
import { getResidentialCreds } from "./proxies.js";

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
  password?:     string;
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

// ── Proxy-aware fetch ──────────────────────────────────────────────────────────
type FetchLike = (url: string, opts?: RequestInit) => Promise<Response>;

function makeFetch(proxyUrl?: string): FetchLike {
  if (!proxyUrl) return (u, o) => fetch(u, o);
  const agent = new ProxyAgent(proxyUrl);
  return (u, o) => undiciFetch(u, { ...(o as object), dispatcher: agent }) as Promise<Response>;
}

// ── Generic helpers ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const DISCORD_UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const SUPER_PROPS  = Buffer.from(JSON.stringify({
  os: "Windows", browser: "Chrome", device: "",
  system_locale: "en-US",
  browser_user_agent: DISCORD_UA,
  browser_version: "136.0.0.0",
  os_version: "10",
  release_channel: "stable",
  client_build_number: 531702,
  client_event_source: null,
})).toString("base64");

function botHeaders() {
  return { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" };
}

function userHeaders(token: string) {
  return {
    Authorization: token,
    "Content-Type": "application/json",
    "User-Agent": DISCORD_UA,
    "X-Super-Properties": SUPER_PROPS,
    "X-Discord-Locale": "en-US",
    "X-Discord-Timezone": "America/Sao_Paulo",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://discord.com",
    "Referer": "https://discord.com/channels/@me",
  };
}

function registerHeaders(fingerprint: string) {
  return {
    "Content-Type": "application/json",
    "User-Agent": DISCORD_UA,
    "X-Super-Properties": SUPER_PROPS,
    "X-Fingerprint": fingerprint,
    "X-Discord-Locale": "en-US",
    "X-Discord-Timezone": "America/Sao_Paulo",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://discord.com",
    "Referer": "https://discord.com/register",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
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
//  TEMP-MAIL helpers
// ══════════════════════════════════════════════════════════════════════════════
const SECMAIL_DOMAINS = ["1secmail.com", "1secmail.net", "1secmail.org", "kzccv.com", "qiott.com", "wwjmp.com"];
// GuerrillaEmail domains (accepted by Discord, API publicly accessible)
const GUERRILLA_DOMAINS = ["sharklasers.com", "guerrillamail.info", "grr.la", "guerrillamail.biz", "guerrillamail.de", "guerrillamail.net", "guerrillamail.org", "spam4.me"];

// GuerrillaEmail session state (needed for inbox polling)
let guerrillaSidToken: string | null = null;

async function getTempEmail(): Promise<{ login: string; domain: string; full: string; sidToken?: string } | null> {
  // Primary: GuerrillaEmail (publicly accessible from server IPs)
  try {
    const r = await fetch("https://api.guerrillamail.com/ajax.php?f=get_email_address", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; tempmail/1.0)" },
    });
    if (r.ok) {
      const d = await r.json() as { email_addr?: string; sid_token?: string };
      if (d.email_addr && d.sid_token) {
        const [login, domain] = d.email_addr.split("@");
        guerrillaSidToken = d.sid_token;
        return { login, domain, full: d.email_addr, sidToken: d.sid_token };
      }
    }
  } catch { /* fall through */ }

  // Secondary: 1secmail API
  try {
    const r = await fetch("https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1");
    if (r.ok) {
      const arr = await r.json() as string[];
      const full = arr[0];
      if (full?.includes("@")) {
        const [login, domain] = full.split("@");
        return { login, domain, full };
      }
    }
  } catch { /* fall through */ }

  // Fallback: generate manually (random from known valid domains)
  const allDomains = [...GUERRILLA_DOMAINS, ...SECMAIL_DOMAINS];
  const login  = "user" + Math.random().toString(36).slice(2, 12);
  const domain = allDomains[Math.floor(Math.random() * allDomains.length)];
  return { login, domain, full: `${login}@${domain}` };
}

function extractVerifyTokenFromBody(body: string): string | null {
  const tokenMatch = body.match(/verify#token=([A-Za-z0-9._-]+)/);
  if (tokenMatch) return tokenMatch[1];
  const linkMatch = body.match(/https?:\/\/[^"'\s]+(?:verify|confirm)[^"'\s]*/i);
  if (linkMatch) return linkMatch[0];
  return null;
}

const isGuerrillaEmail = (domain: string) =>
  ["sharklasers.com","guerrillamail.info","grr.la","guerrillamail.biz","guerrillamail.de","guerrillamail.net","guerrillamail.org","spam4.me","guerrillamailblock.com"].includes(domain);

async function waitForDiscordEmail(
  login: string, domain: string, maxWaitMs = 90_000, sidToken?: string
): Promise<string | null> {
  const deadline = Date.now() + maxWaitMs;
  const isGuerrilla = isGuerrillaEmail(domain);
  const token = sidToken ?? guerrillaSidToken;

  while (Date.now() < deadline) {
    await sleep(4000);
    try {
      if (isGuerrilla && token) {
        // GuerrillaEmail API
        const r = await fetch(`https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${token}`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; tempmail/1.0)" },
        });
        if (!r.ok) continue;
        const data = await r.json() as { list?: Array<{ mail_id: string; mail_from: string; mail_subject: string; mail_body?: string }> };
        const dMail = (data.list ?? []).find(m =>
          m.mail_from?.includes("discord") || m.mail_subject?.toLowerCase().includes("discord") ||
          m.mail_subject?.toLowerCase().includes("verify")
        );
        if (!dMail) continue;
        // Get full message body
        const mr = await fetch(`https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${dMail.mail_id}&sid_token=${token}`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; tempmail/1.0)" },
        });
        if (!mr.ok) continue;
        const mail = await mr.json() as { mail_body?: string };
        const result = extractVerifyTokenFromBody(mail.mail_body ?? dMail.mail_body ?? "");
        if (result) return result;
      } else {
        // 1secmail API
        const r = await fetch(`https://www.1secmail.com/api/v1/?action=getMessages&login=${login}&domain=${domain}`);
        if (!r.ok) continue;
        const msgs = await r.json() as Array<{ id: number; from: string; subject: string }>;
        const dMail = msgs.find(m =>
          m.from?.includes("discord") || m.subject?.toLowerCase().includes("discord") || m.subject?.toLowerCase().includes("verify")
        );
        if (!dMail) continue;
        const mr = await fetch(`https://www.1secmail.com/api/v1/?action=readMessage&login=${login}&domain=${domain}&id=${dMail.id}`);
        if (!mr.ok) continue;
        const mail = await mr.json() as { body?: string; htmlBody?: string };
        const result = extractVerifyTokenFromBody(mail.htmlBody ?? mail.body ?? "");
        if (result) return result;
      }
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
    const params: Record<string, string> = {
      key: apiKey, method: "hcaptcha", sitekey, pageurl: pageUrl, json: "1",
      userAgent: DISCORD_UA, enterprise: "1",
    };
    if (rqdata) params["data"] = rqdata;
    const body = new URLSearchParams(params);
    const r = await fetch("https://2captcha.com/in.php", { method: "POST", body });
    const d = await r.json() as { status: number; request: string };
    console.log(`[2captcha] submit status=${d.status} id=${d.request}`);
    if (d.status !== 1) {
      console.error(`[2captcha] submit failed: ${d.request}`);
      return null;
    }
    const id = d.request;

    // Poll for solution (up to 120s)
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const p = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${id}&json=1`);
      const pd = await p.json() as { status: number; request: string };
      if (pd.status === 1) {
        console.log(`[2captcha] solved after ${(i + 1) * 3}s`);
        return pd.request;
      }
      if (pd.request !== "CAPCHA_NOT_READY") {
        console.error(`[2captcha] poll error: ${pd.request}`);
        return null;
      }
    }
    console.error("[2captcha] timeout after 120s");
    return null;
  } catch (e) {
    console.error("[2captcha] error:", e);
    return null;
  }
}

async function solveCaptchaCapmonster(
  apiKey: string, sitekey: string, pageUrl: string, rqdata?: string
): Promise<string | null> {
  try {
    const taskBody: Record<string, unknown> = {
      type: "HCaptchaTaskProxyless",
      websiteURL: pageUrl,
      websiteKey: sitekey,
      userAgent: DISCORD_UA,
      isEnterprise: true,
    };
    if (rqdata) {
      taskBody["enterprisePayload"] = { rqdata };
    }

    const r = await fetch("https://api.capmonster.cloud/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, task: taskBody }),
    });
    const d = await r.json() as { taskId?: number; errorId?: number; errorCode?: string };
    console.log(`[capmonster] create taskId=${d.taskId} errorId=${d.errorId} errorCode=${d.errorCode}`);
    if (!d.taskId) return null;

    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const p = await fetch("https://api.capmonster.cloud/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId: d.taskId }),
      });
      const pd = await p.json() as { status?: string; solution?: { gRecaptchaResponse?: string }; errorCode?: string };
      if (pd.status === "ready") {
        console.log(`[capmonster] solved after ${(i + 1) * 3}s`);
        return pd.solution?.gRecaptchaResponse ?? null;
      }
      if (pd.status === "failed") {
        console.error(`[capmonster] failed: ${pd.errorCode}`);
        return null;
      }
    }
    console.error("[capmonster] timeout after 120s");
    return null;
  } catch (e) {
    console.error("[capmonster] error:", e);
    return null;
  }
}

async function solveCaptcha(
  service: string, apiKey: string, sitekey: string, pageUrl: string, rqdata?: string,
  proxyFetch?: FetchLike
): Promise<string | null> {
  if (service === "builtin") {
    const result = await solveHCaptchaWithAI(sitekey, pageUrl, rqdata, proxyFetch, 3);
    return result.token;
  }
  if (service === "capmonster") return solveCaptchaCapmonster(apiKey, sitekey, pageUrl, rqdata);
  return solveCaptcha2captcha(apiKey, sitekey, pageUrl, rqdata);
}

// ══════════════════════════════════════════════════════════════════════════════
//  DISCORD FINGERPRINT
// ══════════════════════════════════════════════════════════════════════════════
async function getDiscordFingerprint(pf?: FetchLike): Promise<string | null> {
  const doFetch = pf ?? fetch;
  try {
    const r = await doFetch(`${DISCORD_API_V9}/experiments`, {
      headers: {
        "User-Agent": DISCORD_UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Super-Properties": SUPER_PROPS,
        "X-Discord-Locale": "en-US",
        "Referer": "https://discord.com/register",
        "Origin": "https://discord.com",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
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
  // Rate limited
  if (httpStatus === 429 || body.retry_after !== undefined) {
    const retryAfter = typeof body.retry_after === "number" ? ` (aguarde ${Math.ceil(body.retry_after)}s)` : "";
    return `Rate limit de registro — IP bloqueado pelo Discord${retryAfter}. Use um proxy residencial.`;
  }

  // captcha info (check before field errors)
  if (body.captcha_key) return "captcha-required";

  // Field-specific errors (must check BEFORE top-level message)
  const errors = body.errors as Record<string, { _errors?: Array<{ code?: string; message: string }> }> | undefined;
  const fieldErrors: string[] = [];
  for (const key of ["email", "username", "password", "date_of_birth"]) {
    const fe = (errors?.[key] ?? body[key] as { _errors?: Array<{ code?: string; message: string }> } | undefined);
    if (fe?._errors?.[0]) {
      const e = fe._errors[0];
      fieldErrors.push(`${key}:${e.code ?? e.message}`);
    }
  }
  if (fieldErrors.length) return fieldErrors.join("|");

  // Top-level message
  if (typeof body.message === "string") return body.message;

  // Errors array
  if (Array.isArray(body.errors)) return String(body.errors[0]);

  return `HTTP ${httpStatus}`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  SINGLE ACCOUNT CREATION
// ══════════════════════════════════════════════════════════════════════════════
interface CreateResult {
  status:    "ok" | "error" | "captcha_needed";
  username?: string;
  email?:    string;
  password?: string;
  token?:    string;
  detail:    string;
}

async function createOneAccount(
  captchaService: string, captchaApiKey: string, proxyUrl?: string
): Promise<CreateResult> {
  const pf = makeFetch(proxyUrl);

  // 2. Get fingerprint (through same proxy so Discord sees consistent IP)
  const fingerprint = await getDiscordFingerprint(pf);
  if (!fingerprint) return { status: "error", detail: "Falha ao obter fingerprint do Discord" };

  const username = randomUsername();
  const password = randomPassword();
  const dob      = randomDOB();

  // Try up to 3 different emails if one is already registered
  for (let emailTry = 0; emailTry < 3; emailTry++) {
    // 1. Get temp email
    const mail = await getTempEmail();
    if (!mail) return { status: "error", detail: "Falha ao obter email temporário" };

    const registerPayload: Record<string, unknown> = {
      username,
      email:         mail.full,
      password,
      date_of_birth: dob,
      consent:       true,
    };

    // 3. First registration attempt (may trigger captcha)
    const attempt1 = await pf(`${DISCORD_API_V9}/auth/register`, {
      method: "POST",
      headers: registerHeaders(fingerprint),
      body: JSON.stringify(registerPayload),
    });

    const body1 = await attempt1.json() as Record<string, unknown>;
    console.log(`[register] attempt1 status=${attempt1.status} body=${JSON.stringify(body1).slice(0, 250)}`);

    // Token returned on first try (clean residential IP)
    if (body1.token && typeof body1.token === "string") {
      return { status: "ok", token: body1.token as string, username, email: mail.full, password, detail: "Conta criada (sem captcha)" };
    }

    // Retry with new email if this one is already registered
    const errCheck = extractDiscordError(body1, attempt1.status);
    if (errCheck.includes("EMAIL_ALREADY_REGISTERED")) {
      console.log(`[register] email ${mail.full} already registered, retrying with new email (try ${emailTry + 1}/3)`);
      continue;
    }

    // Captcha required
    const captchaKeys = body1.captcha_key as string[] | string | undefined;
    const isCaptchaNeeded = Array.isArray(captchaKeys)
      ? captchaKeys.some(k => k === "captcha-required" || k.startsWith("captcha"))
      : typeof captchaKeys === "string" && captchaKeys.includes("captcha");

    if (isCaptchaNeeded || body1.captcha_sitekey) {
      if (!captchaApiKey && captchaService !== "builtin") {
        return { status: "captcha_needed", username, email: mail.full, detail: "Captcha necessário — configure a API key de captcha ou use o solver de IA" };
      }

      const sitekey    = (body1.captcha_sitekey     as string | undefined) ?? DISCORD_HCAPTCHA_SITEKEY;
      const rqdata     = body1.captcha_rqdata       as string | undefined;
      const rqtoken    = body1.captcha_rqtoken      as string | undefined;
      const sessionId  = body1.captcha_session_id   as string | undefined;

      const captchaSolution = await solveCaptcha(captchaService, captchaApiKey, sitekey, "https://discord.com/register", rqdata, pf);
      if (!captchaSolution) return { status: "error", username, email: mail.full, detail: "Falha ao resolver captcha" };

      // 4. Retry registration with captcha solution + rqtoken + session_id
      const retryPayload: Record<string, unknown> = {
        ...registerPayload,
        captcha_key:        captchaSolution,
        captcha_rqtoken:    rqtoken ?? undefined,
        captcha_session_id: sessionId ?? undefined,
      };
      if (!rqtoken)   delete retryPayload.captcha_rqtoken;
      if (!sessionId) delete retryPayload.captcha_session_id;

      const attempt2 = await pf(`${DISCORD_API_V9}/auth/register`, {
        method: "POST",
        headers: registerHeaders(fingerprint),
        body: JSON.stringify(retryPayload),
      });

      const body2 = await attempt2.json() as Record<string, unknown>;
      console.log(`[register] attempt2 (post-captcha) status=${attempt2.status} body=${JSON.stringify(body2).slice(0, 200)}`);

      if (body2.token && typeof body2.token === "string") {
        return { status: "ok", token: body2.token as string, username, email: mail.full, password, detail: "Conta criada (captcha resolvido)" };
      }

      const errMsg2 = extractDiscordError(body2, attempt2.status);
      return { status: "error", username, email: mail.full, password, detail: `Registro falhou (pós-captcha): ${errMsg2}` };
    }

    // Other error (username taken, rate limit, etc.)
    const errMsg = extractDiscordError(body1, attempt1.status);
    return { status: "error", username, email: mail.full, password, detail: `Registro falhou: ${errMsg}` };
  }

  return { status: "error", detail: "Todas as tentativas de email falharam (já cadastrados)" };
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

// POST /api/discord/accounts/test-captcha
// Directly tests the AI captcha solver (no Discord proxy needed)
router.post("/discord/accounts/test-captcha", async (req, res) => {
  const { rqdata } = req.body as { rqdata?: string };
  try {
    const start = Date.now();
    const result = await solveHCaptchaWithAI(
      DISCORD_HCAPTCHA_SITEKEY,
      "https://discord.com/register",
      rqdata,
      undefined, // no proxy - go direct
      2,
    );
    const ms = Date.now() - start;
    if (result.token) {
      res.json({ ok: true, token: result.token.slice(0, 20) + "…", full_token: result.token, attempts: result.attempts, ms });
    } else {
      res.json({ ok: false, error: result.error, attempts: result.attempts, ms });
    }
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// GET /api/discord/accounts/free-proxy
// Fetches free proxies from public lists and tests them against Discord
router.get("/discord/accounts/free-proxy", async (_req, res) => {
  try {
    // Fetch from multiple sources
    const sources = [
      "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=elite",
      "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=BR,US,DE,NL,FR&ssl=all&anonymity=anonymous",
      "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt",
      "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=US&ssl=all&anonymity=elite",
    ];

    const allProxies: string[] = [];
    for (const src of sources) {
      try {
        const r = await fetch(src, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const txt = await r.text();
          const list = txt.split(/\r?\n/).map(l => {
            const t = l.trim();
            // Strip "http://" or "https://" prefix if present
            return t.replace(/^https?:\/\//, "");
          }).filter(l => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l));
          allProxies.push(...list);
        }
      } catch { /* ignore source failure */ }
    }

    if (!allProxies.length) {
      res.json({ ok: false, error: "Não foi possível buscar lista de proxies" });
      return;
    }

    // Deduplicate and limit to 50 for testing (more sources = more candidates)
    const candidates = [...new Set(allProxies)].slice(0, 50);

    // Test all concurrently against Discord's gateway
    const testProxy = async (proxy: string): Promise<string | null> => {
      const pf = makeFetch(`http://${proxy}`);
      try {
        const r = await pf("https://discord.com/api/v9/gateway", {
          headers: { "User-Agent": DISCORD_UA, "Accept": "application/json" },
          signal: AbortSignal.timeout(8000),
        } as RequestInit);
        if (!r.ok) return null;
        const d = await r.json() as { url?: string };
        return d.url ? proxy : null;
      } catch { return null; }
    };

    const results = await Promise.all(candidates.map(testProxy));
    const working = results.filter(Boolean) as string[];

    if (!working.length) {
      res.json({ ok: false, error: `Testados ${candidates.length} proxies — nenhum passou no teste do Discord` });
      return;
    }

    // Shuffle working list so different proxies are selected each call
    const shuffled = working.sort(() => Math.random() - 0.5);
    res.json({
      ok: true,
      proxy: `http://${shuffled[0]}`,
      all_proxies: shuffled.map(p => `http://${p}`),
      total_tested: candidates.length,
      total_working: working.length,
    });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// POST /api/discord/accounts/proxy-test
// body: { proxy }
router.post("/discord/accounts/proxy-test", async (req, res) => {
  const { proxy = "" } = req.body as { proxy?: string };
  const proxyUrl = proxy.trim() || undefined;
  const pf = makeFetch(proxyUrl);
  try {
    const start = Date.now();
    const r = await pf("https://discord.com/api/v9/gateway", {
      headers: { "User-Agent": DISCORD_UA, "Accept": "application/json" },
    });
    const ms = Date.now() - start;
    if (!r.ok) { res.json({ ok: false, error: `HTTP ${r.status}` }); return; }
    const data = await r.json() as { url?: string };
    res.json({ ok: true, ms, gateway: data.url, usingProxy: !!proxyUrl });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// POST /api/discord/accounts/create
// body: { count, captchaService, captchaApiKey, delay, proxy, proxies, useResidential }
// Streams SSE events so the UI can update progress in real time
router.post("/discord/accounts/create", async (req, res) => {
  const {
    count            = 1,
    captchaService   = "2captcha",
    captchaApiKey    = "",
    delay            = 3000,
    proxy            = "",
    proxies          = [],
    useResidential   = false,
  } = req.body as { count?: number; captchaService?: string; captchaApiKey?: string; delay?: number; proxy?: string; proxies?: string[]; useResidential?: boolean };

  const safeCount  = Math.max(1, Math.min(count, 20));
  const safeDelay  = Math.max(2000, delay);

  // SSE headers — keep connection alive for streaming
  res.writeHead(200, {
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Build proxy pool: proxies[] > single proxy > residential (if requested) > undefined
  let proxyPool: (string | undefined)[];
  if (proxies.length) {
    proxyPool = proxies.map(p => p.trim()).filter(Boolean);
  } else if (proxy.trim()) {
    proxyPool = [proxy.trim()];
  } else if (useResidential) {
    const rc = getResidentialCreds();
    if (rc) {
      const resUrl = `http://${rc.username}:${rc.password}@${rc.host}:${rc.port}`;
      proxyPool = Array.from({ length: safeCount }, () => resUrl);
      console.log(`[create] Using residential proxy: ${rc.host}:${rc.port} for ${safeCount} accounts`);
    } else {
      proxyPool = [undefined];
    }
  } else {
    proxyPool = [undefined];
  }

  send("start", { total: safeCount });

  const existing = readAccounts();
  const results: Array<CreateResult & { saved: boolean }> = [];
  let created = 0;

  for (let i = 0; i < safeCount; i++) {
    send("progress", { index: i, total: safeCount, status: "creating" });

    const proxyUrl = proxyPool[i % proxyPool.length];
    const result = await createOneAccount(captchaService, captchaApiKey.trim(), proxyUrl);
    let saved = false;

    if (result.status === "ok" && result.token) {
      const info = await fetchUserInfo(result.token);
      const acc: StoredAccount = {
        id:            info?.id ?? `auto_${Date.now()}`,
        username:      info?.username ?? result.username ?? "unknown",
        discriminator: info?.discriminator ?? "0",
        avatar:        info?.avatar ?? null,
        token:         result.token,
        email:         result.email,
        password:      result.password,
        addedAt:       Date.now(),
        status:        info ? "ok" : "unknown",
        createdAuto:   true,
      };
      existing.push(acc);
      writeAccounts(existing);
      saved = true;
      created++;
    }

    const r = { ...result, saved, token: result.token ? result.token.slice(0, 10) + "…" : undefined };
    results.push({ ...result, saved });
    send("result", { index: i, total: safeCount, done: i + 1, result: r });

    if (i < safeCount - 1) await sleep(safeDelay);
  }

  send("done", { created, total: safeCount, results: results.map(r => ({ ...r, token: r.token ? r.token.slice(0, 10) + "…" : undefined })) });
  res.end();
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
  const selected = all.filter(a => accountIds.includes(a.id) && a.status !== "invalid");
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
  const selected = all.filter(a => accountIds.includes(a.id) && a.status !== "invalid");
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
  const acc = readAccounts().find(a => a.id === accountId && a.status !== "invalid");
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
