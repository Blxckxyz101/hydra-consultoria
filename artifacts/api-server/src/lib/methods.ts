export const ATTACK_METHODS = [
  // ── Layer 4 UDP ─────────────────────────────────────────
  {
    id: "udp-flood",
    name: "UDP Flood",
    layer: "L4" as const,
    protocol: "UDP" as const,
    description: "Sends a massive number of UDP packets to a target port, exhausting bandwidth and resources.",
  },
  {
    id: "udp-bypass",
    name: "UDP Bypass",
    layer: "L4" as const,
    protocol: "UDP" as const,
    description: "UDP flood with bypass techniques to evade basic rate limiting and DDoS mitigation.",
  },

  // ── Amplification (L3/UDP) ────────────────────────────
  {
    id: "dns-amp",
    name: "DNS Water Torture  [CDN-bypass]",
    layer: "L3" as const,
    protocol: "UDP" as const,
    description: "DNS Water Torture attack v2 — auto-resolves ALL IPs for ALL NS servers (not just first), floods every NS IP simultaneously. EDNS(0) OPT record forces 4096-byte response buffer per query. 43-char random labels (DNS max) create larger packets. 12 query types: A/AAAA/MX/TXT/ANY/DNSKEY/DS/SOA/NSEC/NSEC3/CAA/RRSIG. 20% CHAOS class queries force unexpected DNS parsing paths. Pre-built 512-label pool eliminates randStr() bottleneck. Bypasses CDN/WAF entirely — NS servers are NOT behind Cloudflare/Akamai.",
  },
  {
    id: "ntp-amp",
    name: "NTP Flood  [mode7+mode3]",
    layer: "L3" as const,
    protocol: "UDP" as const,
    description: "Real NTP flood — sends mode 7 monlist requests (CVE-2013-5211) + mode 3 client packets directly to target port 123. Mode 7 monlist forces server to dump last 600 clients (~48KB response). High concurrency saturates NTP service and upstream bandwidth. Real NTP binary protocol packets.",
  },
  {
    id: "mem-amp",
    name: "Memcached UDP Flood  [binary]",
    layer: "L3" as const,
    protocol: "UDP" as const,
    description: "Real Memcached binary protocol UDP flood to port 11211. Sends get (random keys) + stats commands (forces full server metadata dump). Exposed Memcached is extremely common on misconfigured servers — get response up to 65KB per request. Real binary Memcached protocol via dgram.",
  },
  {
    id: "ssdp-amp",
    name: "SSDP M-SEARCH Flood  [UPnP]",
    layer: "L3" as const,
    protocol: "UDP" as const,
    description: "Real SSDP M-SEARCH flood to port 1900 — rotates ST targets (ssdp:all, rootdevice, WANDevice, InternetGatewayDevice, MediaServer, Chromecast). Forces UPnP stack to respond to each query. Random CPFN header defeats dedup filters. Real SSDP protocol via dgram UDP.",
  },
  {
    id: "cldap-amp",
    name: "CLDAP Flood  [UDP/389 LDAP Exhaustion]",
    layer: "L3" as const,
    protocol: "UDP" as const,
    description: "Connectionless LDAP (CLDAP) flood to port 389. Sends BER-encoded LDAP SearchRequest packets for rootDSE attributes — each 39-62 byte request forces the LDAP service to parse and execute a directory search. Against Windows Active Directory servers: exhausts the LDAP worker thread pool and triggers full directory lookups per packet. Alternates between minimal rootDSE query (all attributes) and supportedCapabilities request (~2KB response per query). Effective against any exposed OpenLDAP or Windows AD service.",
  },

  // ── Layer 4 TCP ─────────────────────────────────────────
  {
    id: "syn-flood",
    name: "SYN Flood",
    layer: "L4" as const,
    protocol: "TCP" as const,
    description: "Exhausts TCP connection table (SYN_RECV state) — extremely effective against unprotected hosts.",
  },
  {
    id: "tcp-flood",
    name: "TCP Flood",
    layer: "L4" as const,
    protocol: "TCP" as const,
    description: "Floods the target with TCP SYN packets, exhausting connection table capacity.",
  },
  {
    id: "tcp-ack",
    name: "TCP ACK Flood",
    layer: "L4" as const,
    protocol: "TCP" as const,
    description: "Sends ACK packets without established connections, forcing the target to process each one.",
  },
  {
    id: "tcp-rst",
    name: "TCP RST Flood",
    layer: "L4" as const,
    protocol: "TCP" as const,
    description: "Sends RST packets to disrupt existing TCP connections on the target.",
  },

  // ── Layer 3 ICMP ─────────────────────────────────────────
  {
    id: "icmp-flood",
    name: "ICMP Flood  [3-tier]",
    layer: "L3" as const,
    protocol: "ICMP" as const,
    description: "Real ICMP echo request flood — 3-tier engine: Tier 1 raw-socket (production with CAP_NET_RAW, true ICMP type 8 packets with random 1400-byte payload), Tier 2 hping3 --icmp --flood (after apt install hping3 on deploy server), Tier 3 large-packet UDP saturation flood (always works, no root needed). Defeats ICMP rate limiters via random payload.",
  },

  // ── GEASS OVERRIDE — Maximum Multi-Vector ────────────────
  {
    id: "geass-override",
    name: "Hydra Override ∞",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "ABSOLUTE MAXIMUM — 30 simultaneous real attack vectors: ConnFlood + Slowloris + H2 RST (CVE-2023-44487) + H2 CONTINUATION (CVE-2024-27316) + HPACK Bomb + WAF Bypass + WebSocket Exhaust + GraphQL Fragment Bomb + RUDY v2 + Cache Poison + HTTP Bypass + Keepalive Exhaust + H2 Settings Storm (326K pps) + HTTP Pipeline (300K req/s) + H2 PING Storm + HTTP Smuggling + TLS Renegotiation + SSL Death + QUIC/H3 + XML Bomb + Slow Read + Range Flood + SYN Flood + ICMP Flood + DNS Water Torture + NTP Flood + Memcached UDP + SSDP M-SEARCH + UDP Flood + DoH Flood. ARES OMNIVECT ∞ — HYDRA COMMANDS YOU!",
  },

  // ── NEW: H2 Settings Storm ────────────────────────────────
  {
    id: "h2-settings-storm",
    name: "H2 Settings Storm (HPACK + Flow Control Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Three simultaneous attack layers per H2 connection: (1) Alternates SETTINGS_HEADER_TABLE_SIZE between 0 and 65536 forcing continuous HPACK dynamic table wipe/rebuild per RFC 7541 §4.2; (2) Holds 20-50 half-open streams open simultaneously locking server connection slots; (3) Floods WINDOW_UPDATE frames on every open stream forcing per-stream flow-control recalculation per RFC 7540 §6.9. CPU + memory combined drain.",
  },

  // ── HTTP Pipeline Flood ───────────────────────────────────
  {
    id: "http-pipeline",
    name: "HTTP Pipeline Flood (HTTP/1.1 Pipelining)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "HTTP/1.1 pipelining — sends 128 requests per TCP write batch without waiting for responses (RFC 7230 §6.3.2). Each connection sends requests back-to-back, keeping the socket in keep-alive state. Server must process all requests serially — queue grows unbounded under sustained pipeline pressure. Pool of 256 pre-built request buffers with randomized paths/IPs/tokens refreshed continuously. Achieves 50K–300K req/s per worker depending on RTT. Highly effective against nginx direct (no CDN).",
  },

  // ── NEW: HPACK Bomb ───────────────────────────────────────
  {
    id: "hpack-bomb",
    name: "HPACK Bomb (RFC 7541 Table Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Sends HTTP/2 HEADERS frames packed with 50–150 unique headers using HPACK incremental indexing (type 0x40). Server MUST add each header to its dynamic HPACK table (64KB default) and continuously evict oldest entries → tight allocator + CPU eviction loop. Targets all H2 servers — nginx, h2o, Envoy, Cloudflare Workers, AWS ALB. No CVE patch exists; this exploits required RFC behavior.",
  },

  // ── NEW: CVE-2024-27316 H2 CONTINUATION ──────────────────
  {
    id: "http2-continuation",
    name: "H2 CONTINUATION Flood (CVE-2024-27316)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Sends HEADERS frames without END_HEADERS flag, then floods CONTINUATION frames — server buffers all headers indefinitely → OOM. Affects nginx ≤1.25.4, Apache ≤2.4.58, Envoy, HAProxy.",
  },

  // ── NEW: TLS Renegotiation ────────────────────────────────
  {
    id: "tls-renego",
    name: "TLS Renegotiation DoS",
    layer: "L4" as const,
    protocol: "TCP" as const,
    description: "Forces TLS 1.2 renegotiation on every connection — each renegotiation = full public-key handshake (~3ms CPU on server). 200 slots × 5 renegotiations/sec = 1,000 handshakes/sec CPU drain.",
  },

  // ── NEW: WebSocket Exhaustion ─────────────────────────────
  {
    id: "ws-flood",
    name: "WebSocket Exhaustion",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Opens thousands of WebSocket connections and holds them with pings. Servers allocate a goroutine/thread per WS — far more expensive than HTTP. DEV: 400 conns | PROD: 5,000 conns.",
  },

  // ── NEW: GraphQL Introspection DoS ───────────────────────
  {
    id: "graphql-dos",
    name: "GraphQL Introspection DoS",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Sends deeply nested queries (15-level recursion, alias bombs, batched introspection). Exponential resolver CPU: O(N^15) complexity. Destroys unprotected GraphQL APIs.",
  },

  // ── NEW: QUIC/HTTP3 Flood ─────────────────────────────────
  {
    id: "quic-flood",
    name: "QUIC / HTTP3 Flood (RFC 9000)",
    layer: "L4" as const,
    protocol: "UDP" as const,
    description: "Sends QUIC Initial packets (Long Header + CRYPTO frame) with random DCIDs. Server allocates connection state per unique DCID → CPU + memory exhaustion. Targets port 443/UDP.",
  },

  // ── NEW: Cache Poisoning DoS ──────────────────────────────
  {
    id: "cache-poison",
    name: "CDN Cache Poisoning DoS",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Fills CDN/reverse-proxy cache with unique keys (random params, X-Forwarded-Host, Range, Vary bombs) → evicts legitimate content, 100% origin miss rate. Kills Cloudflare/Fastly/Akamai/Varnish.",
  },

  // ── NEW: RUDY v2 Multipart ────────────────────────────────
  {
    id: "rudy-v2",
    name: "RUDY v2 — Multipart Slow POST",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Enhanced R.U.D.Y using multipart/form-data with 70-char boundary and 1GB Content-Length. Server waits for closing boundary that never arrives while holding a thread per connection.",
  },

  // ── NEW: SSL Death Record ─────────────────────────────────
  {
    id: "ssl-death",
    name: "SSL Death Record",
    layer: "L4" as const,
    protocol: "TCP" as const,
    description: "Sends 1-byte TLS application records after handshake. Server AES-GCM decrypts + MAC-verifies each 1-byte record individually. 400 slots × 100 records/sec = 40,000 decrypt ops/sec on server CPU.",
  },

  // ── Connection Flood ─────────────────────────────────────
  {
    id: "conn-flood",
    name: "Connection Flood",
    layer: "L4" as const,
    protocol: "TCP" as const,
    description: "Opens thousands of TLS connections and holds them open. Exhausts nginx worker_connections (4096 max) before any rate limiting can activate — fully bypasses HTTP-level protection.",
  },

  // ── Layer 7 HTTP ─────────────────────────────────────────
  {
    id: "http-flood",
    name: "HTTP Flood",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Sends a high volume of HTTP GET requests to overwhelm the web server.",
  },
  {
    id: "http-bypass",
    name: "HTTP Bypass",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Chrome-fingerprinted 3-layer bypass: Layer A=fetch+Chrome headers+proxy rotation (50%), Layer B=raw HTTP/1.1 high-concurrency (30%), Layer C=slow-drain incomplete requests (20%). JA3+AKAMAI fingerprint — defeats Cloudflare/Akamai bot detection.",
  },
  {
    id: "http2-flood",
    name: "HTTP/2 Rapid Reset ∞",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "True CVE-2023-44487: sends HEADERS then immediate RST_STREAM — server wastes CPU on each cancel. 64-stream burst per tick, bypasses maxConcurrentStreams limit completely.",
  },
  {
    id: "slowloris",
    name: "Slowloris",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Opens 25,000 connections sending partial HTTP headers with 10-25s trickle — exhausts Apache/nginx worker pool without triggering rate limits.",
  },
  {
    id: "rudy",
    name: "R.U.D.Y (True SlowPOST)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "R-U-Dead-Yet: claims Content-Length: 1GB then sends 1-2 bytes every 5-15 seconds via raw socket. Apache/IIS hold the thread forever — 25K connections = full thread pool exhaustion.",
  },

  // ── WAF Bypass ───────────────────────────────────────────────────────
  {
    id: "waf-bypass",
    name: "Hydra WAF Bypass ∞",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "HYDRA WAF OMNIVECT ∞ — 7-vector simultaneous Cloudflare/Akamai/AWS destruction: (I) Chrome H2 Primary Flood (256 streams/conn, 10ms reconnect) + (II) Subresource Storm (15-18 asset requests per page load, 15-18× RPS multiplier) + (III) Cache Annihilator (unique Vary dimensions = 100% CDN origin miss) + (IV) Session Amplifier (5-step user journeys, forces DB + session state) + (V) Origin Direct Fire (DNS subdomain enumeration bypasses CF edge entirely) + (VI) H2 Stream Drain (64 frozen buffers per conn) + (VII) Adaptive Burst Mode (fires at T+20s, 15s waves at 2.0× rate). JA3 fingerprint randomization + Chrome AKAMAI H2 + __cf_bm/__cfruid simulation throughout.",
  },

  // ── New ARES OMNIVECT ∞ Vectors ──────────────────────────────────────
  {
    id: "slow-read",
    name: "Slow Read (TCP Buffer Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Establishes HTTP/HTTPS connections, sends valid requests, then pauses TCP receive (socket.pause()). The server's send buffer fills up and server threads stay blocked indefinitely. Effective against Apache, Tomcat, IIS. Drip-reads 1 byte/600ms to prevent server FIN.",
  },
  {
    id: "range-flood",
    name: "HTTP Range Flood (Multi-Range Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Sends Range: bytes=0-0,1-1,...,499-499 forcing server to validate all 500 ranges against the resource, build a multipart/byteranges response with 500 MIME parts, and perform 500× disk/memory seeks per request. Effectively multiplies server I/O cost 500×.",
  },
  {
    id: "xml-bomb",
    name: "XML Bomb / XXE DoS (Billion Laughs)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "POSTs billion-laughs-lite XML payload to SOAP/XMLRPC/XML REST endpoints. If server parses XML without entity limits, parser expands &d; → 16^3 × 64B = gigabytes of memory/CPU. Also includes XXE probe to detect out-of-band exfiltration vulnerabilities.",
  },
  {
    id: "h2-ping-storm",
    name: "HTTP/2 PING Storm (PING Frame Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP/2" as const,
    description: "Every HTTP/2 PING frame MUST be ACK'd by the server per RFC 7540 §6.7. Sends 10,000 PING frames/second per connection — server must context-switch, allocate a PING ACK frame, and write it to the connection's write queue for every single PING. Massive CPU + network overhead.",
  },
  {
    id: "http-smuggling",
    name: "HTTP Request Smuggling (TE/CL Desync)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Sends requests with conflicting Transfer-Encoding: chunked and Content-Length headers that disagree, exploiting HA/load-balancer parsing inconsistencies (CL.TE and TE.CL variants). Poisons the backend request queue — subsequent victims' requests are intercepted.",
  },
  {
    id: "doh-flood",
    name: "DNS over HTTPS Flood (DoH Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Floods DNS-over-HTTPS endpoint (/dns-query) with RFC 8484 wire-format DNS queries for random domains. Forces resolver to perform recursive DNS lookups, exhausting the DNS resolver thread pool and upstream DNS bandwidth. Effective against any server running a DNS resolver.",
  },
  {
    id: "keepalive-exhaust",
    name: "Keepalive Exhaust (HTTP/1.1 Connection Pool)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Opens keep-alive connections and pipelines 128 requests per connection in a burst without waiting for responses. Server must process all queued requests before closing. Combined with POST bodies, saturates the server's keep-alive connection pool (MaxKeepAliveRequests limit).",
  },
  {
    id: "app-smart-flood",
    name: "Application Smart Flood (DB Query Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Sends randomized POST requests to high-cost application endpoints: /login, /search, /checkout, /register, /api/users, /api/products/search. Each request contains unique random form data forcing an uncacheable database query per request. Exhausts the DB connection pool and backend thread pool simultaneously.",
  },
  {
    id: "large-header-bomb",
    name: "Large Header Bomb (HTTP Parser Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Sends HTTP requests with 16KB+ of randomized HTTP headers — hundreds of custom X-* headers with long random names and values. Forces the server's HTTP parser to allocate a large heap buffer per request just to parse headers. Bypasses WAFs that only inspect the body. Effective against nginx (8KB limit), Apache, and IIS.",
  },
  {
    id: "http2-priority-storm",
    name: "HTTP/2 PRIORITY Storm (Stream Dependency Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP/2" as const,
    description: "HTTP/2 PRIORITY frames (RFC 7540 §6.3) define stream dependency trees. Sends thousands of PRIORITY frames referencing random stream IDs with random weights, forcing the server to rebuild its entire stream priority tree on every frame. This is a pure CPU + heap exhaustion attack that bypasses connection limits.",
  },
  {
    id: "h2-rst-burst",
    name: "H2 RST Burst (CVE-2023-44487 Pure RST Engine)",
    layer: "L7" as const,
    protocol: "HTTP/2" as const,
    description: "Dedicated CVE-2023-44487 (HTTP/2 Rapid Reset) exploit engine — sends HEADERS frames immediately followed by RST_STREAM frames in a tight loop. Each pair forces the server to (1) allocate stream state, (2) dispatch to handler thread, (3) accept RST → discard. At 1000+ RST pairs/sec the server's H2 state machine allocation/deallocation cycle causes extreme CPU pressure on nginx (event loop stall), Apache, and Envoy. Uses JA4 fingerprint rotation to evade CDN RST rate limiters.",
  },
  {
    id: "grpc-flood",
    name: "gRPC Flood (Handler Thread Pool Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP/2" as const,
    description: "Sends properly framed gRPC requests (content-type: application/grpc) over HTTP/2 to exhaust server-side gRPC handler threads. gRPC uses a SEPARATE quota and rate-limiter from HTTP — most WAFs (Cloudflare, Akamai, Imperva) have more lenient limits for gRPC. Each request sends a 5-byte length-prefixed gRPC frame with a valid protobuf payload, targeting health/reflection/custom gRPC endpoints. Forces the server to (1) decode gRPC frame, (2) invoke handler, (3) encode response — exhausting the gRPC goroutine/thread pool independently of the HTTP handler pool.",
  },

  // ── NEW: TLS Session Cache Exhaustion ─────────────────────────────────────
  {
    id: "tls-session-exhaust",
    name: "TLS Session Cache Exhaustion",
    layer: "L4" as const,
    protocol: "TCP" as const,
    description: "Forces full TLS handshakes on every connection by disabling session resumption (unique random session IDs, no tickets). Each new TLS 1.2/1.3 handshake requires an asymmetric key exchange (~3-5ms CPU on server). Opens thousands of connections/sec, each triggering a full handshake — server's TLS session cache fills completely, LRU evictions become constant, and the crypto thread pool saturates. More CPU-intensive than conn-flood because it forces RSA/ECDHE operations per connection rather than just TCP state allocation.",
  },

  // ── NEW: HTTP Cache Busting ───────────────────────────────────────────────
  {
    id: "cache-buster",
    name: "HTTP Cache Busting (100% Origin Hit Rate)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Sends GET requests with unique cache-busting parameters on every request: random query strings (?_cb=...), randomized Vary headers (Accept-Language, Accept-Encoding permutations), and Cache-Control: no-cache / Pragma: no-cache. Forces a 100% origin miss rate — every request bypasses CDN edge cache and hits the origin server directly. Extremely effective against Cloudflare/Akamai/Fastly-cached sites where 95%+ of traffic normally hits edge nodes. Combined with high concurrency, overwhelms the origin that was previously shielded by CDN caching.",
  },

  // ── NEW: CDN Purge Flood ───────────────────────────────────────────────────
  {
    id: "cdn-purge-flood",
    name: "CDN Purge Flood ∞ (Cache Invalidation via Proxies)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Floods GoCache and generic CDN purge endpoints (POST /cdn-cgi/purge, /cdn-cgi/cache-purge, PURGE/BAN methods) via 1000 rotating residential proxies. Each purge request instructs the CDN to invalidate its cached copy, forcing every subsequent visitor request to hit the origin server directly — bypassing edge cache completely. Carries GoCache-specific bypass headers (X-GoCache-Bypass, Surrogate-Control: no-store, Edge-Control: no-store) to prevent purge calls from being served from cache themselves. 90% of requests via residential proxies: CDN cannot rate-limit by IP without blocking legitimate cache management traffic. Combined with waf-bypass, forces 100% origin hit rate.",
  },

  // ── NEW: Bypass Storm (Composite Multi-Phase) ─────────────────────────────
  {
    id: "bypass-storm",
    name: "Bypass Storm ∞ (Adaptive Multi-Phase Composite)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Intelligent 3-phase composite attack that adapts to WAF/CDN defenses: Phase 1 (0-25% of duration) = TLS Session Exhaustion + Connection Flood — exhausts the TCP/TLS connection table before any HTTP rate limiting can activate. Phase 2 (25-70%) = WAF Bypass + H2 RST Burst (CVE-2023-44487) — while connection table is under pressure, fires simultaneous JA3-randomized Chrome HTTP/2 bypass + rapid RST pairs. Phase 3 (70-100%) = App Smart Flood + Cache Busting — bypasses any surviving WAF rules with application-layer DB-exhausting POST requests + 100% origin-hit cache destruction. Each phase uses a separate thread pool — all 3 phases run concurrently after initial sequencing. Combines the most effective bypass technique from 7 individual vectors.",
  },

  // ── NEW: Vercel / Next.js Specific Flood ──────────────────────────────────
  {
    id: "vercel-flood",
    name: "Vercel Flood ∞ (Next.js 4-Vector Edge Annihilation)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Vercel/Next.js specific 4-vector attack that bypasses all Vercel edge caching simultaneously: (1) RSC Bypass — requests with ?_rsc=<random> trigger full React Server Component renders; Vercel adds Vary:RSC so every unique _rsc = cache MISS → origin serverless function invocation. (2) Image Optimizer DoS — /_next/image?url=X&w=<N>&q=<N> with unique random (url,width,quality,format) triggers CPU-intensive libvips resize+encode on each cold hit; thousands of concurrent resize ops exhaust Vercel's image lambda pool. (3) Edge API Cold Start — /api/* routes with unique params prevent Vercel runtime reuse; each cold start allocates a new Node.js V8 isolate (~50ms startup). (4) ISR Data Route Flood — /_next/data/<buildId>/[page].json with random buildIds forces getServerSideProps execution per request. Combined: saturates Vercel's serverless lambda concurrency limit (default 1000 concurrent executions), triggers 429/502 responses.",
  },

  // ── NEW: H2 True Multiplexing ─────────────────────────────────────────────
  {
    id: "h2-multiplex",
    name: "H2 Multiplex — True Stream Pool Exhaustion",
    layer: "L7" as const,
    protocol: "HTTP/2" as const,
    description: "True HTTP/2 multiplexing: N persistent sessions each maintaining maxConcurrentStreams open streams simultaneously. Zero RST — each stream sends a real request (60% GET + 40% POST with real bodies), reads the full response, then the slot is immediately refilled. Result: constant maximum pressure with 10x fewer TCP connections than HTTP/1.1. Dev: 20 sessions x 32 streams = 640 concurrent requests over 20 TCP conns. Prod: 150 sessions x 128 streams = 19,200 concurrent requests over 150 TCP conns. Bypasses per-IP connection limits (CDN limits 100 conns/IP but 10 sessions x 128 streams = 1,280 virtual reqs from 1 IP). POST bodies force origin handler + body buffer allocation. Cache-busted URLs force 100% origin cache miss. Adapts to server SETTINGS maxConcurrentStreams in real time. Appears as legitimate browser traffic.",
  },
];
