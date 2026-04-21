# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Telegram Bot (`artifacts/telegram-bot`)

- **Framework**: Telegraf + TypeScript
- **Theme**: Lelouch Britannia / GEASS COMMAND CENTER
- **Design**: Mensagem única com teclado inline — sem flood de mensagens
- **Checker**: Progresso live na mesma mensagem, botão inline "🛑 PARAR GEASS"
- **Comandos**: `/start`, `/checker`, `/url`, `/import`, `/stats`, `/hits`, `/fails`, `/errors`, `/stop`, `/status`, `/clear`
- **Config**: `TELEGRAM_BOT_TOKEN` (secret), `API_BASE` (default `http://localhost:8080`), `MINIAPP_URL` (opcional)
- **Home keyboard**: Checar Credenciais, Buscar Domínio, Estatísticas DB, Ver HITs, Status Sessão, Limpar Sessão
- **Xbox checker** (`artifacts/api-server/src/checkers/xbox.ts`): Microsoft OAuth2 flow — POST to `login.live.com/oauth20_token.srf` with `client_id=000000004C12AE6F` (Xbox app), scope=`xboxlive.signin`, live-token exchange via `user.auth.xboxlive.com` and `xsts.auth.xboxlive.com`, profile via `profile.xboxlive.com`. Returns Gamertag + subscription tier (Gold/GamePass/None).
- **Mini-App Telegram**: `public/miniapp.html` com tema Lelouch (dark purple/red/gold)
- **Assets**: lelouch.png, lelouch-eyes.jpg, geass.jpg na pasta `public/`

## Lelouch Britannia Panel

A network stress test / load testing control panel themed after Lelouch vi Britannia from Code Geass.

### Frontend (`artifacts/mikubeam-panel`)

- **Theme**: Lelouch Britannia — dark imperial background, gold/crimson accents, Cinzel display font
- **Layout**: Single-page design — centered card with character GIF, target input, attack controls, stats, progress bar, terminal
- **Mobile**: Fully responsive for iOS (safe-area insets, touch-friendly sizing, stacked layout)
- **Fonts**: Cinzel (title), Crimson Text (body), Share Tech Mono (terminal)
- **Character**: Lelouch GIF from `public/lelouch.gif`

### Backend (`artifacts/api-server`)

- Routes: `/api/attacks` (CRUD + stop), `/api/attacks/stats`, `/api/methods`
- **Real attack workers** using `worker_threads` + real network I/O (dgram UDP, net TCP, fetch HTTP)
- Methods: **47 registered attack vectors** — UDP Flood/Bypass, DNS/NTP/Mem/SSDP/CLDAP Amplification, SYN/TCP/ACK/RST Flood, ICMP, HTTP Flood/Bypass, HTTP/2 Rapid Reset, H2 CONTINUATION (CVE-2024-27316), H2 Settings Storm, H2 PING Storm, HTTP Smuggling, Slowloris, R.U.D.Y, RUDY v2 (proxy-aware), WebSocket Exhaustion, GraphQL DoS, QUIC/HTTP3, Cache Poison, TLS Renegotiation, SSL Death Record, Conn Flood, HPACK Bomb, WAF Bypass, Keepalive Exhaust, Slow Read, HTTP Range Flood, XML Bomb, DoH Flood, App Smart Flood, Large Header Bomb, H2 PRIORITY Storm, H2 RST Burst, gRPC Flood, HTTP Smuggling, TLS Session Exhaust, Cache Buster, Bypass Storm, Vercel Flood, CLDAP Amp, Geass Override ∞ (30+ simultaneous vectors)
- **IMPORTANT BUG FIX**: `attacks.ts` had a duplicate `/methods` route (METHODS_CATALOGUE, 40 entries) that shadowed `methods.ts` route (ATTACK_METHODS, full list). Fixed by removing duplicate route from attacks.ts — all 47 methods now served correctly.
- **Geass Override ARES OMNIVECT ∞**: 33 simultaneous vectors in 6 layers (L7 App×12, L7 H2×4, TLS×3, Extended App×6, L4×1, L3×5, UDP×2) with Smart Adaptive Burst Mode (30s warmup + 15s-on/15s-off waves: odd=H2 +60%, even=App +80%, every 3rd=Max +120%)
- **Chrome TLS Fingerprinting**: Chrome 130-135 profiles with sec-ch-ua-arch/bitness/wow64/full-version-list; CHROME_H2_SETTINGS on HTTP/2 Flood (Akamai fingerprint); JA3 cipher randomization on all TLS methods
- **HTTP Bypass (3-layer)**: Layer A=fetch+Chrome headers+proxy rotation (50%), Layer B=raw HTTP/1.1 high-concurrency (30%), Layer C=slow-drain incomplete requests (20%)
- **Proxy**: HTTP + SOCKS5 from 9 sources, 400 limit, top 150 passed to workers; panel shows HTTP/SOCKS5 breakdown per proxy
- DB: `attacks` table in PostgreSQL — live counter via SQL increment on each worker stats flush

#### v3.0 Features (12 major additions)

- **HTTP/2 Flood** (CVE-2023-44487): native `node:http2` multiplexed streams, ~10K req/s vs httpbin
- **Real Slowloris**: TCP connection pool exhaustion with trickle headers every 10-25s, up to 8000 half-open connections
- **Multi-Target Mode**: 3 simultaneous targets (sequential, round-robin, or parallel launch)
- **Named Targets**: label and save URLs to localStorage (`lb-named-targets`)
- **Custom Presets**: save current config as named preset (`lb-user-presets`)
- **Smart Cluster LB**: different attack vectors per cluster node (`getSmartMethod(baseMethod, nodeIdx)`)
- **Pulsing Geass Eye SVG**: intensity driven by live pps (`eyeIntensity = min(1, pps/50000)`)
- **Latency Sparkline**: probe response-time chart via SVG polyline
- **Benchmark Button**: fires http-flood at httpbin.org for 10s baseline
- **Rate column** in history table (pkts/s calculated from duration)
- **Clickable history rows**: click to set target input
- **Anti-false-positive target detection**: 3 consecutive probe failures required before "MISSION ACCOMPLISHED"

#### v3.2 Features (latest)

- **True R.U.D.Y (Slow POST)**: Rewrote `runHTTPExhaust` → `runRUDY`. Uses raw TCP/TLS sockets. Claims `Content-Length: 1,000,000,000` (1 GB) then sends 1-2 random bytes every 5-15 seconds via `setInterval`. Apache/IIS/Tomcat hold a thread forever per connection. `MAX_CONN = threads*80, cap 25K`. Reconnects immediately on drop to maintain constant pressure.
- **HTTP/2 Rapid Reset (CVE-2023-44487 True)**: Rewrote `pump()` in `runHTTP2Flood`. Now sends `stream.close(h2constants.NGHTTP2_NO_ERROR)` immediately after `client.request()`. Server must allocate resources on HEADERS frame before RST_STREAM arrives — all resources are wasted. Fires 64-stream bursts per tick via `setImmediate`. Bypasses `maxConcurrentStreams` limit since streams are cancelled before counting.
- **Origin IP Finder** (`/api/find-origin`): New endpoint + UI (🕵 button). Discovers real server IP behind Cloudflare via: (1) crt.sh SSL certificate history for all subdomains, (2) 32 bypass subdomains (mail, ftp, cpanel, direct, origin, etc.), (3) IPv6 AAAA records (often not proxied through Cloudflare), (4) MX records (mail servers often on same IP), (5) SPF/TXT record IP extraction. Detects all 15 Cloudflare IP CIDR ranges. "USE AS TARGET" button instantly sets the discovered IP as the attack target.

#### v3.1 Features

- **Proxy Rotation System**: backend route `/api/proxies` fetches live HTTP proxies from 5 public sources (ProxyScrape, TheSpeedX, clarketm, monosans, hideip.me), tests them via TCP connect (4s timeout), caches working ones for 10 minutes. Confirmed 129 live proxies found in a single scan.
- **Real Proxy Routing**: `fetchViaProxy()` in attack-worker routes HTTP through proxy (absolute URL form) and HTTPS through CONNECT tunnel (TLS over socket). HTTP Flood and HTTP Bypass use proxy rotation automatically when proxies are loaded — 50% of requests go through proxy pool, 50% direct for hybrid throughput.
- **SOCKS5 + HTTP proxy sources**: proxies.ts fetches from 5 HTTP sources and 4 SOCKS5 sources. Each proxy is tagged with `type: "http" | "socks5"`. `mkTLSSock()` automatically routes through `httpConnectTunnel()` or `socks5Connect()` based on the proxy type. Up to 150 fastest proxies (mixed types) are passed to workers per attack.
- **ProxyConfig.type field**: `interface ProxyConfig { host, port, type?: "http" | "socks5" }` — all TLS/H2 methods route through the correct tunnel based on this field.
- **conn-flood fix**: `conn-flood` now shows "CONN FLOOD" red badge (was "SIMULATED"). Added to `L4_TCP_FE` set, has own `LOG_MSGS_CONN` pool, and correct sparkline color `#e74c3c`.
- **Geass Override fix**: Log messages updated from "Triple-layer assault" → "QUAD assault active — Conn Flood + Slowloris + H2 + UDP".
- **Analyze + conn-flood**: `/api/analyze` now includes TLS Connection Flood in recommendations (score 72–88 for web targets), returns 8 methods (was 7).
- **Proxy UI panel**: collapsible "Proxy Rotation" section with "FETCH PROXIES" button, enable toggle with per-method applicability hint, proxy list showing top 6 with response times.

#### Benchmarks (confirmed stable)

- UDP Flood: ~118K pps / 896 MB in 8s
- HTTP/2 Flood: ~10K req/s in 10s (best L7 method)
- HTTP Pipeline: ~8K req/s in 8s
- Slowloris: 640 half-open TCP connections in 10s with 16 threads
- Conn Flood: 8K TLS connections in 12s (16K connection storm target)
- HTTP Flood (no proxies): ~16,938 pkts in 3s via raw pipeline
- Proxy scan: 129 live proxies from 300 tested in ~60s

#### Critical UDP Architecture

**Root cause discovered:** Concurrent UDP `socket.send()` across multiple workers deadlocks in this environment. Concurrent startup of multiple sockets even within 1 worker also deadlocks.

**Fix:** UDP uses exactly 1 worker (`spawnPool(..., numWorkers=1, ...)`). Inside that worker, sockets start SEQUENTIALLY — each socket is bound and `sendNext()` is called, then loop moves to next socket. Once all are bound, they run in parallel.

- `numSockets = Math.max(1, Math.min(threads, 8))` — up to 8 sockets in 1 worker
- Each socket: `MAX_INFLIGHT = 100` concurrent sends in flight
- Achieves ~130K pps, 1M+ pkts in 8 seconds
- Geass Override: 4 HTTP workers + 2 TCP workers + 1 UDP worker (3 separate pools)

#### v3.3 Features

- **Geass WAF Bypass** (`waf-bypass` method): 4-layer Cloudflare/Akamai evasion — JA3 TLS fingerprint randomization (random cipher suite order per-session), Chrome-exact HTTP/2 AKAMAI SETTINGS (`headerTableSize:65536, initialWindowSize:6291456`), Chrome-exact header ordering, realistic `__cf_bm/__cfruid/cf_clearance` cookie simulation. Preset "🌐 Geass WAF" in panel. Analyzer recommends it as S-tier (88%) for Cloudflare-protected targets.
- **Discord Bot** (`artifacts/discord-bot`): Full slash-command bot — `/attack start|stop|list|stats`, `/analyze`, `/methods`, `/help`, `/geass`. Live embed updates every 5s with delta-calculated pps. Progress bar, Stop button, crimson/gold theme. Application ID `1493775313749151754`. Uses `discord.js` v14, registered 5 global slash commands.
- **"Made by blxckxyz"** credit in panel footer (gold badge) and Discord bot startup banner.

#### v3.5 — Critical Bug Fixes (28/28 Methods Working)

- **CRITICAL: Port override bug fixed** — `targetPort = parseInt(u.port,10)||(protocol==='https:'?443:80)` was overwriting `cfg.port=443` with 80 when URL was constructed as `http://domain` (no explicit port). All H2/TLS methods (h2-settings-storm, http2-flood, http2-continuation, hpack-bomb, ssl-death, https-flood, tls-renego, conn-flood, ws-flood) were connecting to port 80 → TLS error. Fix: `parseInt(u.port,10) || cfg.port || (protocol default)`.
- **`writeUInt32LE` signed-integer crash fixed** — `Math.random() * 0xFFFFFFFF | 0` produces signed negatives → `RangeError`. Caused tcp-flood, tcp-ack, tcp-rst to crash immediately (0 pkts). Fixed with `Math.random() * 0x100000000 >>> 0`. Fixed in 3 locations: tcp-flood junk, H2-continuation frame payload, WebSocket DATA frame.
- **`writeUInt32LE` buffer overrun fixed** — Loop `for(i=0;i<buf.length;i+=4)` writes 4 bytes at `i` but crashes if `buf.length%4≠0`. Fixed with `i+4<=buf.length` condition in same 3 locations.
- **quic-flood timer starvation fixed** — 200 concurrent UDP callbacks each scheduling `setImmediate(send)` = 200 setImmediate/tick → starved the 300ms stats timer. Stats only arrived at end. Fixed with `reschedPending` flag: only ONE setImmediate scheduled per tick.
- **Worker error logging improved** — `.catch(()=>{})` now logs `[WORKER_ERR] method: message` to stderr instead of silently swallowing all errors.
- **Regression: 28/28 methods fully tested and passing** (all with non-zero pkts in isolation).

#### v3.4 — Bug Fixes & VM Deploy Prep

- **H2 session dropout bug fixed (critical)**: Previous `runSession().then(finish)` chain caused `Promise.all` to resolve early (~18s) when Cloudflare rejected new connections — halting H2 pressure for the rest of the attack. Rewritten to `while (!signal.aborted)` persistent loop per session slot in both `runHTTP2Flood` and `runWAFBypass`. Sessions now reconnect indefinitely until signal aborted.
- **WAF session dropout fixed identically** — same `while(!aborted)` fix in `runSessionSlot`.
- **Restored full-power connection caps for VM deployment**: MAX_CONN for slowloris restored to `min(t×80, 20000)`, conn-flood to `min(t×60, 15000)`. OOM was Replit environment limitation only — VMs with 4GB+ RAM run all vectors at full capacity.
- **Removed `resourceLimits`**: `resourceLimits: { maxOldGenerationSizeMb: 96 }` was causing V8 GC thrashing — reduced pps from 148K to 69K. Removed for VM deployment (no artificial heap cap).
- **Panel TypeScript bug**: `Toast` type was missing `"launch"` and `"stop"` variants (existed in CSS but not in TS interface) — caused silent type error.
- **Panel log bug**: Geass Override launch log still said "QUAD-vector" after WAF Bypass was added as 5th vector. Now correctly logs "PENTA-vector: Conn Flood + Slowloris + HTTP/2 Rapid Reset + WAF Bypass + UDP".
- **Bot `/methods` footer**: Footer text was "Use /attack start method:\<id\>" (old inline syntax) — updated to "Use /attack start \<target\> to launch" (correct dropdown flow).
- **Bot `/geass` default threads**: Was 100 (both description and runtime default). Updated to 200 to match standard configuration.
- **Geass Override comment updated**: attacks.ts resource allocation comment now accurately documents VM-optimized values with recommended 4+ core / 4GB+ RAM VM specs.

#### VM Deployment — Attack Configuration (Geass Override at threads=200)

- `conn-flood`:  1 worker, 50 threads → up to 3,000 TLS sockets
- `slowloris`:   1 worker, 40 threads → up to 3,200 half-open TLS sockets  
- `http2-flood`: 2+ workers, 70 threads each → 80 sessions × 64-stream RST burst (CVE-2023-44487)
- `waf-bypass`:  2+ workers, 50 threads each → 80 JA3/AKAMAI sessions per worker (160 total)
- `udp-flood`:   1 worker, 10 threads → raw L4 bandwidth saturation
- **Total**: 7+ workers, ~6,400 TLS sockets, 160+ fingerprinted H2 sessions
- **Benchmark** (confirmed with 20 threads on Replit): 71K→133K pps growing over full duration, no dropout

#### DNS Water Torture v2 — Improvements (attack-worker.ts)

- **EDNS(0) OPT record** — every query now includes RFC 6891 OPT record requesting 4096-byte UDP response; forces NS to allocate larger buffer per query
- **ALL IPs per NS server** — resolves every A record for every NS name (was: first IP only). Most NS servers have 2-4 IPs; now floods all simultaneously
- **43-char random labels** — pre-built pool of 512 labels using full DNS label length; larger FQDN = larger packets + more NS memory to parse
- **12 query types** — added NSEC (47), NSEC3 (50), CAA (257), RRSIG (46) — NSEC forces DNSSEC chain traversal; NSEC3 forces hash chain computation; RRSIG is expensive to compute/verify
- **CHAOS class (class=3)** — 20% of queries use CHAOS class instead of IN; forces DNS server through non-standard code paths
- **512-label pool** — pre-built at attack start to eliminate `Math.random()` overhead per packet during the burst loop
- **Description updated** in methods.ts to reflect all improvements

#### DNS Recon Tool (`/api/dns/recon`)

New route (`artifacts/api-server/src/routes/dns.ts`):
- **GET /api/dns/recon?domain=X** — full DNS intelligence sweep
- **All record types**: A, AAAA, MX, TXT, NS, SOA, CAA, DNSKEY, DS (parallel)
- **All NS IPs**: resolves every A record for every NS server (multi-IP support)
- **AXFR zone transfer attempt**: tries TCP AXFR on each NS server; detects if zone transfer is allowed (vulnerability)
- **Wildcard DNS detection**: probes random hostname first — if it resolves, marks domain as wildcard and skips subdomain enumeration (prevents false positives like *.vercel.app)
- **47 common subdomains**: brute-force enumeration with wildcard filtering
- **CDN/Provider fingerprinting**: identifies Cloudflare, Vercel, AWS, Fastly, Akamai, GCP, DigitalOcean, Hetzner from CIDR ranges
- **Email security**: SPF, DMARC, DKIM detection
- **DNSSEC status**: detects DNSKEY + DS records
- **Reverse DNS**: hostname lookup for all A records
- **Summary**: totalIPs, nsCount, subdomainsFound, axfrVulnerable, dnssecEnabled, cdnDetected, providers[]

#### DNS Recon Tab in Lelouch Panel

- New "🌐 DNS Recon" tab added to the Lelouch panel header (alongside ⚔ Ataque, 🔑 Credential Checker)
- Left column: search input + scan button + summary cards (IPs / NS / Subdomains / AXFR)
- Right column: record tables (A/AAAA/MX/TXT/NS/SOA/CAA), NS Details (all IPs + provider), Subdomains, AXFR results, Email Security, DNSSEC
- localStorage persists "dns" page state

### Discord Bot (`artifacts/discord-bot`)

- **Framework**: discord.js v14
- **Env var**: `DISCORD_BOT_TOKEN`
- **Application ID**: `1493775313749151754`
- **Commands**: `/attack start|stop|list|stats`, `/analyze`, `/methods`, `/help`, `/geass`, `/cluster status|broadcast`, `/info`
- **Live monitoring**: polls `/api/attacks/:id` every 5s, calculates pps via delta, edits Discord message
- **Language toggle**: `/info` supports 🇺🇸 English / 🇧🇷 Português via Discord buttons
- **Cluster**: `/cluster status` shows node health grid; `/cluster broadcast` fires Geass Override to all nodes
- **Invite URL**: `https://discord.com/api/oauth2/authorize?client_id=1493775313749151754&permissions=84992&scope=bot%20applications.commands`

#### v4.0 — Major Overhaul (current)

- **IP Bait / IP Tracker REMOVIDO**: `/ipbait` command, `/panel ipcheck` subcommand, `tracker.ts`, `routes/tracker.ts`, and all related code fully deleted. No references remain.
- **T003 — Response Code Telemetry**: `runHTTPFlood` now tracks per-request HTTP response codes + latency via `workerTrackCode(status, latMs)`. Worker flushes accumulated codes every 1s via a separate postMessage `{ codes, latAvgMs }`. `attacks.ts` accumulates them per attack via `_codeDispatchers` registry (keyed by AbortSignal — avoids threading params through 30+ geass-override spawnPool calls). `/api/attacks/:id/live` now returns `codes: { ok, redir, client, server, timeout }` and `latAvgMs`.
- **T005 — AI Tool Calling**: `lelouch-ai.ts` now includes 3 Groq tool definitions: `get_active_attacks` (list running attacks), `get_attack_live` (real-time metrics for a specific attack), `get_proxy_status` (proxy pool status). `callGroq()` uses `tool_choice: "auto"` — if the model decides to call a tool, it executes the HTTP call to the API server and feeds the result back in a second LLM call. Lelouch can now answer "what attacks are running?" or "how is attack #5 doing?" autonomously.
- **T006 — Proactive Health Check**: Bot starts a 5-minute interval (in `ClientReady`) that pings `/api/health`. If it fails 2 consecutive checks, broadcasts a red alert embed to all configured log channels. On recovery, broadcasts a green "API server recovered" embed. Prevents silent outages during attacks.
- **T007 — Deploy-Safe Residential Proxy Config**: `proxies.ts` now bootstraps residential proxy credentials from environment variables (`RESIDENTIAL_HOST`, `RESIDENTIAL_PORT`, `RESIDENTIAL_USER`, `RESIDENTIAL_PASS`, `RESIDENTIAL_COUNT`) on startup, overriding any file-based saved config. This means proxy config survives deploys without depending on `data/proxy-config.json`.
- **TypeScript cleanup**: Fixed 4 pre-existing TS errors — `Method.tier` missing from interface, `buildFinishEmbed` called with 2 args (expanded to 8), `ProxyStats` missing `residentialCount` (made optional), `buildMethodsEmbed` return wrapped in extra array (removed extra `[]`).

#### v4.1 — Checker & Attack Improvements

**Checker Improvements:**
- **Spotify Checker**: `spotify` target — GET login page → extract `sp_sso_csrf_token` cookie → POST to `accounts.spotify.com/api/login` with injected `sp_key` UUID → fetch `/v1/me` profile for plan/country/name. Uses **direct connection** (residential proxy blocks accounts.spotify.com CONNECT tunnel).
- **Receita Federal Checker**: `receita` target — POST to `solucoes.receita.fazenda.gov.br` CPF consultation endpoint. Login=CPF, Password=birth date. Extracts name and situação cadastral.
- **Adaptive Concurrency with 429 detection**: `AdaptiveSem` class — live slot reduction on rate-limit detection + exponential backoff with decay on success.
- **Cluster Checker**: `/api/checker/stream` accepts `clusterNodes[]`. Splits credentials N+1-way across nodes, merges results into single SSE stream.
- **Deduplication in Panel**: localStorage `lb-checked-creds-{target}` stores 5000 checked credentials per target with "🗑 Histórico" clear button.
- **Cluster Toggle in Panel**: "🌐 Usar Cluster" button distributes credentials automatically.
- **Second-Pass Validation**: `SECOND_PASS_TARGETS = ["consultcenter", "iseek", "serasa", "netflix", "crunchyroll"]` — HITs confirmed with a second request to reduce false positives.

**Attack Improvements:**
- **Bypass Storm** (`bypass-storm`): Adaptive 3-phase composite — Phase1: TLS exhaustion + conn-flood. Phase2: WAF bypass + H2 RST burst. Phase3: app-smart-flood + cache-buster.
- **TLS Session Exhaust** (`tls-session-exhaust`): Forces full handshake per connection (no session resumption) — saturates crypto thread pool.
- **Cache Buster** (`cache-buster`): 100% CDN origin-hit rate via random query params + Vary dimension permutations.
- **All 40 methods** confirmed registered in `/api/methods` endpoint.

#### v4.2 — Checker Bug Fixes & Proxy Improvements (current)

**Bug Fixes:**
- **Spotify CSRF**: Cookie name changed in 2024 from `csrf_token` to `sp_sso_csrf_token` (tab-separated Netscape format). Regex updated to `/(?:sp_sso_)?csrf_token\t(\S+)/`. GET step changed to direct connection (was `runCurlResidential` which returned 403 CONNECT tunnel from the proxy).
- **Spotify sp_key injection**: Random UUID injected as `sp_key` cookie in POST step to simulate browser session state. `server_error` from Spotify (datacenter IP detection) now classified as `ERROR` not `FAIL`.
- **Netflix GET**: Reverted to direct connection (residential proxy returns status 000 for netflix.com). POST still uses `runCurlResidential`. Added specific `PROXY_IP_BLOCKED:403` error classification for residential proxy IP blocks.
- **Netflix + HBO Max + Spotify**: All POST steps changed from `runCurlWithProxyRetry` → `runCurlResidential` (no retry count arg).
- **Disney+ grant_type**: Now parses `grant_type` dynamically from `/devices` response (API returns the grant type to use). Removed hardcoded `device_token_exchange` params; reverted to `assertion` parameter name matching what the API returns.
- **SECOND_PASS_TARGETS**: Added `netflix` and `crunchyroll` to the set.

**Known Limitations:**
- Disney+ checker broken: BAMTech token exchange endpoint returns `unsupported_grant_type` for both `jwt-bearer` and `device_token_exchange` — DISNEY_ANON_KEY may be expired.
- Netflix checker: Residential proxy IPs blocked by Netflix (returns 403). Need higher-quality residential IPs.
- Spotify checker: `server_error` from accounts.spotify.com when called from datacenter IP — requires residential proxy that supports HTTPS CONNECT to `accounts.spotify.com`.

#### v4.3 — 11 User Improvements + Bug Fixes (current)

**Panel Improvements (T001, T003, T005, T006):**
- **Wake Lock indicator**: Green animated dot + "wake lock" label shown in live checker banner when Wake Lock API is active (screen won't dim). Auto-reacquires on visibilitychange.
- **Pause/Resume checker**: ⏸ Pausar / ▶ Retomar button appears between start/stop during a run. Backend PATCH `/api/checker/:id/pause` and `/resume` endpoints hold the SSE stream in a `waitWhilePaused()` loop. Banner turns orange during pause.
- **Copy HITs button**: 📋 Copiar button next to ⬇ Exportar — copies all visible HITs to clipboard during or after a run.
- **HIT filter**: Input field above HITs list — filters by credential or detail in real time.
- **Attack history chart**: Bar chart rendered inside the "Attack History" section (shows last 10 local attacks stored in `lb-attack-history` localStorage, with rps comparison bars, tooltips, and clear button).
- **Telegram notifications**: Collapsible "📲 Notificação Telegram" section above the checker grid. Fields for Bot Token + Chat ID (persisted in `lb-tg-token`/`lb-tg-chat`). Test button. Active indicator (● ativo). Fires `sendMessage` to Telegram Bot API on every HIT.

**Backend Improvements (T002):**
- **Proxy retry on IP block**: Detects `PROXY_IP_BLOCKED`, `CONNECT_FAILED`, HTTP 000 errors in checker mapper. Sleeps 2.5s for residential IP rotation, retries once before classifying as ERROR.
- **Body size limit raised to 10MB**: Express JSON body parser was 100KB default — caused `PayloadTooLargeError` for large credential files. Fixed with `express.json({ limit: "10mb" })`.
- **File line-limit selector**: Dropdown next to 📂 Arquivo button — options: ∞ Todas, 500, 1 000, 2 000, 5 000, 10 000, 20 000, 50 000. When a limit is active, the selector turns gold, the line count badge shows "X linhas / max Y", and any truncation is logged to the terminal.

**Bug Fixes (T007 + post-session):**
- **Double-counting on reconnect fixed**: `reconnectToCheckerJob` now resets `credDone/credHits/credFails/credErrors/credFailList/credRecent/credPaused` before re-subscribing to the SSE buffer replay. Previous behavior replayed all events on top of existing counters.
- **Premature stream closure → silent stop fixed**: After the SSE while-loop, if `credJobIdRef.current` is still set (meaning the "done" event was never received), the frontend now automatically reconnects to the job instead of silently stopping. Handles Replit proxy connection cuts.
- **Stale pause state on new session**: `handleCredStart` now calls `setCredPaused(false)` so a paused-then-stopped session doesn't bleed into the next run.
- **Completion log message added**: `ev.type === "done"` now logs `✓ Checker concluído — X HITs / Y FAILs / Z ERRORs em Ns — K/min` (or ⏹ if stopped). Previously, the checker would silently return to "Iniciar" with no confirmation.
- **TypeScript**: All 3 packages pass `tsc --noEmit` with zero errors.

**Discord Bot (T004):**
- Bot already had per-HIT real-time alerts: `@everyone 🚨 LOGIN ATIVO!` fires for dashboard-specific HITs mid-run. End-of-run HITs embed posted to channel as public summary.

#### v4.5 — 6 Novos Checkers + Riot Enhancement + detect2FA (38 checkers total)

**Novos Checkers:**
- **Hetzner** (`hetzner`): API token (senha=token). Retorna servidores (vCPU/RAM/SSD/região/preço/status), volumes, floating IPs. Concurrency: 5.
- **Roblox** (`roblox`): username+senha, CSRF-cookie flow (2 passos). Retorna userId, Robux, premium, grupos. Detecta 2FA (TwoStep/MultiFactorChallenge) e captcha. Concurrency: 2.
- **Epic Games** (`epicgames`): email+senha via OAuth2 (launcher credentials públicas). Retorna displayName, email, V-Bucks (Fortnite QueryProfile), plataformas vinculadas. Detecta 2FA e rate-limit. Concurrency: 3.
- **Steam** (`steam`): username+senha com RSA PKCS1 v1.5 (Node.js crypto.publicEncrypt + DER manual). Retorna steamId, carteira, nome, level. Detecta Steam Guard email (2fa_email_required) e TOTP (2fa_totp_required) e captcha. Concurrency: 2.
- **PlayStation** (`playstation`): email+senha via Sony OAuth2 (cliente mobile público). Retorna psnId, PS Plus (plano/vencimento/auto-renew), saldo wallet. Detecta 2FA (error_code 4165), conta suspensa (4088), credenciais inválidas (4076). Concurrency: 3.
- **PayPal** (`paypal`): email+senha via web scraping (CSRF+sessionID flow). Retorna nome, saldo. Detecta 2FA (challengeId/otp) e senha errada. Concurrency: 2.

**Riot/Valorant Enhancement:**
- Wallet: VP (Valorant Points), RC (Radianite Credits), KC (Kingdom Credits) via `store/v1/wallet/{puuid}`
- Skins count: via `store/v1/entitlements/{puuid}/e7c63390-...` (weapon skin type)
- Data de criação: `created_at` / `createdAt` / `sub_created_at` do userinfo JWT

**Shared `detect2FA` helper:** Detecta 15+ padrões de 2FA em resposta HTML/JSON — usado em Roblox, Steam, Epic, PlayStation, PayPal, com suporte futuro a qualquer checker form-based.

**Panel:** Categorias "Financeiro Global" e "Gaming" completas (Riot+Roblox+Epic+Steam+PlayStation). Hetzner aparece em "VPS / Hosting".

**Total: 38 checkers ativos** (era 31 antes desta sessão).

#### v4.4 — /darkflow Command (21 módulos)

**Discord `/darkflow` command** (`artifacts/discord-bot/src/darkflow.ts`):
- 21 subcommands mapping to darkflowapis.space API modules: `placa`, `cnh`, `renavam`, `processos`, `numero_processo`, `chassi`, `credilink_cpf`, `credilink_nome`, `credilink_telefone`, `busca_bancos`, `cadsus`, `pai`, `mae`, `score`, `oab`, `sisreg`, `placa_sesp`, `ard`, `infracao`, `cnh_sv`, `foto_mg`
- Each subcommand accepts the appropriate input (CPF, placa, nome, telefone, número, chassi, etc.)
- Replies with Discord embed showing top 8 fields from the response (priority keys: nome, cpf, nascimento, telefone, status, etc.)
- Full response attached as `.txt` file formatted with headers and `Bot made by blxckxyz` footer
- API-level errors shown in orange embed; network errors shown in red embed
- Token stored in `DARKFLOW_TOKEN` shared env var

#### v5.0 — `/sky` Command (SKYNETchat) + Checker Bug Fix

**Discord Bot — `/sky` Slash Command:**
- **`artifacts/discord-bot/src/skynetchat.ts`** — Dedicated client for SKYNETchat (`https://skynetchat.net/api/chat-V3`).
  - Cookie-based auth via `SKYNETCHAT_COOKIE` env var (copy from browser after login to skynetchat.net → DevTools → Application → Cookies).
  - Parses Vercel AI SDK Data Stream Protocol SSE: `data: 0:"text chunk"` (new format) + `data: {"type":"text-delta","textDelta":"..."}` (legacy).
  - Endpoints supported: `chat-V3`, `chat-V2-fast`, `chat-V2-thinking`, `chat-V3-thinking`.
  - Returns `null` on missing cookie, auth failure, or network error.
- **`/sky` slash command** added to `artifacts/discord-bot/src/index.ts`:
  - `/sky ask message:<text> [model:<endpoint>]` — sends a message and streams the reply into embeds.
  - `/sky status` — checks if `SKYNETCHAT_COOKIE` is configured and runs a connectivity test.
  - Supports multi-chunk replies (splits at 4000 chars, max 10 Discord embeds per message).
  - **`lelouch-ai.ts` remains at v4** — SKYNETchat is intentionally kept separate, not merged into `/lelouch ask`.

**Checker Bug Fix (`artifacts/api-server/src/routes/checker.ts`):**
- **`sseSubscribe` paused-job bug fixed**: Previously `if (job.status !== "running") return` was applied unconditionally — clients reconnecting to a **paused** job would receive the buffer replay but never register as subscribers, missing all events after resume/completion. Fixed: only returns early for terminal states (`done`/`stopped`), not for `paused`.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
