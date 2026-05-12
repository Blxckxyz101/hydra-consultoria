import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Send, X, Globe, AtSign, Crown, Shield,
  ChevronRight, Loader2, Gift, Image as ImageIcon,
  UserCircle, UserPlus, MessageSquareDiff, Search, CornerUpLeft,
  Trash2, Smile, ZoomIn, Paperclip, File as FileIcon, ArrowDown,
  Hash, Settings, Users,
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
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 24 * 60 * 60 * 1000 && d.getDate() === now.getDate())
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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

// ── Emoji categories ──────────────────────────────────────────────────────────
const EMOJI_CATS = [
  { label: "⭐ Popular",   emojis: ["❤️","😂","😮","😢","👍","🔥","💯","🙏","😎","🫡","⚡","🎯","💀","😭","🤣","🥹","🫶","✅","💪","🤯"] },
  { label: "😀 Rostos",    emojis: ["😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","😋","😎","😍","🥰","😘","🤩","🤗","😏","😒","🙄","😬","😤","😠","😡","🤬","😭","😢","😥","😓","🫠","🥲","😪","🥺","😳","🤭","🤫","🫡","🤔","🤐","🤑","😷","🤒","🤕","🥴","🤧","😵","🤯","🥳","🫨"] },
  { label: "👋 Gestos",    emojis: ["👍","👎","👊","✊","🤛","🤜","🤞","✌️","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👋","🤚","🖐️","✋","🖖","🫱","🫲","🫳","🫴","🫵","🫶","💪","🦾","🙌","👏","🤲","🙏","🤝","✍️","💅","🖕"] },
  { label: "❤️ Corações",  emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","❤️‍🔥","💕","💞","💓","💗","💖","💘","💝","💟","☮️","✝️","♾️","💌","💔","🫀"] },
  { label: "🎉 Festas",    emojis: ["🎉","🎊","🥳","🎈","🎁","🎂","🍾","🥂","🎆","🎇","✨","⭐","🌟","💫","🎖️","🏆","🥇","🥈","🥉","🎗️","🎀","🎯","🎲","🎰","🧨","🎋","🎍","🎎"] },
  { label: "🔥 Fogo",      emojis: ["🔥","💥","⚡","🌊","🌀","🌈","❄️","🌪️","☁️","⛈️","🌤️","🌙","⭐","🌠","🌌","☀️","🪐","💎","🔮","🪄","⚔️","🛡️","🗡️","🧲","🔑","🗝️","🔓","💣","🧪","⚗️"] },
  { label: "🐶 Animais",   emojis: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐔","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🦟","🦗","🕷️","🦂","🐢","🐍","🦎","🦕","🦖","🐙","🦑","🦀","🦞","🦐","🐠","🐟","🐡","🐬","🐳","🐋","🦈"] },
  { label: "🍕 Comida",    emojis: ["🍕","🍔","🌮","🌯","🥙","🍜","🍝","🍛","🍣","🍱","🍤","🍗","🍖","🍞","🥐","🥖","🧀","🥚","🍳","🥞","🧇","🥓","🥩","🍇","🍓","🫐","🍊","🍋","🍌","🍉","🍎","🍏","🥝","🍑","🍒","🍈","🍍","🥭","🥥","🥑","🍅","🥕","🌽","🌶️","🧄","🧅","🥔","🍠","🫘","🧆","🥜","🌰","🫚","🍫","🍬","🍭","🍮","🍯","🍰","🎂","🧁","🥧","🍦","🍧","🍨","🍩","🍪","☕","🧃","🍺","🥤","🧋","🧉"] },
];
const QUICK_EMOJIS = EMOJI_CATS[0]!.emojis.slice(0, 6);
const GIF_API_KEY = "AIzaSyB0hVxdDsEaGWJmcAZdgqh3BQiqeKxvb0o";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Room { id: number; slug: string; name: string; type: string; createdBy: string; description: string | null; icon: string | null; createdAt: string }
interface Reaction { emoji: string; count: number; users: string[] }
interface ChatMsg {
  id: number; roomSlug: string; username: string; displayName: string | null;
  photo: string | null; role: string; accentColor: string | null;
  content: string; createdAt: string; reactions: Reaction[];
  replyToId?: number | null; replyToUsername?: string | null; replyToContent?: string | null;
}
interface MiniUser { username: string; displayName: string | null; photo: string | null; role: string; bio: string | null; accentColor: string | null }
interface ReplyTo { id: number; username: string; displayName: string | null; content: string }
interface PendingFile { dataUri: string; mimeType: string; filename: string; sizeLabel: string; previewUrl: string }
interface FriendEntry {
  id: number; username: string; displayName: string | null; photo: string | null;
  status: string; role: string; friendStatus: string; direction: "sent" | "received";
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  if (role === "admin") return <Crown className="w-3 h-3 inline-block ml-1" style={{ color: "#f59e0b" }} />;
  if (role === "vip")   return <Shield className="w-3 h-3 inline-block ml-1" style={{ color: "var(--color-primary)" }} />;
  return null;
}
function Avatar({ username, photo, size = 8 }: { username: string; photo: string | null; size?: number }) {
  const cls = `w-${size} h-${size} rounded-full overflow-hidden flex items-center justify-center font-bold text-xs shrink-0`;
  if (photo) return <div className={cls}><img src={photo} alt="" className="w-full h-full object-cover" /></div>;
  return <div className={cls} style={{ background: hashColor(username), color: "#000" }}>{username[0]?.toUpperCase()}</div>;
}

// ── Day Separator ─────────────────────────────────────────────────────────────
function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 select-none">
      <div className="flex-1 h-px bg-white/[0.07]" />
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/25 shrink-0 px-1">{label}</span>
      <div className="flex-1 h-px bg-white/[0.07]" />
    </div>
  );
}

// ── Content renderer ──────────────────────────────────────────────────────────
function renderContent(content: string, accent: string, onImgClick?: (src: string) => void) {
  const imgRegex = /(?:https?:\/\/\S+\.(?:gif|jpg|jpeg|png|webp)(?:\?[^\s]*)?\b|\/api\/infinity\/chat\/img\/[a-f0-9]+)/i;
  const splitRegex = /((?:https?:\/\/\S+\.(?:gif|jpg|jpeg|png|webp)(?:\?[^\s]*)?\b|\/api\/infinity\/chat\/img\/[a-f0-9]+|https?:\/\/\S+))/gi;
  const parts = content.split(splitRegex);
  return parts.map((part, i) => {
    if (imgRegex.test(part)) {
      const src = part.startsWith("/") ? `${window.location.origin}${part}` : part;
      return (
        <div key={i} className="mt-1.5 relative group/img inline-block">
          <img src={src} alt=""
            className="max-w-[240px] sm:max-w-[360px] md:max-w-[440px] max-h-72 rounded-xl object-cover border border-white/10 cursor-zoom-in hover:opacity-90 transition-opacity"
            onError={e => { e.currentTarget.style.display = "none"; }}
            onClick={() => onImgClick?.(src)} />
          <button className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-black/60 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
            onClick={() => onImgClick?.(src)}>
            <ZoomIn className="w-3 h-3 text-white" />
          </button>
        </div>
      );
    }
    if (/^https?:\/\/\S+/.test(part)) {
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all hover:opacity-80 transition-opacity" style={{ color: accent }}>{part}</a>;
    }
    const mention = part.split(/(@\w+)/g);
    return <span key={i}>{mention.map((m, j) =>
      m.startsWith("@")
        ? <Link key={j} href={`/u/${m.slice(1)}`}><span className="font-semibold cursor-pointer transition-colors px-1.5 py-0.5 rounded-md mx-0.5 inline-block" style={{ color: accent, background: `color-mix(in srgb, ${accent} 18%, transparent)` }} onMouseEnter={e => e.currentTarget.style.background = `color-mix(in srgb, ${accent} 35%, transparent)`} onMouseLeave={e => e.currentTarget.style.background = `color-mix(in srgb, ${accent} 18%, transparent)`}>{m}</span></Link>
        : <span key={j}>{m}</span>
    )}</span>;
  });
}

// ── Full Emoji Picker ─────────────────────────────────────────────────────────
function EmojiPickerPopup({ onSelect, onClose }: { onSelect: (e: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return (
    <motion.div ref={ref}
      initial={{ opacity: 0, scale: 0.9, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 8 }} transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className="absolute bottom-full right-0 mb-2 w-72 rounded-2xl border border-white/10 shadow-2xl overflow-hidden z-50"
      style={{ background: "hsl(220 35% 7%)" }}>
      <div className="flex border-b border-white/[0.06] overflow-x-auto scrollbar-none">
        {EMOJI_CATS.map((c, i) => (
          <button key={i} onClick={() => setCat(i)}
            className={`px-2 py-2 text-base shrink-0 transition-colors ${cat === i ? "bg-white/10" : "hover:bg-white/5"}`}
            title={c.label}>{c.emojis[0]}</button>
        ))}
      </div>
      <div className="px-3 pt-2 pb-1 text-[9px] font-bold text-white/25 tracking-widest uppercase">{EMOJI_CATS[cat]?.label}</div>
      <div className="grid grid-cols-8 gap-0.5 px-2 pb-3 max-h-40 overflow-y-auto">
        {EMOJI_CATS[cat]?.emojis.map((e, i) => (
          <button key={i} onClick={() => onSelect(e)}
            className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-lg transition-colors">{e}</button>
        ))}
      </div>
    </motion.div>
  );
}

// ── Image Lightbox ────────────────────────────────────────────────────────────
function LightboxModal({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.94)", backdropFilter: "blur(8px)" }} onClick={onClose}>
      <motion.img src={src} alt=""
        initial={{ scale: 0.85 }} animate={{ scale: 1 }} exit={{ scale: 0.85 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

// ── Friends Panel ─────────────────────────────────────────────────────────────
function FriendsPanel({ friends, loading, onUserClick, onRefresh }: {
  friends: FriendEntry[]; loading: boolean;
  onUserClick: (u: MiniUser) => void; onRefresh: () => void;
}) {
  const STATUS_DOT: Record<string, string> = { online: "#22c55e", busy: "#ef4444", away: "#f59e0b", offline: "#4b5563" };
  const STATUS_LABEL: Record<string, string> = { online: "Online", busy: "Ocupado", away: "Ausente", offline: "Offline" };
  const incoming = friends.filter(f => f.friendStatus === "pending" && f.direction === "received");
  const accepted = friends.filter(f => f.friendStatus === "accepted");
  const sent = friends.filter(f => f.friendStatus === "pending" && f.direction === "sent");
  const accept = async (id: number) => { try { await fetch(`/api/infinity/friends/${id}/accept`, { method: "POST", headers: authHeaders() }); onRefresh(); } catch {} };
  const decline = async (id: number) => { try { await fetch(`/api/infinity/friends/${id}/decline`, { method: "POST", headers: authHeaders() }); onRefresh(); } catch {} };
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>;
  return (
    <div className="flex-1 overflow-y-auto py-2 space-y-3 scrollbar-thin scrollbar-thumb-white/10">
      {incoming.length > 0 && (
        <div>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 px-3 block mb-1.5">Pedidos · {incoming.length}</span>
          {incoming.map(f => (
            <div key={f.id} className="px-2 py-2 hover:bg-white/5 rounded-xl mx-1 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <Avatar username={f.username} photo={f.photo} size={8} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate text-white/85">{f.displayName ?? f.username}</p>
                  <p className="text-[10px] text-white/30">@{f.username}</p>
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => accept(f.id)} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 20%, transparent)", color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)" }}>
                  Aceitar
                </button>
                <button onClick={() => decline(f.id)} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide border border-white/10 hover:bg-white/8 text-white/40 transition-all">
                  Recusar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {accepted.length > 0 && (
        <div>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 px-3 block mb-1.5">Amigos · {accepted.length}</span>
          {accepted.map(f => (
            <button key={f.id} onClick={() => onUserClick({ username: f.username, displayName: f.displayName, photo: f.photo, role: f.role, bio: null, accentColor: null })}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors text-left">
              <div className="relative shrink-0">
                <Avatar username={f.username} photo={f.photo} size={8} />
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-[1.5px]"
                  style={{ background: STATUS_DOT[f.status] ?? "#4b5563", borderColor: "rgba(15,18,28,0.85)" }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate text-white/80">{f.displayName ?? f.username}</p>
                <p className="text-[10px] text-white/30">{STATUS_LABEL[f.status] ?? "Offline"}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      {sent.length > 0 && (
        <div>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/20 px-3 block mb-1">Aguardando</span>
          {sent.map(f => (
            <div key={f.id} className="flex items-center gap-2 px-3 py-2 opacity-40">
              <Avatar username={f.username} photo={f.photo} size={8} />
              <div className="min-w-0"><p className="text-xs truncate text-white/60">{f.displayName ?? f.username}</p><p className="text-[10px] text-white/30">Pedido enviado</p></div>
            </div>
          ))}
        </div>
      )}
      {friends.length === 0 && (
        <div className="px-3 py-12 text-center">
          <Users className="w-8 h-8 text-white/10 mx-auto mb-3" />
          <p className="text-xs text-white/25">Nenhum amigo ainda</p>
          <p className="text-[10px] text-white/15 mt-1">Adicione pessoas clicando no avatar no chat</p>
        </div>
      )}
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, prev, myUsername, onReact, onUserClick, onReply, onDelete, onImgClick }: {
  msg: ChatMsg; prev?: ChatMsg; myUsername: string;
  onReact: (msgId: number, emoji: string) => void;
  onUserClick: (user: MiniUser) => void;
  onReply: (r: ReplyTo) => void;
  onDelete: (msgId: number) => void;
  onImgClick: (src: string) => void;
}) {
  const isConsecutive = prev && prev.username === msg.username &&
    !(!prev || !isSameDay(prev.createdAt, msg.createdAt)) &&
    (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 5 * 60 * 1000;
  const time = formatTime(msg.createdAt);
  const accent = msg.accentColor ?? "var(--color-primary)";
  const isOwn = msg.username === myUsername;
  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [replyFlash, setReplyFlash] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart = useRef({ x: 0, y: 0 });
  const wasDragging = useRef(false);
  const didLongPress = useRef(false);
  const cancelLP = () => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } };

  const onPD = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, a, img, input, textarea")) return;
    pointerStart.current = { x: e.clientX, y: e.clientY };
    wasDragging.current = false; didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null; didLongPress.current = true;
      setShowEmojiPicker(true); setShowActions(true);
      if (navigator.vibrate) navigator.vibrate(22);
    }, 500);
  };
  const onPM = (e: React.PointerEvent) => {
    const dx = e.clientX - pointerStart.current.x;
    const dy = Math.abs(e.clientY - pointerStart.current.y);
    if (Math.abs(dx) > 8 || dy > 8) cancelLP();
    if (dx > 0 && dy < 45 && !didLongPress.current) {
      wasDragging.current = true;
      setSwipeX(Math.min(dx * 0.55, 70));
    } else if (dx <= 0 && swipeX > 0) { setSwipeX(0); }
  };
  const onPU = (e: React.PointerEvent) => {
    const wasTap = longPressTimer.current !== null;
    cancelLP();
    if (swipeX > 52 && wasDragging.current && !didLongPress.current) {
      setReplyFlash(true); setTimeout(() => setReplyFlash(false), 280);
      onReply({ id: msg.id, username: msg.username, displayName: msg.displayName, content: msg.content });
      if (navigator.vibrate) navigator.vibrate([8, 8]);
    } else if (wasTap && !wasDragging.current && !didLongPress.current) {
      setShowActions(v => !v);
    }
    setSwipeX(0); wasDragging.current = false;
  };

  return (
    <div className={`relative overflow-x-hidden ${isConsecutive ? "mt-0" : "mt-4"}`}>
      {/* Reply indicator slides in from left */}
      <div className="absolute left-2.5 top-1/2 z-10 pointer-events-none flex items-center justify-center w-8 h-8 rounded-full"
        style={{ opacity: swipeX > 15 ? Math.min(1, (swipeX - 15) / 38) : 0, transform: `translateY(-50%) translateX(${Math.max(0, swipeX - 15)}px)`, background: "var(--color-primary)", color: "#000", transition: swipeX === 0 ? "opacity 0.18s, transform 0.18s" : "none" }}>
        <CornerUpLeft className="w-4 h-4" />
      </div>
      <div
        className={`flex items-start gap-3 sm:gap-4 group px-3 sm:px-4 py-0.5 relative transition-colors`}
        style={{ background: replyFlash ? "color-mix(in srgb, var(--color-primary) 10%, transparent)" : showActions ? "rgba(255,255,255,0.04)" : undefined, transform: `translateX(${swipeX}px)`, transition: swipeX === 0 ? "transform 0.2s cubic-bezier(0.25,0.46,0.45,0.94), background 0.15s" : "background 0.15s", touchAction: "pan-y" }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => { setShowActions(false); setShowEmojiPicker(false); }}
        onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU}
        onPointerCancel={() => { cancelLP(); setSwipeX(0); wasDragging.current = false; }}
      >
      {/* Avatar column */}
      <div className="w-10 shrink-0 mt-0.5">
        {!isConsecutive && (
          <button onClick={() => onUserClick({ username: msg.username, displayName: msg.displayName, photo: msg.photo, role: msg.role, bio: null, accentColor: msg.accentColor })}
            className="focus:outline-none hover:scale-105 transition-transform">
            <Avatar username={msg.username} photo={msg.photo} size={10} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {!isConsecutive && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <button onClick={() => onUserClick({ username: msg.username, displayName: msg.displayName, photo: msg.photo, role: msg.role, bio: null, accentColor: msg.accentColor })}
              className="focus:outline-none hover:underline font-bold text-[15px] leading-tight" style={{ color: accent }}>
              {msg.displayName ?? msg.username}
            </button>
            <RoleBadge role={msg.role} />
            <span className="text-[11px] text-white/40 font-medium">{isSameDay(msg.createdAt, new Date().toISOString()) ? `Hoje às ${time}` : time}</span>
            {isOwn && <span className="text-[10px] text-white/30">• você</span>}
          </div>
        )}

        {/* Reply preview */}
        {msg.replyToUsername && msg.replyToContent && (
          <div className="flex items-start gap-1.5 mb-1 pl-2 border-l-2 rounded py-0.5 cursor-pointer hover:bg-white/5 transition-colors"
            style={{ borderColor: accent + "60" }}>
            <CornerUpLeft className="w-3 h-3 shrink-0 mt-0.5 opacity-40" />
            <div className="min-w-0">
              <span className="text-[10px] font-semibold opacity-60" style={{ color: accent }}>@{msg.replyToUsername}</span>
              <p className="text-[11px] text-white/40 truncate max-w-[300px]">{msg.replyToContent}</p>
            </div>
          </div>
        )}

        <div className="text-sm text-white/90 break-words leading-relaxed">
          {renderContent(msg.content, accent, onImgClick)}
        </div>

        {/* Reactions */}
        {msg.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {msg.reactions.map(r => {
              const mine = r.users.includes(myUsername);
              return (
                <motion.button key={r.emoji} onClick={() => onReact(msg.id, r.emoji)}
                  whileTap={{ scale: 0.85 }}
                  whileHover={{ y: -2 }}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-sm transition-all border"
                  style={{
                    background: mine ? "color-mix(in srgb, var(--color-primary) 18%, transparent)" : "rgba(255,255,255,0.06)",
                    borderColor: mine ? "color-mix(in srgb, var(--color-primary) 50%, transparent)" : "rgba(255,255,255,0.08)",
                  }}
                  title={r.users.join(", ")}>
                  <span className="text-base leading-none">{r.emoji}</span>
                  <span className={`text-xs font-bold ${mine ? "text-primary" : "text-white/65"}`}>{r.count}</span>
                </motion.button>
              );
            })}
            <button onClick={() => setShowEmojiPicker(true)} className="opacity-0 group-hover:opacity-100 w-7 h-6 rounded-lg border border-dashed border-white/20 hover:border-primary hover:bg-primary/10 text-white/40 hover:text-primary flex items-center justify-center transition-all" title="Adicionar reação">
              <Smile className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Consecutive timestamp on hover */}
        {isConsecutive && showActions && (
          <span className="text-[9px] text-white/20 absolute left-3.5 top-1 leading-none pointer-events-none">{time}</span>
        )}
      </div>

      {/* Hover action toolbar */}
      <AnimatePresence>
        {showActions && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 4 }} transition={{ duration: 0.1 }}
            className="absolute right-3 -top-4 flex items-center gap-0.5 rounded-xl px-1.5 py-1 shadow-xl z-20 border border-white/[0.08]"
            style={{ background: "hsl(220 35% 10%)" }}
          >
            {QUICK_EMOJIS.map(e => (
              <button key={e} onClick={() => onReact(msg.id, e)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-sm hover:bg-white/10 hover:scale-110 transition-all">{e}</button>
            ))}
            <div className="w-px h-4 bg-white/10 mx-0.5" />
            <div className="relative">
              <button onClick={() => setShowEmojiPicker(v => !v)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-primary hover:bg-white/10 transition-colors" title="Mais emojis">
                <Smile className="w-3.5 h-3.5" />
              </button>
              <AnimatePresence>
                {showEmojiPicker && (
                  <EmojiPickerPopup
                    onSelect={e => { onReact(msg.id, e); setShowEmojiPicker(false); }}
                    onClose={() => setShowEmojiPicker(false)} />
                )}
              </AnimatePresence>
            </div>
            <div className="w-px h-4 bg-white/10 mx-0.5" />
            <button onClick={() => onReply({ id: msg.id, username: msg.username, displayName: msg.displayName, content: msg.content })}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-primary hover:bg-white/10 transition-colors" title="Responder">
              <CornerUpLeft className="w-3.5 h-3.5" />
            </button>
            {isOwn && (
              <button onClick={() => onDelete(msg.id)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-colors" title="Apagar">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}

// ── User Popup ────────────────────────────────────────────────────────────────
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
    } catch { setFriendStatus("error"); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }} onClick={onClose}>
      <motion.div initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 12 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className="w-full max-w-xs rounded-2xl border border-white/10 overflow-hidden shadow-2xl"
        style={{ background: "hsl(220 35% 8%)" }} onClick={e => e.stopPropagation()}>
        <div className="h-20 relative" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 35%, transparent), hsl(220 35% 8%))` }}>
          <button onClick={onClose} className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center hover:bg-black/30 text-white/60 transition-colors">
            <X className="w-4 h-4" />
          </button>
          <div className="absolute -bottom-9 left-4">
            <div className="w-16 h-16 rounded-2xl overflow-hidden" style={{ boxShadow: `0 0 0 4px hsl(220 35% 8%)` }}>
              {user.photo
                ? <img src={user.photo} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-2xl font-bold" style={{ background: hashColor(user.username), color: "#000" }}>
                    {(user.displayName ?? user.username)[0]?.toUpperCase()}
                  </div>}
            </div>
          </div>
        </div>
        <div className="pt-11 px-4 pb-4">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="font-bold text-base" style={{ color: accent }}>{user.displayName ?? user.username}</span>
            <RoleBadge role={user.role} />
          </div>
          <p className="text-xs text-white/35 mb-3">@{user.username}</p>
          {user.bio && <p className="text-xs text-white/60 mb-3 line-clamp-2 leading-relaxed border-l-2 pl-2" style={{ borderColor: accent + "50" }}>{user.bio}</p>}
          <div className={`grid gap-2 mt-2 ${isSelf ? "grid-cols-1" : "grid-cols-3"}`}>
            <Link href={`/u/${user.username}`} onClick={onClose}>
              <button className="flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors w-full">
                <UserCircle className="w-4 h-4 text-white/40" />
                <span className="text-[9px] text-white/50 font-medium">Ver Perfil</span>
              </button>
            </Link>
            {!isSelf && (
              <button onClick={sendFriendRequest} disabled={friendStatus !== "none"}
                className="flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-60">
                {friendStatus === "sending" ? <Loader2 className="w-4 h-4 animate-spin text-white/40" />
                  : friendStatus === "sent" ? <span className="text-green-400 text-sm font-bold">✓</span>
                  : friendStatus === "error" ? <span className="text-red-400 text-sm">!</span>
                  : <UserPlus className="w-4 h-4 text-white/40" />}
                <span className="text-[9px] text-white/50 font-medium">
                  {friendStatus === "sent" ? "Enviado!" : friendStatus === "error" ? "Erro" : "Add Amigo"}
                </span>
              </button>
            )}
            {!isSelf && (
              <Link href={`/dm/${user.username}`} onClick={onClose}>
                <button className="flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl transition-colors w-full"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)" }}>
                  <AtSign className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
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

// ── Create Room Modal ─────────────────────────────────────────────────────────
function CreateRoomModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: Room) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [icon, setIcon] = useState("💬");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const ICONS = ["💬","🎮","🎵","📊","🔥","⚡","🌊","🏆","💡","🎯","🛡️","🌐","🤖","⚗️","🗡️","🌿"];

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
    } catch { setErr("Erro de conexão"); } finally { setLoading(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        className="w-full max-w-sm rounded-2xl border border-white/10 p-6 space-y-4"
        style={{ background: "hsl(220 35% 8%)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-base">Criar Sala</h2>
            <p className="text-xs text-white/30 mt-0.5">Crie um espaço público para conversar</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 text-white/40"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-white/30 mb-2 block font-semibold">Ícone</label>
          <div className="flex flex-wrap gap-2">
            {ICONS.map(ic => (
              <button key={ic} onClick={() => setIcon(ic)}
                className={`w-9 h-9 rounded-xl text-lg transition-all ${icon === ic ? "border-2 scale-110" : "border border-white/10 hover:border-white/25 hover:bg-white/5"}`}
                style={{ borderColor: icon === ic ? "var(--color-primary)" : undefined, background: icon === ic ? "color-mix(in srgb, var(--color-primary) 15%, transparent)" : undefined }}>{ic}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-white/30 mb-2 block font-semibold">Nome da sala *</label>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()}
            placeholder="ex: discussão geral"
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-primary/50 transition-colors" maxLength={50} />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-white/30 mb-2 block font-semibold">Descrição</label>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Opcional"
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-primary/50 transition-colors" maxLength={200} />
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button onClick={create} disabled={!name.trim() || loading}
          className="w-full py-3 rounded-xl font-bold text-sm uppercase tracking-widest transition-all disabled:opacity-40 hover:opacity-90"
          style={{ background: "var(--color-primary)", color: "#000" }}>
          {loading ? "Criando..." : "Criar sala"}
        </button>
      </motion.div>
    </motion.div>
  );
}

// ── GIF Picker ────────────────────────────────────────────────────────────────
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
      setGifs((d.results ?? []).map(g => ({ url: g.media_formats?.gif?.url ?? "", preview: g.media_formats?.tinygif?.url ?? g.media_formats?.gif?.url ?? "" })).filter(g => g.url));
    } catch { setGifs([]); } finally { setLoading(false); }
  };

  return (
    <div className="border-t border-white/[0.06] p-3" style={{ background: "rgba(2,6,18,0.6)" }}>
      <div className="flex gap-2 mb-2.5">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Buscar GIFs (Tenor)..."
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-primary/50 placeholder-white/25" />
        <button onClick={search} className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/50 rounded-xl text-xs transition-colors">Buscar</button>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl text-white/30 transition-colors"><X className="w-4 h-4" /></button>
      </div>
      {loading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}
      {!loading && gifs.length === 0 && <p className="text-white/25 text-xs text-center py-3">Digite e pressione Enter para buscar</p>}
      <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto">
        {gifs.map((g, i) => (
          <button key={i} onClick={() => { onSelect(g.url); onClose(); }}
            className="aspect-video rounded-xl overflow-hidden hover:opacity-80 hover:scale-105 transition-all">
            <img src={g.preview} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Search Users Modal ────────────────────────────────────────────────────────
function SearchUsersModal({ onClose, onUserClick }: { onClose: () => void; onUserClick: (u: MiniUser) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MiniUser[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/infinity/users/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
        if (r.ok) setResults(await r.json() as MiniUser[]);
      } catch {} finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-20" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: -20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: -20 }}
        className="w-full max-w-sm rounded-2xl border border-white/10 overflow-hidden shadow-2xl"
        style={{ background: "hsl(220 35% 8%)" }} onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-white/[0.06] flex items-center gap-3">
          <Search className="w-4 h-4 text-white/30 shrink-0" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar usuários..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-white/25" />
          {loading && <Loader2 className="w-4 h-4 animate-spin text-white/30 shrink-0" />}
          <button onClick={onClose} className="shrink-0 text-white/30 hover:text-white/70 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {q.length < 2 && <p className="text-xs text-white/25 text-center py-6">Digite ao menos 2 caracteres</p>}
          {q.length >= 2 && !loading && results.length === 0 && <p className="text-xs text-white/25 text-center py-6">Nenhum usuário encontrado</p>}
          {results.map(u => (
            <button key={u.username} onClick={() => { onUserClick(u); onClose(); }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left">
              <Avatar username={u.username} photo={u.photo} size={9} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate" style={{ color: u.accentColor ?? "var(--color-primary)" }}>{u.displayName ?? u.username}</div>
                <div className="text-[10px] text-white/30">@{u.username}</div>
              </div>
              <RoleBadge role={u.role} />
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Typing Indicator ──────────────────────────────────────────────────────────
function TypingIndicator({ typingUsers }: { typingUsers: Map<string, string> }) {
  const list = Array.from(typingUsers.entries());
  if (list.length === 0) return null;
  const names = list.map(([, dn]) => dn);
  const text = names.length === 1 ? `${names[0]} está digitando`
    : names.length === 2 ? `${names[0]} e ${names[1]} estão digitando`
    : `${names[0]} e mais ${names.length - 1} estão digitando`;
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
      className="flex items-center gap-2 px-4 py-1.5">
      <div className="flex gap-0.5">
        {[0, 1, 2].map(i => (
          <motion.span key={i} className="w-1.5 h-1.5 rounded-full bg-white/30 inline-block"
            animate={{ y: [0, -3, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }} />
        ))}
      </div>
      <span className="text-[10px] text-white/30 italic">{text}...</span>
    </motion.div>
  );
}

// ── Pending File Preview ──────────────────────────────────────────────────────
function PendingFileBar({ file, onRemove }: { file: PendingFile; onRemove: () => void }) {
  const isImg = file.mimeType.startsWith("image/");
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
      className="border-t border-white/[0.06] px-3 py-2.5 bg-white/[0.02]">
      <div className="flex items-center gap-3">
        {isImg ? (
          <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-white/10">
            <img src={file.previewUrl} alt="" className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-14 h-14 rounded-xl shrink-0 border border-white/10 bg-white/5 flex items-center justify-center">
            <FileIcon className="w-6 h-6 text-white/30" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white/80 truncate">{file.filename}</p>
          <p className="text-[10px] text-white/30 mt-0.5">{file.sizeLabel} · {isImg ? "Imagem" : "Arquivo"}</p>
          <p className="text-[9px] text-primary/60 mt-0.5">Pronto para enviar — adicione uma legenda ou envie direto</p>
        </div>
        <button onClick={onRemove} className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center hover:bg-red-400/10 text-white/30 hover:text-red-400 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

// ── Delete Confirm ────────────────────────────────────────────────────────────
function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} onClick={onCancel}>
      <motion.div initial={{ scale: 0.9, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 8 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="w-full max-w-xs rounded-2xl border border-white/10 p-5 shadow-2xl"
        style={{ background: "hsl(220 35% 9%)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-red-400/10 flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <p className="font-semibold text-sm">Apagar mensagem</p>
            <p className="text-[10px] text-white/30">Essa ação não pode ser desfeita.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-sm transition-colors">Cancelar</button>
          <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-red-500/80 hover:bg-red-500 text-white text-sm font-semibold transition-colors">Apagar</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
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
  const [wsKey, setWsKey] = useState(0);
  const wsDelayRef = useRef(1_500);
  const wsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [selectedUser, setSelectedUser] = useState<MiniUser | null>(null);
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [imgUploading, setImgUploading] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<{ username: string; displayName: string | null }[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"rooms" | "friends">("rooms");
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingUserTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const myUsername = me?.username ?? "";

  // Load rooms
  useEffect(() => {
    fetch("/api/infinity/chat/rooms", { headers: authHeaders() })
      .then(r => r.json())
      .then((data: Room[]) => {
        setRooms(data);
        const global = data.find(r => r.slug === "global");
        if (global) setActiveRoom(global);
      }).catch(() => {});
  }, []);

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    try {
      const r = await fetch("/api/infinity/friends", { headers: authHeaders() });
      if (r.ok) setFriends(await r.json() as FriendEntry[]);
    } catch {} finally { setFriendsLoading(false); }
  }, []);

  useEffect(() => {
    if (!me) return;
    void loadFriends();
  }, [me, loadFriends]);

  const loadMessages = useCallback(async (slug: string) => {
    try {
      const r = await fetch(`/api/infinity/chat/rooms/${slug}/messages?limit=80`, { headers: authHeaders() });
      if (r.ok) setMessages(await r.json() as ChatMsg[]);
    } catch {}
  }, []);

  useEffect(() => {
    if (!activeRoom) return;
    setMessages([]);
    setReplyTo(null);
    loadMessages(activeRoom.slug);
  }, [activeRoom, loadMessages]);

  // WebSocket with auto-reconnect
  useEffect(() => {
    if (!me) return;
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;
    ws.onopen = () => {
      setWsReady(true);
      wsDelayRef.current = 1_500;
    };
    ws.onclose = () => {
      setWsReady(false);
      wsRef.current = null;
      if (wsTimerRef.current) clearTimeout(wsTimerRef.current);
      const d = wsDelayRef.current;
      wsDelayRef.current = Math.min(d * 2, 30_000);
      wsTimerRef.current = setTimeout(() => setWsKey(k => k + 1), d);
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as Record<string, unknown>;
        if (data.type === "message") {
          const msg = data as unknown as ChatMsg;
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, { ...msg, reactions: (msg as any).reactions ?? [] }];
          });
          const from = String(data.username ?? "");
          if (from) {
            setTypingUsers(prev => { const next = new Map(prev); next.delete(from); return next; });
            const t = typingUserTimers.current.get(from);
            if (t) { clearTimeout(t); typingUserTimers.current.delete(from); }
          }
        }
        if (data.type === "reaction_update") {
          const { messageId, reactions } = data as { messageId: number; reactions: Reaction[] };
          setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
        }
        if (data.type === "message_delete") {
          const { messageId } = data as { messageId: number };
          setMessages(prev => prev.filter(m => m.id !== messageId));
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
    const ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" })); }, 25_000);
    return () => {
      clearInterval(ping);
      if (wsTimerRef.current) clearTimeout(wsTimerRef.current);
      ws.onclose = null;
      ws.close();
      wsRef.current = null;
    };
  }, [me, myUsername, wsKey]);

  useEffect(() => {
    if (!activeRoom || !wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "join", roomSlug: activeRoom.slug }));
    setTypingUsers(new Map());
  }, [activeRoom, wsReady]);

  // Auto-scroll only when at bottom
  useEffect(() => {
    if (isAtBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAtBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
  }, []);

  const sendTyping = useCallback(() => {
    if (!activeRoom || wsRef.current?.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "typing", roomSlug: activeRoom.slug }));
  }, [activeRoom]);

  const sendMessage = useCallback(async (content: string, rToId?: number) => {
    const trimmed = content.trim();
    if (!trimmed || !activeRoom || sending) return;
    setInput(""); setReplyTo(null);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "message", roomSlug: activeRoom.slug, content: trimmed, replyToId: rToId ?? null }));
    } else {
      setSending(true);
      try {
        await fetch(`/api/infinity/chat/rooms/${activeRoom.slug}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ content: trimmed, replyToId: rToId ?? null }),
        });
        await loadMessages(activeRoom.slug);
      } catch {} finally { setSending(false); }
    }
    setIsAtBottom(true);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    inputRef.current?.focus();
  }, [activeRoom, sending, loadMessages]);

  const handleSend = useCallback(async () => {
    if (!activeRoom) return;
    if (pendingFile) {
      setImgUploading(true);
      try {
        const token = localStorage.getItem("infinity_token");
        const r = await fetch("/api/infinity/chat/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ dataUri: pendingFile.dataUri }),
        });
        if (r.ok) {
          const { url } = await r.json() as { url: string };
          const imgUrl = `${window.location.origin}${url}`;
          const content = input.trim() ? `${imgUrl}\n${input.trim()}` : imgUrl;
          await sendMessage(content, replyTo?.id);
          setPendingFile(null);
        }
      } catch {} finally { setImgUploading(false); }
    } else {
      await sendMessage(input, replyTo?.id);
    }
  }, [activeRoom, pendingFile, input, replyTo, sendMessage]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => sendTyping(), 500);
    const atMatch = value.match(/@(\w*)$/);
    if (atMatch) setMentionQuery(atMatch[1] ?? "");
    else { setMentionQuery(null); setMentionSuggestions([]); }
  }, [sendTyping]);

  useEffect(() => {
    if (mentionQuery === null || !activeRoom) { setMentionSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/infinity/chat/rooms/${activeRoom.slug}/members`, { headers: authHeaders() });
        if (r.ok) {
          const members = await r.json() as { username: string; displayName: string | null }[];
          const q = mentionQuery.toLowerCase();
          const withSelf = members.some(m => m.username === myUsername) ? members : [{ username: myUsername, displayName: null }, ...members];
          setMentionSuggestions(withSelf.filter(m => m.username.toLowerCase().includes(q) || (m.displayName ?? "").toLowerCase().includes(q)).slice(0, 7));
        }
      } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [mentionQuery, activeRoom, myUsername]);

  const insertMention = useCallback((username: string) => {
    const newVal = input.replace(/@(\w*)$/, `@${username} `);
    setInput(newVal);
    setMentionQuery(null);
    setMentionSuggestions([]);
    inputRef.current?.focus();
  }, [input]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      setPendingFile({ dataUri, mimeType: file.type, filename: file.name, sizeLabel: formatBytes(file.size), previewUrl: URL.createObjectURL(file) });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleReact = async (messageId: number, emoji: string) => {
    try {
      const r = await fetch(`/api/infinity/chat/messages/${messageId}/react`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ emoji }),
      });
      if (r.ok) {
        const d = await r.json() as { reactions: Reaction[] };
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: d.reactions } : m));
      }
    } catch {}
  };

  const handleDelete = async (messageId: number) => {
    try {
      const r = await fetch(`/api/infinity/chat/messages/${messageId}`, { method: "DELETE", headers: authHeaders() });
      if (r.ok) setMessages(prev => prev.filter(m => m.id !== messageId));
    } catch {}
    setDeleteConfirmId(null);
  };

  const canSend = (!!input.trim() || !!pendingFile) && !!activeRoom && !sending && !imgUploading;

  return (
    <div className="flex h-full overflow-hidden relative">
      <AnimatePresence>
        {lightboxSrc && <LightboxModal src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
        {showCreate && <CreateRoomModal onClose={() => setShowCreate(false)} onCreated={r => { setRooms(prev => [...prev, r]); setActiveRoom(r); }} />}
        {selectedUser && <UserPopup user={selectedUser} onClose={() => setSelectedUser(null)} myUsername={myUsername} />}
        {showSearch && <SearchUsersModal onClose={() => setShowSearch(false)} onUserClick={u => { setSelectedUser(u); setShowSearch(false); }} />}
        {deleteConfirmId !== null && (
          <DeleteConfirm
            onConfirm={() => handleDelete(deleteConfirmId)}
            onCancel={() => setDeleteConfirmId(null)} />
        )}
      </AnimatePresence>

      {/* ── Sidebar mobile backdrop ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden fixed inset-0 z-20 bg-black/55 backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      {/* ── Sidebar ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ x: -260, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -260, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute lg:relative inset-y-0 left-0 z-30 w-[240px] lg:w-[240px] shrink-0 h-full flex flex-col border-r border-white/[0.06] overflow-hidden shadow-2xl lg:shadow-none"
            style={{ background: "rgba(15,18,28,0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>

            {/* Sidebar header */}
            <div className="px-3 py-3 border-b border-white/[0.06]">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-primary) 18%, transparent)" }}>
                    <Hash className="w-3 h-3" style={{ color: "var(--color-primary)" }} />
                  </div>
                  <span className="font-bold text-xs uppercase tracking-[0.18em] text-white/50">Comunidade</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowSearch(true)}
                    className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 text-white/25 hover:text-primary transition-colors" title="Buscar usuários">
                    <Search className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setShowCreate(true)}
                    className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 text-white/25 hover:text-primary transition-colors" title="Criar sala">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Connection status */}
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${wsReady ? "bg-green-400" : "bg-yellow-400 animate-pulse"}`} />
                <span className="text-[10px] text-white/30">{wsReady ? "Conectado" : "Reconectando..."}</span>
              </div>
            </div>

            {/* Tab switcher: Salas / Amigos */}
            <div className="flex gap-1 px-2 pt-2 pb-1">
              {(["rooms", "friends"] as const).map(tab => {
                const pendingCount = tab === "friends" ? friends.filter(f => f.friendStatus === "pending" && f.direction === "received").length : 0;
                return (
                  <button key={tab} onClick={() => { setSidebarTab(tab); if (tab === "friends") void loadFriends(); }}
                    className="flex-1 relative py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                    style={sidebarTab === tab
                      ? { background: "color-mix(in srgb, var(--color-primary) 20%, transparent)", color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)" }
                      : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.07)" }
                    }>
                    {tab === "rooms" ? "# Salas" : "Amigos"}
                    {pendingCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center font-bold leading-none">
                        {pendingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {sidebarTab === "rooms" ? (
              <>
                <div className="px-3 pt-2 pb-1">
                  <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/20">Canais de texto</span>
                </div>
                <div className="flex-1 overflow-y-auto pb-2 px-1.5 space-y-0.5 scrollbar-thin scrollbar-thumb-white/10">
                  {rooms.map(room => {
                    const isActive = activeRoom?.slug === room.slug;
                    return (
                      <button key={room.slug}
                        onClick={() => { setActiveRoom(room); if (window.innerWidth < 1024) setSidebarOpen(false); }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors relative group ${isActive ? "text-white" : "text-white/45 hover:text-white/85"}`}
                        style={isActive ? { background: "rgba(255,255,255,0.08)" } : {}}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
                        {isActive && <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-1 h-7 rounded-r-full" style={{ background: "var(--color-primary)" }} />}
                        <Hash className="w-4 h-4 shrink-0 text-white/40" />
                        <span className="text-[15px] font-medium truncate flex-1">{room.name}</span>
                        {room.type === "global" && <Globe className="w-3 h-3 shrink-0 text-white/25" />}
                      </button>
                    );
                  })}
                  {rooms.length === 0 && <div className="px-3 py-8 text-center"><p className="text-xs text-white/20">Nenhuma sala ainda</p></div>}
                </div>
                <div className="p-2.5 border-t border-white/[0.06] space-y-1">
                  <button onClick={() => setShowCreate(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/30 hover:text-white/60 hover:bg-white/5 border border-dashed border-white/[0.08] hover:border-white/20 transition-all">
                    <Plus className="w-3.5 h-3.5" /> Nova sala
                  </button>
                  <Link href="/dm/...">
                    <button className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/30 hover:text-white/60 hover:bg-white/5 transition-all">
                      <MessageSquareDiff className="w-3.5 h-3.5" /> Nova DM
                    </button>
                  </Link>
                </div>
              </>
            ) : (
              <FriendsPanel
                friends={friends}
                loading={friendsLoading}
                onUserClick={u => { setSelectedUser(u); if (window.innerWidth < 1024) setSidebarOpen(false); }}
                onRefresh={loadFriends}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main chat area ── */}
      <div className="flex-1 flex flex-col min-w-0 relative">

        {/* Header */}
        <div className="shrink-0 px-4 h-12 flex items-center gap-3 shadow-lg z-10"
          style={{ background: "rgba(15,18,28,0.5)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={() => setSidebarOpen(v => !v)}
            className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-white/5 text-white/40 hover:text-white shrink-0 transition-colors lg:hidden">
            <ChevronRight className={`w-5 h-5 transition-transform duration-200 ${sidebarOpen ? "rotate-180" : ""}`} />
          </button>
          {activeRoom ? (
            <>
              <Hash className="w-5 h-5 text-white/40 shrink-0" />
              <div className="min-w-0 flex items-baseline gap-3">
                <span className="font-bold text-[15px] text-white truncate">{activeRoom.name}</span>
                {activeRoom.description && (
                  <>
                    <span className="hidden sm:inline w-px h-4 bg-white/10 self-center" />
                    <span className="hidden sm:inline text-[13px] text-white/45 truncate">{activeRoom.description}</span>
                  </>
                )}
              </div>
              <div className="ml-auto flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: wsReady ? "rgba(34,197,94,0.12)" : "rgba(234,179,8,0.12)" }}>
                  <span className={`w-1.5 h-1.5 rounded-full ${wsReady ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
                  <span className={`text-[11px] font-semibold uppercase tracking-wide ${wsReady ? "text-green-400" : "text-yellow-400"}`}>{wsReady ? "ao vivo" : "offline"}</span>
                </div>
                <button onClick={() => setShowSearch(true)}
                  className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-white/5 text-white/45 hover:text-white transition-colors" title="Buscar usuários">
                  <Users className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : <span className="text-sm text-white/30">Selecione uma sala</span>}
        </div>

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-2 scrollbar-thin scrollbar-thumb-white/10">
          {!activeRoom && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
              <div className="w-14 h-14 rounded-2xl border border-white/[0.08] flex items-center justify-center" style={{ background: "hsl(220 35% 7%)" }}>
                <Hash className="w-7 h-7 text-white/15" />
              </div>
              <p className="text-sm text-white/30">Selecione uma sala para começar</p>
            </div>
          )}
          {activeRoom && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
              <div className="text-5xl">{activeRoom.icon ?? "💬"}</div>
              <div>
                <p className="font-bold text-lg text-white/80">#{activeRoom.name}</p>
                {activeRoom.description && <p className="text-sm text-white/30 mt-1">{activeRoom.description}</p>}
                <p className="text-xs text-white/20 mt-2">Seja o primeiro a enviar uma mensagem neste canal.</p>
              </div>
            </div>
          )}

          {/* Messages list with day separators */}
          {messages.map((msg, i) => {
            const prev = messages[i - 1];
            const showDay = !prev || !isSameDay(prev.createdAt, msg.createdAt);
            return (
              <div key={msg.id}>
                {showDay && <DaySeparator label={formatDaySeparator(msg.createdAt)} />}
                <MessageBubble
                  msg={msg}
                  prev={showDay ? undefined : prev}
                  myUsername={myUsername}
                  onReact={handleReact}
                  onUserClick={setSelectedUser}
                  onReply={r => { setReplyTo(r); inputRef.current?.focus(); }}
                  onDelete={id => setDeleteConfirmId(id)}
                  onImgClick={setLightboxSrc}
                />
              </div>
            );
          })}

          <AnimatePresence>
            <TypingIndicator typingUsers={typingUsers} />
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>

        {/* Jump to bottom FAB */}
        <AnimatePresence>
          {!isAtBottom && activeRoom && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8, y: 8 }}
              onClick={() => { setIsAtBottom(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
              className="absolute bottom-20 right-4 w-9 h-9 rounded-full flex items-center justify-center shadow-xl border border-white/15 hover:scale-110 hover:border-primary/40 transition-all z-10"
              style={{ background: "hsl(220 35% 12%)" }}
            >
              <ArrowDown className="w-4 h-4 text-white/50" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* GIF Picker */}
        {showGif && activeRoom && (
          <GifPicker onSelect={url => sendMessage(url, replyTo?.id)} onClose={() => setShowGif(false)} />
        )}

        {/* Input zone */}
        <div className="shrink-0 px-3 sm:px-4 pb-3 pt-1" style={{ background: "rgba(15,18,28,0.45)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}>

          {/* @ Mention suggestions */}
          <AnimatePresence>
            {mentionSuggestions.length > 0 && mentionQuery !== null && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                className="border-t border-white/[0.05] divide-y divide-white/[0.04]"
                style={{ background: "hsl(220 35% 7%)" }}>
                {mentionSuggestions.map(u => (
                  <button key={u.username} onClick={() => insertMention(u.username)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-white/5 text-left transition-colors">
                    <Avatar username={u.username} photo={null} size={6} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-white/90">{u.displayName ?? u.username}</span>
                      <span className="text-xs text-white/30 ml-1.5">@{u.username}</span>
                    </div>
                    {u.username === myUsername && <span className="text-[9px] text-primary/60 shrink-0">você</span>}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reply preview */}
          <AnimatePresence>
            {replyTo && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-3 px-4 py-2 bg-white/[0.02] border-t border-white/[0.04]">
                <CornerUpLeft className="w-3.5 h-3.5 text-white/30 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-semibold" style={{ color: "var(--color-primary)" }}>
                    @{replyTo.username}{replyTo.username === myUsername ? " (você)" : ""}
                  </span>
                  <p className="text-[11px] text-white/35 truncate">{replyTo.content}</p>
                </div>
                <button onClick={() => setReplyTo(null)} className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 text-white/25 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Pending file preview */}
          <AnimatePresence>
            {pendingFile && <PendingFileBar file={pendingFile} onRemove={() => setPendingFile(null)} />}
          </AnimatePresence>

          {/* Input row — Discord-style pill */}
          <div className="flex items-end gap-2 rounded-2xl px-3 py-2.5 border border-white/10" style={{ background: "rgba(56,58,64,0.55)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
            <button onClick={() => fileInputRef.current?.click()}
              className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all ${pendingFile ? "bg-primary text-black" : "bg-white/55 hover:bg-white text-[#383a40]"}`}
              title="Anexar foto" disabled={!activeRoom || imgUploading}>
              {imgUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-5 h-5" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

            {/* Text input */}
            <input
              ref={inputRef}
              value={input}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (mentionSuggestions.length > 0) insertMention(mentionSuggestions[0]!.username);
                  else void handleSend();
                }
                if (e.key === "Escape") { setReplyTo(null); setMentionQuery(null); setMentionSuggestions([]); setPendingFile(null); }
              }}
              placeholder={
                pendingFile ? "Adicione uma legenda (opcional)..."
                  : activeRoom ? `Conversar em #${activeRoom.name}`
                  : "Selecione uma sala"
              }
              disabled={!activeRoom || sending}
              className="flex-1 min-w-0 bg-transparent border-0 text-[15px] text-white focus:outline-none transition-colors placeholder:text-white/40 disabled:opacity-40"
            />

            <button onClick={() => setShowGif(v => !v)}
              className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors ${showGif ? "text-primary" : "text-white/55 hover:text-white"}`}
              title="GIF" disabled={!activeRoom}>
              <Gift className="w-5 h-5" />
            </button>

            {canSend ? (
              <button onClick={handleSend}
                className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all hover:scale-110"
                style={{ color: "var(--color-primary)" }}>
                {sending || imgUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            ) : (
              <Smile className="w-5 h-5 text-white/55 shrink-0" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
