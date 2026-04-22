// eslint-disable-next-line @typescript-eslint/no-require-imports
const puppeteerExtra = require("puppeteer-extra") as any;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
import type { Browser } from "puppeteer-core";
import { randomUUID } from "crypto";

puppeteerExtra.use(StealthPlugin());

const CHROMIUM_PATH =
  "/nix/store/43y6k6fj85l4kcd1yan43hpdld6nmjmp-ungoogled-chromium-131.0.6778.204/bin/chromium";

const SITE_URL = "https://skynetchat.net";

const EXTRA_STEALTH = `
  // Patch hardwareConcurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  // Patch deviceMemory
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }); } catch(_) {}
  // Patch platform
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  // Patch languages
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR','pt','en-US','en'] });
  // Ensure chrome runtime exists
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = {};
  // Patch screen
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
  // Remove headless from appVersion
  Object.defineProperty(navigator, 'appVersion', {
    get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });
`;

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && (browserInstance as any).connected) return browserInstance;

  browserInstance = (await (puppeteerExtra as any).launch({
    executablePath: CHROMIUM_PATH,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1920,1080",
      "--lang=pt-BR",
      "--disable-features=IsolateOrigins,site-per-process",
      "--flag-switches-begin",
      "--disable-site-isolation-trials",
      "--flag-switches-end",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  })) as Browser;

  return browserInstance;
}

export async function solveTurnstile(timeoutMs = 60_000): Promise<string | null> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

    await page.evaluateOnNewDocument(EXTRA_STEALTH);

    await page.setExtraHTTPHeaders({
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    await page.goto(`${SITE_URL}/sign-up`, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });

    // Wait a bit for scripts to settle
    await new Promise((r) => setTimeout(r, 2000));

    const waitMs = Math.max(timeoutMs - 35_000, 20_000);

    const token = await page.evaluate((wait: number) => {
      return new Promise<string | null>((resolve) => {
        // Hook Turnstile render callback before widget initializes
        const w = window as any;

        const hookTurnstile = () => {
          if (!w.turnstile) return false;
          const orig = w.turnstile.render?.bind(w.turnstile);
          if (!orig || (w.turnstile as any).__hooked) return false;
          (w.turnstile as any).__hooked = true;
          w.turnstile.render = (el: Element, opts: any) => {
            const origCb = opts.callback;
            opts.callback = (t: string) => { resolve(t); if (origCb) origCb(t); };
            const origErr = opts["error-callback"];
            opts["error-callback"] = (e: unknown) => { resolve(null); if (origErr) (origErr as any)(e); };
            return orig(el, opts);
          };
          return true;
        };

        // Poll for turnstile object + input value
        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          if (!hookTurnstile()) hookTurnstile();

          // Check hidden input
          const input = document.querySelector<HTMLInputElement>(
            "input[name='cf-turnstile-response'], input[name='turnstileToken']"
          );
          if (input?.value) {
            clearInterval(poll);
            resolve(input.value);
            return;
          }
        }, 400);

        setTimeout(() => { clearInterval(poll); resolve(null); }, wait);
      });
    }, waitMs);

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
  const token = await solveTurnstile(60_000);
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
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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

  console.log(
    `[turnstile] New account created! code=${data.code.slice(0, 8)}... nid=${nid.slice(0, 10)}...`
  );
  return { nid, sid, code: data.code, createdAt: Date.now(), messagesUsed: 0 };
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await (browserInstance as any).close().catch(() => {});
    browserInstance = null;
  }
}
