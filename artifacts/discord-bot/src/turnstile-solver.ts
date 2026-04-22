import puppeteer, { type Browser } from "puppeteer-core";
import { randomUUID } from "crypto";

const CHROMIUM_PATH =
  "/nix/store/43y6k6fj85l4kcd1yan43hpdld6nmjmp-ungoogled-chromium-131.0.6778.204/bin/chromium";

const TURNSTILE_SITEKEY = "0x4AAAAAACGoLxOoVHmJThAv";
const SITE_URL = "https://skynetchat.net";

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR','pt','en-US','en'] });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  window.chrome = { runtime: {} };
  Object.defineProperty(navigator, 'permissions', {
    get: () => ({ query: (p) => Promise.resolve({ state: 'granted', onchange: null }) })
  });
`;

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) return browserInstance;
  browserInstance = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1920,1080",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ],
  });
  return browserInstance;
}

export async function solveTurnstile(timeoutMs = 45_000): Promise<string | null> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(STEALTH_SCRIPT);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    // Navigate to the real sign-up page so the origin matches the sitekey
    await page.goto(`${SITE_URL}/sign-up`, {
      waitUntil: "networkidle0",
      timeout: 20_000,
    });

    // Intercept the Turnstile token via hidden input polling + callback hook
    const token = await page.evaluate((timeout: number) => {
      return new Promise<string | null>((resolve) => {
        const w = window as any;
        // Hook Turnstile render if it hasn't rendered yet
        if (w.turnstile) {
          const orig = w.turnstile.render?.bind(w.turnstile);
          if (orig) {
            w.turnstile.render = (el: Element, opts: any) => {
              const cb = opts.callback;
              opts.callback = (t: string) => {
                resolve(t);
                if (cb) cb(t);
              };
              const errCb = opts["error-callback"];
              opts["error-callback"] = (e: unknown) => {
                resolve(null);
                if (errCb) (errCb as (e: unknown) => void)(e);
              };
              return orig(el, opts);
            };
          }
        }

        // Also poll the hidden input (for already-rendered widgets)
        const poll = setInterval(() => {
          const input = document.querySelector("input[name='cf-turnstile-response']") as HTMLInputElement | null;
          const svelte = document.querySelector("input[name='turnstileToken']") as HTMLInputElement | null;
          const val = input?.value || svelte?.value;
          if (val) { clearInterval(poll); resolve(val); }
        }, 300);

        setTimeout(() => { clearInterval(poll); resolve(null); }, timeout);
      });
    }, Math.max(timeoutMs - 25_000, 15_000));

    return token;
  } finally {
    await page.close().catch(() => {});
  }
}

export interface SkynetAccount {
  nid: string;
  sid: string;
  code: string;
  createdAt: number;
  messagesUsed: number;
}

export async function createSkynetAccount(): Promise<SkynetAccount | null> {
  console.log("[turnstile] Solving Turnstile for new account...");
  const token = await solveTurnstile(45_000);
  if (!token) {
    console.error("[turnstile] Failed to get Turnstile token");
    return null;
  }
  console.log(`[turnstile] Got token: ${token.slice(0, 30)}...`);

  const visitorId = randomUUID();

  const resp = await fetch(`${SITE_URL}/api/access-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": SITE_URL,
      "Referer": `${SITE_URL}/sign-up`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ turnstileToken: token, visitorId, webrtcIps: [] }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error(`[turnstile] /api/access-code failed ${resp.status}: ${body}`);
    return null;
  }

  const data = (await resp.json()) as { code?: string };
  if (!data.code) {
    console.error("[turnstile] No code in response:", data);
    return null;
  }

  const setCookie = resp.headers.get("set-cookie") ?? "";
  const nid = setCookie.match(/nid=([^;]+)/)?.[1] ?? "";
  const sid = setCookie.match(/sid=([^;]+)/)?.[1] ?? "";

  if (!nid || !sid) {
    console.error("[turnstile] No session cookies in response");
    return null;
  }

  console.log(`[turnstile] New account created! code=${data.code.slice(0, 8)}... nid=${nid.slice(0, 10)}...`);
  return { nid, sid, code: data.code, createdAt: Date.now(), messagesUsed: 0 };
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}
