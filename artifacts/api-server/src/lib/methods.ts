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
    name: "DNS Amplification  [54x]",
    layer: "L3" as const,
    protocol: "UDP" as const,
    description: "Exploits open DNS resolvers — amplification factor up to 54x floods origin bandwidth.",
  },
  {
    id: "ntp-amp",
    name: "NTP Amplification  [556x]",
    layer: "L3" as const,
    protocol: "UDP" as const,
    description: "Uses monlist command against NTP servers — 556x amplification. Generates terabit-class traffic.",
  },
  {
    id: "mem-amp",
    name: "Memcached Amp  [51000x]",
    layer: "L3" as const,
    protocol: "UDP" as const,
    description: "Abuses exposed Memcached servers — amplification factor up to 51,000x. Capable of terabit attacks.",
  },
  {
    id: "ssdp-amp",
    name: "SSDP Amplification  [30x]",
    layer: "L3" as const,
    protocol: "UDP" as const,
    description: "Abuses UPnP SSDP protocol — 30x amplification, highly effective against IoT and home routers.",
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
    name: "ICMP Flood",
    layer: "L3" as const,
    protocol: "ICMP" as const,
    description: "Sends a flood of ICMP echo request packets to saturate the target's network link.",
  },

  // ── GEASS OVERRIDE — Maximum Multi-Vector ────────────────
  {
    id: "geass-override",
    name: "Geass Override ∞",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "ABSOLUTE MAXIMUM — 8 simultaneous vectors: ConnFlood + Slowloris + H2 RST (CVE-2023-44487) + H2 CONTINUATION (CVE-2024-27316) + WAF Bypass + WebSocket Exhaust + GraphQL DoS + UDP. Unstoppable.",
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
    description: "HTTP flood with browser emulation to bypass basic bot protection and challenge pages.",
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
