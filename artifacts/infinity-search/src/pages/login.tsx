import { useState } from "react";
import { useLocation } from "wouter";
import { useInfinityLogin } from "@workspace/api-client-react";
import logoUrl from "@/assets/logo.png";
import { AnimatedBackground } from "@/components/ui/AnimatedBackground";
import { motion } from "framer-motion";

export default function Login() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useInfinityLogin();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const data = await loginMutation.mutateAsync({ data: { username, password } });
      localStorage.setItem("infinity_token", data.token);
      setLocation("/");
    } catch (err: any) {
      setError(err.message || "Credenciais inválidas");
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden">
      <AnimatedBackground />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md p-8 glass-panel rounded-2xl relative z-10"
      >
        <div className="flex flex-col items-center mb-8">
          <img src={logoUrl} alt="Infinity Search" className="w-20 h-20 mb-4" />
          <h1 className="text-2xl font-bold tracking-widest text-primary neon-text uppercase">Infinity Search</h1>
          <p className="text-muted-foreground text-sm uppercase tracking-widest mt-2">Acesso Restrito</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              {error}
            </div>
          )}
          
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Operador</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50"
              placeholder="admin"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50"
              placeholder="admin"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full bg-primary text-primary-foreground font-bold uppercase tracking-widest py-3 rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {loginMutation.isPending ? "Autenticando..." : "Iniciar Sessão"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
