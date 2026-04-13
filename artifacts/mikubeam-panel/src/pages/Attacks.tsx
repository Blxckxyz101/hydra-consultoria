import { useListAttacks, useStopAttack, useDeleteAttack, getListAttacksQueryKey, getGetAttackStatsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";
import { StopCircle, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Attacks() {
  const { data: attacks, isLoading } = useListAttacks({ query: { refetchInterval: 5000 } });
  const stopAttack = useStopAttack();
  const deleteAttack = useDeleteAttack();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleStop = (id: number) => {
    stopAttack.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Signal sent", description: "Attack stop signal transmitted." });
        queryClient.invalidateQueries({ queryKey: getListAttacksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAttackStatsQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to stop attack.", variant: "destructive" });
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteAttack.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Record deleted", description: "Attack record wiped from database." });
        queryClient.invalidateQueries({ queryKey: getListAttacksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAttackStatsQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to delete record.", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return <div className="text-primary font-mono animate-pulse">FETCHING ATTACK LOGS...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tighter text-primary">ATTACK LOGS</h1>
        <p className="text-muted-foreground mt-1">Complete history of all operations</p>
      </div>

      <div className="border border-border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="font-mono text-muted-foreground">ID</TableHead>
              <TableHead className="font-mono text-muted-foreground">TARGET</TableHead>
              <TableHead className="font-mono text-muted-foreground">METHOD</TableHead>
              <TableHead className="font-mono text-muted-foreground">DURATION</TableHead>
              <TableHead className="font-mono text-muted-foreground">THREADS</TableHead>
              <TableHead className="font-mono text-muted-foreground">STATUS</TableHead>
              <TableHead className="font-mono text-muted-foreground">STARTED</TableHead>
              <TableHead className="text-right font-mono text-muted-foreground">ACTIONS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attacks?.map((attack) => (
              <TableRow key={attack.id} className="border-border/50 hover:bg-secondary/30">
                <TableCell className="font-mono text-muted-foreground">#{attack.id}</TableCell>
                <TableCell>
                  <div className="font-mono font-medium text-foreground">{attack.target}</div>
                  <div className="text-xs text-muted-foreground">Port {attack.port}</div>
                </TableCell>
                <TableCell>
                  <span className="bg-secondary px-2 py-1 rounded text-xs font-mono text-secondary-foreground">{attack.method}</span>
                </TableCell>
                <TableCell className="font-mono">{attack.duration}s</TableCell>
                <TableCell className="font-mono">{attack.threads}</TableCell>
                <TableCell><StatusBadge status={attack.status} /></TableCell>
                <TableCell className="text-muted-foreground text-sm font-mono">
                  {format(new Date(attack.createdAt), "MMM d, HH:mm:ss")}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {attack.status === "running" && (
                      <Button 
                        variant="destructive" 
                        size="icon" 
                        onClick={() => handleStop(attack.id)}
                        disabled={stopAttack.isPending}
                        title="Stop Attack"
                      >
                        <StopCircle className="h-4 w-4" />
                      </Button>
                    )}
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={() => handleDelete(attack.id)}
                      disabled={deleteAttack.isPending}
                      className="border-muted hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                      title="Delete Record"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {attacks?.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground font-mono">
                  NO RECORDS FOUND
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
