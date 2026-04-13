import { Link, useLocation } from "wouter";
import { useHealthCheck } from "@workspace/api-client-react";
import { Activity, ShieldAlert, Crosshair, Terminal, Server, RadioTower } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/attacks", label: "Active Attacks", icon: ShieldAlert },
  { href: "/launch", label: "Launch Strike", icon: Crosshair },
  { href: "/methods", label: "Methods DB", icon: Terminal },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck({ query: { refetchInterval: 10000 } });

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3 text-primary">
            <RadioTower className="h-6 w-6 animate-pulse" />
            <span className="font-bold tracking-tight text-lg">MIKUMI<br/>KUBEAM</span>
          </div>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="block">
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md transition-colors font-mono text-sm",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 px-2 text-xs font-mono">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">SYSTEM STATUS</span>
            <div className="ml-auto flex items-center gap-2">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  health?.status === "ok" ? "bg-primary animate-pulse" : "bg-destructive"
                )}
              />
              <span className={health?.status === "ok" ? "text-primary" : "text-destructive"}>
                {health?.status === "ok" ? "ONLINE" : "OFFLINE"}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto flex flex-col">
        <div className="flex-1 p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
