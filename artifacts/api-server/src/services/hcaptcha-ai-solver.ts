import crypto from "crypto";
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "dummy",
});

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

// ── Proof-of-Work solvers ──────────────────────────────────────────────────────
// hCaptcha JWT PoW: hsw type — iterate sha256 `c` times on decoded `d` field
function solveJwtHsw(jwtReq: string): string {
  try {
    // Decode JWT payload (URL-safe base64)
    const parts = jwtReq.split(".");
    if (parts.length < 2) return "";
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(payload, "base64").toString("utf8");
    const j = JSON.parse(decoded) as {
      d?: string; // base64 data to hash
      c?: number; // iteration count
      n?: string; // type
    };

    if (!j.d || !j.c) return "";

    // Decode the data bytes
    const dataBytes = Buffer.from(j.d, "base64");

    // Iterate sha256 c times
    let hash = dataBytes;
    for (let i = 0; i < j.c; i++) {
      hash = Buffer.from(crypto.createHash("sha256").update(hash).digest());
    }

    // Return as base64
    return hash.toString("base64");
  } catch (e) {
    console.error("[hsw] JWT PoW error:", e);
    return "";
  }
}

// Legacy simple PoW (leading-zeros search) — kept for fallback
function solveHswSimple(req: string): string {
  try {
    const decoded = Buffer.from(req.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const arr = JSON.parse(decoded) as [string, number, ...unknown[]];
    const [prefix, difficulty] = arr;
    if (typeof prefix !== "string" || typeof difficulty !== "number") return "";
    const target = "0".repeat(difficulty);
    for (let i = 0; i < 2_000_000; i++) {
      const h = crypto.createHash("sha256").update(prefix + i).digest("hex");
      if (h.startsWith(target)) return String(i);
    }
  } catch { /* ignore */ }
  return "";
}

function solveHsl(req: string): string {
  try {
    const decoded = Buffer.from(req.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const arr = JSON.parse(decoded) as [string, number, number, ...unknown[]];
    const [key, difficulty, expires] = arr;
    const target = "0".repeat(difficulty);
    for (let i = 0; i < 2_000_000; i++) {
      const h = crypto.createHash("sha256").update(key + i).digest("hex");
      if (h.startsWith(target)) {
        return Buffer.from(JSON.stringify([key, difficulty, expires, i])).toString("base64");
      }
    }
  } catch { /* ignore */ }
  return "";
}

function computeN(c: { type?: string; req?: string } | undefined): string {
  if (!c?.req) return "";
  if (!c.type) return "";
  if (c.type === "hsl") return solveHsl(c.req);
  if (c.type === "hsw") {
    // Check if it's a JWT (has dots) or legacy format (plain base64 array)
    const isJwt = c.req.includes(".");
    return isJwt ? solveJwtHsw(c.req) : solveHswSimple(c.req);
  }
  return "";
}

// ── Realistic motion data ──────────────────────────────────────────────────────
function makeMotionData(sitekey: string, host: string): string {
  const now = Date.now();
  const widgetId = Math.random().toString(36).slice(2, 7);
  return JSON.stringify({
    v: 1,
    topLevel: {
      inv: false,
      exec: false,
      st: now - Math.floor(Math.random() * 3000 + 1000),
      sc: { availWidth: 1920, availHeight: 1080, width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24, top: 0, left: 0 },
      nv: {
        cookieEnabled: true, doNotTrack: null,
        hardwareConcurrency: 8, language: "en-US",
        languages: ["en-US", "en"],
        platform: "Win32",
        userAgent: UA,
      },
      dr: `https://${host}/`,
    },
    session: [],
    widgetList: [widgetId],
    widgetId,
    href: `https://${host}/`,
    prev: { escaped: false, passed: false, expiredChallenge: false, expiredResponse: false },
    sitekey,
    newcaptcha: true,
  });
}

// ── Image download ─────────────────────────────────────────────────────────────
async function fetchImageBase64(url: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const contentType = r.headers.get("content-type") ?? "image/jpeg";
    const mime = contentType.includes("png") ? "image/png" : "image/jpeg";
    return { b64: buf.toString("base64"), mime };
  } catch { return null; }
}

// ── GPT-4o image classification ────────────────────────────────────────────────
async function classifyImages(
  question: string,
  tasks: Array<{ datapoint_uri: string; task_key: string }>
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};

  const BATCH = 4;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    const images = await Promise.all(batch.map(t => fetchImageBase64(t.datapoint_uri)));

    for (let j = 0; j < batch.length; j++) {
      const img = images[j];
      const task = batch[j];
      if (!img) { answers[task.task_key] = "false"; continue; }

      try {
        const resp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_completion_tokens: 5,
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: `Captcha task: "${question}"\nDoes this image match? Answer ONLY "true" or "false".`,
              },
              {
                type: "image_url",
                image_url: { url: `data:${img.mime};base64,${img.b64}`, detail: "low" },
              },
            ],
          }],
        });
        const ans = resp.choices[0]?.message?.content?.trim().toLowerCase() ?? "false";
        answers[task.task_key] = ans.includes("true") ? "true" : "false";
      } catch {
        answers[task.task_key] = "false";
      }
    }
  }

  return answers;
}

// ── Challenge response type ─────────────────────────────────────────────────────
interface ChallengeResp {
  pass?: boolean;
  generated_pass_UUID?: string;
  c?: { type?: string; req?: string };
  key?: string;
  request_type?: string;
  requester_question?: { en?: string; [k: string]: string | undefined };
  tasklist?: Array<{ datapoint_uri: string; task_key: string }>;
  success?: boolean;
  error?: string;
}

type FetchLike = (url: string, opts?: RequestInit) => Promise<Response>;

// ── Challenge fetcher with PoW loop ───────────────────────────────────────────
async function fetchChallenge(
  sitekey: string,
  host: string,
  rqdata: string | undefined,
  doFetch: FetchLike,
  pageUrl: string,
  maxPowRounds = 3,
): Promise<ChallengeResp | null> {
  let lastC: { type?: string; req?: string } | undefined;

  for (let round = 0; round < maxPowRounds; round++) {
    // Compute PoW from previous round if needed
    const n = lastC ? computeN(lastC) : undefined;

    const params = new URLSearchParams({
      v:          "b0f2fa0",
      host,
      sitekey,
      sc:         "1",
      swa:        "1",
      motionData: makeMotionData(sitekey, host),
    });
    if (rqdata) params.set("rqdata", rqdata);
    if (n)     params.set("n", n);
    if (lastC) params.set("c", JSON.stringify(lastC));

    const challengeResp = await doFetch(
      `https://api2.hcaptcha.com/getcaptcha/${sitekey}`,
      {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": pageUrl,
          "Origin": "https://newassets.hcaptcha.com",
          "Accept": "application/json",
        },
        body: params.toString(),
      }
    );

    if (!challengeResp.ok) {
      console.error(`[hcaptcha] getcaptcha failed HTTP ${challengeResp.status}`);
      return null;
    }

    const challenge = await challengeResp.json() as ChallengeResp;
    console.log(`[hcaptcha] round ${round}: pass=${challenge.pass} key=${challenge.key?.slice(0,8)} success=${challenge.success} type=${challenge.request_type} tasks=${challenge.tasklist?.length}`);

    // Already passed
    if (challenge.pass && challenge.generated_pass_UUID) {
      return challenge;
    }

    // Has task list — proceed to image classification
    if (challenge.key && challenge.tasklist?.length) {
      return challenge;
    }

    // Has PoW challenge → solve and retry
    if (challenge.c?.req) {
      lastC = challenge.c;
      continue;
    }

    // Empty response or unknown state
    return null;
  }

  return null;
}

// ── Main solver ────────────────────────────────────────────────────────────────
export interface SolveResult {
  token: string | null;
  error?: string;
  attempts: number;
}

export async function solveHCaptchaWithAI(
  sitekey: string,
  pageUrl: string,
  rqdata?: string,
  proxyFetch?: FetchLike,
  maxAttempts = 3,
): Promise<SolveResult> {
  const doFetch: FetchLike = proxyFetch ?? ((u: string, o?: RequestInit) => fetch(u, o));
  const host = new URL(pageUrl).hostname;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // ── 1. Get challenge (with PoW auto-solving) ────────────────────────────
      const challenge = await fetchChallenge(sitekey, host, rqdata, doFetch, pageUrl);
      if (!challenge) {
        console.error(`[hcaptcha] attempt ${attempt}: no challenge received`);
        continue;
      }

      // Already passed
      if (challenge.pass && challenge.generated_pass_UUID) {
        return { token: challenge.generated_pass_UUID, attempts: attempt };
      }

      if (!challenge.key || !challenge.tasklist?.length) {
        console.error(`[hcaptcha] attempt ${attempt}: no task list`);
        continue;
      }

      // ── 2. Classify images with GPT-4o ─────────────────────────────────────
      const question = challenge.requester_question?.en ?? "Please select matching images";
      console.log(`[hcaptcha] classifying ${challenge.tasklist.length} images for: "${question}"`);
      const answers = await classifyImages(question, challenge.tasklist);

      // ── 3. Compute PoW for submission ─────────────────────────────────────
      const n = computeN(challenge.c);

      // ── 4. Submit answers ──────────────────────────────────────────────────
      const checkBody: Record<string, unknown> = {
        v:          "b0f2fa0",
        job_mode:   challenge.request_type ?? "image_label_binary",
        answers,
        serverdomain: host,
        sitekey,
        motionData: makeMotionData(sitekey, host),
      };
      if (n)          checkBody.n = n;
      if (challenge.c) checkBody.c = JSON.stringify(challenge.c);

      const checkResp = await doFetch(
        `https://api2.hcaptcha.com/checkcaptcha/${sitekey}/${challenge.key}`,
        {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/json",
            "Referer": pageUrl,
            "Origin": "https://newassets.hcaptcha.com",
            "Accept": "application/json",
          },
          body: JSON.stringify(checkBody),
        }
      );

      const result = await checkResp.json() as {
        generated_pass_UUID?: string;
        pass?: boolean;
        error?: string;
      };
      console.log(`[hcaptcha] check result: pass=${result.pass} uuid=${result.generated_pass_UUID?.slice(0,20)} error=${result.error}`);

      if (result.generated_pass_UUID) {
        return { token: result.generated_pass_UUID, attempts: attempt };
      }

    } catch (e) {
      console.error(`[hcaptcha] attempt ${attempt} error:`, e);
      if (attempt === maxAttempts) {
        return { token: null, error: String(e), attempts: attempt };
      }
    }
  }

  return { token: null, error: "Max attempts reached", attempts: maxAttempts };
}
