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
    description: "DNS Water Torture attack — floods target's authoritative NS servers with random subdomain queries. Bypasses CDN/WAF (NS servers are NOT protected by CloudFlare/Akamai). Forces recursive resolution for every query, fills NXDOMAIN cache, exhausts NS memory. Real DNS binary protocol packets via dgram UDP.",
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
    name: "Geass Override ∞",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "ABSOLUTE MAXIMUM — 19 simultaneous real attack vectors: ConnFlood + Slowloris + H2 RST (CVE-2023-44487) + H2 CONTINUATION (CVE-2024-27316) + HPACK Bomb + WAF Bypass + WebSocket Exhaust + GraphQL Fragment Bomb + RUDY v2 + Cache Poison + TLS Renegotiation + QUIC/H3 + SSL Death + H2 Settings Storm + ICMP Flood + DNS Water Torture (CDN-bypass!) + NTP Flood + Memcached UDP + SSDP M-SEARCH. NOVEMDECIM ARES COMMAND.",
  },

  // ── NEW: H2 Settings Storm ────────────────────────────────
  {
    id: "h2-settings-storm",
    name: "H2 Settings Storm (HPACK + Flow Control Exhaustion)",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Three simultaneous attack layers per H2 connection: (1) Alternates SETTINGS_HEADER_TABLE_SIZE between 0 and 65536 forcing continuous HPACK dynamic table wipe/rebuild per RFC 7541 §4.2; (2) Holds 20-50 half-open streams open simultaneously locking server connection slots; (3) Floods WINDOW_UPDATE frames on every open stream forcing per-stream flow-control recalculation per RFC 7540 §6.9. CPU + memory combined drain.",
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
    name: "Geass WAF Bypass ∞",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "4-layer Cloudflare/Akamai/AWS evasion: JA3 TLS fingerprint randomization + Chrome-exact HTTP/2 AKAMAI SETTINGS + precise header ordering + __cf_bm/__cfruid cookie simulation. Each connection appears as a distinct real Chrome browser.",
  },
];
