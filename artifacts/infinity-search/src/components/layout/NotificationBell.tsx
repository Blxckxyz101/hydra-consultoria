import { useState, useEffect, useRef } from "react";
import { Bell, UserPlus, Heart, MessageCircle, Check, CheckCheck, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

interface Notif {
  id: number;
  type: string;
  fromUser: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

function notifIcon(type: string) {
  if (type === "friend_request") return <UserPlus className="w-3.5 h-3.5 text-cyan-400" />;
  if (type === "friend_accept") return <Users className="w-3.5 h-3.5 text-green-400" />;
  if (type === "reaction") return <Heart className="w-3.5 h-3.5 text-pink-400" />;
  if (type === "dm") return <MessageCircle className="w-3.5 h-3.5 text-purple-400" />;
  return <Bell className="w-3.5 h-3.5 text-yellow-400" />;
}

function notifText(n: Notif): string {
  const who = n.fromUser ?? "Alguém";
  if (n.type === "friend_request") return `${who} enviou um pedido de amizade`;
  if (n.type === "friend_accept") return `${who} aceitou sua amizade`;
  if (n.type === "reaction") {
    const emoji = (n.data?.emoji as string) ?? "❤️";
    return `${who} reagiu à sua mensagem com ${emoji}`;
  }
  if (n.type === "dm") {
    const preview = (n.data?.preview as string) ?? "";
    return `${who}: ${preview.slice(0, 50)}`;
  }
  return "Nova notificação";
}

function notifLink(n: Notif): string {
  if (n.type === "friend_request" || n.type === "friend_accept") return "/perfil";
  if (n.type === "dm") return `/dm/${n.fromUser ?? ""}`;
  if (n.type === "reaction") return "/comunidade";
  return "/";
}

export function NotificationBell() {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unread = notifs.filter(n => !n.read).length;

  const load = () => {
    fetch("/api/infinity/me/notifications", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then((list: Notif[]) => setNotifs(list))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Mark all read when opened
  useEffect(() => {
    if (!open || unread === 0) return;
    fetch("/api/infinity/me/notifications/read", {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" } as Record<string, string>,
      body: JSON.stringify({}),
    }).then(() => {
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    }).catch(() => {});
  }, [open]);

  // Listen for WS notifications
  useEffect(() => {
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws/chat?token=${localStorage.getItem("infinity_token") ?? ""}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data) as { type?: string; notification?: Notif };
        if (d.type === "notification" && d.notification) {
          setNotifs(prev => [d.notification!, ...prev].slice(0, 30));
        }
      } catch {}
    };
    const ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" })); }, 25000);
    return () => { clearInterval(ping); ws.close(); };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl hover:bg-white/5 transition-colors text-white/40 hover:text-white/80"
        aria-label="Notificações"
      >
        <Bell className="w-4.5 h-4.5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-cyan-500 text-[9px] font-bold text-black flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 z-50 rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden"
            style={{ background: "hsl(220 35% 6%)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <p className="text-sm font-semibold text-white">Notificações</p>
              <span className="text-[10px] text-white/30">{notifs.length} total</span>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {notifs.length === 0 && (
                <div className="py-8 text-center">
                  <Bell className="w-8 h-8 text-white/10 mx-auto mb-2" />
                  <p className="text-xs text-white/25">Sem notificações</p>
                </div>
              )}
              {notifs.map(n => (
                <Link key={n.id} href={notifLink(n)}>
                  <div
                    onClick={() => setOpen(false)}
                    className={`flex items-start gap-3 px-4 py-3 hover:bg-white/[0.03] cursor-pointer transition-colors border-b border-white/[0.03] ${!n.read ? "bg-cyan-500/[0.04]" : ""}`}
                  >
                    <div className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                      {notifIcon(n.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/80 leading-snug">{notifText(n)}</p>
                      <p className="text-[9px] text-white/25 mt-1">
                        {new Date(n.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0 mt-1.5" />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
