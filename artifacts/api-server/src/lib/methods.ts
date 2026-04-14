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
    description: "Absolute Geass command. Combines real HTTP flood (all methods) + TCP connection table overflow simultaneously. Two vectors at once — nothing can stop it.",
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
    name: "HTTP/2 Rapid Reset",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Exploits HTTP/2 multiplexing — HEADERS+RST_STREAM at extreme rate (CVE-2023-44487).",
  },
  {
    id: "slowloris",
    name: "Slowloris",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "Opens many connections and sends partial HTTP headers slowly, tying up server threads.",
  },
  {
    id: "rudy",
    name: "R.U.D.Y",
    layer: "L7" as const,
    protocol: "HTTP" as const,
    description: "R-U-Dead-Yet: sends POST data at an extremely slow rate, holding connections open indefinitely.",
  },
];
