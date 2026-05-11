import { Link, useLocation } from "wouter";
import { Activity, Search, Bot, LogOut, ChevronRight, Menu, X, FolderOpen, MessageCircle, UserCircle, Star, Server, Settings, Palette, Bell, Headphones, Zap, History, AlertTriangle, Gift, Wallet, Users, type LucideIcon } from "lucide-react";
import { useInfinityMe, useInfinityLogout, getInfinityMeQueryKey } from "@workspace/api-client-react";
import { NotificationBell } from "@/components/layout/NotificationBell";

import logoUrl from "@/assets/hydra-icon.png";
import { AnimatedBackground } from "@/components/ui/AnimatedBackground";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useRef, useCallback } from "react";
import { LockScreen } from "@/components/ui/LockScreen";

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 65%, 62%)`;
}

interface InfinityNotif {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  createdAt: string;
  authorName: string;
}

const SEEN_KEY = "infinity_notif_seen";
function getSeenIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]")); } catch { return new Set(); }
}
function markAllSeen(ids: string[]) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids)); } catch {}
}

const SUPORTE_SEEN_KEY = "infinity_suporte_seen_latest";
function getSuporteSeenLatest(): string {
  try { return localStorage.getItem(SUPORTE_SEEN_KEY) ?? ""; } catch { return ""; }
}
function markSuporteSeen(latestId: string) {
  try { localStorage.setItem(SUPORTE_SEEN_KEY, latestId); } catch {}
}

function isAccountExpired(user: { role?: string; accountExpiresAt?: string | null } | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return false;
  if (!(user as any).accountExpiresAt) return false;
  return new Date((user as any).accountExpiresAt).getTime() < Date.now();
}

function NotifPanel({ onClose }: { onClose: () => void }) {
  const [notifs, setNotifs] = useState<InfinityNotif[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("infinity_token");
    fetch("/api/infinity/notifications", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then((data: InfinityNotif[]) => {
        setNotifs(data);
        markAllSeen(data.map(n => n.id));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ duration: 0.16 }}
      className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 backdrop-blur-2xl shadow-2xl z-50 overflow-hidden" style={{ background: "color-mix(in srgb, var(--color-card) 95%, transparent)" }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Bell className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-foreground">Novidades</span>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/5 text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto divide-y divide-white/5">
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground animate-pulse">Carregando...</div>
        ) : notifs.length === 0 ? (
          <div className="px-4 py-8 flex flex-col items-center gap-2 text-center">
            <Bell className="w-8 h-8 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground">Nenhuma novidade por enquanto.</p>
          </div>
        ) : (
          notifs.map(n => (
            <div key={n.id} className="hover:bg-white/[0.03] transition-colors">
              {n.imageUrl && (
                <div className="relative overflow-hidden" style={{ maxHeight: "160px" }}>
                  <img
                    src={n.imageUrl}
                    alt=""
                    className="w-full object-cover"
                    style={{ maxHeight: "160px" }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/60 pointer-events-none" />
                </div>
              )}
              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-foreground leading-snug">{n.title}</span>
                  <span className="text-[9px] text-muted-foreground/50 shrink-0 mt-0.5">
                    {new Date(n.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">{n.body}</p>
                <p className="text-[9px] text-muted-foreground/40 mt-1.5 uppercase tracking-wider">por {n.authorName}</p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="px-4 py-2.5 border-t border-white/5 flex justify-center">
        <a
          href="/suporte"
          className="text-[10px] uppercase tracking-[0.25em] hover:text-foreground transition-colors"
          style={{ color: "var(--color-primary)" }}
        >
          Ver todas as novidades →
        </a>
      </div>
    </motion.div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user } = useInfinityMe({ query: { queryKey: getInfinityMeQueryKey() } });
  const logout = useInfinityLogout();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profilePhoto, setProfilePhoto]   = useState<string | null>(() => localStorage.getItem("infinity_profile_photo"));
  const [profileStatus, setProfileStatus] = useState<string>(() => localStorage.getItem("infinity_profile_status") ?? "online");
  const [bellOpen, setBellOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [suporteNovo, setSuporteNovo] = useState(false);
  const [expiryDismissed, setExpiryDismissed] = useState(false);
  const bellDesktopRef = useRef<HTMLDivElement>(null);
  const bellMobileRef = useRef<HTMLDivElement>(null);

  const fetchUnread = useCallback(() => {
    const token = localStorage.getItem("infinity_token");
    fetch("/api/infinity/notifications", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then((data: InfinityNotif[]) => {
        const seen = getSeenIds();
        setUnreadCount(data.filter(n => !seen.has(n.id)).length);
        // Suporte "novo" badge: check if latest notification is newer than last seen
        if (data.length > 0) {
          const latestId = data[0].id;
          const seenLatest = getSuporteSeenLatest();
          setSuporteNovo(latestId !== seenLatest);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchUnread();
    const id = setInterval(fetchUnread, 60_000);
    return () => clearInterval(id);
  }, [fetchUnread]);

  useEffect(() => {
    if (!bellOpen) return;
    function onDown(e: MouseEvent) {
      const inDesktop = bellDesktopRef.current?.contains(e.target as Node);
      const inMobile = bellMobileRef.current?.contains(e.target as Node);
      if (!inDesktop && !inMobile) setBellOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [bellOpen]);

  useEffect(() => {
    setMobileOpen(false);
    // Clear "novo" badge when user visits Suporte
    if (location === "/suporte" && suporteNovo) {
      // Find the latest notif id and mark seen
      const token = localStorage.getItem("infinity_token");
      fetch("/api/infinity/notifications", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then(r => r.json())
        .then((data: InfinityNotif[]) => {
          if (data.length > 0) markSuporteSeen(data[0].id);
        })
        .catch(() => {});
      setSuporteNovo(false);
    }
  }, [location, suporteNovo]);

  useEffect(() => {
    const handler = () => {
      setProfilePhoto(localStorage.getItem("infinity_profile_photo"));
      setProfileStatus(localStorage.getItem("infinity_profile_status") ?? "online");
    };
    window.addEventListener("infinity-profile-updated", handler);
    return () => window.removeEventListener("infinity-profile-updated", handler);
  }, []);

  const handleLogout = async () => {
    try { await logout.mutateAsync(); } catch {}
    localStorage.removeItem("infinity_token");
    setLocation("/login");
  };

  const openBell = () => {
    setBellOpen(v => {
      if (!v) setUnreadCount(0);
      return !v;
    });
  };

  const isAdmin = user?.role === "admin";

  // Friend request badge count
  const [pendingFriends, setPendingFriends] = useState(0);
  useEffect(() => {
    const load = () => {
      const token = localStorage.getItem("infinity_token");
      if (!token) return;
      fetch("/api/infinity/friends", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then((list: { status: string; direction: string }[]) => {
          const pending = list.filter(f => f.status === "pending" && f.direction === "received").length;
          setPendingFriends(pending);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  type NavItem = { href: string; label: string; icon: LucideIcon; badge?: string };
  const navGroups: { label: string; items: NavItem[] }[] = [
    {
      label: "Principal",
      items: [
        { href: "/", label: "Visão Geral", icon: Activity },
        { href: "/consultas", label: "Consultas", icon: Search },
        { href: "/comunidade", label: "Comunidade", icon: Users, badge: pendingFriends > 0 ? String(pendingFriends) : undefined },
        { href: "/api-promo", label: "🌟 API", icon: Zap },
        { href: "/ia", label: "Assistente IA", icon: Bot },
      ],
    },
    {
      label: "Ferramentas",
      items: [
        { href: "/historico", label: "Histórico", icon: History },
        { href: "/dossie", label: "Dossiê", icon: FolderOpen },
        { href: "/favoritos", label: "Favoritos", icon: Star },
        ...(isAdmin ? [{ href: "/bases", label: "Monitor de Bases", icon: Server }] : []),
      ],
    },
    {
      label: "Conta",
      items: [
        { href: "/afiliados", label: "Afiliados", icon: Gift },
        { href: "/carteira", label: "Carteira", icon: Wallet },
        { href: "/suporte", label: "Suporte", icon: Headphones, badge: suporteNovo ? "NOVO" : undefined },
        { href: "/perfil", label: "Perfil", icon: UserCircle },
        { href: "/configuracoes", label: "Configurações", icon: Settings },
        { href: "/personalizar", label: "Personalizar", icon: Palette },
      ],
    },
  ];

  const roleLabel = (role: string) => {
    if (role === "admin") return "Admin";
    if (role === "vip") return "VIP";
    return role;
  };

  const renderSidebar = (onClose?: () => void) => (
    <>
      {/* Header */}
      <div className="px-5 pt-5 pb-5 flex items-center gap-3 border-b border-white/5">
        <div className="relative w-11 h-11 shrink-0 flex items-center justify-center">
          <img
            src={logoUrl}
            alt="Hydra Consultoria"
            className="w-11 h-11 object-contain"
          />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="leading-none text-foreground" style={{ fontFamily: "'Bebas Neue', 'Exo 2', sans-serif", fontSize: "20px", letterSpacing: "0.18em" }}>HYDRA</span>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[9px]" style={{ color: "var(--color-primary)", opacity: 0.7 }}>—</span>
            <span className="text-[8px] uppercase tracking-[0.45em] font-medium" style={{ color: "var(--color-primary)", opacity: 0.8, fontFamily: "'Exo 2', sans-serif" }}>CONSULTORIA</span>
            <span className="text-[9px]" style={{ color: "var(--color-primary)", opacity: 0.7 }}>—</span>
          </div>
        </div>
        {onClose ? (
          <button
            onClick={onClose}
            className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
            aria-label="Fechar menu"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <NotificationBell />
          <div ref={bellDesktopRef} className="relative shrink-0">
            <button
              onClick={openBell}
              className="relative w-9 h-9 rounded-xl flex items-center justify-center bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors"
              aria-label="Novidades"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-black px-1"
                  style={{ background: "var(--color-primary)" }}
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            <AnimatePresence>
              {bellOpen && <NotifPanel onClose={() => setBellOpen(false)} />}
            </AnimatePresence>
          </div>
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {navGroups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-4 pt-4 border-t border-white/[0.06]" : ""}>
            <div className="px-3 mb-2">
              <span className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground/40 font-semibold">{group.label}</span>
            </div>
            <div className="space-y-0.5">
              {group.items.map((item, i) => {
                const isActive = location === item.href;
                const Icon = item.icon;
                return (
                  <motion.div
                    key={item.href}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: (gi * 4 + i) * 0.035 }}
                  >
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative overflow-hidden ${
                        isActive
                          ? "text-primary border"
                          : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground border border-transparent"
                      }`}
                      style={isActive ? {
                        background: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                        borderColor: "color-mix(in srgb, var(--color-primary) 28%, transparent)",
                        boxShadow: "0 0 22px -6px color-mix(in srgb, var(--color-primary) 35%, transparent)",
                      } : {}}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activePill"
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full"
                          style={{
                            background: "var(--color-primary)",
                            boxShadow: "0 0 10px color-mix(in srgb, var(--color-primary) 80%, transparent)",
                          }}
                        />
                      )}
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-all duration-200 ${!isActive ? "group-hover:scale-110" : ""}`}
                        style={isActive ? { filter: "drop-shadow(0 0 5px color-mix(in srgb, var(--color-primary) 80%, transparent))" } : {}}
                      />
                      <span className="font-medium text-sm flex-1 truncate">{item.label}</span>
                      {item.badge && !isActive && (
                        <span
                          className="text-[8px] font-bold tracking-widest px-1.5 py-0.5 rounded-full text-black animate-pulse shrink-0"
                          style={{ background: "var(--color-primary)" }}
                        >
                          {item.badge}
                        </span>
                      )}
                      {isActive && <ChevronRight className="w-3 h-3 shrink-0" />}
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-white/5 space-y-3">
        <div className="px-4 py-3 rounded-xl bg-black/40 border border-white/5">
          <div className="flex items-center gap-3">
            {/* Avatar with Discord-style status dot */}
            <div className="relative shrink-0">
              <div
                className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center font-bold text-sm"
                style={{
                  background: profilePhoto ? "transparent" : hashColor(user?.username ?? "?"),
                  color: "#000",
                  boxShadow: `0 0 16px ${hashColor(user?.username ?? "?")}55`,
                }}
              >
                {profilePhoto ? (
                  <img src={profilePhoto} alt="" className="w-full h-full object-cover" />
                ) : (
                  ((user as any)?.displayName ?? user?.username)?.[0]?.toUpperCase() ?? "?"
                )}
              </div>
              <span
                className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background"
                style={{ background: profileStatus === "online" ? "#22c55e" : profileStatus === "busy" ? "#ef4444" : profileStatus === "away" ? "#f59e0b" : "#6b7280" }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm truncate">{(user as any)?.displayName ?? user?.username}</div>
              <div className="text-[8px] text-muted-foreground/30 font-mono truncate">
                {localStorage.getItem("infinity_hide_username") === "true"
                  ? "@hydraconsultoria"
                  : `@${user?.username ?? ""}`}
              </div>
              <div
                className="text-[9px] uppercase tracking-[0.3em]"
                style={{ color: "color-mix(in srgb, var(--color-primary) 70%, transparent)" }}
              >
                {user?.role ? roleLabel(user.role) : ""}
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors text-left text-sm font-medium border border-transparent hover:border-destructive/30"
        >
          <LogOut className="w-4 h-4" />
          <span>Desconectar</span>
        </button>

        <div className="space-y-1">
          <a
            href="https://t.me/infinitysearchchannel"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-muted-foreground transition-colors text-sm font-medium border border-transparent"
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "color-mix(in srgb, var(--color-primary) 10%, transparent)";
              el.style.color = "var(--color-primary)";
              el.style.borderColor = "color-mix(in srgb, var(--color-primary) 30%, transparent)";
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "";
              el.style.color = "";
              el.style.borderColor = "";
            }}
          >
            <MessageCircle className="w-4 h-4" />
            <span>Precisa de ajuda?</span>
          </a>
          <a
            href="https://t.me/infinitysearchchannel"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-muted-foreground transition-colors text-sm font-medium border border-transparent"
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "color-mix(in srgb, var(--color-primary) 10%, transparent)";
              el.style.color = "var(--color-primary)";
              el.style.borderColor = "color-mix(in srgb, var(--color-primary) 30%, transparent)";
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "";
              el.style.color = "";
              el.style.borderColor = "";
            }}
          >
            <Bell className="w-4 h-4" />
            <span>Canal de Atualizações</span>
          </a>
        </div>

        <div className="pt-3 mt-2 border-t border-white/5 flex items-center justify-between text-[9px] uppercase tracking-[0.35em] text-muted-foreground/60">
          <span>Hydra Consultoria</span>
          <span>v1.0</span>
        </div>
      </div>
    </>
  );

  function getExpiryWarning(u: { role?: string; accountExpiresAt?: string | null } | undefined): number | null {
    if (!u || u.role === "admin") return null;
    const exp = (u as any).accountExpiresAt;
    if (!exp) return null;
    const ms = new Date(exp).getTime() - Date.now();
    const days = Math.ceil(ms / 86400000);
    if (days > 0 && days <= 3) return days;
    return null;
  }

  const expiryWarningDays = getExpiryWarning(user as any);

  if (isAccountExpired(user as any)) {
    return <LockScreen />;
  }

  return (
    <div className="min-h-screen w-full flex text-foreground overflow-hidden relative">
      <AnimatedBackground />

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-72 flex-col z-10 shrink-0 border-r border-white/[0.05] backdrop-blur-3xl" style={{ background: "rgba(0,0,4,0.15)" }}>
        {renderSidebar()}
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 h-14 border-b border-white/5 bg-black/60 backdrop-blur-2xl">
        <button
          onClick={() => setMobileOpen(true)}
          className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/5 border border-white/10 text-foreground"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="relative w-7 h-7 shrink-0 flex items-center justify-center">
            <img
              src={logoUrl}
              alt=""
              className="w-7 h-7 object-contain"
            />
          </div>
          <span className="text-foreground" style={{ fontFamily: "'Bebas Neue', 'Exo 2', sans-serif", fontSize: "17px", letterSpacing: "0.18em" }}>HYDRA</span>
        </div>
        {/* Personal notifications bell — mobile topbar */}
        <div className="flex items-center gap-1">
          <NotificationBell />
          {/* System bell — mobile topbar */}
          <div ref={bellMobileRef} className="relative">
            <button
              onClick={openBell}
              className="relative w-10 h-10 rounded-xl flex items-center justify-center bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Novidades"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-black px-1"
                  style={{ background: "var(--color-primary)" }}
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            <AnimatePresence>
              {bellOpen && <NotifPanel onClose={() => setBellOpen(false)} />}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/30 z-40"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 280, damping: 32 }}
              className="lg:hidden fixed inset-y-0 left-0 w-[80%] max-w-[300px] z-50 flex flex-col border-r border-white/[0.08] backdrop-blur-2xl" style={{ background: "rgba(2,6,18,0.35)" }}
            >
              {renderSidebar(() => setMobileOpen(false))}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="flex-1 h-screen overflow-y-auto z-10 pt-14 lg:pt-0">
        {/* Expiry warning banner */}
        <AnimatePresence>
          {expiryWarningDays !== null && !expiryDismissed && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mx-4 mt-3 lg:mx-6 lg:mt-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-400/30 bg-amber-400/8 backdrop-blur-xl"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-200 flex-1">
                <span className="font-bold">Atenção —</span> seu plano vence em{" "}
                <span className="font-semibold">{expiryWarningDays === 1 ? "1 dia" : `${expiryWarningDays} dias`}</span>.{" "}
                <Link href="/planos" className="underline underline-offset-2 hover:text-amber-100 transition-colors">
                  Renovar agora →
                </Link>
              </p>
              <button
                onClick={() => setExpiryDismissed(true)}
                className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 text-amber-400/60 hover:text-amber-400 transition-colors shrink-0"
                aria-label="Fechar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          key={location}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
