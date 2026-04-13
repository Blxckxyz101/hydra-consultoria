import { useListMethods, useCreateAttack, getListAttacksQueryKey, getGetAttackStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Crosshair, AlertTriangle } from "lucide-react";

const launchSchema = z.object({
  target: z.string().min(1, "Target is required"),
  port: z.coerce.number().min(1).max(65535),
  method: z.string().min(1, "Method is required"),
  duration: z.coerce.number().min(1).max(3600),
  threads: z.coerce.number().min(1).max(1024),
});

export default function Launch() {
  const { data: methods } = useListMethods();
  const createAttack = useCreateAttack();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof launchSchema>>({
    resolver: zodResolver(launchSchema),
    defaultValues: {
      target: "",
      port: 80,
      method: "",
      duration: 60,
      threads: 10,
    },
  });

  const onSubmit = (data: z.infer<typeof launchSchema>) => {
    createAttack.mutate({ data }, {
      onSuccess: () => {
        toast({ title: "Attack Launched", description: "Target acquired. Operation started." });
        queryClient.invalidateQueries({ queryKey: getListAttacksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAttackStatsQueryKey() });
        setLocation("/attacks");
      },
      onError: (err) => {
        toast({ title: "Launch Failed", description: "Failed to initiate sequence.", variant: "destructive" });
      }
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tighter text-primary flex items-center gap-3">
          <Crosshair className="h-8 w-8" />
          LAUNCH STRIKE
        </h1>
        <p className="text-muted-foreground mt-1">Configure and deploy new operation</p>
      </div>

      <Card className="border-border bg-card shadow-lg shadow-primary/5">
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="target"
                  render={({ field }) => (
                    <FormItem className="col-span-2 md:col-span-1">
                      <FormLabel className="font-mono text-primary">TARGET [IP/HOST]</FormLabel>
                      <FormControl>
                        <Input placeholder="1.1.1.1" className="font-mono bg-background border-border" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem className="col-span-2 md:col-span-1">
                      <FormLabel className="font-mono text-primary">PORT</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="80" className="font-mono bg-background border-border" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-primary">VECTOR [METHOD]</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="font-mono bg-background border-border">
                          <SelectValue placeholder="SELECT VECTOR" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {methods?.map(method => (
                          <SelectItem key={method.id} value={method.id} className="font-mono">
                            {method.name} [{method.layer}/{method.protocol}]
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-6 pt-4 border-t border-border">
                <FormField
                  control={form.control}
                  name="duration"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex justify-between items-center pb-2">
                        <FormLabel className="font-mono text-primary">DURATION [SECONDS]</FormLabel>
                        <span className="font-mono font-bold text-foreground">{field.value}s</span>
                      </div>
                      <FormControl>
                        <Slider 
                          min={1} 
                          max={3600} 
                          step={1} 
                          value={[field.value]} 
                          onValueChange={(vals) => field.onChange(vals[0])}
                          className="py-4"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="threads"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex justify-between items-center pb-2">
                        <FormLabel className="font-mono text-primary">THREADS</FormLabel>
                        <span className="font-mono font-bold text-foreground">{field.value}</span>
                      </div>
                      <FormControl>
                        <Slider 
                          min={1} 
                          max={1024} 
                          step={1} 
                          value={[field.value]} 
                          onValueChange={(vals) => field.onChange(vals[0])}
                          className="py-4"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="pt-4 flex justify-end">
                <Button 
                  type="submit" 
                  className="w-full font-mono font-bold text-lg h-14 bg-primary hover:bg-primary/90 text-primary-foreground tracking-widest group"
                  disabled={createAttack.isPending}
                >
                  <AlertTriangle className="mr-2 h-5 w-5 group-hover:animate-pulse" />
                  {createAttack.isPending ? "INITIATING..." : "EXECUTE STRIKE"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
