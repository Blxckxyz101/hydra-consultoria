import { useListMethods } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Methods() {
  const { data: methods, isLoading } = useListMethods();

  if (isLoading) {
    return <div className="text-primary font-mono animate-pulse">FETCHING DATABASE...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tighter text-primary">METHODS DB</h1>
        <p className="text-muted-foreground mt-1">Reference library of available attack vectors</p>
      </div>

      <div className="border border-border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="font-mono text-muted-foreground w-32">ID</TableHead>
              <TableHead className="font-mono text-muted-foreground w-48">NAME</TableHead>
              <TableHead className="font-mono text-muted-foreground w-32">LAYER</TableHead>
              <TableHead className="font-mono text-muted-foreground w-32">PROTOCOL</TableHead>
              <TableHead className="font-mono text-muted-foreground">DESCRIPTION</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {methods?.map((method) => (
              <TableRow key={method.id} className="border-border/50 hover:bg-secondary/30">
                <TableCell className="font-mono font-medium text-foreground">{method.id}</TableCell>
                <TableCell className="font-mono text-primary">{method.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="border-primary/50 text-primary rounded-sm font-mono">
                    {method.layer}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="rounded-sm font-mono">
                    {method.protocol}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {method.description}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
