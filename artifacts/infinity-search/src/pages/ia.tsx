import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Send, Bot, User } from "lucide-react";
import robotUrl from "@/assets/robot.png";

type Message = { role: "user" | "assistant", content: string };

export default function IA() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setIsStreaming(true);

    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      const token = localStorage.getItem("infinity_token");
      const res = await fetch("/api/infinity/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ messages: [...messages, { role: "user", content: userMsg }] })
      });

      if (!res.ok) throw new Error("Falha na comunicação");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.delta) {
                  setMessages(prev => {
                    const newMsgs = [...prev];
                    const last = newMsgs[newMsgs.length - 1];
                    if (last && last.role === "assistant") {
                      last.content += parsed.delta;
                    }
                    return newMsgs;
                  });
                }
              } catch (e) {
                // ignore parse error
              }
            }
          }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const newMsgs = [...prev];
        const last = newMsgs[newMsgs.length - 1];
        if (last && last.role === "assistant") {
          last.content = "Erro ao processar resposta da IA.";
        }
        return newMsgs;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col glass-panel rounded-xl overflow-hidden relative">
      {messages.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30 pointer-events-none">
          <img src={robotUrl} alt="Robot" className="w-64 h-64 object-contain opacity-50 filter grayscale mix-blend-screen" />
          <h2 className="text-xl font-bold uppercase tracking-widest mt-4">Assistente Operacional Online</h2>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-6 z-10">
        {messages.map((msg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-primary/20 text-primary" : "bg-secondary border border-white/10"}`}>
              {msg.role === "user" ? <User size={20} /> : <Bot size={20} />}
            </div>
            <div className={`max-w-[80%] p-4 rounded-2xl ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-black/50 border border-white/10 rounded-tl-none whitespace-pre-wrap"}`}>
              {msg.content}
            </div>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 bg-black/40 border-t border-white/5 z-10">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={isStreaming}
            placeholder="Digite sua requisição..."
            className="flex-1 bg-black/50 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-primary/50 transition-colors"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="bg-primary text-primary-foreground p-3 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center w-12"
          >
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
