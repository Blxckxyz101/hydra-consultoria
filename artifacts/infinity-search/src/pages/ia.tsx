import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Bot, User, Mic, MicOff, Sparkles, Trash2, Plus,
  MessageSquare, Clock, ChevronRight, Copy, Check, Search,
  Zap, X, Volume2, VolumeX,
} from "lucide-react";
import robotUrl from "@/assets/robot.png";
import { VoiceOrb, type OrbState } from "@/components/ui/VoiceOrb";
import { ThinkingPanel } from "@/components/ui/ThinkingPanel";

// ─── Types ───────────────────────────────────────────────────────────────────
type Message = {
  role: "user" | "assistant";
  content: string;
  ts: number;
};

type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const LS_SESSIONS = "infinity_chat_sessions";
const MAX_SESSIONS = 30;

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── Voice synthesis helper ───────────────────────────────────────────────────
function getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const v = window.speechSynthesis.getVoices();
    if (v.length) { resolve(v); return; }
    window.speechSynthesis.addEventListener("voiceschanged", () => resolve(window.speechSynthesis.getVoices()), { once: true });
  });
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
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
    if (line.startsWith("### "))      result.push(<p key={i} className="font-bold text-primary text-sm mt-3 mb-1">{inlineRender(line.slice(4))}</p>);
    else if (line.startsWith("## ")) result.push(<p key={i} className="font-bold text-base mt-3 mb-1">{inlineRender(line.slice(3))}</p>);
    else if (line.startsWith("# "))  result.push(<p key={i} className="font-bold text-lg mt-3 mb-1">{inlineRender(line.slice(2))}</p>);
    else if (line.startsWith("- ") || line.startsWith("• "))
      result.push(<div key={i} className="flex gap-2 items-start my-0.5"><span className="text-primary/60 mt-0.5 shrink-0">·</span><span>{inlineRender(line.slice(2))}</span></div>);
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

// ─── CopyButton ───────────────────────────────────────────────────────────────
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

// ─── Suggested prompts ────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { icon: Search, label: "Consultar CPF", text: "Consulte o CPF 11144477735" },
  { icon: Zap, label: "Consultar telefone", text: "Consulte o telefone 62999173029" },
  { icon: Bot, label: "O que você pode fazer?", text: "O que você consegue consultar e pesquisar?" },
  { icon: Sparkles, label: "Dossier completo", text: "Faça um dossiê completo sobre o CPF 11144477735" },
];

// ─── Waveform bars (speaking indicator) ──────────────────────────────────────
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

// ─── Main component ───────────────────────────────────────────────────────────
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

  // Preload TTS voices on mount
  useEffect(() => { if ("speechSynthesis" in window) getVoicesAsync().catch(() => {}); }, []);

  // Ensure currentId has a session
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

  // ─── Send ──────────────────────────────────────────────────────────────────
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
    const assistantTs = Date.now();
    updateSession(currentId, (s) => ({
      ...s,
      messages: [...s.messages, { role: "assistant", content: "", ts: assistantTs }],
    }));

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
      let firstChunk = true;
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
              // status = consulting indicator (do NOT append to message content)
              if (parsed.status) {
                setConsultingStatus(parsed.status);
                continue;
              }
              if (parsed.delta) {
                setConsultingStatus(null);
                if (firstChunk) { setIsThinking(false); firstChunk = false; }
                finalReply += parsed.delta;
                updateSession(currentId, (s) => {
                  const msgs = [...s.messages];
                  const last = msgs[msgs.length - 1];
                  if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, content: last.content + parsed.delta };
                  return { ...s, messages: msgs, updatedAt: Date.now() };
                });
              }
            } catch {}
          }
        }
      }
    } catch {
      setIsThinking(false);
      setConsultingStatus(null);
      updateSession(currentId, (s) => {
        const msgs = [...s.messages];
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, content: "Erro ao processar resposta da IA." };
        return { ...s, messages: msgs };
      });
    } finally {
      setIsThinking(false);
      setConsultingStatus(null);
      setIsStreaming(false);
      if (voiceModeRef.current && finalReply && !voiceMutedRef.current) speakAndContinue(finalReply);
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

  // ─── Voice synthesis ────────────────────────────────────────────────────────
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
      u.onend = () => {
        setSpeaking(false);
        if (continuousRef.current && voiceModeRef.current && !voiceMutedRef.current) setTimeout(() => startVoice(), 380);
      };
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
        rec.onresult = (e: any) => {
          const t = e.results?.[0]?.[0]?.transcript || "";
          if (t) { stopVoice(); sendMessage(t); }
        };
        rec.onerror = () => stopVoice();
        // Use ref so closure always has current value
        rec.onend = () => { if (listeningRef.current) stopVoice(); };
        recognitionRef.current = rec; rec.start();
      } else {
        // Browser doesn't support speech recognition — still show mic active
        console.warn("[VoiceMode] SpeechRecognition não suportado neste navegador.");
      }
      setListening(true);
    } catch (err) {
      console.warn("[VoiceMode] Erro ao acessar microfone:", err);
      stopVoice();
    }
  };

  useEffect(() => () => stopVoice(), []);

  // ─── Filtered sessions ─────────────────────────────────────────────────────
  const filteredSessions = sessions.filter((s) =>
    !historySearch || s.title.toLowerCase().includes(historySearch.toLowerCase())
  );

  // ─── Orb state ─────────────────────────────────────────────────────────────
  const orbState: OrbState = speaking ? "speaking" : isThinking || isStreaming ? "thinking" : listening ? "listening" : "idle";

  // ─── Voice mode ────────────────────────────────────────────────────────────
  if (voiceMode) {
    const stateLabel = speaking ? "Falando…" : isStreaming ? "Processando…" : isThinking ? "Pensando…" : listening ? "Ouvindo você" : continuous ? "Aguardando…" : "Toque para falar";
    const stateColor = speaking ? "text-violet-300" : isThinking || isStreaming ? "text-amber-300" : listening ? "text-sky-300" : "text-muted-foreground";

    return (
      <div className="min-h-[calc(100vh-8rem)] sm:min-h-[calc(100vh-6rem)] flex flex-col items-center justify-center relative py-8 gap-0">
        {/* Back */}
        <button
          onClick={() => { stopVoice(); window.speechSynthesis?.cancel(); setSpeaking(false); setVoiceMode(false); }}
          className="absolute top-4 right-4 text-[10px] uppercase tracking-[0.4em] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5"
        >
          <X size={12} /> Sair
        </button>

        {/* Mute */}
        <button
          onClick={() => setVoiceMuted((v) => !v)}
          className={`absolute top-4 left-4 p-2.5 rounded-xl border transition-all ${voiceMuted ? "bg-destructive/15 border-destructive/40 text-destructive" : "bg-white/5 border-white/10 text-muted-foreground hover:text-white"}`}
          title={voiceMuted ? "Ativar voz" : "Mutar voz"}
        >
          {voiceMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>

        {/* State label */}
        <div className="flex flex-col items-center gap-1 mb-6">
          <div className="text-[10px] uppercase tracking-[0.55em] text-primary/70 flex items-center gap-2">
            Modo de Voz
            {continuous && <span className="px-2 py-0.5 rounded-full bg-emerald-400/20 border border-emerald-400/40 text-emerald-300 text-[9px]">Contínuo</span>}
            {voiceMuted && <span className="px-2 py-0.5 rounded-full bg-destructive/20 border border-destructive/30 text-destructive text-[9px]">Mudo</span>}
          </div>
          <motion.h2
            key={stateLabel}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-2xl font-bold tracking-[0.15em] uppercase ${stateColor}`}
          >
            {stateLabel}
          </motion.h2>
          {speaking && !voiceMuted && (
            <div className="mt-1"><WaveformBars color="violet" /></div>
          )}
        </div>

        {/* Orb */}
        <button
          onClick={startVoice}
          disabled={speaking || isStreaming || isThinking}
          className="relative disabled:opacity-80 transition-opacity"
          aria-label="Falar"
        >
          <VoiceOrb active={listening || speaking || isThinking} intensity={speaking ? 0.65 : intensity} size={340} orbState={orbState} />
          {/* Center icon overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {!listening && !speaking && !isStreaming && !isThinking && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-14 h-14 rounded-full bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center"
              >
                <Mic className="w-6 h-6 text-white/80" />
              </motion.div>
            )}
          </div>
        </button>

        {/* Controls */}
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={() => {
              const next = !continuous; setContinuous(next);
              if (next && !listening && !speaking && !isStreaming) startVoice();
            }}
            className={`px-4 py-2.5 rounded-2xl border text-[10px] uppercase tracking-[0.3em] font-semibold transition-all ${
              continuous
                ? "bg-emerald-400/15 border-emerald-400/50 text-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.25)]"
                : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/8"
            }`}
          >
            {continuous ? "Contínuo ON" : "Ativar contínuo"}
          </button>

          {/* Mic button */}
          <button
            onClick={startVoice}
            disabled={speaking || isStreaming || isThinking}
            className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all disabled:opacity-50 ${
              listening
                ? "bg-destructive/20 border-2 border-destructive/60 shadow-[0_0_28px_rgba(239,68,68,0.4)]"
                : "bg-sky-500/15 border-2 border-sky-500/50 shadow-[0_0_28px_rgba(56,189,248,0.35)] hover:scale-110 hover:shadow-[0_0_40px_rgba(56,189,248,0.55)]"
            }`}
          >
            {listening ? <MicOff className="w-6 h-6 text-destructive" /> : <Mic className="w-6 h-6 text-sky-300" />}
          </button>

          {speaking && (
            <button
              onClick={() => { window.speechSynthesis.cancel(); setSpeaking(false); }}
              className="px-4 py-2.5 rounded-2xl bg-white/5 border border-white/10 text-[10px] uppercase tracking-[0.3em] font-semibold text-muted-foreground hover:text-white transition-colors"
            >
              Pular
            </button>
          )}
        </div>

        <div className="mt-8 text-[9px] uppercase tracking-[0.45em] text-muted-foreground/40">
          Infinity AI · Llama 3.3 70B
        </div>
      </div>
    );
  }

  // ─── Chat mode ─────────────────────────────────────────────────────────────
  return (
    <div className="h-[calc(100vh-8rem)] sm:h-[calc(100vh-6rem)] flex gap-3 overflow-hidden">

      {/* ── Sidebar ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            key="sidebar"
            initial={{ opacity: 0, x: -20, width: 0 }}
            animate={{ opacity: 1, x: 0, width: 260 }}
            exit={{ opacity: 0, x: -20, width: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="shrink-0 flex flex-col rounded-2xl border border-white/[0.07] bg-black/20 backdrop-blur-2xl overflow-hidden"
            style={{ width: 260 }}
          >
            <div className="px-4 pt-4 pb-3 border-b border-white/5">
              <button
                onClick={createNew}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-sky-500/20 to-cyan-400/10 border border-sky-500/30 hover:border-sky-500/60 hover:from-sky-500/30 transition-all text-sm font-medium text-sky-300 group"
              >
                <Plus size={15} className="group-hover:rotate-90 transition-transform" />
                Nova conversa
              </button>
            </div>

            <div className="px-4 py-2.5 border-b border-white/5">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/8">
                <Search size={12} className="text-muted-foreground shrink-0" />
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
              {filteredSessions.length === 0 && (
                <div className="flex flex-col items-center justify-center h-24 gap-2 text-muted-foreground/50">
                  <MessageSquare size={18} />
                  <span className="text-[10px] uppercase tracking-widest">Sem conversas</span>
                </div>
              )}
              {filteredSessions.map((s) => (
                <motion.button
                  key={s.id}
                  layout
                  onClick={() => { setCurrentId(s.id); setSidebarOpen(true); }}
                  className={`group w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${s.id === currentId ? "bg-sky-500/15 border border-sky-500/30 text-white" : "hover:bg-white/5 border border-transparent text-muted-foreground hover:text-white"}`}
                >
                  <MessageSquare size={13} className={`mt-0.5 shrink-0 ${s.id === currentId ? "text-sky-400" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{s.title}</div>
                    <div className="text-[9px] text-muted-foreground/50 flex items-center gap-1 mt-0.5">
                      <Clock size={8} /> {relativeTime(s.updatedAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => deleteSession(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-destructive/20 hover:text-destructive text-muted-foreground/50 shrink-0"
                  >
                    <Trash2 size={11} />
                  </button>
                </motion.button>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-white/5 text-[9px] uppercase tracking-widest text-muted-foreground/40 text-center">
              {sessions.length} conversa{sessions.length !== 1 ? "s" : ""}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main chat ── */}
      <div className="flex-1 flex flex-col rounded-2xl border border-white/[0.07] bg-black/15 backdrop-blur-2xl overflow-hidden min-w-0">

        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-black/20 to-transparent shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-2 rounded-xl hover:bg-white/5 transition-colors text-muted-foreground hover:text-white"
              title="Histórico"
            >
              <MessageSquare size={16} />
            </button>
            <div className="relative">
              <div className="absolute inset-0 rounded-xl bg-primary/30 blur-lg" />
              <img src={robotUrl} alt="IA" className="relative w-9 h-9 rounded-xl object-cover" />
            </div>
            <div>
              <div className="font-bold tracking-widest text-sm">INFINITY SEARCH IA</div>
              <div className="text-[9px] uppercase tracking-[0.4em] text-primary/70 flex items-center gap-1.5">
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-primary inline-block"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                {isThinking ? "Pensando..." : isStreaming ? "Respondendo..." : "Online"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={() => updateSession(currentId, (s) => ({ ...s, messages: [] }))}
                className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Limpar conversa"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              onClick={() => setVoiceMode(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-primary/30 text-primary hover:bg-primary/10 transition-colors text-xs uppercase tracking-widest"
            >
              <Mic size={13} /> Voz
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 relative">

          {/* Empty state */}
          {messages.length === 0 && !isThinking && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center h-full gap-8 pb-10"
            >
              <div className="text-center">
                <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
                  <img src={robotUrl} alt="AI" className="w-28 h-28 object-contain mx-auto drop-shadow-[0_0_40px_rgba(56,189,248,0.5)]" />
                </motion.div>
                <div className="mt-5 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.5em] text-primary/70">
                  <Sparkles size={11} /> Infinity Search IA
                </div>
                <h2 className="mt-2 text-xl font-bold uppercase tracking-[0.2em]">Como posso ajudar?</h2>
                <p className="mt-2 text-xs text-muted-foreground max-w-xs mx-auto">
                  Consultas OSINT, análises, pesquisas — tudo via linguagem natural.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTIONS.map((s) => (
                  <motion.button
                    key={s.label}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setInput(s.text); inputRef.current?.focus(); }}
                    className="flex items-center gap-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.07] hover:bg-white/[0.06] hover:border-sky-500/25 transition-all text-left group backdrop-blur-sm"
                  >
                    <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0 group-hover:bg-sky-500/20 transition-colors">
                      <s.icon size={14} className="text-sky-400" />
                    </div>
                    <div>
                      <div className="text-xs font-medium">{s.label}</div>
                      <div className="text-[10px] text-muted-foreground/60 mt-0.5 truncate max-w-[160px]">{s.text}</div>
                    </div>
                    <ChevronRight size={13} className="ml-auto text-muted-foreground/30 group-hover:text-sky-400 transition-colors shrink-0" />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Messages */}
          {messages.map((msg, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                msg.role === "user"
                  ? "bg-gradient-to-br from-sky-500 to-cyan-400 text-black shadow-[0_0_16px_rgba(56,189,248,0.4)]"
                  : "bg-black/50 border border-white/10"
              }`}>
                {msg.role === "user" ? <User size={14} /> : <img src={robotUrl} className="w-6 h-6 rounded-md" alt="AI" />}
              </div>

              <div className={`group relative max-w-[75%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
                <div className={`px-4 py-3 rounded-2xl ${
                  msg.role === "user"
                    ? "bg-gradient-to-br from-sky-500/70 to-cyan-500/60 text-white rounded-tr-sm shadow-[0_4px_20px_rgba(56,189,248,0.18)] text-sm font-medium backdrop-blur-sm border border-sky-400/30"
                    : "bg-white/[0.03] border border-white/[0.07] backdrop-blur-sm rounded-tl-sm shadow-[0_4px_20px_rgba(0,0,0,0.2)]"
                }`}>
                  {msg.role === "user"
                    ? <p className="text-sm leading-relaxed">{msg.content}</p>
                    : (msg.content
                        ? renderMarkdown(msg.content)
                        : isStreaming && idx === messages.length - 1
                          ? <div className="flex gap-1 py-1">{[0,1,2].map((i) => <motion.div key={i} className="w-2 h-2 rounded-full bg-sky-400/60" animate={{ opacity: [0.3,1,0.3] }} transition={{ duration: 0.9, repeat: Infinity, delay: i*0.18 }} />)}</div>
                          : null
                      )
                  }
                </div>
                <div className={`flex items-center gap-1 mt-1 px-1 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                  <span className="text-[9px] text-muted-foreground/40">
                    {new Date(msg.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {msg.role === "assistant" && msg.content && <CopyButton text={msg.content} />}
                </div>
              </div>
            </motion.div>
          ))}

          {/* ── Consulting status indicator ── */}
          <AnimatePresence>
            {consultingStatus && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex gap-3"
              >
                <div className="w-8 h-8 rounded-xl bg-black/50 border border-white/10 flex items-center justify-center shrink-0 mt-1">
                  <img src={robotUrl} className="w-6 h-6 rounded-md" alt="AI" />
                </div>
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-white/[0.03] border border-white/[0.07] backdrop-blur-sm">
                  <motion.div
                    className="w-1.5 h-1.5 rounded-full bg-sky-400"
                    animate={{ scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                  <span className="text-xs text-sky-300/90 font-mono">{consultingStatus}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Thinking Panel (Replit-style) ── */}
          <AnimatePresence>
            {isThinking && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex gap-3"
              >
                <div className="w-8 h-8 rounded-xl bg-black/50 border border-white/10 flex items-center justify-center shrink-0 mt-1">
                  <img src={robotUrl} className="w-6 h-6 rounded-md" alt="AI" />
                </div>
                <div className="flex-1 min-w-0">
                  <ThinkingPanel />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="p-4 border-t border-white/5 bg-black/20 shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                placeholder="Digite sua requisição… (Enter para enviar)"
                rows={1}
                className="w-full bg-white/5 border border-white/10 focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/15 rounded-2xl px-4 py-3.5 pr-12 text-sm outline-none transition-all resize-none placeholder:text-muted-foreground/40 disabled:opacity-50"
                style={{ minHeight: 52, maxHeight: 120 }}
              />
              <button
                type="button"
                onClick={startVoice}
                className={`absolute right-3 bottom-3 p-1.5 rounded-lg transition-all ${listening ? "text-destructive bg-destructive/15" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
              >
                {listening ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
            </div>
            <motion.button
              type="submit"
              disabled={!input.trim() || isStreaming}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-[52px] h-[52px] rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 text-black flex items-center justify-center shadow-[0_0_20px_rgba(56,189,248,0.3)] hover:shadow-[0_0_32px_rgba(56,189,248,0.6)] disabled:opacity-40 disabled:cursor-not-allowed transition-shadow shrink-0"
            >
              <Send size={18} />
            </motion.button>
          </form>
          <div className="mt-2 flex items-center justify-center text-[9px] uppercase tracking-[0.35em] text-muted-foreground/30">
            <span>Infinity Search IA · Consultas OSINT em linguagem natural</span>
          </div>
        </div>
      </div>
    </div>
  );
}
