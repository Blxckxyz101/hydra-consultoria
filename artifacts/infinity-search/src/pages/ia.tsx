import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Bot, User, Mic, MicOff, Sparkles, Trash2, Plus,
  MessageSquare, Clock, ChevronRight, Copy, Check, Search,
  Zap, X, Volume2, VolumeX, Star, IdCard, Phone, Building2, Car,
} from "lucide-react";
import robotUrl from "@/assets/robot.png";
import { VoiceOrb, type OrbState } from "@/components/ui/VoiceOrb";
import { ThinkingPanel } from "@/components/ui/ThinkingPanel";

type Message = { role: "user" | "assistant"; content: string; ts: number; };
type ChatSession = { id: string; title: string; messages: Message[]; createdAt: number; updatedAt: number; };

const LS_SESSIONS = "infinity_chat_sessions";
const MAX_SESSIONS = 30;

function newSession(): ChatSession {
  return { id: crypto.randomUUID(), title: "Nova conversa", messages: [], createdAt: Date.now(), updatedAt: Date.now() };
}
function loadSessions(): ChatSession[] {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS) ?? "[]"); } catch { return []; }
}
function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
}
function titleFromMsg(text: string) {
  return text.replace(/\*\*|`|#|>/g, "").slice(0, 42).trim() || "Nova conversa";
}
function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m atrás`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h atrás`;
  return `${Math.floor(diff / 86_400_000)}d atrás`;
}

function getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const v = window.speechSynthesis.getVoices();
    if (v.length) { resolve(v); return; }
    window.speechSynthesis.addEventListener("voiceschanged", () => resolve(window.speechSynthesis.getVoices()), { once: true });
  });
}

const IMAGE_URL_RE = /(?:https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?|(?:https?:)?\/\/[^\s]+\/api\/infinity\/foto\/[a-f0-9]{24}|\/api\/infinity\/foto\/[a-f0-9]{24})/i;

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
          <pre className="bg-black/50 px-4 py-3 text-xs font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap">{codeLines.join("\n")}</pre>
        </div>
      );
      i++; continue;
    }
    // Detect standalone image URLs (photo CNH, etc.)
    const imgMatch = line.match(IMAGE_URL_RE);
    if (imgMatch && line.trim() === imgMatch[0]) {
      result.push(
        <div key={i} className="my-3">
          <img
            src={imgMatch[0]}
            alt="Foto"
            className="max-w-[260px] w-full rounded-xl border border-white/10 shadow-lg"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <p className="text-[9px] text-muted-foreground/50 mt-1 uppercase tracking-widest">Foto CNH · Skylers</p>
        </div>
      );
      i++; continue;
    }
    if (line.startsWith("### "))      result.push(<p key={i} className="font-bold text-primary text-sm mt-3 mb-1">{inlineRender(line.slice(4))}</p>);
    else if (line.startsWith("## ")) result.push(<p key={i} className="font-bold text-base mt-3 mb-1">{inlineRender(line.slice(3))}</p>);
    else if (line.startsWith("# "))  result.push(<p key={i} className="font-bold text-lg mt-3 mb-1">{inlineRender(line.slice(2))}</p>);
    else if (line.startsWith("- ") || line.startsWith("• "))
      result.push(<div key={i} className="flex gap-2 items-start my-0.5"><span className="text-primary/60 mt-0.5 shrink-0">·</span><span>{inlineRender(line)}</span></div>);
    else if (line === "") result.push(<div key={i} className="h-2" />);
    else result.push(<p key={i} className="leading-relaxed">{inlineRender(line)}</p>);
    i++;
  }
  return <div className="text-sm space-y-0.5">{result}</div>;
}

function inlineRender(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="bg-white/10 px-1.5 py-0.5 rounded text-emerald-300 font-mono text-xs">{part.slice(1, -1)}</code>;
    return part;
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  );
}

// Persistent suggestions — always visible
const SUGGESTIONS = [
  { icon: IdCard, label: "Consultar CPF", text: "Consulte o CPF 11144477735", color: "text-sky-300", bg: "bg-sky-400/10 border-sky-400/20 hover:bg-sky-400/15" },
  { icon: Phone, label: "Consultar telefone", text: "Consulte o telefone 62999173029", color: "text-emerald-300", bg: "bg-emerald-400/10 border-emerald-400/20 hover:bg-emerald-400/15" },
  { icon: Building2, label: "Consultar CNPJ", text: "Consulte o CNPJ 00000000000191", color: "text-violet-300", bg: "bg-violet-400/10 border-violet-400/20 hover:bg-violet-400/15" },
  { icon: Car, label: "Consultar Placa", text: "Consulte a placa ABC1234", color: "text-amber-300", bg: "bg-amber-400/10 border-amber-400/20 hover:bg-amber-400/15" },
  { icon: Star, label: "Dossiê completo", text: "Faça um dossiê completo sobre o CPF 11144477735", color: "text-rose-300", bg: "bg-rose-400/10 border-rose-400/20 hover:bg-rose-400/15" },
  { icon: Bot, label: "O que posso fazer?", text: "O que você consegue consultar e pesquisar?", color: "text-primary", bg: "bg-primary/10 border-primary/20 hover:bg-primary/15" },
];

function WaveformBars({ color = "sky" }: { color?: string }) {
  const cls = color === "violet" ? "bg-violet-400" : "bg-sky-400";
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
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [currentId, setCurrentId] = useState<string>(() => {
    const s = loadSessions();
    return s.length ? s[0].id : newSession().id;
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [input, setInput] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("infinity_ia_sound") !== "0");
  const [intensity, setIntensity] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

  useEffect(() => {
    setSessions((prev) => {
      if (prev.find((s) => s.id === currentId)) return prev;
      const fresh = newSession();
      setCurrentId(fresh.id);
      return [fresh, ...prev];
    });
  }, [currentId]);

  const currentSession = sessions.find((s) => s.id === currentId) ?? sessions[0];
  const messages = currentSession?.messages ?? [];

  const updateSession = useCallback((id: string, updater: (s: ChatSession) => ChatSession) => {
    setSessions((prev) => {
      const next = prev.map((s) => s.id === id ? updater(s) : s);
      saveSessions(next);
      return next;
    });
  }, []);

  const createNew = () => {
    const s = newSession();
    setSessions((prev) => { const next = [s, ...prev]; saveSessions(next); return next; });
    setCurrentId(s.id);
    setSidebarOpen(false);
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSessions(next);
      if (id === currentId) {
        if (next.length) setCurrentId(next[0].id);
        else { const fresh = newSession(); setCurrentId(fresh.id); return [fresh]; }
      }
      return next;
    });
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isThinking]);

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

    try {
      const token = localStorage.getItem("infinity_token");
      const historyMessages = [...messages, userEntry].map(({ role, content }) => ({ role, content }));
      const res = await fetch("/api/infinity/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: historyMessages }),
      });
      if (!res.ok) throw new Error("Falha na comunicação");
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
              if (parsed.status) { setConsultingStatus(parsed.status); continue; }
              if (parsed.photo) {
                // Photo event arrives before AI text stream — display it immediately
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
                  // First chunk: stop thinking, add assistant message for the first time
                  setIsThinking(false);
                  assistantMsgAdded = true;
                  const aTs = Date.now();
                  updateSession(currentId, (s) => ({
                    ...s,
                    messages: [...s.messages, { role: "assistant", content: parsed.delta, ts: aTs }],
                    updatedAt: aTs,
                  }));
                } else {
                  // Subsequent chunks: append to existing assistant message
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
      }
    } catch {
      setIsThinking(false);
      setConsultingStatus(null);
      if (!assistantMsgAdded) {
        updateSession(currentId, (s) => ({
          ...s,
          messages: [...s.messages, { role: "assistant", content: "Erro ao processar resposta da IA.", ts: Date.now() }],
          updatedAt: Date.now(),
        }));
      } else {
        updateSession(currentId, (s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && !last.content) msgs[msgs.length - 1] = { ...last, content: "Erro ao processar resposta da IA." };
          return { ...s, messages: msgs };
        });
      }
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
    await sendMessage(t);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e as any); }
  };

  const speakAndContinue = async (text: string) => {
    if (!("speechSynthesis" in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const clean = text.replace(/\*\*|`|#|>|🔍/g, "").trim();
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

  if (voiceMode) {
    const stateLabel = speaking ? "Falando…" : isStreaming ? "Processando…" : isThinking ? "Pensando…" : listening ? "Ouvindo você" : continuous ? "Aguardando…" : "Toque para falar";
    const stateColor = speaking ? "text-violet-300" : isThinking || isStreaming ? "text-amber-300" : listening ? "text-sky-300" : "text-muted-foreground";
    return (
      <div className="min-h-[calc(100vh-8rem)] sm:min-h-[calc(100vh-6rem)] flex flex-col items-center justify-center relative py-8 gap-0">
        <button
          onClick={() => { stopVoice(); window.speechSynthesis?.cancel(); setSpeaking(false); setVoiceMode(false); }}
          className="absolute top-4 right-4 text-[10px] uppercase tracking-[0.4em] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5"
        >
          <X size={12} /> Sair
        </button>
        <button
          onClick={() => setVoiceMuted((v) => !v)}
          className={`absolute top-4 left-4 p-2.5 rounded-xl border transition-all ${voiceMuted ? "bg-destructive/15 border-destructive/40 text-destructive" : "bg-white/5 border-white/10 text-muted-foreground hover:text-white"}`}
        >
          {voiceMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <div className="flex flex-col items-center gap-1 mb-6">
          <div className="text-[10px] uppercase tracking-[0.55em] text-primary/70 flex items-center gap-2">
            Modo de Voz
            {continuous && <span className="px-2 py-0.5 rounded-full bg-emerald-400/20 border border-emerald-400/40 text-emerald-300 text-[9px]">Contínuo</span>}
          </div>
          <motion.h2 key={stateLabel} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={`text-2xl font-bold tracking-[0.15em] uppercase ${stateColor}`}>
            {stateLabel}
          </motion.h2>
          {speaking && !voiceMuted && <div className="mt-1"><WaveformBars color="violet" /></div>}
        </div>
        <button
          onClick={startVoice}
          disabled={speaking || isStreaming || isThinking}
          className="relative disabled:opacity-80 transition-opacity"
        >
          <VoiceOrb active={listening || speaking || isThinking} intensity={speaking ? 0.65 : intensity} size={340} orbState={orbState} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {!listening && !speaking && !isStreaming && !isThinking && (
              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="w-14 h-14 rounded-full bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                <Mic className="w-6 h-6 text-white/80" />
              </motion.div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={() => { const next = !continuous; setContinuous(next); if (next && !listening && !speaking && !isStreaming) startVoice(); }}
            className={`px-4 py-2.5 rounded-2xl border text-[10px] uppercase tracking-[0.3em] font-semibold transition-all ${continuous ? "bg-emerald-400/15 border-emerald-400/50 text-emerald-300" : "bg-white/5 border-white/10 text-muted-foreground"}`}
          >
            {continuous ? "Contínuo ON" : "Ativar contínuo"}
          </button>
          <button
            onClick={startVoice}
            disabled={speaking || isStreaming || isThinking}
            className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all disabled:opacity-50 ${listening ? "bg-destructive/20 border-2 border-destructive/60" : "bg-sky-500/15 border-2 border-sky-500/50"}`}
          >
            {listening ? <MicOff className="w-6 h-6 text-destructive" /> : <Mic className="w-6 h-6 text-sky-300" />}
          </button>
        </div>
        {messages.length > 0 && (
          <div className="mt-6 max-w-md w-full px-4">
            <div className="text-xs text-muted-foreground/60 text-center mb-2 uppercase tracking-widest">Última resposta</div>
            <div className="bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-muted-foreground/80 max-h-24 overflow-y-auto">
              {messages[messages.length - 1]?.content?.slice(0, 200)}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)] sm:h-[calc(100vh-6rem)] lg:h-[calc(100vh-4rem)]">
      {/* Sessions sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="sidebar"
            initial={{ opacity: 0, x: -20, width: 0 }}
            animate={{ opacity: 1, x: 0, width: 260 }}
            exit={{ opacity: 0, x: -20, width: 0 }}
            className="shrink-0 flex flex-col rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl overflow-hidden"
          >
            <div className="p-3 border-b border-white/5 flex items-center justify-between gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full bg-black/40 border border-white/8 rounded-lg pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-primary/40 transition-colors"
                />
              </div>
              <button
                onClick={createNew}
                className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center text-primary hover:bg-primary/25 transition-colors shrink-0"
                title="Nova conversa"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredSessions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground/50 text-xs">Nenhuma conversa ainda</div>
              ) : filteredSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setCurrentId(s.id); setSidebarOpen(false); }}
                  className={`group w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all ${s.id === currentId ? "bg-primary/15 border border-primary/30 text-primary" : "hover:bg-white/5 border border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  <MessageSquare size={12} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{s.title}</div>
                    <div className="text-[9px] opacity-50 flex items-center gap-1 mt-0.5">
                      <Clock size={8} /> {relativeTime(s.updatedAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => deleteSession(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-destructive transition-all"
                  >
                    <Trash2 size={10} />
                  </button>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat area */}
      <div className="flex-1 flex flex-col rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl overflow-hidden min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageSquare size={14} />
            </button>
            <div className="flex items-center gap-2">
              <img src={robotUrl} alt="" className="w-7 h-7 object-contain drop-shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
              <div>
                <div className="text-sm font-semibold">Assistente Infinity</div>
                <div className="text-[9px] uppercase tracking-[0.3em] text-primary/70">IA · Online</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                localStorage.setItem("infinity_ia_sound", next ? "1" : "0");
                if (!next) window.speechSynthesis?.cancel();
              }}
              title={soundEnabled ? "Desativar narração" : "Ativar narração por voz"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] uppercase tracking-widest font-semibold transition-colors ${
                soundEnabled
                  ? "bg-sky-400/10 border-sky-400/20 text-sky-300 hover:bg-sky-400/15"
                  : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
              }`}
            >
              {soundEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
              {soundEnabled ? "Som" : "Mudo"}
            </button>
            <button
              onClick={() => { setVoiceMode(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-400/10 border border-violet-400/20 text-violet-300 text-[10px] uppercase tracking-widest font-semibold hover:bg-violet-400/15 transition-colors"
            >
              <Mic size={12} /> Voz
            </button>
            <button
              onClick={createNew}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-muted-foreground text-[10px] uppercase tracking-widest hover:text-foreground transition-colors"
            >
              <Plus size={12} /> Novo
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-3"
              >
                <div className="relative">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <img src={robotUrl} alt="" className="w-10 h-10 object-contain" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-400 border-2 border-[#06091a] flex items-center justify-center">
                    <Sparkles size={9} className="text-black" />
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-bold tracking-widest text-sm">Infinity IA</div>
                  <div className="text-[10px] text-muted-foreground mt-1">Como posso ajudar hoje?</div>
                </div>
              </motion.div>

              {/* Persistent suggestions */}
              <div className="w-full max-w-lg">
                <div className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground/60 text-center mb-3">Sugestões rápidas</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SUGGESTIONS.map((s, i) => {
                    const Icon = s.icon;
                    return (
                      <motion.button
                        key={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.06 }}
                        onClick={() => sendMessage(s.text)}
                        disabled={isStreaming}
                        className={`flex flex-col items-start gap-2 p-3 rounded-xl border text-left transition-all disabled:opacity-50 ${s.bg}`}
                      >
                        <Icon size={14} className={s.color} />
                        <span className="text-[10px] font-semibold text-foreground/80 leading-tight">{s.label}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <motion.div
              key={`${msg.ts}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`group flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0 mt-0.5">
                  <img src={robotUrl} alt="" className="w-5 h-5 object-contain" />
                </div>
              )}
              <div className={`max-w-[80%] ${msg.role === "user" ? "order-first" : ""}`}>
                <div className={`relative rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-gradient-to-br from-sky-500/20 to-cyan-400/10 border border-sky-500/20 ml-8"
                    : "bg-black/40 border border-white/8"
                }`}>
                  {msg.content ? renderMarkdown(msg.content) : (
                    msg.role === "assistant" ? <ThinkingPanel /> : null
                  )}
                  <CopyButton text={msg.content} />
                </div>
                <div className={`text-[9px] text-muted-foreground/40 mt-1 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                  {new Date(msg.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <User size={14} className="text-muted-foreground" />
                </div>
              )}
            </motion.div>
          ))}

          {isThinking && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                <img src={robotUrl} alt="" className="w-5 h-5 object-contain" />
              </div>
              <div className="bg-black/40 border border-white/8 rounded-2xl px-4 py-3">
                <ThinkingPanel />
              </div>
            </div>
          )}

          {consultingStatus && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 text-xs text-primary/80 bg-primary/5 border border-primary/15 rounded-xl px-4 py-2.5"
            >
              <div className="relative w-1.5 h-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
              </div>
              {consultingStatus}
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Persistent suggestions row — shown even when there are messages */}
        {messages.length > 0 && !isStreaming && (
          <div className="px-4 pb-2 flex gap-2 overflow-x-auto no-scrollbar">
            {SUGGESTIONS.slice(0, 4).map((s, i) => {
              const Icon = s.icon;
              return (
                <button
                  key={i}
                  onClick={() => sendMessage(s.text)}
                  disabled={isStreaming}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-semibold uppercase tracking-widest transition-all disabled:opacity-50 ${s.bg} ${s.color}`}
                >
                  <Icon size={11} />
                  {s.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-white/5 shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite uma mensagem... (Enter para enviar)"
                rows={1}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 pr-4 text-sm resize-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                style={{ maxHeight: "120px" }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center text-black hover:shadow-[0_0_20px_rgba(56,189,248,0.5)] transition-all disabled:opacity-40 shrink-0"
            >
              <Send size={16} />
            </button>
          </form>
          <div className="text-[9px] text-muted-foreground/40 text-center mt-2 uppercase tracking-widest">
            Infinity IA · Powered by Llama 3.3 70B
          </div>
        </div>
      </div>
    </div>
  );
}
