import { API_BASE } from "./config.js";

export interface Attack {
  id:           number;
  target:       string;
  method:       string;
  threads:      number;
  duration:     number;
  status:       "running" | "stopped" | "finished" | "error";
  packetsSent:  number;
  bytesSent:    number;
  webhookUrl:   string | null;
  startedAt:    string;
  stoppedAt:    string | null;
  createdAt:    string;
  port?:        number;
}

export interface AttackStats {
  runningAttacks:    number;
  totalAttacks:      number;
  totalPacketsSent:  number;
  totalBytesSent:    number;
  attacksByMethod:   { method: string; count: number }[];
  recentAttacks:     Attack[];
  cpuCount?:         number;
}

export interface Method {
  id:          string;
  name:        string;
  layer:       string;
  protocol:    string;
  description: string;
}

export interface AnalyzeResult {
  target:           string;
  ip:               string | null;
  allIPs:           string[];
  isIP:             boolean;
  hasDNS:           boolean;
  httpAvailable:    boolean;
  httpsAvailable:   boolean;
  responseTimeMs:   number;
  serverHeader:     string;
  serverType:       string;
  serverLabel:      string;
  isCDN:            boolean;
  cdnProvider:      string;
  hasWAF:           boolean;
  wafProvider:      string;
  supportsH2:       boolean;
  supportsH3:       boolean;
  altSvc:           string;
  hasHSTS:          boolean;
  hstsMaxAge:       number;
  hasGraphQL:       boolean;
  hasWebSocket:     boolean;
  openPorts:        number[];
  recommendations:  Recommendation[];
}

export interface Recommendation {
  method:            string;
  name:              string;
  score:             number;
  tier:              string;
  reason:            string;
  suggestedThreads:  number;
  suggestedDuration: number;
  protocol:          string;
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  // 2.5s hard timeout — prevents slow DB queries from blocking the Discord event loop
  // and causing "The application did not respond" errors (Discord's 3s window).
  const signal = opts?.signal ?? AbortSignal.timeout(2500);
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface LiveConns {
  conns:        number;
  running:      boolean;
  pps:          number;
  bps:          number;
  totalPackets: number;
  totalBytes:   number;
}

const LIVE_FALLBACK: LiveConns = { conns: 0, running: false, pps: 0, bps: 0, totalPackets: 0, totalBytes: 0 };

export const api = {
  getMethods:   ()           => req<Method[]>("/api/methods"),
  getAttacks:   ()           => req<Attack[]>("/api/attacks"),
  getStats:     ()           => req<AttackStats>("/api/attacks/stats"),
  getAttack:    (id: number) => req<Attack>(`/api/attacks/${id}`).catch(() => null as null),
  getLiveConns: (id: number) => req<LiveConns>(`/api/attacks/${id}/live`).catch(() => LIVE_FALLBACK),

  startAttack: (body: {
    target:    string;
    method:    string;
    threads:   number;
    duration:  number;
    port?:     number;
    packetSize?: number;
  }) => req<Attack>("/api/attacks", {
    method: "POST",
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(8_000), // 8s — DB insert can be slow under load
  }),

  stopAttack:  (id: number) =>
    req<{ ok: boolean }>(`/api/attacks/${id}/stop`, { method: "POST" }),

  extendAttack: (id: number, seconds = 60) =>
    req<{ ok: boolean; extended: number } & Attack>(`/api/attacks/${id}/extend`, {
      method: "PATCH",
      body:   JSON.stringify({ seconds }),
    }),

  deleteAttack: (id: number) =>
    req<{ ok: boolean }>(`/api/attacks/${id}`, { method: "DELETE" }),

  analyze: (target: string) =>
    req<AnalyzeResult>("/api/analyze", {
      method: "POST",
      body:   JSON.stringify({ url: target }),  // API schema uses 'url', not 'target'
      signal: AbortSignal.timeout(15_000),      // 15s — DNS probes + HTTP fingerprinting
    }),

  getClusterStatus: () =>
    req<ClusterStatus>("/api/cluster/status"),

  getClusterNodes: () =>
    req<{ nodes: string[]; count: number; cpus: number; totalRamMb: number; freeRamMb: number }>("/api/cluster/nodes"),
};

export interface ClusterNodeResult {
  url:       string;
  online:    boolean;
  latencyMs: number;
  cpus?:     number;
  freeMem?:  number;
}

export interface ClusterStatus {
  self: {
    url:       string;
    online:    boolean;
    latencyMs: number;
    cpus:      number;
    freeMem:   number;
  };
  nodes:            ClusterNodeResult[];
  totalOnline:      number;
  configuredNodes:  number;
}
