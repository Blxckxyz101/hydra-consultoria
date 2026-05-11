import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hash, Plus, Send, X, Globe, Lock, Smile, AtSign, Crown, Shield, ChevronRight, Users, Loader2 } from "lucide-react";
import { useInfinityMe } from "@workspace/api-client-react";
import { Link } from "wouter";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getWsUrl(): string {
  const token = localStorage.getItem("infinity_token") ?? "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${proto}//${host}/api/ws/chat?token=${encodeURIComponent(token)}`;
}

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 65%, 62%)`;
}

interface Room { id: number; slug: string; name: string; type: string; createdBy: string; description: string | null; icon: string | null; createdAt: string }
interface ChatMsg {
  id: number; roomSlug: string; username: string; displayName: string | null;
  photo: string | null; role: string; accentColor: string | null; content: string; createdAt: string
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

function MessageBubble({ msg, prev }: { msg: ChatMsg; prev?: ChatMsg }) {
  const isConsecutive = prev && prev.username === msg.username &&
    (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 5 * 60 * 1000;

  const time = new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const accent = msg.accentColor ?? "var(--color-primary)";
  const displayName = msg.displayName ?? msg.username;

  // Parse @mentions
  const parts = msg.content.split(/(@\w+)/g);

  return (
    <div className={`flex items-start gap-3 group hover:bg-white/[0.02] px-2 py-1 rounded-xl transition-colors ${isConsecutive ? "mt-0.5" : "mt-3"}`}>
      <div className="w-8 shrink-0">
        {!isConsecutive && <Avatar username={msg.username} photo={msg.photo} size={8} />}
      </div>
      <div className="flex-1 min-w-0">
        {!isConsecutive && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <Link href={`/u/${msg.username}`}>
              <span className="font-semibold text-sm cursor-pointer hover:underline" style={{ color: accent }}>
                {displayName}
              </span>
            </Link>
            <RoleBadge role={msg.role} />
            <span className="text-[10px] text-muted-foreground/40">{time}</span>
          </div>
        )}
        <p className="text-sm text-foreground/90 break-words leading-relaxed">
          {parts.map((p, i) =>
            p.startsWith("@")
              ? <Link key={i} href={`/u/${p.slice(1)}`}><span className="font-semibold cursor-pointer hover:underline" style={{ color: accent }}>{p}</span></Link>
              : <span key={i}>{p}</span>
          )}
        </p>
      </div>
      <span className="text-[9px] text-muted-foreground/0 group-hover:text-muted-foreground/30 transition-colors shrink-0 self-center">{isConsecutive ? time : ""}</span>
    </div>
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
      onCreated(room);
      onClose();
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
                style={{ borderColor: icon === ic ? "var(--color-primary)" : undefined }}>
                {ic}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 block">Nome da sala *</label>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()}
            placeholder="ex: discussão geral"
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-primary transition-colors"
            maxLength={50} />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 block">Descrição</label>
          <input value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Opcional"
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-primary transition-colors"
            maxLength={200} />
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

export default function Comunidade() {
  const { data: me } = useInfinityMe({});

  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load rooms
  useEffect(() => {
    fetch("/api/infinity/chat/rooms", { headers: authHeaders() })
      .then(r => r.json())
      .then((data: Room[]) => {
        setRooms(data);
        const global = data.find(r => r.slug === "global");
        if (global) setActiveRoom(global);
      })
      .catch(() => {});
  }, []);

  // Load messages when room changes
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

  // WebSocket
  useEffect(() => {
    if (!me) return;
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => setWsReady(true);
    ws.onclose = () => setWsReady(false);

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as { type: string; [k: string]: unknown };
        if (data.type === "message") {
          const msg = data as unknown as ChatMsg & { type: string };
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
        if (data.type === "online") setOnlineCount(data.count as number ?? 0);
      } catch {}
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [me]);

  // Join active room via WS
  useEffect(() => {
    if (!activeRoom || !wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "join", roomSlug: activeRoom.slug }));
  }, [activeRoom, wsReady]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !activeRoom || sending) return;
    const content = input.trim();
    setInput("");

    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "message", roomSlug: activeRoom.slug, content }));
    } else {
      // REST fallback
      setSending(true);
      try {
        await fetch(`/api/infinity/chat/rooms/${activeRoom.slug}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ content }),
        });
        await loadMessages(activeRoom.slug);
      } catch {}
      finally { setSending(false); }
    }
    inputRef.current?.focus();
  };

  const mentionUser = (username: string) => {
    setInput(prev => prev + `@${username} `);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden">
      {/* Rooms sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 240, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 h-full flex flex-col border-r border-white/[0.06] overflow-hidden"
            style={{ background: "rgba(2,6,18,0.4)", backdropFilter: "blur(16px)" }}
          >
            {/* Sidebar header */}
            <div className="px-4 py-4 border-b border-white/5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
                  <span className="font-bold text-sm uppercase tracking-[0.2em]">Comunidade</span>
                </div>
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors"
                  title="Criar sala"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              {wsReady && (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[10px] text-muted-foreground/50">Conectado</span>
                </div>
              )}
            </div>

            {/* Room list */}
            <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
              {rooms.map(room => {
                const isActive = activeRoom?.slug === room.slug;
                return (
                  <button
                    key={room.slug}
                    onClick={() => setActiveRoom(room)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${
                      isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                    style={isActive ? {
                      background: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 25%, transparent)",
                    } : {}}
                  >
                    <span className="text-base w-5 text-center shrink-0">{room.icon ?? (room.type === "global" ? "🌐" : "#")}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{room.name}</div>
                      {room.description && <div className="text-[10px] text-muted-foreground/50 truncate">{room.description}</div>}
                    </div>
                    {room.type === "global" && <Globe className="w-3 h-3 shrink-0 text-muted-foreground/40 ml-auto" />}
                  </button>
                );
              })}

              {rooms.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <p className="text-xs text-muted-foreground/40">Nenhuma sala ainda</p>
                </div>
              )}
            </div>

            {/* Create room button */}
            <div className="p-3 border-t border-white/5">
              <button
                onClick={() => setShowCreate(true)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 border border-dashed border-white/10 hover:border-white/20 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Nova sala</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="shrink-0 px-4 py-3 border-b border-white/5 flex items-center gap-3"
          style={{ background: "rgba(2,6,18,0.3)", backdropFilter: "blur(12px)" }}>
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 text-muted-foreground"
          >
            <ChevronRight className={`w-4 h-4 transition-transform ${sidebarOpen ? "rotate-180" : ""}`} />
          </button>

          {activeRoom && (
            <>
              <span className="text-xl">{activeRoom.icon ?? "💬"}</span>
              <div>
                <div className="font-bold text-sm">{activeRoom.name}</div>
                {activeRoom.description && <div className="text-[10px] text-muted-foreground/50">{activeRoom.description}</div>}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${wsReady ? "bg-green-400" : "bg-yellow-400"}`} />
                <span className="text-[10px] text-muted-foreground/40">{wsReady ? "tempo real" : "reconectando..."}</span>
              </div>
            </>
          )}

          {!activeRoom && <span className="text-sm text-muted-foreground">Selecione uma sala</span>}
        </div>

        {/* Messages */}
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
              <p className="font-semibold text-base">Bem-vindo ao #{activeRoom.name}!</p>
              <p className="text-xs text-muted-foreground/60">Seja o primeiro a enviar uma mensagem.</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={msg.id} msg={msg} prev={messages[i - 1]} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        {activeRoom && (
          <div className="shrink-0 px-4 py-3 border-t border-white/5" style={{ background: "rgba(2,6,18,0.3)" }}>
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.03]">
              <Avatar username={me?.username ?? "?"} photo={null} size={6} />
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={`Mensagem em #${activeRoom.name}...`}
                className="flex-1 bg-transparent text-sm outline-none placeholder-muted-foreground/30"
                maxLength={2000}
              />
              <div className="flex items-center gap-1.5">
                {input.trim() && (
                  <motion.button
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    onClick={sendMessage}
                    disabled={sending}
                    className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                    style={{ background: "var(--color-primary)", color: "#000" }}
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </motion.button>
                )}
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground/25 mt-1.5 text-center">Enter para enviar • @username para mencionar</p>
          </div>
        )}
      </div>

      {/* Create room modal */}
      <AnimatePresence>
        {showCreate && (
          <CreateRoomModal
            onClose={() => setShowCreate(false)}
            onCreated={(room) => setRooms(prev => [...prev, room])}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
