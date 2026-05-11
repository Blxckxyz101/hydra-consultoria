import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Send, Loader2, SmilePlus, Image, Gift, X, Paperclip
} from "lucide-react";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
function getToken() { return localStorage.getItem("infinity_token") ?? ""; }

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 65%, 62%)`;
}

const QUICK_EMOJIS = ["❤️","😂","😮","😢","👍","🔥","💯","🙏","😎","🫡"];
const GIF_SEARCH_URL = "https://tenor.googleapis.com/v2/search";

interface Reaction { emoji: string; count: number; users: string[] }
interface Message {
  id: number; username: string; displayName: string | null;
  photo: string | null; role: string; accentColor: string | null;
  content: string; createdAt: string; reactions: Reaction[];
  roomSlug: string;
}
interface OtherUser { username: string; displayName: string | null; profilePhoto: string | null; profileAccentColor: string | null }

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws/chat`;

export default function DM() {
  const [, params] = useRoute("/dm/:username");
  const otherUsername = params?.username ?? "";

  const [otherUser, setOtherUser] = useState<OtherUser | null>(null);
  const [roomSlug, setRoomSlug] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [gifSearch, setGifSearch] = useState("");
  const [gifs, setGifs] = useState<{ url: string; preview: string; title: string }[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [hoveredMsg, setHoveredMsg] = useState<number | null>(null);
  const [myUsername, setMyUsername] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Get my username
  useEffect(() => {
    fetch("/api/infinity/me", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then((d: { username?: string } | null) => { if (d?.username) setMyUsername(d.username); })
      .catch(() => {});
  }, []);

  // Initialize DM room
  useEffect(() => {
    if (!otherUsername) return;
    setLoading(true);
    fetch(`/api/infinity/me/dm/${otherUsername}`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: { room: { slug: string }; otherUser: OtherUser }) => {
        setRoomSlug(d.room.slug);
        setOtherUser(d.otherUser);
        return fetch(`/api/infinity/chat/rooms/${d.room.slug}/messages`, { headers: authHeaders() });
      })
      .then(r => r.json())
      .then((msgs: Message[]) => setMessages(msgs))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [otherUsername]);

  // WebSocket connection
  useEffect(() => {
    if (!roomSlug) return;
    const token = getToken();
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", roomSlug }));
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type: string } & Record<string, unknown>;
        if (data.type === "message") {
          setMessages(prev => {
            if (prev.find(m => m.id === (data as { id?: number }).id)) return prev;
            return [...prev, { ...(data as unknown as Message), reactions: (data as { reactions?: Reaction[] }).reactions ?? [] }];
          });
        }
        if (data.type === "reaction_update") {
          const upd = data as unknown as { messageId: number; reactions: Reaction[] };
          setMessages(prev => prev.map(m => m.id === upd.messageId ? { ...m, reactions: upd.reactions } : m));
        }
      } catch {}
    };

    const ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" })); }, 25000);
    return () => { clearInterval(ping); ws.close(); };
  }, [roomSlug]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || !roomSlug || sending) return;
    const trimmed = content.trim();
    setSending(true);
    setInput("");
    try {
      if (wsRef.current?.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: "message", roomSlug, content: trimmed }));
      } else {
        await fetch(`/api/infinity/chat/rooms/${roomSlug}/messages`, {
          method: "POST", headers: authHeaders(), body: JSON.stringify({ content: trimmed }),
        });
      }
    } finally { setSending(false); }
    inputRef.current?.focus();
  }, [roomSlug, sending]);

  const addReaction = async (messageId: number, emoji: string) => {
    await fetch(`/api/infinity/chat/messages/${messageId}/react`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ emoji }),
    });
  };

  const searchGifs = async (q: string) => {
    if (!q.trim()) return;
    setGifLoading(true);
    try {
      // Using Tenor v2 with a public key (limited but works for demos)
      const r = await fetch(`${GIF_SEARCH_URL}?q=${encodeURIComponent(q)}&key=AIzaSyB0hVxdDsEaGWJmcAZdgqh3BQiqeKxvb0o&limit=12&media_filter=gif`);
      const d = await r.json() as { results?: { media_formats?: { gif?: { url: string }; tinygif?: { url: string } }; title?: string }[] };
      setGifs((d.results ?? []).map(g => ({
        url: g.media_formats?.gif?.url ?? "",
        preview: g.media_formats?.tinygif?.url ?? g.media_formats?.gif?.url ?? "",
        title: g.title ?? "",
      })).filter(g => g.url));
    } catch { setGifs([]); }
    finally { setGifLoading(false); }
  };

  const accent = otherUser?.profileAccentColor ?? "#00d9ff";
  const isMe = (username: string) => username === myUsername;

  function renderContent(content: string) {
    const urlRegex = /https?:\/\/\S+\.(gif|jpg|jpeg|png|webp)(\?[^\s]*)?\b/gi;
    const tenorRegex = /https?:\/\/tenor\.com\/view\/\S+/gi;
    const parts = content.split(/(https?:\/\/\S+)/g);
    return parts.map((part, i) => {
      if (/^https?:\/\/.+\.(gif|jpg|jpeg|png|webp)/i.test(part)) {
        return <img key={i} src={part} alt="" className="max-w-xs max-h-48 rounded-xl mt-1 object-cover" />;
      }
      if (/^https?:\/\/tenor\.com\/view\//i.test(part)) {
        return <div key={i} className="mt-1 text-xs text-cyan-400 underline"><a href={part} target="_blank" rel="noopener noreferrer">🎬 GIF</a></div>;
      }
      if (/^https?:\/\/\S+/.test(part)) {
        return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline text-cyan-400 break-all">{part}</a>;
      }
      return <span key={i}>{part}</span>;
    });
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
    </div>
  );

  return (
    <div className="flex flex-col h-full max-h-screen bg-[hsl(220_35%_4%)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[hsl(220_35%_5%)]">
        <Link href="/comunidade">
          <button className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-white/80 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <div className="relative">
          <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center font-bold text-sm shrink-0"
            style={{ background: otherUser?.profilePhoto ? "transparent" : hashColor(otherUsername) }}>
            {otherUser?.profilePhoto
              ? <img src={otherUser.profilePhoto} alt="" className="w-full h-full object-cover" />
              : <span style={{ color: "#000" }}>{(otherUser?.displayName ?? otherUsername)[0]?.toUpperCase()}</span>
            }
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-white leading-none">{otherUser?.displayName ?? otherUsername}</p>
          <p className="text-[10px] text-white/30 mt-0.5">@{otherUsername} · Mensagem direta</p>
        </div>
        <div className="ml-auto">
          <a href={`/u/${otherUsername}`} target="_blank" className="text-[10px] text-white/30 hover:text-cyan-400 transition-colors">
            Ver perfil →
          </a>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 scrollbar-thin scrollbar-thumb-white/10">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
            const mine = isMe(msg.username);
            const prev = messages[i - 1];
            const sameAuthor = prev?.username === msg.username;
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-end gap-2 group ${mine ? "flex-row-reverse" : ""} ${sameAuthor ? "mt-0.5" : "mt-3"}`}
                onMouseEnter={() => setHoveredMsg(msg.id)}
                onMouseLeave={() => setHoveredMsg(null)}
              >
                {/* Avatar */}
                {!sameAuthor ? (
                  <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center font-bold text-xs mb-0.5"
                    style={{ background: msg.photo ? "transparent" : hashColor(msg.username) }}>
                    {msg.photo
                      ? <img src={msg.photo} alt="" className="w-full h-full object-cover" />
                      : <span style={{ color: "#000" }}>{(msg.displayName ?? msg.username)[0]?.toUpperCase()}</span>
                    }
                  </div>
                ) : <div className="w-8 shrink-0" />}

                <div className={`flex flex-col max-w-[72%] ${mine ? "items-end" : "items-start"}`}>
                  {!sameAuthor && (
                    <p className="text-[10px] text-white/30 mb-1 px-1">{mine ? "Você" : (msg.displayName ?? msg.username)}</p>
                  )}
                  <div className="relative">
                    <div
                      className="px-3 py-2 rounded-2xl text-sm text-white leading-relaxed"
                      style={{
                        background: mine
                          ? `linear-gradient(135deg, ${accent}cc, ${accent}99)`
                          : "rgba(255,255,255,0.06)",
                        color: mine ? "#000" : "#fff",
                        borderRadius: mine
                          ? (sameAuthor ? "18px 18px 4px 18px" : "18px 18px 4px 18px")
                          : (sameAuthor ? "18px 18px 18px 4px" : "18px 18px 18px 4px"),
                      }}
                    >
                      {renderContent(msg.content)}
                    </div>

                    {/* Emoji picker on hover */}
                    {hoveredMsg === msg.id && (
                      <div className={`absolute ${mine ? "right-full mr-2" : "left-full ml-2"} bottom-0 flex gap-1 bg-[hsl(220_35%_8%)] border border-white/10 rounded-xl px-2 py-1.5 shadow-xl z-10`}>
                        {QUICK_EMOJIS.map(e => (
                          <button key={e} onClick={() => addReaction(msg.id, e)}
                            className="text-base hover:scale-125 transition-transform cursor-pointer leading-none"
                            title={`Reagir com ${e}`}>{e}</button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Reactions */}
                  {msg.reactions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 px-1">
                      {msg.reactions.map(r => (
                        <button key={r.emoji} onClick={() => addReaction(msg.id, r.emoji)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-white/10 hover:bg-white/5 transition-colors"
                          style={{ background: r.users.includes(myUsername) ? `${accent}20` : "transparent" }}>
                          <span>{r.emoji}</span>
                          <span className="text-white/60">{r.count}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <p className="text-[9px] text-white/20 mt-1 px-1">
                    {new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* GIF picker */}
      {showGif && (
        <div className="border-t border-white/[0.06] bg-[hsl(220_35%_5%)] p-3">
          <div className="flex gap-2 mb-2">
            <input
              value={gifSearch}
              onChange={e => setGifSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && searchGifs(gifSearch)}
              placeholder="Buscar GIFs no Tenor..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50"
            />
            <button onClick={() => searchGifs(gifSearch)} className="px-3 py-2 bg-cyan-500/20 text-cyan-400 rounded-xl text-xs">Buscar</button>
            <button onClick={() => setShowGif(false)} className="p-2 hover:bg-white/5 rounded-xl text-white/40">
              <X className="w-4 h-4" />
            </button>
          </div>
          {gifLoading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>}
          {!gifLoading && gifs.length === 0 && <p className="text-white/30 text-xs text-center py-4">Digite algo e clique em Buscar</p>}
          <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
            {gifs.map((g, i) => (
              <button key={i} onClick={() => { sendMessage(g.url); setShowGif(false); }}
                className="aspect-video rounded-lg overflow-hidden hover:opacity-80 transition-opacity">
                <img src={g.preview} alt={g.title} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-white/[0.06] bg-[hsl(220_35%_5%)] px-4 py-3">
        <div className="flex items-end gap-2">
          <button onClick={() => setShowGif(g => !g)} className="p-2 text-white/30 hover:text-cyan-400 transition-colors shrink-0 mb-0.5" title="Enviar GIF">
            <Gift className="w-5 h-5" />
          </button>
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder={`Mensagem para ${otherUser?.displayName ?? otherUsername}...`}
              rows={1}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-white resize-none outline-none focus:border-cyan-500/40 transition-colors placeholder-white/25"
              style={{ maxHeight: "120px" }}
              onInput={e => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 120) + "px";
              }}
            />
          </div>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || sending}
            className="p-2.5 rounded-2xl font-bold transition-all disabled:opacity-30 shrink-0 mb-0.5"
            style={{ background: accent, color: "#000" }}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
