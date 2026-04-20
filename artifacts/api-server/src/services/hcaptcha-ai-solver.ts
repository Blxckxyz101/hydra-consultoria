import crypto from "crypto";
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "dummy",
});

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

// ── Proof-of-Work solvers ──────────────────────────────────────────────────────
function solveHsw(req: string): string {
  try {
    const decoded = Buffer.from(req, "base64").toString("utf8");
    const arr = JSON.parse(decoded) as [string, number, ...unknown[]];
    const [prefix, difficulty] = arr;
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
    const decoded = Buffer.from(req, "base64").toString("utf8");
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
  if (c.type === "hsw") return solveHsw(c.req);
  if (c.type === "hsl") return solveHsl(c.req);
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

  // Classify in batches of 4 to reduce API calls
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
  proxyFetch?: (url: string, opts?: RequestInit) => Promise<Response>,
  maxAttempts = 3,
): Promise<SolveResult> {
  const doFetch = proxyFetch ?? ((u: string, o?: RequestInit) => fetch(u, o));
  const host = new URL(pageUrl).hostname;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // ── 1. Get challenge ────────────────────────────────────────────────────
      const challengeParams = new URLSearchParams({
        v: "b0f2fa0",
        host,
        sitekey,
        sc: "1",
        swa: "1",
        motionData: makeMotionData(sitekey, host),
        ...(rqdata ? { rqdata } : {}),
      });

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
          body: challengeParams.toString(),
        }
      );

      if (!challengeResp.ok) {
        continue;
      }

      const challenge = await challengeResp.json() as {
        pass?: boolean;
        generated_pass_UUID?: string;
        c?: { type?: string; req?: string };
        key?: string;
        request_type?: string;
        requester_question?: { en?: string; [k: string]: string | undefined };
        tasklist?: Array<{ datapoint_uri: string; task_key: string }>;
      };

      // Already passed (rare, happens on clean IPs)
      if (challenge.pass && challenge.generated_pass_UUID) {
        return { token: challenge.generated_pass_UUID, attempts: attempt };
      }

      if (!challenge.key || !challenge.tasklist?.length) {
        continue;
      }

      // ── 2. Classify images with GPT-4o ─────────────────────────────────────
      const question = challenge.requester_question?.en ?? "Please select matching images";
      const answers = await classifyImages(question, challenge.tasklist);

      // ── 3. Compute PoW ─────────────────────────────────────────────────────
      const n = computeN(challenge.c);

      // ── 4. Submit answers ──────────────────────────────────────────────────
      const checkBody = {
        v: "b0f2fa0",
        job_mode: challenge.request_type ?? "image_label_binary",
        answers,
        serverdomain: host,
        sitekey,
        motionData: makeMotionData(sitekey, host),
        n: n || undefined,
        c: challenge.c ? JSON.stringify(challenge.c) : undefined,
      };

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

      if (result.generated_pass_UUID) {
        return { token: result.generated_pass_UUID, attempts: attempt };
      }

      // If wrong answers, retry
    } catch (e) {
      if (attempt === maxAttempts) {
        return { token: null, error: String(e), attempts: attempt };
      }
    }
  }

  return { token: null, error: "Max attempts reached", attempts: maxAttempts };
}
