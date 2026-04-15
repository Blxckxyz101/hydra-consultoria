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
    description: "Absolute Geass command. 4 simultaneous vectors: Connection Flood (TLS exhaustion) + Slowloris + HTTP/2 Rapid Reset + UDP. Bypasses all rate limiting — operates below HTTP layer.",
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
