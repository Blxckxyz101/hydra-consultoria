import type { Browser } from "puppeteer-core";
import { randomUUID } from "crypto";

let _puppeteerReady = false;
let _puppeteerExtra: any = null;

async function getPuppeteer() {
  if (_puppeteerReady) return _puppeteerExtra;
  const [mod, stealth] = await Promise.all([
    import("puppeteer-extra"),
    import("puppeteer-extra-plugin-stealth"),
  ]);
  _puppeteerExtra = mod.default ?? mod;
  const StealthPlugin = (stealth.default ?? stealth) as any;
  _puppeteerExtra.use(StealthPlugin());
  _puppeteerReady = true;
  return _puppeteerExtra;
}

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

  const puppeteerExtra = await getPuppeteer();
  browserInstance = (await puppeteerExtra.launch({
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
      // Disable Private Access Token / Private State Token (causes 401 in Turnstile PAT challenge)
      "--disable-features=PrivateStateTokens,TrustTokens,PrivacySandboxAdsAPIs,FedCm",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  })) as Browser;

  return browserInstance;
}

// Injected BEFORE page load to intercept turnstile callbacks
const TURNSTILE_HOOK = `
(function() {
  window.__tsToken = null;
  window.__tsError = false;

  function hookRender(ts) {
    if (!ts || !ts.render || ts.__hooked) return;
    ts.__hooked = true;
    var orig = ts.render.bind(ts);
    ts.render = function(el, opts) {
      if (opts && typeof opts === 'object') {
        var cb = opts.callback;
        opts.callback = function(token) {
          window.__tsToken = token;
          if (cb) cb(token);
        };
        var errCb = opts['error-callback'];
        opts['error-callback'] = function(e) {
          window.__tsError = true;
          if (errCb) errCb(e);
        };
      }
      return orig(el, opts);
    };
  }

  // Poll for window.turnstile to appear and hook it
  var attempts = 0;
  var check = setInterval(function() {
    attempts++;
    if (window.turnstile && window.turnstile.render && !window.turnstile.__hooked) {
      hookRender(window.turnstile);
    }
    if (attempts > 200) clearInterval(check);
  }, 100);
})();
`;

export async function solveTurnstile(timeoutMs = 60_000): Promise<string | null> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

    // Inject both stealth patches AND the turnstile hook before any page script runs
    await page.evaluateOnNewDocument(EXTRA_STEALTH + "\n" + TURNSTILE_HOOK);

    await page.setExtraHTTPHeaders({
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // Intercept PAT (Private Access Token) challenge requests and fake a 200 response
    // so Turnstile thinks the browser passed the real-device check
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/pat/") && url.includes("challenge-platform")) {
        // Fake success — Turnstile checks status code, not the cryptographic body
        req.respond({ status: 200, contentType: "application/private-token-response", body: "" });
      } else {
        req.continue();
      }
    });

    await page.goto(`${SITE_URL}/sign-up`, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });

    // Give scripts a moment to settle, then click the generate button to trigger Turnstile
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(function() {
      // Click the "GERAR CÓDIGO DE ACESSO" button
      var btns = Array.from(document.querySelectorAll("button"));
      var btn = btns.find(function(b) {
        return b.textContent && (
          b.textContent.includes("GERAR") ||
          b.textContent.includes("CÓDIGO") ||
          b.textContent.includes("ACESSO") ||
          b.textContent.includes("CRIAR")
        );
      });
      if (btn) { btn.click(); console.log("[solver] Clicked:", btn.textContent); }
      else { console.log("[solver] Button not found, buttons:", btns.map(function(b){ return b.textContent?.trim().slice(0,30); }).join(" | ")); }
    });

    // Poll for token set by our hook, up to remaining timeout
    const deadline = Date.now() + Math.max(timeoutMs - 35_000, 20_000);
    let token: string | null = null;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));

      const result = await page.evaluate(function() {
        var t = (window as any).__tsToken;
        var err = (window as any).__tsError;
        // Also check hidden inputs as fallback
        var inp = document.querySelector("input[name='cf-turnstile-response']") as HTMLInputElement
               || document.querySelector("input[name='turnstileToken']") as HTMLInputElement;
        return { token: t || (inp && inp.value) || null, error: err };
      });

      if (result.token) { token = result.token; break; }
      if (result.error) { console.error("[turnstile] Widget reported error"); break; }
    }

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

/**
 * Logs into skynetchat.net using a Pro code via headless Chromium.
 * Cookies are created on the same server IP — so they work for API calls.
 */
export async function loginWithProCode(code: string): Promise<SkynetAccount | null> {
  console.log(`[turnstile] Logging into SKYNETchat with Pro code ${code.slice(0, 6)}...`);
  const browser = await getBrowser();
  const page    = await browser.newPage();

  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(EXTRA_STEALTH + "\n" + TURNSTILE_HOOK);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    );
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/pat/") && url.includes("challenge-platform")) {
        req.respond({ status: 200, contentType: "application/private-token-response", body: "" });
      } else {
        req.continue();
      }
    });

    await page.goto(`${SITE_URL}/login`, { waitUntil: "networkidle2", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Fill the code input
    const filled = await page.evaluate((proCode: string) => {
      const inputs = Array.from(document.querySelectorAll("input"));
      const codeInput = inputs.find(i =>
        i.type === "text" || i.type === "number" ||
        (i.placeholder && (i.placeholder.includes("código") || i.placeholder.includes("code") || /\d{6,}/.test(i.placeholder)))
      ) ?? inputs[0];
      if (!codeInput) return false;
      const nativeSetter = (Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value") as any)?.set;
      if (nativeSetter) nativeSetter.call(codeInput, proCode);
      codeInput.dispatchEvent(new Event("input", { bubbles: true }));
      codeInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, code);

    if (!filled) {
      console.error("[turnstile] Could not find code input on login page");
      return null;
    }

    // Wait for Turnstile to auto-solve
    const deadline = Date.now() + 45_000;
    let tsToken: string | null = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 600));
      const result = await page.evaluate(() => {
        const t = (window as any).__tsToken;
        const inp = document.querySelector("input[name='cf-turnstile-response']") as HTMLInputElement
                 || document.querySelector("input[name='turnstileToken']") as HTMLInputElement;
        return { token: t || (inp && inp.value) || null, error: (window as any).__tsError };
      });
      if (result.token) { tsToken = result.token; break; }
      if (result.error) { console.error("[turnstile] Turnstile error on login page"); break; }
    }

    if (!tsToken) {
      console.error("[turnstile] No Turnstile token — Turnstile did not auto-solve");
      return null;
    }
    console.log(`[turnstile] Got token on login page: ${tsToken.slice(0, 30)}...`);

    // Submit the form
    await page.evaluate(() => {
      const btn = (Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]).find(b =>
        b.type === "submit" || (b.textContent && (b.textContent.toLowerCase().includes("enter") || b.textContent.toLowerCase().includes("entrar") || b.textContent.toLowerCase().includes("login")))
      );
      if (btn) btn.click();
      else { const form = document.querySelector("form"); if (form) form.submit(); }
    });

    // Wait for navigation / cookie set
    await Promise.race([
      page.waitForNavigation({ timeout: 15_000 }),
      new Promise(r => setTimeout(r, 8_000)),
    ]).catch(() => {});

    // Extract cookies
    const cookies = await page.cookies();
    const nid = cookies.find(c => c.name === "nid")?.value ?? "";
    const sid = cookies.find(c => c.name === "sid")?.value ?? "";

    if (!sid) {
      // Fallback: POST directly using the token we got
      console.log("[turnstile] No cookies from navigation — trying direct API POST...");
      const visitorId = randomUUID();
      const formBody = new URLSearchParams({
        code,
        "cf-turnstile-response": tsToken,
        turnstileToken: tsToken,
        visitorId,
      });
      const resp = await fetch(`${SITE_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type":       "application/x-www-form-urlencoded",
          "x-sveltekit-action": "true",
          "Origin":             SITE_URL,
          "Referer":            `${SITE_URL}/login`,
          "User-Agent":         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        },
        body: formBody.toString(),
      });
      const setCookie = resp.headers.get("set-cookie") ?? "";
      const nidM = setCookie.match(/nid=([^;]+)/)?.[1] ?? "";
      const sidM = setCookie.match(/sid=([^;]+)/)?.[1] ?? "";
      if (!sidM) {
        const body = await resp.text().catch(() => "");
        console.error(`[turnstile] Direct POST also failed (${resp.status}): ${body.slice(0, 200)}`);
        return null;
      }
      console.log(`[turnstile] Pro login SUCCESS via direct POST! nid=${nidM.slice(0, 10)}... sid=${sidM.slice(0, 10)}...`);
      return { nid: nidM, sid: sidM, code, createdAt: Date.now(), messagesUsed: 0 };
    }

    console.log(`[turnstile] Pro login SUCCESS! nid=${nid.slice(0, 10)}... sid=${sid.slice(0, 10)}...`);
    return { nid, sid, code, createdAt: Date.now(), messagesUsed: 0 };

  } catch (err) {
    console.error("[turnstile] loginWithProCode error:", err);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await (browserInstance as any).close().catch(() => {});
    browserInstance = null;
  }
}
