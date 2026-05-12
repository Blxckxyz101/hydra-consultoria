import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Loader2, X, Gift, Plus, Search, MessageSquarePlus,
  CornerUpLeft, Smile, Trash2, ZoomIn, ArrowDown, UserCircle,
  AtSign, Crown, Shield,
} from "lucide-react";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}
function getToken() { return localStorage.getItem("infinity_token") ?? ""; }
function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 60%, 58%)`;
}
function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "agora";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
  if (diff < 86400000 && d.getDate() === now.getDate()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff < 172800000) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function formatDaySeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return "Hoje";
  if (msgDay.getTime() === yesterday.getTime()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
function isSameDay(a: string, b: string): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

const QUICK_EMOJIS = ["❤️","😂","😮","😢","👍","🔥","💯","🙏","😎","🫡"];
const GIF_API_KEY = "AIzaSyB0hVxdDsEaGWJmcAZdgqh3BQiqeKxvb0o";
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws/chat`;

interface Reaction { emoji: string; count: number; users: string[] }
interface Message {
  id: number; username: string; displayName: string | null;
  photo: string | null; role: string; accentColor: string | null;
  content: string; createdAt: string; reactions: Reaction[];
  replyToId?: number | null; replyToUsername?: string | null; replyToContent?: string | null;
}
interface OtherUser { username: string; displayName: string | null; profilePhoto: string | null; profileAccentColor: string | null }
interface DMConvo { room: { slug: string }; otherUser: OtherUser | null; lastMessage: { content: string; username: string; createdAt: string } | null }

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") return <Crown className="w-3 h-3 inline-block ml-0.5 text-amber-400 shrink-0" />;
  if (role === "vip") return <Shield className="w-3 h-3 inline-block ml-0.5 text-cyan-400 shrink-0" />;
  return null;
}

function Avatar({ username, photo, size = 9 }: { username: string; photo?: string | null; size?: number }) {
  const s = `w-${size} h-${size}`;
  if (photo) return <div className={`${s} rounded-full overflow-hidden shrink-0`}><img src={photo} alt="" className="w-full h-full object-cover" /></div>;
  return <div className={`${s} rounded-full shrink-0 flex items-center justify-center font-bold text-xs`} style={{ background: hashColor(username), color: "#000" }}>{username[0]?.toUpperCase()}</div>;
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 h-px bg-white/[0.06]" />
      <span className="text-[10px] font-semibold text-white/25 uppercase tracking-widest shrink-0">{label}</span>
      <div className="flex-1 h-px bg-white/[0.06]" />
    </div>
  );
}

function renderContent(content: string, onImgClick?: (src: string) => void) {
  const parts = content.split(/(https?:\/\/\S+)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\/.+\.(gif|jpg|jpeg|png|webp)/i.test(part)) {
      return (
        <div key={i} className="mt-1.5 inline-block">
          <img src={part} alt="" className="max-w-[260px] max-h-52 rounded-xl object-cover cursor-zoom-in hover:opacity-90 border border-white/10 transition-opacity"
            onError={e => { e.currentTarget.style.display = "none"; }}
            onClick={() => onImgClick?.(part)} />
        </div>
      );
    }
    if (/^https?:\/\/\S+/.test(part)) {
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline text-cyan-400 break-all hover:text-cyan-300 transition-colors">{part}</a>;
    }
    return <span key={i}>{part}</span>;
  });
}

function LightboxModal({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.94)", backdropFilter: "blur(8px)" }} onClick={onClose}>
      <motion.img src={src} alt=""
        initial={{ scale: 0.85 }} animate={{ scale: 1 }} exit={{ scale: 0.85 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl"
        onClick={e => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

function GifPickerPanel({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<{ url: string; preview: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${GIF_API_KEY}&limit=12&media_filter=gif`);
      const d = await r.json() as { results?: { media_formats?: { gif?: { url: string }; tinygif?: { url: string } } }[] };
      setGifs((d.results ?? []).map(g => ({ url: g.media_formats?.gif?.url ?? "", preview: g.media_formats?.tinygif?.url ?? g.media_formats?.gif?.url ?? "" })).filter(g => g.url));
    } catch { setGifs([]); } finally { setLoading(false); }
  };
  return (
    <div className="border-t border-white/[0.06] bg-[hsl(220_35%_5%)] p-3">
      <div className="flex gap-2 mb-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Buscar GIFs (Tenor)..."
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 placeholder-white/25" />
        <button onClick={search} className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/60 rounded-xl text-xs transition-colors">Buscar</button>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl text-white/40 transition-colors"><X className="w-4 h-4" /></button>
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

export default function DM() {
  const [, params] = useRoute("/dm/:username");
  const [, setLocation] = useLocation();
  const otherUsername = params?.username ?? "";

  const [otherUser, setOtherUser] = useState<OtherUser | null>(null);
  const [roomSlug, setRoomSlug] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [hoveredMsg, setHoveredMsg] = useState<number | null>(null);
  const [myUsername, setMyUsername] = useState("");
  const [myDisplayName, setMyDisplayName] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());

  // Sidebar states
  const [convos, setConvos] = useState<DMConvo[]>([]);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [searchResults, setSearchResults] = useState<OtherUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingUserTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Fetch my user info
  useEffect(() => {
    fetch("/api/infinity/me", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then((d: { username?: string; displayName?: string } | null) => {
        if (d?.username) { setMyUsername(d.username); setMyDisplayName(d.displayName ?? d.username); }
      }).catch(() => {});
  }, []);

  // Fetch recent DM conversations
  const loadConvos = useCallback(() => {
    fetch("/api/infinity/me/dms", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then((data: DMConvo[]) => setConvos(data))
      .catch(() => {});
  }, []);

  useEffect(() => { loadConvos(); }, [loadConvos]);

  // Search users in sidebar
  useEffect(() => {
    if (sidebarSearch.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/infinity/users/search?q=${encodeURIComponent(sidebarSearch)}`, { headers: authHeaders() });
        if (r.ok) {
          const data = await r.json() as { username: string; displayName: string | null; photo?: string | null; profilePhoto?: string | null; profileAccentColor?: string | null }[];
          setSearchResults(data.map(u => ({ username: u.username, displayName: u.displayName, profilePhoto: u.photo ?? u.profilePhoto ?? null, profileAccentColor: u.profileAccentColor ?? null })));
        }
      } catch {} finally { setSearchLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [sidebarSearch]);

  // Initialize DM room
  useEffect(() => {
    if (!otherUsername) { setOtherUser(null); setRoomSlug(null); setMessages([]); return; }
    setLoading(true);
    fetch(`/api/infinity/me/dm/${otherUsername}`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: { room: { slug: string }; otherUser: OtherUser }) => {
        setRoomSlug(d.room.slug);
        setOtherUser(d.otherUser);
        return fetch(`/api/infinity/chat/rooms/${d.room.slug}/messages?limit=80`, { headers: authHeaders() });
      })
      .then(r => r.json())
      .then((msgs: Message[]) => setMessages(msgs))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [otherUsername]);

  // WebSocket
  useEffect(() => {
    if (!roomSlug || !myUsername) return;
    const ws = new WebSocket(`${WS_URL}?token=${getToken()}`);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", roomSlug }));
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        if (data.type === "message") {
          const msg = data as unknown as Message;
          setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: msg.reactions ?? [] }]);
          const from = String(data.username ?? "");
          if (from) {
            setTypingUsers(prev => { const next = new Map(prev); next.delete(from); return next; });
            const t = typingUserTimers.current.get(from);
            if (t) { clearTimeout(t); typingUserTimers.current.delete(from); }
          }
          loadConvos();
        }
        if (data.type === "reaction_update") {
          const { messageId, reactions } = data as { messageId: number; reactions: Reaction[] };
          setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
        }
        if (data.type === "typing") {
          const from = String(data.username ?? "");
          const displayName = String(data.displayName ?? from);
          if (from && from !== myUsername) {
            const old = typingUserTimers.current.get(from);
            if (old) clearTimeout(old);
            setTypingUsers(prev => { const next = new Map(prev); next.set(from, displayName); return next; });
            const t = setTimeout(() => {
              setTypingUsers(prev => { const next = new Map(prev); next.delete(from); return next; });
              typingUserTimers.current.delete(from);
            }, 3500);
            typingUserTimers.current.set(from, t);
          }
        }
      } catch {}
    };
    const ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" })); }, 25000);
    return () => { clearInterval(ping); ws.close(); };
  }, [roomSlug, myUsername, loadConvos]);

  // Auto-scroll
  useEffect(() => {
    if (isAtBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAtBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  const sendMessage = useCallback(async (content: string, rToId?: number) => {
    if (!content.trim() || !roomSlug || sending) return;
    const trimmed = content.trim();
    setSending(true);
    setInput(""); setReplyTo(null);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    try {
      if (wsRef.current?.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: "message", roomSlug, content: trimmed, replyToId: rToId ?? null }));
      } else {
        await fetch(`/api/infinity/chat/rooms/${roomSlug}/messages`, {
          method: "POST", headers: authHeaders(), body: JSON.stringify({ content: trimmed, replyToId: rToId ?? null }),
        });
      }
    } finally { setSending(false); }
    setIsAtBottom(true);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    inputRef.current?.focus();
    loadConvos();
  }, [roomSlug, sending, loadConvos]);

  const addReaction = async (messageId: number, emoji: string) => {
    const r = await fetch(`/api/infinity/chat/messages/${messageId}/react`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ emoji }),
    });
    if (r.ok) {
      const d = await r.json() as { reactions: Reaction[] };
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: d.reactions } : m));
    }
  };

  const sendTyping = useCallback(() => {
    if (!roomSlug || wsRef.current?.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "typing", roomSlug }));
  }, [roomSlug]);

  const accent = otherUser?.profileAccentColor ?? "#00d9ff";

  const typingList = Array.from(typingUsers.entries());
  const typingText = typingList.length === 1 ? `${typingList[0]![1]} está digitando`
    : typingList.length === 2 ? `${typingList[0]![1]} e ${typingList[1]![1]} estão digitando`
    : typingList.length > 2 ? `${typingList[0]![1]} e mais ${typingList.length - 1} estão digitando` : "";

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "hsl(220 35% 4%)" }}>
      <AnimatePresence>
        {lightboxSrc && <LightboxModal src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      </AnimatePresence>

      {/* ── Sidebar ── */}
      <div className="w-64 shrink-0 flex flex-col border-r border-white/[0.06] overflow-hidden" style={{ background: "hsl(220 35% 5%)" }}>
        {/* Sidebar header */}
        <div className="px-3 pt-3 pb-2 border-b border-white/[0.06]">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-white/40">Mensagens</span>
            <button
              onClick={() => setSidebarSearch("")}
              className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 text-white/30 hover:text-cyan-400 transition-colors"
              title="Nova conversa"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
            <input
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
              placeholder="Encontrar ou iniciar DM..."
              className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-white/25 outline-none focus:border-cyan-500/40 focus:bg-white/[0.08] transition-all"
            />
            {searchLoading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-white/30" />}
            {sidebarSearch && !searchLoading && (
              <button onClick={() => setSidebarSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto py-1.5 scrollbar-thin scrollbar-thumb-white/10">
          {/* Search results */}
          {sidebarSearch.length >= 2 ? (
            <div>
              {searchResults.length === 0 && !searchLoading && (
                <p className="text-xs text-white/25 text-center py-6 px-3">Nenhum usuário encontrado</p>
              )}
              {searchResults.map(u => (
                <button key={u.username}
                  onClick={() => { setLocation(`/dm/${u.username}`); setSidebarSearch(""); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all hover:bg-white/[0.06] ${otherUsername === u.username ? "bg-white/[0.08]" : ""}`}>
                  <Avatar username={u.username} photo={u.profilePhoto} size={8} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate leading-none mb-0.5">{u.displayName ?? u.username}</p>
                    <p className="text-[10px] text-white/35 truncate">@{u.username}</p>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-white/20 shrink-0" />
                </button>
              ))}
            </div>
          ) : (
            <div>
              {convos.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-3">
                    <MessageSquarePlus className="w-5 h-5 text-white/20" />
                  </div>
                  <p className="text-xs text-white/25 leading-relaxed">
                    Nenhuma conversa ainda.<br />Use a barra acima para buscar alguém.
                  </p>
                </div>
              )}
              {convos.map(c => {
                const u = c.otherUser;
                if (!u) return null;
                const isActive = otherUsername === u.username;
                const preview = c.lastMessage
                  ? (c.lastMessage.username === myUsername ? `Você: ${c.lastMessage.content}` : c.lastMessage.content)
                  : "Nenhuma mensagem ainda";
                return (
                  <button key={u.username}
                    onClick={() => setLocation(`/dm/${u.username}`)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all group relative ${isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}`}
                  >
                    {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 rounded-r-full" style={{ background: u.profileAccentColor ?? "#00d9ff" }} />}
                    <div className="relative shrink-0">
                      <Avatar username={u.username} photo={u.profilePhoto} size={9} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <p className="text-sm font-semibold text-white/90 truncate leading-none">{u.displayName ?? u.username}</p>
                        {c.lastMessage && <span className="text-[9px] text-white/25 shrink-0">{formatRelativeTime(c.lastMessage.createdAt)}</span>}
                      </div>
                      <p className="text-[11px] text-white/35 truncate leading-none">{preview.slice(0, 48)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* My profile footer */}
        {myUsername && (
          <div className="border-t border-white/[0.06] px-3 py-2.5 flex items-center gap-2">
            <Avatar username={myUsername} size={7} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white/80 truncate leading-none">{myDisplayName || myUsername}</p>
              <p className="text-[10px] text-white/30 truncate">@{myUsername}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Main Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!otherUsername ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center border border-white/[0.08]" style={{ background: "hsl(220 35% 7%)" }}>
              <AtSign className="w-8 h-8 text-white/15" />
            </div>
            <div>
              <p className="font-bold text-lg text-white/80 mb-1">Suas mensagens diretas</p>
              <p className="text-sm text-white/30 max-w-xs leading-relaxed">
                Selecione uma conversa ao lado ou busque um usuário para começar um papo.
              </p>
            </div>
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]" style={{ background: "hsl(220 35% 5%)" }}>
              {otherUser ? (
                <>
                  <div className="relative">
                    <Avatar username={otherUsername} photo={otherUser.profilePhoto} size={9} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-white leading-none truncate" style={{ color: otherUser.profileAccentColor ?? undefined }}>
                        {otherUser.displayName ?? otherUsername}
                      </p>
                    </div>
                    <p className="text-[10px] text-white/30 mt-0.5">@{otherUsername} · Mensagem direta</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link href={`/u/${otherUsername}`}>
                      <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/80 text-xs font-medium transition-all">
                        <UserCircle className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Perfil</span>
                      </button>
                    </Link>
                  </div>
                </>
              ) : (
                <p className="text-sm text-white/50">@{otherUsername}</p>
              )}
            </div>

            {/* Messages */}
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-2 scrollbar-thin scrollbar-thumb-white/10">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                  <Avatar username={otherUsername} photo={otherUser?.profilePhoto} size={16} />
                  <div>
                    <p className="font-bold text-base text-white/80">{otherUser?.displayName ?? otherUsername}</p>
                    <p className="text-xs text-white/30 mt-1">@{otherUsername} · Início da conversa</p>
                  </div>
                  <p className="text-sm text-white/25 max-w-xs">Esta é a sua conversa privada. Diga olá!</p>
                </div>
              )}

              <AnimatePresence initial={false}>
                {messages.map((msg, i) => {
                  const mine = msg.username === myUsername;
                  const prev = messages[i - 1];
                  const showDay = !prev || !isSameDay(prev.createdAt, msg.createdAt);
                  const sameAuthor = !showDay && prev?.username === msg.username &&
                    (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 5 * 60 * 1000;
                  const msgAccent = msg.accentColor ?? (mine ? accent : "#00d9ff");
                  return (
                    <div key={msg.id}>
                      {showDay && <DaySeparator label={formatDaySeparator(msg.createdAt)} />}
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                        className={`flex items-end gap-2.5 px-4 group relative ${mine ? "flex-row-reverse" : ""} ${sameAuthor ? "mt-0.5" : "mt-3"}`}
                        onMouseEnter={() => setHoveredMsg(msg.id)}
                        onMouseLeave={() => setHoveredMsg(null)}
                      >
                        {/* Avatar */}
                        {!sameAuthor ? (
                          <Link href={`/u/${msg.username}`}>
                            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 mb-0.5 cursor-pointer hover:opacity-80 transition-opacity flex items-center justify-center font-bold text-xs"
                              style={{ background: msg.photo ? "transparent" : hashColor(msg.username) }}>
                              {msg.photo ? <img src={msg.photo} alt="" className="w-full h-full object-cover" /> : <span style={{ color: "#000" }}>{(msg.displayName ?? msg.username)[0]?.toUpperCase()}</span>}
                            </div>
                          </Link>
                        ) : <div className="w-8 shrink-0" />}

                        <div className={`flex flex-col max-w-[68%] ${mine ? "items-end" : "items-start"}`}>
                          {/* Author + time */}
                          {!sameAuthor && (
                            <div className={`flex items-center gap-1.5 mb-1 px-1 ${mine ? "flex-row-reverse" : ""}`}>
                              <span className="text-xs font-semibold" style={{ color: msgAccent }}>
                                {mine ? "Você" : (msg.displayName ?? msg.username)}
                              </span>
                              <RoleBadge role={msg.role} />
                              <span className="text-[9px] text-white/20">
                                {new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          )}

                          {/* Reply preview */}
                          {msg.replyToUsername && msg.replyToContent && (
                            <div className={`flex items-start gap-1.5 mb-1 px-2 py-1 rounded-xl border-l-2 bg-white/[0.04] max-w-full ${mine ? "self-end" : "self-start"}`}
                              style={{ borderColor: msgAccent + "60" }}>
                              <div className="min-w-0">
                                <span className="text-[9px] font-semibold opacity-60" style={{ color: msgAccent }}>↩ @{msg.replyToUsername}</span>
                                <p className="text-[10px] text-white/40 truncate max-w-[200px]">{msg.replyToContent}</p>
                              </div>
                            </div>
                          )}

                          {/* Bubble */}
                          <div className="relative">
                            <div className="px-3.5 py-2.5 rounded-2xl text-sm text-white leading-relaxed"
                              style={{
                                background: mine
                                  ? `linear-gradient(135deg, ${msgAccent}cc, ${msgAccent}88)`
                                  : "rgba(255,255,255,0.07)",
                                color: mine ? "#000" : "#fff",
                                borderRadius: mine
                                  ? (sameAuthor ? "18px 18px 6px 18px" : "18px 18px 6px 18px")
                                  : (sameAuthor ? "18px 18px 18px 6px" : "18px 18px 18px 6px"),
                              }}>
                              {renderContent(msg.content, setLightboxSrc)}
                            </div>

                            {/* Reaction toolbar on hover */}
                            <AnimatePresence>
                              {hoveredMsg === msg.id && (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.88, y: 4 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.88, y: 4 }}
                                  transition={{ duration: 0.12 }}
                                  className={`absolute ${mine ? "right-full mr-2" : "left-full ml-2"} bottom-0 flex items-center gap-0.5 rounded-xl px-1.5 py-1 shadow-xl z-10 border border-white/10`}
                                  style={{ background: "hsl(220 35% 9%)" }}
                                >
                                  {QUICK_EMOJIS.slice(0, 6).map(e => (
                                    <button key={e} onClick={() => addReaction(msg.id, e)}
                                      className="w-7 h-7 rounded-lg flex items-center justify-center text-sm hover:bg-white/10 hover:scale-110 transition-all">{e}</button>
                                  ))}
                                  <div className="w-px h-4 bg-white/10 mx-0.5" />
                                  <button
                                    onClick={() => setReplyTo(msg)}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-cyan-400 hover:bg-white/10 transition-all"
                                    title="Responder"
                                  >
                                    <CornerUpLeft className="w-3.5 h-3.5" />
                                  </button>
                                  {mine && (
                                    <button
                                      onClick={async () => {
                                        await fetch(`/api/infinity/chat/messages/${msg.id}`, { method: "DELETE", headers: authHeaders() });
                                        setMessages(prev => prev.filter(m => m.id !== msg.id));
                                        setHoveredMsg(null);
                                      }}
                                      className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-all"
                                      title="Apagar"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                          {/* Reactions */}
                          {msg.reactions.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1 px-1">
                              {msg.reactions.map(r => (
                                <button key={r.emoji} onClick={() => addReaction(msg.id, r.emoji)}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-white/10 hover:border-white/25 transition-all"
                                  style={{ background: r.users.includes(myUsername) ? `${msgAccent}20` : "rgba(255,255,255,0.04)" }}>
                                  <span>{r.emoji}</span>
                                  <span className="text-white/50 text-[10px]">{r.count}</span>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Timestamp for consecutive */}
                          {sameAuthor && (
                            <p className="text-[9px] text-white/15 mt-0.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    </div>
                  );
                })}
              </AnimatePresence>

              {/* Typing indicator */}
              <AnimatePresence>
                {typingText && (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                    className="flex items-center gap-2 px-4 py-2">
                    <div className="flex gap-0.5">
                      {[0, 1, 2].map(i => (
                        <motion.span key={i} className="w-1.5 h-1.5 rounded-full bg-white/30 inline-block"
                          animate={{ y: [0, -4, 0] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }} />
                      ))}
                    </div>
                    <span className="text-[10px] text-white/30 italic">{typingText}...</span>
                  </motion.div>
                )}
              </AnimatePresence>
              <div ref={bottomRef} />
            </div>

            {/* Jump to bottom */}
            <AnimatePresence>
              {!isAtBottom && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => { setIsAtBottom(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
                  className="absolute bottom-24 right-6 w-9 h-9 rounded-full flex items-center justify-center shadow-xl border border-white/15 hover:scale-110 transition-transform z-10"
                  style={{ background: "hsl(220 35% 10%)" }}
                >
                  <ArrowDown className="w-4 h-4 text-white/60" />
                </motion.button>
              )}
            </AnimatePresence>

            {/* GIF picker */}
            {showGif && <GifPickerPanel onSelect={url => sendMessage(url, replyTo?.id)} onClose={() => setShowGif(false)} />}

            {/* Reply preview */}
            <AnimatePresence>
              {replyTo && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-3 px-4 py-2 bg-white/[0.03] border-t border-white/[0.04]">
                  <CornerUpLeft className="w-3.5 h-3.5 text-white/30 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-semibold" style={{ color: accent }}>↩ @{replyTo.username}</span>
                    <p className="text-[11px] text-white/40 truncate">{replyTo.content}</p>
                  </div>
                  <button onClick={() => setReplyTo(null)} className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 text-white/30 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input bar */}
            <div className="shrink-0 border-t border-white/[0.06] px-4 py-3" style={{ background: "hsl(220 35% 5%)" }}>
              <div className="flex items-end gap-2">
                <button onClick={() => setShowGif(g => !g)}
                  className={`p-2.5 rounded-xl transition-all shrink-0 mb-0.5 ${showGif ? "text-cyan-400 bg-cyan-400/10" : "text-white/25 hover:text-cyan-400 hover:bg-white/5"}`}
                  title="GIF">
                  <Gift className="w-4.5 h-4.5" />
                </button>

                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => {
                      setInput(e.target.value);
                      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                      typingTimerRef.current = setTimeout(sendTyping, 500);
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input, replyTo?.id); }
                      if (e.key === "Escape") setReplyTo(null);
                    }}
                    placeholder={`Mensagem para ${otherUser?.displayName ?? otherUsername}...`}
                    rows={1}
                    className="w-full bg-white/[0.07] border border-white/[0.1] rounded-2xl px-4 py-2.5 text-sm text-white resize-none outline-none focus:border-cyan-500/40 focus:bg-white/[0.09] transition-all placeholder-white/20"
                    style={{ maxHeight: "120px" }}
                    onInput={e => {
                      const t = e.currentTarget;
                      t.style.height = "auto";
                      t.style.height = Math.min(t.scrollHeight, 120) + "px";
                    }}
                  />
                  <button
                    className="absolute right-2.5 bottom-2 p-1 text-white/20 hover:text-white/60 transition-colors"
                    title="Emoji"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={() => sendMessage(input, replyTo?.id)}
                  disabled={!input.trim() || sending}
                  className="p-2.5 rounded-2xl font-bold transition-all disabled:opacity-25 shrink-0 mb-0.5 hover:scale-105 active:scale-95"
                  style={{ background: `linear-gradient(135deg, ${accent}, ${accent}bb)`, color: "#000" }}
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
