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
  hasDNS:           boolean;
  httpAvailable:    boolean;
  httpsAvailable:   boolean;
  responseTimeMs:   number;
  serverType:       string;
  statusCode:       number;
  isCDN:            boolean;
  cdnProvider:      string;
  isIP:             boolean;
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
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getMethods: ()           => req<Method[]>("/api/methods"),
  getAttacks: ()           => req<Attack[]>("/api/attacks"),
  getStats:   ()           => req<AttackStats>("/api/attacks/stats"),
  getAttack:  (id: number) => req<Attack>(`/api/attacks/${id}`).catch(() => null as null),

  startAttack: (body: {
    target:    string;
    method:    string;
    threads:   number;
    duration:  number;
    packetSize?: number;
  }) => req<Attack>("/api/attacks", { method: "POST", body: JSON.stringify(body) }),

  stopAttack:  (id: number) =>
    req<{ ok: boolean }>(`/api/attacks/${id}/stop`, { method: "POST" }),

  deleteAttack: (id: number) =>
    req<{ ok: boolean }>(`/api/attacks/${id}`, { method: "DELETE" }),

  analyze: (target: string) =>
    req<AnalyzeResult>("/api/analyze", {
      method: "POST",
      body:   JSON.stringify({ target }),
    }),
};
