import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Send, X, Globe, AtSign, Crown, Shield,
  ChevronRight, Users, Loader2, Gift, Image as ImageIcon, UserCircle, UserPlus, MessageSquareDiff
} from "lucide-react";
import { useInfinityMe } from "@workspace/api-client-react";
import { Link } from "wouter";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function getWsUrl(): string {
  const token = localStorage.getItem("infinity_token") ?? "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws/chat?token=${encodeURIComponent(token)}`;
}
function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 65%, 62%)`;
}

const QUICK_EMOJIS = ["❤️","😂","😮","😢","👍","🔥","💯","🙏","😎","🫡","⚡","🎯"];
const GIF_API_KEY = "AIzaSyB0hVxdDsEaGWJmcAZdgqh3BQiqeKxvb0o";

interface Room { id: number; slug: string; name: string; type: string; createdBy: string; description: string | null; icon: string | null; createdAt: string }
interface Reaction { emoji: string; count: number; users: string[] }
interface ChatMsg {
  id: number; roomSlug: string; username: string; displayName: string | null;
  photo: string | null; role: string; accentColor: string | null;
  content: string; createdAt: string; reactions: Reaction[];
}
interface MiniUser {
  username: string; displayName: string | null; photo: string | null;
  role: string; bio: string | null; accentColor: string | null;
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") return <Crown className="w-3 h-3 inline-block ml-1" style={{ color: "#f59e0b" }} />;
  if (role === "vip") return <Shield className="w-3 h-3 inline-block ml-1" style={{ color: "var(--color-primary)" }} />;
  return null;
}
function Avatar({ username, photo, size = 8 }: { username: string; photo: string | null; size?: number }) {
  const cls = `w-${size} h-${size} rounded-full overflow-hidden flex items-center justify-center font-bold text-xs shrink-0`;
  if (photo) return <div className={cls}><img src={photo} alt="" className="w-full h-full object-cover" /></div>;
  return <div className={cls} style={{ background: hashColor(username), color: "#000" }}>{username[0]?.toUpperCase()}</div>;
}

function renderContent(content: string, accent: string) {
  const imgRegex = /(?:https?:\/\/\S+\.(?:gif|jpg|jpeg|png|webp)(?:\?[^\s]*)?\b|\/api\/infinity\/chat\/img\/[a-f0-9]+)/i;
  const splitRegex = /((?:https?:\/\/\S+\.(?:gif|jpg|jpeg|png|webp)(?:\?[^\s]*)?\b|\/api\/infinity\/chat\/img\/[a-f0-9]+|https?:\/\/\S+))/gi;
  const parts = content.split(splitRegex);
  return parts.map((part, i) => {
    if (imgRegex.test(part)) {
      const src = part.startsWith("/") ? `${window.location.origin}${part}` : part;
      return (
        <div key={i} className="mt-1">
          <img src={src} alt="" className="max-w-[240px] max-h-48 rounded-xl object-cover border border-white/10" onError={e => { e.currentTarget.style.display = "none"; }} />
        </div>
      );
    }
    if (/^https?:\/\/\S+/.test(part)) {
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all" style={{ color: accent }}>{part}</a>;
    }
    const mention = part.split(/(@\w+)/g);
    return <span key={i}>{mention.map((m, j) =>
      m.startsWith("@")
        ? <Link key={j} href={`/u/${m.slice(1)}`}><span className="font-semibold cursor-pointer hover:underline" style={{ color: accent }}>{m}</span></Link>
        : <span key={j}>{m}</span>
    )}</span>;
  });
}

function MessageBubble({ msg, prev, myUsername, onReact, onUserClick }: {
  msg: ChatMsg; prev?: ChatMsg; myUsername: string;
  onReact: (msgId: number, emoji: string) => void;
  onUserClick: (user: MiniUser) => void;
}) {
  const isConsecutive = prev && prev.username === msg.username &&
    (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 5 * 60 * 1000;
  const time = new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const accent = msg.accentColor ?? "var(--color-primary)";
  const [showReact, setShowReact] = useState(false);

  const handleUserClick = () => {
    onUserClick({
      username: msg.username,
      displayName: msg.displayName,
      photo: msg.photo,
      role: msg.role,
      bio: null,
      accentColor: msg.accentColor,
    });
  };

  return (
    <div
      className={`flex items-start gap-3 group hover:bg-white/[0.02] px-2 py-1 rounded-xl transition-colors relative ${isConsecutive ? "mt-0.5" : "mt-3"}`}
      onMouseEnter={() => setShowReact(true)}
      onMouseLeave={() => setShowReact(false)}
    >
      <div className="w-8 shrink-0">
        {!isConsecutive && (
          <button onClick={handleUserClick} className="focus:outline-none" title={`Ver perfil de ${msg.username}`}>
            <Avatar username={msg.username} photo={msg.photo} size={8} />
          </button>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {!isConsecutive && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <button onClick={handleUserClick} className="focus:outline-none hover:underline font-semibold text-sm" style={{ color: accent }}>
              {msg.displayName ?? msg.username}
            </button>
            <RoleBadge role={msg.role} />
            <span className="text-[10px] text-muted-foreground/40">{time}</span>
          </div>
        )}
        <div className="text-sm text-foreground/90 break-words leading-relaxed">
          {renderContent(msg.content, accent)}
        </div>
        {msg.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {msg.reactions.map(r => (
              <button key={r.emoji} onClick={() => onReact(msg.id, r.emoji)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-white/10 hover:border-white/25 transition-all"
                style={{ background: r.users.includes(myUsername) ? "color-mix(in srgb, var(--color-primary) 18%, transparent)" : "rgba(255,255,255,0.04)" }}
                title={r.users.join(", ")}>
                <span>{r.emoji}</span>
                <span className="text-white/50 text-[10px]">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {showReact && (
        <div className="absolute right-2 top-0 -translate-y-1/2 flex gap-0.5 bg-[hsl(220_35%_8%)] border border-white/10 rounded-xl px-2 py-1.5 shadow-xl z-20 opacity-0 group-hover:opacity-100 transition-opacity">
          {QUICK_EMOJIS.slice(0, 6).map(e => (
            <button key={e} onClick={() => onReact(msg.id, e)}
              className="text-base hover:scale-125 transition-transform cursor-pointer leading-none px-0.5">{e}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserPopup({ user, onClose, myUsername }: { user: MiniUser; onClose: () => void; myUsername: string }) {
  const [friendStatus, setFriendStatus] = useState<"none" | "sending" | "sent" | "error">("none");
  const accent = user.accentColor ?? "var(--color-primary)";
  const isSelf = user.username === myUsername;

  const sendFriendRequest = async () => {
    if (friendStatus !== "none" || isSelf) return;
    setFriendStatus("sending");
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: user.username }),
      });
      setFriendStatus(r.ok || r.status === 409 ? "sent" : "error");
    } catch {
      setFriendStatus("error");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 12 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className="w-full max-w-xs rounded-2xl border border-white/10 overflow-hidden shadow-2xl"
        style={{ background: "color-mix(in srgb, var(--color-card) 98%, transparent)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="h-16 relative" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 28%, transparent), color-mix(in srgb, hsl(220 35% 8%) 85%, transparent))` }}>
          <button onClick={onClose} className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center hover:bg-black/25 text-white/60 transition-colors">
            <X className="w-4 h-4" />
          </button>
          <div className="absolute -bottom-8 left-4">
            <div className="w-16 h-16 rounded-2xl overflow-hidden ring-4" style={{ boxShadow: `0 0 0 4px hsl(220 35% 8%)` }}>
              {user.photo
                ? <img src={user.photo} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-2xl font-bold" style={{ background: hashColor(user.username), color: "#000" }}>
                    {(user.displayName ?? user.username)[0]?.toUpperCase()}
                  </div>
              }
            </div>
          </div>
        </div>

        <div className="pt-10 px-4 pb-4">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="font-bold text-base" style={{ color: accent }}>{user.displayName ?? user.username}</span>
            <RoleBadge role={user.role} />
          </div>
          <p className="text-xs text-muted-foreground/50 mb-3">@{user.username}</p>
          {user.bio && <p className="text-xs text-muted-foreground/70 mb-3 line-clamp-2 leading-relaxed">{user.bio}</p>}

          <div className={`grid gap-2 mt-2 ${isSelf ? "grid-cols-1" : "grid-cols-3"}`}>
            <Link href={`/u/${user.username}`} onClick={onClose}>
              <button className="flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors w-full">
                <UserCircle className="w-4.5 h-4.5 text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground font-medium">Ver Perfil</span>
              </button>
            </Link>
            {!isSelf && (
              <button
                onClick={sendFriendRequest}
                disabled={friendStatus !== "none"}
                className="flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-60"
              >
                {friendStatus === "sending"
                  ? <Loader2 className="w-4.5 h-4.5 animate-spin text-muted-foreground" />
                  : friendStatus === "sent"
                    ? <span className="text-green-400 text-sm font-bold">✓</span>
                    : friendStatus === "error"
                      ? <span className="text-red-400 text-sm">!</span>
                      : <UserPlus className="w-4.5 h-4.5 text-muted-foreground" />
                }
                <span className="text-[9px] text-muted-foreground font-medium">
                  {friendStatus === "sent" ? "Enviado!" : friendStatus === "error" ? "Erro" : "Add Amigo"}
                </span>
              </button>
            )}
            {!isSelf && (
              <Link href={`/dm/${user.username}`} onClick={onClose}>
                <button className="flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl w-full transition-colors"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 16%, transparent)" }}>
                  <AtSign className="w-4.5 h-4.5" style={{ color: "var(--color-primary)" }} />
                  <span className="text-[9px] font-medium" style={{ color: "var(--color-primary)" }}>Enviar DM</span>
                </button>
              </Link>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CreateRoomModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: Room) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [icon, setIcon] = useState("💬");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const ICONS = ["💬", "🎮", "🎵", "📊", "🔥", "⚡", "🌊", "🏆", "💡", "🎯", "🛡️", "🌐"];

  const create = async () => {
    if (!name.trim()) return;
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/infinity/chat/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: name.trim(), description: desc.trim() || null, icon }),
      });
      if (!r.ok) { setErr("Erro ao criar sala"); return; }
      const room = await r.json() as Room;
      onCreated(room); onClose();
    } catch { setErr("Erro de conexão"); }
    finally { setLoading(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        className="w-full max-w-sm rounded-2xl border border-white/10 p-6 space-y-4"
        style={{ background: "color-mix(in srgb, var(--color-card) 98%, transparent)" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-base">Criar Sala</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 block">Ícone</label>
          <div className="flex flex-wrap gap-2">
            {ICONS.map(ic => (
              <button key={ic} onClick={() => setIcon(ic)}
                className={`w-9 h-9 rounded-xl text-lg transition-all ${icon === ic ? "border-2 scale-110" : "border border-white/10 hover:border-white/20"}`}
                style={{ borderColor: icon === ic ? "var(--color-primary)" : undefined }}>{ic}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 block">Nome da sala *</label>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()}
            placeholder="ex: discussão geral"
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-primary transition-colors" maxLength={50} />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 block">Descrição</label>
          <input value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Opcional"
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-primary transition-colors" maxLength={200} />
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button onClick={create} disabled={!name.trim() || loading}
          className="w-full py-3 rounded-xl font-bold text-sm uppercase tracking-widest transition-all disabled:opacity-40"
          style={{ background: "var(--color-primary)", color: "#000" }}>
          {loading ? "Criando..." : "Criar sala"}
        </button>
      </motion.div>
    </motion.div>
  );
}

function GifPicker({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<{ url: string; preview: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${GIF_API_KEY}&limit=12&media_filter=gif`);
      const d = await r.json() as { results?: { media_formats?: { gif?: { url: string }; tinygif?: { url: string } } }[] };
      setGifs((d.results ?? []).map(g => ({
        url: g.media_formats?.gif?.url ?? "",
        preview: g.media_formats?.tinygif?.url ?? g.media_formats?.gif?.url ?? "",
      })).filter(g => g.url));
    } catch { setGifs([]); }
    finally { setLoading(false); }
  };

  return (
    <div className="border-t border-white/[0.06] bg-[hsl(220_35%_5%)] p-3">
      <div className="flex gap-2 mb-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Buscar GIFs (Tenor)..."
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50" />
        <button onClick={search} className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/60 rounded-xl text-xs transition-colors">Buscar</button>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl text-white/40"><X className="w-4 h-4" /></button>
      </div>
      {loading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>}
      {!loading && gifs.length === 0 && <p className="text-white/30 text-xs text-center py-3">Digite e pressione Enter para buscar</p>}
      <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto">
        {gifs.map((g, i) => (
          <button key={i} onClick={() => { onSelect(g.url); onClose(); }}
            className="aspect-video rounded-lg overflow-hidden hover:opacity-80 transition-opacity">
            <img src={g.preview} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Comunidade() {
  const { data: me } = useInfinityMe({});
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [selectedUser, setSelectedUser] = useState<MiniUser | null>(null);
  const [imgUploading, setImgUploading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const myUsername = me?.username ?? "";

  useEffect(() => {
    fetch("/api/infinity/chat/rooms", { headers: authHeaders() })
      .then(r => r.json())
      .then((data: Room[]) => {
        setRooms(data);
        const global = data.find(r => r.slug === "global");
        if (global) setActiveRoom(global);
      }).catch(() => {});
  }, []);

  const loadMessages = useCallback(async (slug: string) => {
    try {
      const r = await fetch(`/api/infinity/chat/rooms/${slug}/messages?limit=80`, { headers: authHeaders() });
      if (r.ok) setMessages(await r.json() as ChatMsg[]);
    } catch {}
  }, []);

  useEffect(() => {
    if (!activeRoom) return;
    setMessages([]);
    loadMessages(activeRoom.slug);
  }, [activeRoom, loadMessages]);

  useEffect(() => {
    if (!me) return;
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;
    ws.onopen = () => setWsReady(true);
    ws.onclose = () => setWsReady(false);
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as Record<string, unknown>;
        if (data.type === "message") {
          const msg = data as unknown as ChatMsg;
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, { ...msg, reactions: (msg as any).reactions ?? [] }];
          });
        }
        if (data.type === "reaction_update") {
          const { messageId, reactions } = data as { messageId: number; reactions: Reaction[] };
          setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
        }
      } catch {}
    };
    const ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" })); }, 25000);
    return () => { clearInterval(ping); ws.close(); wsRef.current = null; };
  }, [me]);

  useEffect(() => {
    if (!activeRoom || !wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "join", roomSlug: activeRoom.slug }));
  }, [activeRoom, wsReady]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || !activeRoom || sending) return;
    setInput(""); setSending(false);
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "message", roomSlug: activeRoom.slug, content: trimmed }));
    } else {
      setSending(true);
      try {
        await fetch(`/api/infinity/chat/rooms/${activeRoom.slug}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ content: trimmed }),
        });
        await loadMessages(activeRoom.slug);
      } catch {}
      finally { setSending(false); }
    }
    inputRef.current?.focus();
  }, [activeRoom, sending, loadMessages]);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImgUploading(true);
    try {
      const dataUri = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/chat/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dataUri }),
      });
      if (r.ok) {
        const { url } = await r.json() as { url: string };
        const fullUrl = `${window.location.origin}${url}`;
        await sendMessage(fullUrl);
      }
    } catch {}
    finally { setImgUploading(false); }
  }, [sendMessage]);

  const handleReact = async (messageId: number, emoji: string) => {
    try {
      const r = await fetch(`/api/infinity/chat/messages/${messageId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ emoji }),
      });
      if (r.ok) {
        const d = await r.json() as { reactions: Reaction[] };
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: d.reactions } : m));
      }
    } catch {}
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem-76px)] lg:h-screen overflow-hidden">
      {/* Rooms sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }} animate={{ width: 220, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 h-full flex flex-col border-r border-white/[0.06] overflow-hidden"
            style={{ background: "rgba(2,6,18,0.4)", backdropFilter: "blur(16px)" }}>
            <div className="px-4 py-4 border-b border-white/5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
                  <span className="font-bold text-sm uppercase tracking-[0.2em]">Salas</span>
                </div>
                <button onClick={() => setShowCreate(true)}
                  className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors" title="Criar sala">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${wsReady ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
                <span className="text-[10px] text-muted-foreground/50">{wsReady ? "Tempo real ativo" : "Reconectando..."}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
              {rooms.map(room => {
                const isActive = activeRoom?.slug === room.slug;
                return (
                  <button key={room.slug} onClick={() => setActiveRoom(room)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                    style={isActive ? { background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 25%, transparent)" } : {}}>
                    <span className="text-base w-5 text-center shrink-0">{room.icon ?? "#"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{room.name}</div>
                    </div>
                    {room.type === "global" && <Globe className="w-3 h-3 shrink-0 text-muted-foreground/40 ml-auto" />}
                  </button>
                );
              })}
              {rooms.length === 0 && <div className="px-3 py-8 text-center"><p className="text-xs text-muted-foreground/40">Nenhuma sala ainda</p></div>}
            </div>

            <div className="p-3 border-t border-white/5 space-y-1">
              <button onClick={() => setShowCreate(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 border border-dashed border-white/10 hover:border-white/20 transition-all">
                <Plus className="w-3.5 h-3.5" /> Nova sala
              </button>
              <Link href={`/dm/${myUsername ? "..." : "amigo"}`}>
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all">
                  <MessageSquareDiff className="w-3.5 h-3.5" /> Nova DM
                </button>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="shrink-0 px-4 py-3 border-b border-white/5 flex items-center gap-3"
          style={{ background: "rgba(2,6,18,0.3)", backdropFilter: "blur(12px)" }}>
          <button onClick={() => setSidebarOpen(v => !v)}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 text-muted-foreground">
            <ChevronRight className={`w-4 h-4 transition-transform ${sidebarOpen ? "rotate-180" : ""}`} />
          </button>
          {activeRoom ? (
            <>
              <span className="text-xl">{activeRoom.icon ?? "💬"}</span>
              <div>
                <div className="font-bold text-sm">{activeRoom.name}</div>
                {activeRoom.description && <div className="text-[10px] text-muted-foreground/50">{activeRoom.description}</div>}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${wsReady ? "bg-green-400" : "bg-yellow-400"}`} />
                <span className="text-[10px] text-muted-foreground/40">{wsReady ? "ao vivo" : "offline"}</span>
              </div>
            </>
          ) : <span className="text-sm text-muted-foreground">Selecione uma sala</span>}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-4">
          {!activeRoom && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="text-4xl">💬</div>
              <p className="text-sm text-muted-foreground">Selecione uma sala para começar</p>
            </div>
          )}
          {activeRoom && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <span className="text-4xl">{activeRoom.icon ?? "💬"}</span>
              <p className="font-semibold text-base">#{activeRoom.name}</p>
              <p className="text-xs text-muted-foreground/60">Seja o primeiro a enviar uma mensagem.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              prev={messages[i - 1]}
              myUsername={myUsername}
              onReact={handleReact}
              onUserClick={setSelectedUser}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        <AnimatePresence>
          {showGif && activeRoom && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <GifPicker onSelect={(url) => sendMessage(url)} onClose={() => setShowGif(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {activeRoom && (
          <div className="shrink-0 px-4 py-3 border-t border-white/5" style={{ background: "rgba(2,6,18,0.3)" }}>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl border border-white/10 bg-white/[0.03]">
              <button onClick={() => setShowGif(g => !g)} title="GIF"
                className="text-muted-foreground/50 hover:text-primary transition-colors shrink-0">
                <Gift className="w-4.5 h-4.5" />
              </button>
              <button
                onClick={() => imgInputRef.current?.click()}
                disabled={imgUploading}
                title="Foto / Imagem"
                className="text-muted-foreground/50 hover:text-primary transition-colors shrink-0 disabled:opacity-40"
              >
                {imgUploading
                  ? <Loader2 className="w-4.5 h-4.5 animate-spin" />
                  : <ImageIcon className="w-4.5 h-4.5" />
                }
              </button>
              <input
                ref={imgInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={handleImageUpload}
              />
              <Avatar username={myUsername || "?"} photo={null} size={6} />
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                placeholder={`Mensagem em ${activeRoom.icon ?? "#"}${activeRoom.name}...`}
                className="flex-1 bg-transparent text-sm outline-none placeholder-muted-foreground/30 min-w-0"
                maxLength={2000}
              />
              {input.trim() && (
                <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }}
                  onClick={() => sendMessage(input)} disabled={sending}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0"
                  style={{ background: "var(--color-primary)", color: "#000" }}>
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </motion.button>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground/25 mt-1 text-center">Enter para enviar • clique no avatar para ver perfil • 📎 foto até 2MB</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateRoomModal onClose={() => setShowCreate(false)} onCreated={(room) => setRooms(prev => [...prev, room])} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedUser && (
          <UserPopup user={selectedUser} onClose={() => setSelectedUser(null)} myUsername={myUsername} />
        )}
      </AnimatePresence>
    </div>
  );
}
