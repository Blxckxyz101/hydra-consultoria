import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Mic, MicOff, Sparkles, Trash2, Plus,
  MessageSquare, Clock, Copy, Check, Search,
  X, Volume2, VolumeX, Star, IdCard, Phone, Building2, Car, CreditCard, Camera, FileSearch,
} from "lucide-react";
import robotUrl from "@/assets/robot.png";
import { VoiceOrb, type OrbState } from "@/components/ui/VoiceOrb";
import { ThinkingPanel } from "@/components/ui/ThinkingPanel";

type Message = { role: "user" | "assistant"; content: string; ts: number; };
type ChatSession = { id: string; title: string; messages: Message[]; createdAt: number; updatedAt: number; };

const LS_SESSIONS = "infinity_chat_sessions";
const MAX_SESSIONS = 30;
const API_BASE = "/api/infinity";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function newSession(): ChatSession {
  return { id: crypto.randomUUID(), title: "Nova conversa", messages: [], createdAt: Date.now(), updatedAt: Date.now() };
}
function loadSessionsLocal(): ChatSession[] {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS) ?? "[]"); } catch { return []; }
}
async function fetchSessionsAPI(): Promise<ChatSession[]> {
  try {
    const r = await fetch(`${API_BASE}/me/ai/sessions`, { headers: authHeaders() });
    if (!r.ok) return [];
    const rows = await r.json() as Array<{ id: string; title: string; messages: unknown[]; updatedAt: string; createdAt: string }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      messages: row.messages as Message[],
      createdAt: new Date(row.createdAt).getTime(),
      updatedAt: new Date(row.updatedAt).getTime(),
    }));
  } catch { return []; }
}
async function upsertSessionAPI(s: ChatSession): Promise<void> {
  try {
    await fetch(`${API_BASE}/me/ai/sessions/${s.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ title: s.title, messages: s.messages }),
    });
  } catch {}
}
async function deleteSessionAPI(id: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/me/ai/sessions/${id}`, { method: "DELETE", headers: authHeaders() });
  } catch {}
}
function titleFromMsg(text: string) {
  return text.replace(/\*\*|`|#|>/g, "").slice(0, 42).trim() || "Nova conversa";
}
function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const v = window.speechSynthesis.getVoices();
    if (v.length) { resolve(v); return; }
    window.speechSynthesis.addEventListener("voiceschanged", () => resolve(window.speechSynthesis.getVoices()), { once: true });
  });
}

const IMAGE_URL_RE = /(?:https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?|(?:https?:)?\/\/[^\s]+\/api\/infinity\/foto\/[a-f0-9]+|\/api\/infinity\/foto\/[a-f0-9]+)/i;

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const result: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      result.push(
        <div key={i} className="my-2 rounded-xl overflow-hidden border border-white/10">
          {lang && <div className="px-3 py-1 bg-white/5 text-[9px] uppercase tracking-widest text-primary/60 font-mono">{lang}</div>}
          <pre className="bg-black/60 px-4 py-3 text-xs font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap">{codeLines.join("\n")}</pre>
        </div>
      );
      i++; continue;
    }
    const imgMatch = line.match(IMAGE_URL_RE);
    if (imgMatch && line.trim() === imgMatch[0]) {
      result.push(
        <div key={i} className="my-3">
          <div className="relative inline-block">
            <img
              src={imgMatch[0]}
              alt="Foto biométrica"
              className="max-w-[200px] w-full rounded-2xl border-2 border-white/15 shadow-[0_0_40px_rgba(0,0,0,0.6)]"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 pointer-events-none" />
            <div className="absolute bottom-2 left-2 right-2 text-center">
              <span className="text-[9px] bg-black/70 text-white/60 px-2 py-0.5 rounded-full uppercase tracking-widest">Foto biométrica</span>
            </div>
          </div>
        </div>
      );
      i++; continue;
    }
    if (line.startsWith("### ")) {
      result.push(
        <div key={i} className="flex items-center gap-2 mt-4 mb-2 pb-1.5 border-b border-white/[0.06]">
          <span className="text-sm font-bold text-foreground/90">{inlineRender(line.slice(4))}</span>
        </div>
      );
    } else if (line.startsWith("## ")) {
      result.push(<p key={i} className="font-bold text-base mt-3 mb-1 text-foreground">{inlineRender(line.slice(3))}</p>);
    } else if (line.startsWith("# ")) {
      result.push(<p key={i} className="font-bold text-lg mt-3 mb-1 text-foreground">{inlineRender(line.slice(2))}</p>);
    } else if (line.startsWith("- ") || line.startsWith("• ") || line.startsWith("→ ")) {
      result.push(
        <div key={i} className="flex gap-2 items-start my-0.5">
          <span className="text-primary/50 mt-0.5 shrink-0 text-[10px]">▸</span>
          <span className="flex-1">{inlineRender(line.replace(/^[-•→]\s*/, ""))}</span>
        </div>
      );
    } else if (line === "---" || line === "___") {
      result.push(<hr key={i} className="border-white/[0.06] my-2" />);
    } else if (line === "") {
      result.push(<div key={i} className="h-1.5" />);
    } else {
      result.push(<p key={i} className="leading-relaxed">{inlineRender(line)}</p>);
    }
    i++;
  }
  return <div className="text-sm space-y-0.5">{result}</div>;
}

function inlineRender(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-white/95">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="bg-white/10 px-1.5 py-0.5 rounded-md text-emerald-300 font-mono text-[11px]">{part.slice(1, -1)}</code>;
    return part;
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground/50 hover:text-white transition-all"
      title="Copiar"
    >
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 rounded-full bg-primary/60"
          animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

const CAPABILITY_RESPONSE = `### 🤖 O que a Hydra IA consegue fazer

Sou um agente OSINT integrado às bases de dados da Hydra Consultoria. Basta me enviar um dado e eu consulto automaticamente:

### 👤 Pessoa
- **CPF** — dados completos (nome, endereço, vínculos)
- **Nome** — busca por nome completo
- **RG**, **Mãe**, **Pai**, **Parentes**, **Óbito**

### 📞 Contato
- **Telefone** — titular do número
- **Email**, **Chave PIX**, **CEP**

### 🚗 Veículo
- **Placa** — dados do veículo e proprietário
- **Chassi**, **CNH**, **RENAVAM**, **Frota**

### 🏢 Empresa
- **CNPJ** — dados da empresa e sócios
- **Funcionários** — vínculos empregatícios

### 🏛️ Governo
- **NIS**, **CNS** (cartão SUS), **Título de eleitor**
- **IRPF**, **Benefícios** (Bolsa Família/BPC)
- **Mandado de prisão**

### 💳 Financeiro
- **Score de crédito**, **Dívidas** (BACEN/FGTS)
- **Bens**, **Processos judiciais**, **SPC**

### 📷 Biometria
- **Foto** por CPF — bases: CNH, SP, DF, MG, BA, PE, RN, PR, RS, CE, MA

---
**Dossiê completo:** me peça um dossiê de um CPF e eu farei CPF → score → foto automaticamente.

Basta digitar o dado que você quer consultar!`;

const SUGGESTIONS = [
  { icon: IdCard,     label: "Consultar CPF",      text: "Consulte o CPF 11144477735",                           color: "text-sky-300",    bg: "bg-sky-400/10 border-sky-400/20 hover:bg-sky-400/18",    canned: null },
  { icon: Phone,      label: "Consultar telefone",  text: "Consulte o telefone 11999887766",                      color: "text-emerald-300",bg: "bg-emerald-400/10 border-emerald-400/20 hover:bg-emerald-400/18", canned: null },
  { icon: Building2,  label: "Consultar CNPJ",      text: "Consulte o CNPJ 00000000000191",                       color: "text-violet-300", bg: "bg-violet-400/10 border-violet-400/20 hover:bg-violet-400/18", canned: null },
  { icon: Car,        label: "Consultar placa",     text: "Consulte a placa ABC1234",                             color: "text-amber-300",  bg: "bg-amber-400/10 border-amber-400/20 hover:bg-amber-400/18", canned: null },
  { icon: Camera,     label: "Foto biométrica",     text: "Consulte a foto biométrica do CPF 11144477735",        color: "text-rose-300",   bg: "bg-rose-400/10 border-rose-400/20 hover:bg-rose-400/18",  canned: null },
  { icon: CreditCard, label: "Score de crédito",    text: "Qual o score de crédito do CPF 11144477735?",          color: "text-orange-300", bg: "bg-orange-400/10 border-orange-400/20 hover:bg-orange-400/18", canned: null },
  { icon: FileSearch, label: "Dossiê completo",     text: "Faça um dossiê completo sobre o CPF 11144477735",      color: "text-indigo-300", bg: "bg-indigo-400/10 border-indigo-400/20 hover:bg-indigo-400/18", canned: null },
  { icon: Sparkles,   label: "O que você faz?",     text: "O que você consegue consultar e pesquisar?",           color: "text-primary",    bg: "bg-primary/10 border-primary/20 hover:bg-primary/15",    canned: CAPABILITY_RESPONSE },
];

function WaveformBars({ color = "sky" }: { color?: string }) {
  const cls = color === "violet" ? "bg-violet-400" : "bg-primary";
  return (
    <div className="flex items-center gap-0.5 h-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={i}
          className={`w-0.5 rounded-full ${cls}`}
          animate={{ height: ["4px", `${8 + Math.random() * 8}px`, "4px"] }}
          transition={{ duration: 0.5 + Math.random() * 0.3, repeat: Infinity, delay: i * 0.1, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

export default function IA() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentId, setCurrentId] = useState<string>(() => crypto.randomUUID());
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [input, setInput] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("infinity_ia_sound") !== "0");
  const [intensity, setIntensity] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 640);
  const [historySearch, setHistorySearch] = useState("");
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [consultingStatus, setConsultingStatus] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const continuousRef = useRef(false);
  const voiceModeRef = useRef(false);
  const voiceMutedRef = useRef(false);
  const listeningRef = useRef(false);
  useEffect(() => { continuousRef.current = continuous; }, [continuous]);
  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);
  useEffect(() => { voiceMutedRef.current = voiceMuted; }, [voiceMuted]);
  useEffect(() => { listeningRef.current = listening; }, [listening]);

  useEffect(() => { if ("speechSynthesis" in window) getVoicesAsync().catch(() => {}); }, []);

  // On mount: fetch sessions from API; migrate any local-only sessions
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [apiSessions, localSessions] = await Promise.all([fetchSessionsAPI(), Promise.resolve(loadSessionsLocal())]);
      if (cancelled) return;
      const apiIds = new Set(apiSessions.map((s) => s.id));
      const localOnly = localSessions.filter((s) => !apiIds.has(s.id));
      // Migrate local-only sessions to API in background
      localOnly.forEach((s) => upsertSessionAPI(s));
      const merged = [...apiSessions, ...localOnly].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
      if (merged.length > 0) {
        setSessions(merged);
        setCurrentId(merged[0].id);
        // Clear localStorage after successful migration
        if (localSessions.length > 0) localStorage.removeItem(LS_SESSIONS);
      } else {
        const fresh = newSession();
        setSessions([fresh]);
        setCurrentId(fresh.id);
        upsertSessionAPI(fresh);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Debounced API save: wait 2 seconds after last update before calling API
  const scheduleSave = useCallback((s: ChatSession) => {
    const existing = saveTimers.current.get(s.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      upsertSessionAPI(s);
      saveTimers.current.delete(s.id);
    }, 2000);
    saveTimers.current.set(s.id, timer);
  }, []);

  const currentSession = sessions.find((s) => s.id === currentId) ?? sessions[0];
  const messages = currentSession?.messages ?? [];

  const updateSession = useCallback((id: string, updater: (s: ChatSession) => ChatSession) => {
    setSessions((prev) => {
      const next = prev.map((s) => s.id === id ? updater(s) : s);
      const updated = next.find((s) => s.id === id);
      if (updated) scheduleSave(updated);
      return next;
    });
  }, [scheduleSave]);

  const createNew = () => {
    const s = newSession();
    setSessions((prev) => [s, ...prev].slice(0, MAX_SESSIONS));
    setCurrentId(s.id);
    setSidebarOpen(false);
    upsertSessionAPI(s);
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSessionAPI(id);
    const existing = saveTimers.current.get(id);
    if (existing) { clearTimeout(existing); saveTimers.current.delete(id); }
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (id === currentId) {
        if (next.length) setCurrentId(next[0].id);
        else { const fresh = newSession(); setCurrentId(fresh.id); upsertSessionAPI(fresh); return [fresh]; }
      }
      return next;
    });
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isThinking]);

  const sendCanned = (userText: string, cannedReply: string) => {
    if (isStreaming) return;
    const ts = Date.now();
    const userEntry: Message = { role: "user", content: userText, ts };
    const aTs = ts + 1;
    const assistantEntry: Message = { role: "assistant", content: cannedReply, ts: aTs };
    updateSession(currentId, (s) => ({
      ...s,
      title: s.messages.length === 0 ? titleFromMsg(userText) : s.title,
      messages: [...s.messages, userEntry, assistantEntry],
      updatedAt: aTs,
    }));
  };

  const sendMessage = async (text: string) => {
    const userMsg = text.trim();
    if (!userMsg || isStreaming) return;
    const ts = Date.now();
    const userEntry: Message = { role: "user", content: userMsg, ts };
    updateSession(currentId, (s) => ({
      ...s,
      title: s.messages.length === 0 ? titleFromMsg(userMsg) : s.title,
      messages: [...s.messages, userEntry],
      updatedAt: ts,
    }));
    setIsThinking(true);
    setIsStreaming(true);
    let finalReply = "";
    let assistantMsgAdded = false;

    const addErrorMsg = (err: string) => {
      const errContent = `Erro: ${err}`;
      if (!assistantMsgAdded) {
        assistantMsgAdded = true;
        updateSession(currentId, (s) => ({
          ...s,
          messages: [...s.messages, { role: "assistant", content: errContent, ts: Date.now() }],
          updatedAt: Date.now(),
        }));
      } else {
        updateSession(currentId, (s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && !last.content) {
            msgs[msgs.length - 1] = { ...last, content: errContent };
          }
          return { ...s, messages: msgs };
        });
      }
    };

    try {
      const token = localStorage.getItem("infinity_token");
      const MAX_HIST_MSGS = 8;
      const MAX_HIST_CONTENT = 1200;
      const historyMessages = [...messages, userEntry]
        .slice(-MAX_HIST_MSGS)
        .map(({ role, content }) => {
          const cleaned = content.replace(/\n\/api\/infinity\/foto\/[a-f0-9]+\n/g, "[foto exibida acima]");
          return {
            role,
            content: cleaned.length > MAX_HIST_CONTENT ? cleaned.slice(0, MAX_HIST_CONTENT) + "…" : cleaned,
          };
        });
      const res = await fetch("/api/infinity/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: historyMessages }),
      });
      if (!res.ok) {
        let errMsg = "Falha na comunicação com a IA.";
        try { const j = await res.json(); if (j?.error) errMsg = j.error; } catch {}
        throw new Error(errMsg);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const data = line.slice(6);
            if (data === "[DONE]") { setConsultingStatus(null); continue; }
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                setConsultingStatus(null);
                setIsThinking(false);
                addErrorMsg(parsed.error);
                continue;
              }
              if (parsed.status) { setConsultingStatus(parsed.status); continue; }
              if (parsed.photo) {
                setConsultingStatus(null);
                setIsThinking(false);
                const photoLine = `\n${parsed.photo}\n`;
                if (!assistantMsgAdded) {
                  assistantMsgAdded = true;
                  finalReply = photoLine;
                  const aTs = Date.now();
                  updateSession(currentId, (s) => ({
                    ...s,
                    messages: [...s.messages, { role: "assistant", content: photoLine, ts: aTs }],
                    updatedAt: aTs,
                  }));
                } else {
                  finalReply = photoLine + finalReply;
                  updateSession(currentId, (s) => {
                    const msgs = [...s.messages];
                    const last = msgs[msgs.length - 1];
                    if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, content: photoLine + last.content };
                    return { ...s, messages: msgs, updatedAt: Date.now() };
                  });
                }
                continue;
              }
              if (parsed.delta) {
                setConsultingStatus(null);
                finalReply += parsed.delta;
                if (!assistantMsgAdded) {
                  setIsThinking(false);
                  assistantMsgAdded = true;
                  const aTs = Date.now();
                  updateSession(currentId, (s) => ({
                    ...s,
                    messages: [...s.messages, { role: "assistant", content: parsed.delta, ts: aTs }],
                    updatedAt: aTs,
                  }));
                } else {
                  updateSession(currentId, (s) => {
                    const msgs = [...s.messages];
                    const last = msgs[msgs.length - 1];
                    if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, content: last.content + parsed.delta };
                    return { ...s, messages: msgs, updatedAt: Date.now() };
                  });
                }
              }
            } catch {}
          }
        }
        if (!assistantMsgAdded) {
          addErrorMsg("A IA não retornou uma resposta. Verifique sua conexão e tente novamente.");
        }
      }
    } catch (err) {
      setIsThinking(false);
      setConsultingStatus(null);
      addErrorMsg(err instanceof Error ? err.message : "Erro ao processar resposta da IA.");
    } finally {
      setIsThinking(false);
      setConsultingStatus(null);
      setIsStreaming(false);
      if (finalReply) {
        if (voiceModeRef.current && !voiceMutedRef.current) speakAndContinue(finalReply);
        else if (soundEnabled) speakAndContinue(finalReply);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const t = input.trim(); setInput("");
    if (inputRef.current) { inputRef.current.style.height = "auto"; }
    await sendMessage(t);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e as any); }
  };

  const speakAndContinue = async (text: string) => {
    if (!("speechSynthesis" in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const clean = text.replace(/\*\*|`|#|>/g, "").trim();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = "pt-BR"; u.rate = 1.05; u.pitch = 1.0; u.volume = 1.0;
      const voices = await getVoicesAsync();
      const ptVoice = voices.find((v) => v.lang === "pt-BR") ?? voices.find((v) => v.lang.startsWith("pt"));
      if (ptVoice) u.voice = ptVoice;
      setSpeaking(true);
      u.onend = () => { setSpeaking(false); if (continuousRef.current && voiceModeRef.current && !voiceMutedRef.current) setTimeout(() => startVoice(), 380); };
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    } catch { setSpeaking(false); }
  };

  const stopVoice = () => {
    setListening(false); setIntensity(0);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {}); audioCtxRef.current = null;
    analyserRef.current = null;
    try { recognitionRef.current?.stop(); } catch {}
  };

  const startVoice = async () => {
    if (listeningRef.current) { stopVoice(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new Ctx(); audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyserRef.current = analyser;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i];
        setIntensity(Math.min(1, (sum / data.length / 255) * 2.4));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) {
        const rec = new SR(); rec.lang = "pt-BR"; rec.interimResults = false; rec.continuous = false;
        rec.onresult = (e: any) => { const t = e.results?.[0]?.[0]?.transcript || ""; if (t) { stopVoice(); sendMessage(t); } };
        rec.onerror = () => stopVoice();
        rec.onend = () => { if (listeningRef.current) stopVoice(); };
        recognitionRef.current = rec; rec.start();
      }
      setListening(true);
    } catch { stopVoice(); }
  };

  useEffect(() => () => stopVoice(), []);

  const filteredSessions = sessions.filter((s) =>
    !historySearch || s.title.toLowerCase().includes(historySearch.toLowerCase())
  );

  const orbState: OrbState = speaking ? "speaking" : isThinking || isStreaming ? "thinking" : listening ? "listening" : "idle";

  /* ── Voice Mode ──────────────────────────────────────────────────────────── */
  if (voiceMode) {
    const stateLabel = speaking ? "Falando…" : isStreaming ? "Processando…" : isThinking ? "Pensando…" : listening ? "Ouvindo você" : continuous ? "Aguardando…" : "Toque para falar";
    const stateColor = speaking ? "text-violet-300" : isThinking || isStreaming ? "text-amber-300" : listening ? "text-primary" : "text-muted-foreground";
    return (
      <div className="min-h-[calc(100vh-8rem)] sm:min-h-[calc(100vh-6rem)] flex flex-col items-center justify-center relative py-8 gap-0">
        <button
          onClick={() => { stopVoice(); window.speechSynthesis?.cancel(); setSpeaking(false); setVoiceMode(false); }}
          className="absolute top-4 right-4 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.4em] text-muted-foreground hover:text-primary transition-colors px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:border-primary/30"
        >
          <X size={11} /> Sair do modo voz
        </button>
        <button
          onClick={() => setVoiceMuted((v) => !v)}
          className={`absolute top-4 left-4 p-2.5 rounded-xl border transition-all ${voiceMuted ? "bg-destructive/15 border-destructive/40 text-destructive" : "bg-white/5 border-white/10 text-muted-foreground hover:text-white"}`}
        >
          {voiceMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <div className="flex flex-col items-center gap-1.5 mb-8">
          <div className="text-[10px] uppercase tracking-[0.55em] text-primary/70 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />
            Modo de Voz
            {continuous && <span className="px-2 py-0.5 rounded-full bg-emerald-400/20 border border-emerald-400/40 text-emerald-300 text-[9px]">Contínuo</span>}
          </div>
          <motion.h2 key={stateLabel} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={`text-2xl font-bold tracking-[0.1em] ${stateColor}`}>
            {stateLabel}
          </motion.h2>
          {speaking && !voiceMuted && <div className="mt-1"><WaveformBars color="violet" /></div>}
        </div>
        <button
          onClick={startVoice}
          disabled={speaking || isStreaming || isThinking}
          className="relative disabled:opacity-80 transition-opacity"
        >
          <VoiceOrb active={listening || speaking || isThinking} intensity={speaking ? 0.65 : intensity} size={320} orbState={orbState} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {!listening && !speaking && !isStreaming && !isThinking && (
              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="w-14 h-14 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                <Mic className="w-6 h-6 text-white/80" />
              </motion.div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-3 mt-8">
          <button
            onClick={() => { const next = !continuous; setContinuous(next); if (next && !listening && !speaking && !isStreaming) startVoice(); }}
            className={`px-4 py-2.5 rounded-2xl border text-[10px] uppercase tracking-[0.3em] font-semibold transition-all ${continuous ? "bg-emerald-400/15 border-emerald-400/50 text-emerald-300" : "bg-white/5 border-white/10 text-muted-foreground"}`}
          >
            {continuous ? "Contínuo ON" : "Ativar contínuo"}
          </button>
          <button
            onClick={startVoice}
            disabled={speaking || isStreaming || isThinking}
            className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all disabled:opacity-50 border-2 ${listening ? "bg-destructive/20 border-destructive/60" : "bg-primary/15 border-primary/50"}`}
          >
            {listening ? <MicOff className="w-6 h-6 text-destructive" /> : <Mic className="w-6 h-6 text-primary" />}
          </button>
        </div>
        {messages.length > 0 && (
          <div className="mt-8 max-w-sm w-full px-4">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 text-center mb-2">Última resposta</p>
            <div className="bg-black/40 border border-white/8 rounded-2xl px-4 py-3 text-xs text-muted-foreground/70 max-h-24 overflow-y-auto leading-relaxed">
              {messages[messages.length - 1]?.content?.slice(0, 200)}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Main Chat View ──────────────────────────────────────────────────────── */
  return (
    <div className="relative flex gap-3 h-[calc(100vh-8rem-76px)] sm:h-[calc(100vh-6rem-76px)] lg:h-[calc(100vh-4rem)]">

      {/* ── Mobile backdrop ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="sm:hidden absolute inset-0 bg-black/60 z-40 rounded-2xl"
          />
        )}
      </AnimatePresence>

      {/* ── Sessions Sidebar ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="sidebar"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            style={{ width: 252 }}
            className="absolute top-0 left-0 bottom-0 z-50 sm:relative sm:inset-auto sm:z-auto shrink-0 flex flex-col rounded-2xl border border-white/8 bg-[#07091d]/95 sm:bg-black/50 backdrop-blur-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 border-b border-white/[0.06]">
              <div className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground font-semibold flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3 text-primary" /> Conversas
              </div>
              <button
                onClick={createNew}
                className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center text-primary hover:bg-primary/25 hover:border-primary/50 transition-all"
                title="Nova conversa"
              >
                <Plus size={13} />
              </button>
            </div>

            {/* Search */}
            <div className="px-3 py-2.5 border-b border-white/[0.05]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/35" />
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Buscar conversa..."
                  className="w-full bg-white/[0.03] border border-white/8 rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:border-primary/35 transition-colors"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
              {filteredSessions.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground/30 text-xs">Nenhuma conversa</div>
              ) : filteredSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setCurrentId(s.id); setSidebarOpen(false); }}
                  className={`group w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all relative overflow-hidden ${
                    s.id === currentId
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-white/[0.04] text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.id === currentId && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
                  )}
                  <MessageSquare size={11} className="shrink-0 opacity-50" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{s.title}</div>
                    <div className="text-[9px] opacity-35 flex items-center gap-1 mt-0.5">
                      <Clock size={7} /> {relativeTime(s.updatedAt)} atrás
                    </div>
                  </div>
                  <button
                    onClick={(e) => deleteSession(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
                  >
                    <Trash2 size={10} />
                  </button>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Chat area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col rounded-2xl border border-white/8 bg-black/30 backdrop-blur-2xl overflow-hidden min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/8 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/25 transition-all"
            >
              <MessageSquare size={13} />
            </button>
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-9 h-9 rounded-[10px] bg-primary/10 border border-primary/20 flex items-center justify-center shadow-[0_0_16px_hsl(var(--primary)/0.2)]">
                  <img src={robotUrl} alt="" className="w-[22px] h-[22px] object-contain" style={{ filter: "drop-shadow(0 0 5px hsl(var(--primary) / 0.55))" }} />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 flex">
                  <span className="absolute inline-flex h-3 w-3 rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400 border border-black/80" />
                </span>
              </div>
              <div>
                <div className="text-sm font-bold tracking-tight leading-tight">Hydra IA</div>
                <div className="text-[9px] uppercase tracking-[0.35em] text-emerald-400/75 mt-0.5">Online · Llama 3.3</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                localStorage.setItem("infinity_ia_sound", next ? "1" : "0");
                if (!next) window.speechSynthesis?.cancel();
              }}
              title={soundEnabled ? "Desativar narração" : "Ativar narração"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] uppercase tracking-widest font-semibold transition-all ${
                soundEnabled
                  ? "bg-primary/10 border-primary/25 text-primary hover:bg-primary/15"
                  : "bg-white/[0.04] border-white/8 text-muted-foreground hover:text-foreground"
              }`}
            >
              {soundEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
              <span className="hidden sm:inline">{soundEnabled ? "Som" : "Mudo"}</span>
            </button>
            <button
              onClick={() => setVoiceMode(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-400/10 border border-violet-400/20 text-violet-300 text-[10px] uppercase tracking-widest font-semibold hover:bg-violet-400/18 transition-all"
            >
              <Mic size={11} /> <span className="hidden sm:inline">Voz</span>
            </button>
            <button
              onClick={createNew}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/8 text-muted-foreground text-[10px] uppercase tracking-widest hover:text-foreground hover:bg-white/[0.07] transition-all"
            >
              <Plus size={11} /> <span className="hidden sm:inline">Novo</span>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-7 py-6">
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 20 }}
                className="relative flex items-center justify-center"
              >
                {[80, 114, 152].map((size, i) => (
                  <motion.div
                    key={size}
                    className="absolute rounded-full border border-primary/20"
                    style={{ width: size, height: size }}
                    animate={{ scale: [1, 1.06, 1], opacity: [0.35, 0.07, 0.35] }}
                    transition={{ duration: 2.5 + i * 0.8, repeat: Infinity, delay: i * 0.7, ease: "easeInOut" }}
                  />
                ))}
                <div className="relative w-[52px] h-[52px] rounded-[14px] bg-primary/10 border border-primary/25 flex items-center justify-center z-10 shadow-[0_0_35px_hsl(var(--primary)/0.25)]">
                  <img src={robotUrl} alt="" className="w-8 h-8 object-contain" style={{ filter: "drop-shadow(0 0 8px hsl(var(--primary) / 0.5))" }} />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
                className="text-center"
              >
                <div className="font-bold text-lg tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">Como posso ajudar?</div>
                <div className="text-[11px] text-muted-foreground/60 mt-1.5 max-w-[270px] mx-auto leading-relaxed">
                  Consulte CPFs, CNPJs, veículos e muito mais com linguagem natural
                </div>
              </motion.div>

              <div className="w-full max-w-md">
                <p className="text-[9px] uppercase tracking-[0.45em] text-muted-foreground/35 text-center mb-3">Sugestões</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SUGGESTIONS.map((s, i) => {
                    const Icon = s.icon;
                    return (
                      <motion.button
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.14 + i * 0.04, type: "spring", stiffness: 260, damping: 22 }}
                        whileHover={{ y: -2, transition: { duration: 0.12 } }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => s.canned ? sendCanned(s.text, s.canned) : sendMessage(s.text)}
                        disabled={isStreaming}
                        className={`flex flex-col items-start gap-2 p-3 rounded-2xl border text-left transition-all disabled:opacity-50 ${s.bg}`}
                      >
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-black/20">
                          <Icon size={13} className={s.color} />
                        </div>
                        <span className="text-[10px] font-semibold text-foreground/80 leading-snug">{s.label}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => {
            const isUser = msg.role === "user";
            return (
              <motion.div
                key={`${msg.ts}-${i}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"} items-end`}
              >
                {/* Robot avatar (left) */}
                {!isUser && (
                  <div className="w-8 h-8 rounded-[10px] bg-primary/8 border border-primary/18 flex items-center justify-center shrink-0 mb-0.5">
                    <img src={robotUrl} alt="" className="w-[18px] h-[18px] object-contain" style={{ filter: "drop-shadow(0 0 3px hsl(var(--primary) / 0.45))" }} />
                  </div>
                )}

                <div className={`group flex flex-col gap-1 max-w-[78%] ${isUser ? "items-end" : "items-start"}`}>
                  {/* Bubble */}
                  <div className={`relative px-4 py-3 text-sm leading-relaxed ${
                    isUser
                      ? "bg-gradient-to-br from-primary/22 to-primary/8 border border-primary/28 rounded-[18px] rounded-br-[5px]"
                      : "bg-black/40 border border-white/[0.07] rounded-[18px] rounded-bl-[5px] backdrop-blur-sm"
                  }`}>
                    {msg.content
                      ? renderMarkdown(msg.content)
                      : (msg.role === "assistant" ? <span className="text-muted-foreground/50 text-xs italic">Sem resposta</span> : null)
                    }
                    {/* Copy button */}
                    <div className={`absolute ${isUser ? "top-2 left-2" : "top-2 right-2"} opacity-0 group-hover:opacity-100 transition-opacity`}>
                      <CopyButton text={msg.content} />
                    </div>
                  </div>
                  {/* Timestamp */}
                  <div className="text-[9px] text-muted-foreground/30 px-1">
                    {new Date(msg.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>

                {/* User avatar (right) */}
                {isUser && (
                  <div className="w-8 h-8 rounded-[10px] bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0 mb-0.5 text-[11px] font-bold text-primary">
                    U
                  </div>
                )}
              </motion.div>
            );
          })}

          {/* Thinking indicator */}
          {isThinking && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5 items-end">
              <div className="w-8 h-8 rounded-[10px] bg-primary/8 border border-primary/18 flex items-center justify-center shrink-0">
                <img src={robotUrl} alt="" className="w-[18px] h-[18px] object-contain" style={{ filter: "drop-shadow(0 0 3px hsl(var(--primary) / 0.45))" }} />
              </div>
              <div className="px-5 py-4 bg-black/40 border border-white/[0.07] rounded-[18px] rounded-bl-[5px] backdrop-blur-sm">
                <ThinkingDots />
              </div>
            </motion.div>
          )}

          {/* Consulting status */}
          <AnimatePresence>
            {consultingStatus && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.95 }}
                className="flex justify-center"
              >
                <div className="inline-flex items-center gap-3 text-xs text-primary/85 bg-primary/[0.07] border border-primary/15 rounded-2xl px-5 py-2.5 backdrop-blur-sm shadow-[0_0_20px_hsl(var(--primary)/0.1)]">
                  <div className="relative w-2 h-2 shrink-0">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    <div className="absolute inset-0 w-2 h-2 rounded-full bg-primary animate-ping opacity-75" />
                  </div>
                  <span>{consultingStatus}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={bottomRef} />
        </div>

        {/* Quick suggestions (shown when messages exist) */}
        {messages.length > 0 && !isStreaming && (
          <div className="px-4 pb-2 flex gap-2 overflow-x-auto no-scrollbar shrink-0">
            {SUGGESTIONS.map((s, i) => {
              const Icon = s.icon;
              return (
                <button
                  key={i}
                  onClick={() => s.canned ? sendCanned(s.text, s.canned) : sendMessage(s.text)}
                  disabled={isStreaming}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[9px] font-semibold uppercase tracking-widest transition-all disabled:opacity-40 ${s.bg} ${s.color}`}
                >
                  <Icon size={10} /> {s.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Input area */}
        <div className="px-4 pb-4 pt-2.5 border-t border-white/[0.05] shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            {/* Textarea container */}
            <div className="flex-1 relative bg-black/40 border border-white/10 rounded-2xl transition-all focus-within:border-primary/45 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.07)]">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onInput={(e) => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 148) + "px";
                }}
                placeholder="Mensagem… (Enter para enviar, Shift+Enter para nova linha)"
                rows={1}
                disabled={isStreaming}
                className="w-full bg-transparent px-4 py-3.5 text-sm resize-none focus:outline-none text-foreground placeholder:text-muted-foreground/40 disabled:opacity-60"
                style={{ maxHeight: "148px" }}
              />
            </div>

            {/* Mic button */}
            <button
              type="button"
              onClick={startVoice}
              disabled={isStreaming || speaking}
              className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all shrink-0 disabled:opacity-40 ${
                listening
                  ? "bg-destructive/20 border-destructive/50 text-destructive shadow-[0_0_15px_hsl(var(--destructive)/0.3)]"
                  : "bg-white/[0.04] border-white/10 text-muted-foreground hover:text-violet-300 hover:border-violet-400/30 hover:bg-violet-400/8"
              }`}
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>

            {/* Send button */}
            <button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-35 shrink-0"
              style={{
                background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.65) 100%)",
                boxShadow: input.trim() && !isStreaming ? "0 0 22px hsl(var(--primary) / 0.4)" : "none",
              }}
            >
              {isStreaming ? (
                <div className="w-3.5 h-3.5 border-2 border-black/70 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send size={14} className="text-black font-bold" />
              )}
            </button>
          </form>

          <p className="text-[9px] text-muted-foreground/25 text-center mt-2 uppercase tracking-[0.35em]">
            Hydra IA · Llama 3.3 70B · Pode cometer erros
          </p>
        </div>
      </div>
    </div>
  );
}
