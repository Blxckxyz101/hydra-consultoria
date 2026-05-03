import { Link, useLocation } from "wouter";
import { Activity, Search, Bot, Settings, LogOut } from "lucide-react";
import { useInfinityMe, useInfinityLogout } from "@workspace/api-client-react";
import logoUrl from "@/assets/logo.png";
import { AnimatedBackground } from "../ui/AnimatedBackground";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user } = useInfinityMe({ query: { queryKey: ["infinityMe"] } });
  const logout = useInfinityLogout();

  const handleLogout = async () => {
    try {
      await logout.mutateAsync({});
    } catch (e) {
      // ignore
    } finally {
      localStorage.removeItem("infinity_token");
      setLocation("/login");
    }
  };

  const navItems = [
    { href: "/", label: "Visão Geral", icon: Activity },
    { href: "/consultas", label: "Consultas", icon: Search },
    { href: "/ia", label: "Assistente IA", icon: Bot },
    ...(user?.role === "admin" ? [{ href: "/configuracoes", label: "Configurações", icon: Settings }] : []),
  ];

  return (
    <div className="min-h-screen w-full flex text-foreground overflow-hidden">
      <AnimatedBackground />
      
      {/* Sidebar */}
      <aside className="w-64 glass-panel border-r border-white/5 flex flex-col z-10 shrink-0">
        <div className="p-6 flex items-center gap-3">
          <img src={logoUrl} alt="Infinity Search" className="w-8 h-8 object-contain" />
          <span className="font-bold tracking-widest text-lg neon-text">INFINITY</span>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-2">
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  isActive 
                    ? "bg-primary/20 text-primary border border-primary/30 shadow-[0_0_15px_rgba(45,212,191,0.2)]" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/5">
          <div className="px-4 py-3 rounded-lg bg-black/20 flex flex-col gap-1 mb-4 border border-white/5">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Operador</span>
            <span className="font-semibold text-sm truncate">{user?.username}</span>
            <span className="text-[10px] text-primary/70 uppercase tracking-widest">{user?.role}</span>
          </div>
          
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors text-left font-medium"
          >
            <LogOut className="w-5 h-5" />
            <span>Desconectar</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 h-screen overflow-y-auto z-10 p-8">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
