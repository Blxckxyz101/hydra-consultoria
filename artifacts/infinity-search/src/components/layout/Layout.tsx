import { Link, useLocation } from "wouter";
import { Activity, Search, Bot, Settings, LogOut, ChevronRight } from "lucide-react";
import { useInfinityMe, useInfinityLogout, getInfinityMeQueryKey } from "@workspace/api-client-react";
import logoUrl from "@/assets/logo.png";
import { AnimatedBackground } from "@/components/ui/AnimatedBackground";
import { motion } from "framer-motion";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user } = useInfinityMe({ query: { queryKey: getInfinityMeQueryKey() } });
  const logout = useInfinityLogout();

  const handleLogout = async () => {
    try {
      await logout.mutateAsync({});
    } catch {}
    localStorage.removeItem("infinity_token");
    setLocation("/login");
  };

  const navItems = [
    { href: "/", label: "Visão Geral", icon: Activity },
    { href: "/consultas", label: "Consultas", icon: Search },
    { href: "/ia", label: "Assistente IA", icon: Bot },
    ...(user?.role === "admin" ? [{ href: "/configuracoes", label: "Configurações", icon: Settings }] : []),
  ];

  return (
    <div className="min-h-screen w-full flex text-foreground overflow-hidden relative">
      <AnimatedBackground />

      <aside className="w-72 flex flex-col z-10 shrink-0 border-r border-white/5 bg-black/30 backdrop-blur-2xl">
        <div className="px-6 pt-6 pb-8 flex items-center gap-3 border-b border-white/5">
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

        <nav className="flex-1 px-4 py-6 space-y-1">
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
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center text-black font-bold text-sm">
                {user?.username?.[0]?.toUpperCase() ?? "?"}
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

          <div className="pt-3 mt-2 border-t border-white/5 flex items-center justify-between text-[9px] uppercase tracking-[0.35em] text-muted-foreground/60">
            <span>by blxckxyz</span>
            <span>v1.0</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 h-screen overflow-y-auto z-10">
        <motion.div
          key={location}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-7xl mx-auto p-8"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
