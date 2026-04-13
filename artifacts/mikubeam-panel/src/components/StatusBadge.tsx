import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <Badge variant="outline" className="border-primary text-primary bg-primary/10 gap-1.5 font-mono">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        RUNNING
      </Badge>
    );
  }
  
  if (status === "stopped") {
    return (
      <Badge variant="outline" className="border-muted text-muted-foreground bg-muted/10 gap-1.5 font-mono">
        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        STOPPED
      </Badge>
    );
  }

  if (status === "finished") {
    return (
      <Badge variant="outline" className="border-green-500 text-green-500 bg-green-500/10 gap-1.5 font-mono">
        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
        FINISHED
      </Badge>
    );
  }

  if (status === "error") {
    return (
      <Badge variant="destructive" className="gap-1.5 font-mono">
        <div className="w-1.5 h-1.5 rounded-full bg-current" />
        ERROR
      </Badge>
    );
  }

  return <Badge variant="outline">{status.toUpperCase()}</Badge>;
}
