import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, Mic, MicOff, Sparkles, Trash2 } from "lucide-react";
import robotUrl from "@/assets/robot.png";
import { VoiceOrb } from "@/components/ui/VoiceOrb";
import { InfinityLoader } from "@/components/ui/InfinityLoader";

type Message = { role: "user" | "assistant"; content: string };

export default function IA() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [intensity, setIntensity] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const sendMessage = async (text: string) => {
    const userMsg = text.trim();
    if (!userMsg) return;
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const token = localStorage.getItem("infinity_token");
      const res = await fetch("/api/infinity/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: userMsg }],
        }),
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
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.delta) {
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last && last.role === "assistant") {
                    last.content += parsed.delta;
                  }
                  return next;
                });
              }
            } catch {}
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          last.content = "Erro ao processar resposta da IA.";
        }
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const t = input.trim();
    setInput("");
    await sendMessage(t);
  };

  const stopVoice = () => {
    setListening(false);
    setIntensity(0);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    try {
      recognitionRef.current?.stop();
    } catch {}
  };

  const startVoice = async () => {
    if (listening) {
      stopVoice();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      src.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;
        setIntensity(Math.min(1, avg * 2.4));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const SR =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      if (SR) {
        const rec = new SR();
        rec.lang = "pt-BR";
        rec.interimResults = false;
        rec.continuous = false;
        rec.onresult = (e: any) => {
          const text = e.results?.[0]?.[0]?.transcript || "";
          if (text) {
            stopVoice();
            sendMessage(text);
          }
        };
        rec.onerror = () => stopVoice();
        rec.onend = () => {
          if (listening) stopVoice();
        };
        recognitionRef.current = rec;
        rec.start();
      }
      setListening(true);
    } catch {
      stopVoice();
    }
  };

  useEffect(() => () => stopVoice(), []);

  if (voiceMode) {
    return (
      <div className="min-h-[calc(100vh-8rem)] sm:min-h-[calc(100vh-6rem)] flex flex-col items-center justify-center gap-8 sm:gap-10 relative py-8">
        <button
          onClick={() => { stopVoice(); setVoiceMode(false); }}
          className="absolute top-4 right-4 text-[10px] uppercase tracking-[0.4em] text-muted-foreground hover:text-primary transition-colors"
        >
          Voltar ao chat
        </button>

        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.5em] text-primary/80 mb-2">
            Modo de Voz
          </div>
          <h2 className="text-2xl font-bold tracking-[0.2em] uppercase">
            {listening ? "Estou te ouvindo" : "Toque para falar"}
          </h2>
        </div>

        <button onClick={startVoice} className="relative">
          <VoiceOrb active={listening} intensity={intensity} size={320} />
        </button>

        <div className="flex items-center gap-6">
          <button
            onClick={startVoice}
            className={`group relative w-20 h-20 rounded-full flex items-center justify-center transition-all ${
              listening
                ? "bg-destructive/20 border border-destructive/50 shadow-[0_0_30px_rgba(239,68,68,0.4)]"
                : "bg-primary/15 border border-primary/40 shadow-[0_0_30px_rgba(56,189,248,0.4)] hover:scale-110"
            }`}
          >
            {listening ? (
              <MicOff className="w-7 h-7 text-destructive" />
            ) : (
              <Mic className="w-7 h-7 text-primary" />
            )}
          </button>
        </div>

        <div className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">
          Made by blxckxyz · Infinity Search
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] sm:h-[calc(100vh-6rem)] flex flex-col rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl overflow-hidden relative">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-black/20">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-primary/30 blur-lg" />
            <img src={robotUrl} alt="IA" className="relative w-10 h-10 rounded-lg" />
          </div>
          <div>
            <div className="font-bold tracking-widest text-sm">INFINITY AI</div>
            <div className="text-[9px] uppercase tracking-[0.4em] text-primary/70 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Online
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-destructive/10"
              title="Limpar conversa"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setVoiceMode(true)}
            className="text-xs uppercase tracking-widest text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/30"
          >
            <Mic className="w-3.5 h-3.5" />
            Voz
          </button>
        </div>
      </div>

      {/* Empty state */}
      {messages.length === 0 && (
        <div className="absolute inset-0 top-20 flex flex-col items-center justify-center pointer-events-none">
          <motion.img
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 0.5, scale: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            src={robotUrl}
            alt="Robot"
            className="w-56 h-56 object-contain drop-shadow-[0_0_40px_rgba(56,189,248,0.5)]"
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-center mt-6"
          >
            <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.5em] text-primary/70 mb-2">
              <Sparkles className="w-3 h-3" /> Assistente Operacional
            </div>
            <h2 className="text-xl font-bold uppercase tracking-[0.2em]">Como posso ajudar?</h2>
            <p className="text-xs text-muted-foreground mt-3 max-w-sm">
              Pergunte sobre consultas, estratégias de pesquisa ou peça análises sobre dados coletados.
            </p>
          </motion.div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 z-10">
        {messages.map((msg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                msg.role === "user"
                  ? "bg-gradient-to-br from-sky-500 to-cyan-400 text-black"
                  : "bg-black/40 border border-white/10"
              }`}
            >
              {msg.role === "user" ? (
                <User size={16} />
              ) : (
                <img src={robotUrl} className="w-7 h-7 rounded-md" alt="AI" />
              )}
            </div>
            <div
              className={`max-w-[78%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-gradient-to-br from-sky-500/90 to-cyan-400/90 text-black rounded-tr-sm"
                  : "bg-black/40 border border-white/10 rounded-tl-sm whitespace-pre-wrap"
              }`}
            >
              {msg.content || (
                isStreaming && idx === messages.length - 1 ? (
                  <InfinityLoader size={28} label="" />
                ) : null
              )}
            </div>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="p-4 bg-black/40 border-t border-white/5 z-10">
        <form onSubmit={handleSubmit} className="flex gap-2 items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isStreaming}
            placeholder="Digite sua requisição..."
            className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3.5 focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="bg-gradient-to-r from-sky-500 to-cyan-400 text-black w-12 h-12 rounded-xl hover:shadow-[0_0_25px_rgba(56,189,248,0.6)] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center"
          >
            <Send size={18} />
          </button>
        </form>
        <div className="mt-2 flex items-center justify-between text-[9px] uppercase tracking-[0.4em] text-muted-foreground/60">
          <span>Made by blxckxyz</span>
          <span>llama-3.3-70b · groq</span>
        </div>
      </div>
    </div>
  );
}
