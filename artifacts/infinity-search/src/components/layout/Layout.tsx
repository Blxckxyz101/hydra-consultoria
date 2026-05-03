import { Link, useLocation } from "wouter";
import { Activity, Search, Bot, LogOut, ChevronRight, Menu, X, FolderOpen, MessageCircle, UserCircle } from "lucide-react";
import { useInfinityMe, useInfinityLogout, getInfinityMeQueryKey } from "@workspace/api-client-react";
import logoUrl from "@/assets/logo.png";
import { AnimatedBackground } from "@/components/ui/AnimatedBackground";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { LockScreen } from "@/components/ui/LockScreen";

function isAccountExpired(user: { role?: string; accountExpiresAt?: string | null } | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return false;
  if (!(user as any).accountExpiresAt) return false;
  return new Date((user as any).accountExpiresAt).getTime() < Date.now();
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user } = useInfinityMe({ query: { queryKey: getInfinityMeQueryKey() } });
  const logout = useInfinityLogout();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(() =>
    localStorage.getItem("infinity_profile_photo")
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    const handler = () => setProfilePhoto(localStorage.getItem("infinity_profile_photo"));
    window.addEventListener("infinity-profile-updated", handler);
    return () => window.removeEventListener("infinity-profile-updated", handler);
  }, []);

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
    } catch {}
    localStorage.removeItem("infinity_token");
    setLocation("/login");
  };

  const navItems = [
    { href: "/", label: "Visão Geral", icon: Activity },
    { href: "/consultas", label: "Consultas", icon: Search },
    { href: "/ia", label: "Assistente IA", icon: Bot },
    { href: "/dossie", label: "Dossiê", icon: FolderOpen },
    { href: "/perfil", label: "Perfil", icon: UserCircle },
  ];

  const SidebarBody = (
    <>
      <div className="px-6 pt-6 pb-6 flex items-center gap-3 border-b border-white/5">
        <div className="relative">
          <div className="absolute inset-0 rounded-xl bg-primary/30 blur-xl scale-110" />
          <img
            src={logoUrl}
            alt="Infinity Search"
            className="relative w-11 h-11 object-contain drop-shadow-[0_0_12px_rgba(56,189,248,0.6)]"
          />
        </div>
        <div className="flex flex-col">
          <span className="font-bold tracking-[0.25em] text-base text-foreground">INFINITY</span>
          <span className="text-[9px] uppercase tracking-[0.4em] text-primary/70">SEARCH</span>
        </div>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {navItems.map((item, i) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          return (
            <motion.div
              key={item.href}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Link
                href={item.href}
                className={`group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 relative overflow-hidden ${
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/30 shadow-[0_0_25px_-5px_rgba(56,189,248,0.4)]"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activePill"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-7 bg-primary rounded-r-full shadow-[0_0_12px_rgba(56,189,248,0.8)]"
                  />
                )}
                <Icon className={`w-4 h-4 ${isActive ? "drop-shadow-[0_0_6px_rgba(56,189,248,0.8)]" : ""}`} />
                <span className="font-medium text-sm flex-1">{item.label}</span>
                {isActive && <ChevronRight className="w-3 h-3" />}
              </Link>
            </motion.div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/5 space-y-3">
        <div className="px-4 py-3 rounded-xl bg-black/40 border border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center text-black font-bold text-sm shrink-0">
              {profilePhoto ? (
                <img src={profilePhoto} alt="" className="w-full h-full object-cover" />
              ) : (
                user?.username?.[0]?.toUpperCase() ?? "?"
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm truncate">{user?.username}</div>
              <div className="text-[9px] uppercase tracking-[0.3em] text-primary/70">{user?.role}</div>
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
            href="https://t.me/Blxckxyz"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-muted-foreground hover:bg-sky-500/10 hover:text-sky-400 transition-colors text-sm font-medium border border-transparent hover:border-sky-500/30"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Suporte</span>
            <span className="ml-auto text-[9px] text-muted-foreground/50">@Blxckxyz</span>
          </a>
          <a
            href="https://t.me/xxmathexx"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-muted-foreground hover:bg-sky-500/10 hover:text-sky-400 transition-colors text-sm font-medium border border-transparent hover:border-sky-500/30"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Suporte</span>
            <span className="ml-auto text-[9px] text-muted-foreground/50">@xxmathexx</span>
          </a>
        </div>

        <div className="pt-3 mt-2 border-t border-white/5 flex items-center justify-between text-[9px] uppercase tracking-[0.35em] text-muted-foreground/60">
          <span>by blxckxyz</span>
          <span>v1.0</span>
        </div>
      </div>
    </>
  );

  if (isAccountExpired(user as any)) {
    return <LockScreen />;
  }

  return (
    <div className="min-h-screen w-full flex text-foreground overflow-hidden relative">
      <AnimatedBackground />

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-72 flex-col z-10 shrink-0 border-r border-white/5 bg-black/30 backdrop-blur-2xl">
        {SidebarBody}
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
          <img src={logoUrl} alt="" className="w-7 h-7 object-contain drop-shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
          <span className="font-bold tracking-[0.2em] text-sm">INFINITY</span>
        </div>
        <div className="w-10" />
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
              className="lg:hidden fixed inset-0 bg-black/70 z-40 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 280, damping: 32 }}
              className="lg:hidden fixed inset-y-0 left-0 w-[78%] max-w-[320px] z-50 flex flex-col border-r border-white/10 bg-[#06091a]/95 backdrop-blur-2xl"
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
              {SidebarBody}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="flex-1 h-screen overflow-y-auto z-10 pt-14 lg:pt-0">
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
