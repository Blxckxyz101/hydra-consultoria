import { useGetAttackStats, getGetAttackStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity, Zap, Database, ArrowRightLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const { data: stats, isLoading } = useGetAttackStats({ query: { refetchInterval: 5000 } });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-card rounded-lg border border-border" />)}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tighter text-primary">OPERATIONAL OVERVIEW</h1>
        <p className="text-muted-foreground mt-1">Live metrics and recent activity</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground font-mono">TOTAL ATTACKS</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{stats.totalAttacks}</div>
          </CardContent>
        </Card>
        
        <Card className="bg-card border-primary/50 shadow-[0_0_15px_rgba(0,255,255,0.1)]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-primary font-mono">RUNNING NOW</CardTitle>
            <Zap className="h-4 w-4 text-primary animate-pulse" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{stats.runningAttacks}</div>
          </CardContent>
        </Card>
        
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground font-mono">PACKETS SENT</CardTitle>
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{(stats.totalPacketsSent / 1000000).toFixed(2)}M</div>
          </CardContent>
        </Card>
        
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground font-mono">BYTES SENT</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{(stats.totalBytesSent / 1024 / 1024 / 1024).toFixed(2)} GB</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="bg-card border-border col-span-1">
          <CardHeader>
            <CardTitle className="font-mono">ATTACKS BY METHOD</CardTitle>
            <CardDescription>Distribution of attack vectors</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.attacksByMethod} layout="vertical" margin={{ left: 20, right: 20 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="method" type="category" axisLine={false} tickLine={false} className="font-mono text-xs" />
                <Tooltip 
                  cursor={{fill: 'rgba(255,255,255,0.05)'}} 
                  contentStyle={{backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', fontFamily: 'var(--font-mono)'}}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card border-border col-span-1 flex flex-col">
          <CardHeader>
            <CardTitle className="font-mono">RECENT DEPLOYMENTS</CardTitle>
            <CardDescription>Latest 5 operations</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="space-y-4">
              {stats.recentAttacks.map((attack) => (
                <div key={attack.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-secondary/20">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-bold text-primary">{attack.target}</span>
                      <span className="text-muted-foreground text-sm">:{attack.port}</span>
                    </div>
                    <div className="flex gap-2 text-xs text-muted-foreground font-mono">
                      <span>{attack.method}</span>
                      <span>•</span>
                      <span>{formatDistanceToNow(new Date(attack.createdAt), { addSuffix: true })}</span>
                    </div>
                  </div>
                  <StatusBadge status={attack.status} />
                </div>
              ))}
              {stats.recentAttacks.length === 0 && (
                <div className="text-center text-muted-foreground py-8 font-mono">
                  NO RECENT ACTIVITY
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
