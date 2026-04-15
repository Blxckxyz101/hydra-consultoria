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

## Lelouch Britannia Panel

A network stress test / load testing control panel themed after Lelouch vi Britannia from Code Geass.

### Frontend (`artifacts/mikubeam-panel`)

- **Theme**: Lelouch Britannia — dark imperial background, gold/crimson accents, Cinzel display font
- **Layout**: Single-page design matching MikuMikuBeam screenshot — centered card with character GIF, target input, attack controls, stats, progress bar, terminal
- **Mobile**: Fully responsive for iOS (safe-area insets, touch-friendly sizing, stacked layout)
- **Fonts**: Cinzel (title), Crimson Text (body), Share Tech Mono (terminal)
- **Character**: Lelouch GIF from `public/lelouch.gif`

### Backend (`artifacts/api-server`)

- Routes: `/api/attacks` (CRUD + stop), `/api/attacks/stats`, `/api/methods`
- **Real attack workers** using `worker_threads` + real network I/O (dgram UDP, net TCP, fetch HTTP)
- Methods: 24 attack vectors — UDP Flood/Bypass, DNS/NTP/Mem/SSDP Amplification, SYN/TCP/ACK/RST Flood, ICMP, HTTP Flood/Bypass, HTTP/2 Rapid Reset, H2 CONTINUATION (CVE-2024-27316), Slowloris, R.U.D.Y, RUDY v2, WebSocket Exhaustion, GraphQL DoS, QUIC/HTTP3, Cache Poison, TLS Renegotiation, SSL Death Record, Conn Flood, HPACK Bomb, Geass Override (13 vectors)
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

### Discord Bot (`artifacts/discord-bot`)

- **Framework**: discord.js v14
- **Env var**: `DISCORD_BOT_TOKEN`
- **Application ID**: `1493775313749151754`
- **Commands**: `/attack start|stop|list|stats`, `/analyze`, `/methods`, `/help`
- **Live monitoring**: polls `/api/attacks/:id` every 5s, calculates pps via delta, edits Discord message
- **Invite URL**: `https://discord.com/api/oauth2/authorize?client_id=1493775313749151754&permissions=84992&scope=bot%20applications.commands`

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
