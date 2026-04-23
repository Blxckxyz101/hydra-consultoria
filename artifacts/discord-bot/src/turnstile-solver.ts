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
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }); } catch(_) {}
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR','pt','en-US','en'] });
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = {};
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
  Object.defineProperty(navigator, 'appVersion', {
    get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });
`;

// Captures token AND sitekey from Turnstile widget
const TURNSTILE_HOOK = `
(function() {
  window.__tsToken    = null;
  window.__tsError    = false;
  window.__tsSitekey  = null;

  function hookRender(ts) {
    if (!ts || !ts.render || ts.__hooked) return;
    ts.__hooked = true;
    var orig = ts.render.bind(ts);
    ts.render = function(el, opts) {
      if (opts && typeof opts === 'object') {
        if (opts.sitekey) window.__tsSitekey = opts.sitekey;
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
      } else {
        // opts may be inline via data- attributes on the element
        try {
          var sk = (el && el.dataset && el.dataset.sitekey) || null;
          if (sk) window.__tsSitekey = sk;
        } catch(_) {}
      }
      return orig(el, opts);
    };
  }

  var attempts = 0;
  var check = setInterval(function() {
    attempts++;
    if (window.turnstile && window.turnstile.render && !window.turnstile.__hooked) {
      hookRender(window.turnstile);
    }
    // Also scan DOM for data-sitekey attribute
    if (!window.__tsSitekey) {
      var el = document.querySelector('[data-sitekey]');
      if (el) window.__tsSitekey = el.getAttribute('data-sitekey');
    }
    if (attempts > 200) clearInterval(check);
  }, 100);
})();
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
      "--disable-features=PrivateStateTokens,TrustTokens,PrivacySandboxAdsAPIs,FedCm",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  })) as Browser;

  return browserInstance;
}

// ── 2captcha Turnstile solver ─────────────────────────────────────────────────

async function solveTurnstileWith2captcha(
  sitekey: string,
  pageUrl: string,
): Promise<string | null> {
  const apiKey = process.env.TWOCAPTCHA_API_KEY?.trim();
  if (!apiKey) return null;

  console.log(`[2captcha] Submitting Turnstile task — sitekey=${sitekey.slice(0, 12)}...`);

  const submitResp = await fetch(
    `https://2captcha.com/in.php?key=${apiKey}&method=turnstile&sitekey=${encodeURIComponent(sitekey)}&pageurl=${encodeURIComponent(pageUrl)}&json=1`,
  );
  const submitData = (await submitResp.json()) as { status: number; request: string };

  if (submitData.status !== 1) {
    console.error(`[2captcha] Submit failed: ${JSON.stringify(submitData)}`);
    return null;
  }

  const taskId = submitData.request;
  console.log(`[2captcha] Task submitted (id=${taskId}) — polling...`);

  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
    const resultResp = await fetch(
      `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`,
    );
    const resultData = (await resultResp.json()) as { status: number; request: string };
    if (resultData.status === 1) {
      console.log(`[2captcha] Solved! token=${resultData.request.slice(0, 20)}...`);
      return resultData.request;
    }
    if (resultData.request !== "CAPCHA_NOT_READY") {
      console.error(`[2captcha] Error: ${JSON.stringify(resultData)}`);
      return null;
    }
  }

  console.error("[2captcha] Timeout waiting for solution");
  return null;
}

// ── Shared: get sitekey + wait for auto-solve or inject 2captcha token ────────

async function getTurnstileTokenFromPage(
  page: import("puppeteer-core").Page,
  pageUrl: string,
  autoSolveTimeoutMs = 20_000,
): Promise<string | null> {
  // First, wait a bit for the widget to render and capture the sitekey
  await new Promise((r) => setTimeout(r, 2_000));

  const sitekey: string | null = await page.evaluate(() => (window as any).__tsSitekey).catch(() => null);

  // If 2captcha is available, use it (most reliable)
  if (sitekey && process.env.TWOCAPTCHA_API_KEY) {
    const token = await solveTurnstileWith2captcha(sitekey, pageUrl);
    if (token) {
      // Inject the token into the page so form submission works
      await page.evaluate((t: string) => {
        (window as any).__tsToken = t;
        // Also set hidden inputs
        const inputs = document.querySelectorAll("input[name='cf-turnstile-response'], input[name='turnstileToken']");
        inputs.forEach((inp) => { (inp as HTMLInputElement).value = t; });
        // Trigger any callback registered by the page
        if ((window as any).turnstile && (window as any).turnstile.__resolveCallback) {
          (window as any).turnstile.__resolveCallback(t);
        }
      }, token);
      return token;
    }
  }

  // Fallback: wait for Turnstile to auto-solve
  console.log("[turnstile] Waiting for Turnstile auto-solve...");
  const deadline = Date.now() + autoSolveTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    const result = await page.evaluate(() => {
      const t = (window as any).__tsToken;
      const inp =
        (document.querySelector("input[name='cf-turnstile-response']") as HTMLInputElement) ||
        (document.querySelector("input[name='turnstileToken']") as HTMLInputElement);
      return { token: t || (inp?.value) || null, error: (window as any).__tsError };
    });
    if (result.token) return result.token as string;
    if (result.error) {
      console.error("[turnstile] Widget reported error");
      break;
    }
  }

  return null;
}

// ── Public: solve Turnstile on sign-up page (used by createSkynetAccount) ─────

export async function solveTurnstile(timeoutMs = 90_000): Promise<string | null> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const pageUrl = `${SITE_URL}/sign-up`;

  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(EXTRA_STEALTH + "\n" + TURNSTILE_HOOK);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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

    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Click the "GERAR CÓDIGO" button to trigger Turnstile widget render
    await page.evaluate(() => {
      const btn = (Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]).find(
        (b) =>
          b.textContent &&
          (b.textContent.includes("GERAR") ||
            b.textContent.includes("CÓDIGO") ||
            b.textContent.includes("ACESSO") ||
            b.textContent.includes("CRIAR")),
      );
      if (btn) btn.click();
    });

    return await getTurnstileTokenFromPage(page, pageUrl, Math.max(timeoutMs - 35_000, 20_000));
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
  const token = await solveTurnstile(90_000);
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
      Origin: SITE_URL,
      Referer: `${SITE_URL}/sign-up`,
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
    `[turnstile] New account created! code=${data.code.slice(0, 8)}... nid=${nid.slice(0, 10)}...`,
  );
  return { nid, sid, code: data.code, createdAt: Date.now(), messagesUsed: 0 };
}

/**
 * Logs into skynetchat.net with a Pro code via headless Chromium + 2captcha.
 * Cookies are generated on this server IP, so they work for direct API calls.
 */
export async function loginWithProCode(code: string): Promise<SkynetAccount | null> {
  console.log(`[turnstile] Logging into SKYNETchat with Pro code ${code.slice(0, 6)}...`);
  const browser = await getBrowser();
  const page = await browser.newPage();
  const pageUrl = `${SITE_URL}/login`;

  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(EXTRA_STEALTH + "\n" + TURNSTILE_HOOK);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
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

    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Fill the code input
    const filled = await page.evaluate((proCode: string) => {
      const inputs = Array.from(document.querySelectorAll("input"));
      const codeInput =
        inputs.find(
          (i) =>
            i.type === "text" ||
            i.type === "number" ||
            (i.placeholder &&
              (i.placeholder.includes("código") ||
                i.placeholder.includes("code") ||
                /\d{6,}/.test(i.placeholder))),
        ) ?? inputs[0];
      if (!codeInput) return false;
      const nativeSetter = (
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value") as any
      )?.set;
      if (nativeSetter) nativeSetter.call(codeInput, proCode);
      codeInput.dispatchEvent(new Event("input", { bubbles: true }));
      codeInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, code);

    if (!filled) {
      console.error("[turnstile] Could not find code input on login page");
      return null;
    }

    // Get the Turnstile token (via 2captcha if available, else auto-solve)
    const tsToken = await getTurnstileTokenFromPage(page, pageUrl, 45_000);

    if (!tsToken) {
      console.error("[turnstile] No Turnstile token — trying direct POST fallback...");
      return null;
    }
    console.log(`[turnstile] Got token: ${tsToken.slice(0, 30)}...`);

    // Submit the form
    await page.evaluate(() => {
      const btn = (
        Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]
      ).find(
        (b) =>
          b.type === "submit" ||
          (b.textContent &&
            (b.textContent.toLowerCase().includes("enter") ||
              b.textContent.toLowerCase().includes("entrar") ||
              b.textContent.toLowerCase().includes("login"))),
      );
      if (btn) btn.click();
      else {
        const form = document.querySelector("form");
        if (form) form.submit();
      }
    });

    // Wait for navigation / cookie set
    await Promise.race([
      page.waitForNavigation({ timeout: 15_000 }),
      new Promise((r) => setTimeout(r, 8_000)),
    ]).catch(() => {});

    // Extract cookies from browser session
    const cookies = await page.cookies();
    let nid = cookies.find((c) => c.name === "nid")?.value ?? "";
    let sid = cookies.find((c) => c.name === "sid")?.value ?? "";

    if (!sid) {
      // Fallback: POST directly using the Turnstile token
      console.log("[turnstile] No cookies from browser — trying direct API POST...");
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
          Origin:               SITE_URL,
          Referer:              pageUrl,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        },
        body: formBody.toString(),
      });
      const setCookie = resp.headers.get("set-cookie") ?? "";
      nid = setCookie.match(/nid=([^;]+)/)?.[1] ?? "";
      sid = setCookie.match(/sid=([^;]+)/)?.[1] ?? "";
      if (!sid) {
        const body = await resp.text().catch(() => "");
        console.error(`[turnstile] Direct POST also failed (${resp.status}): ${body.slice(0, 300)}`);
        return null;
      }
      console.log(`[turnstile] Pro login SUCCESS via direct POST! nid=${nid.slice(0,10)}... sid=${sid.slice(0,10)}...`);
    } else {
      console.log(`[turnstile] Pro login SUCCESS! nid=${nid.slice(0,10)}... sid=${sid.slice(0,10)}...`);
    }

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
