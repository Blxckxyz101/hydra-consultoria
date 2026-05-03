import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useInfinityConsultaCpf,
  useInfinityConsultaCnpj,
  useInfinityConsultaTelefone,
  useInfinityConsultaSipni,
  useInfinityListConsultas,
  getInfinityListConsultasQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, AlertTriangle, CheckCircle2, History, FileText, IdCard, Building2, Phone, Syringe } from "lucide-react";
import { ResultViewer } from "@/components/consultas/ResultViewer";
import { InfinityLoader } from "@/components/ui/InfinityLoader";

type Tipo = "cpf" | "cnpj" | "telefone" | "sipni";

const TABS: { id: Tipo; label: string; placeholder: string; mask: string; icon: any }[] = [
  { id: "cpf", label: "CPF", placeholder: "00000000000", mask: "11 dígitos", icon: IdCard },
  { id: "cnpj", label: "CNPJ", placeholder: "00000000000000", mask: "14 dígitos", icon: Building2 },
  { id: "telefone", label: "Telefone", placeholder: "5511999999999", mask: "DDI + DDD + número", icon: Phone },
  { id: "sipni", label: "SIPNI", placeholder: "00000000000", mask: "CPF — vacinas", icon: Syringe },
];

export default function Consultas() {
  const [tab, setTab] = useState<Tipo>("cpf");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<any>(null);
  const queryClient = useQueryClient();

  const cpf = useInfinityConsultaCpf();
  const cnpj = useInfinityConsultaCnpj();
  const tel = useInfinityConsultaTelefone();
  const sip = useInfinityConsultaSipni();

  const { data: history } = useInfinityListConsultas(
    { limit: 20 },
    { query: { queryKey: getInfinityListConsultasQueryKey({ limit: 20 }) } }
  );

  const isPending = cpf.isPending || cnpj.isPending || tel.isPending || sip.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isPending) return;
    setResult(null);
    try {
      let r: any;
      if (tab === "cpf") r = await cpf.mutateAsync({ data: { cpf: query.trim() } });
      else if (tab === "cnpj") r = await cnpj.mutateAsync({ data: { cnpj: query.trim() } });
      else if (tab === "telefone") r = await tel.mutateAsync({ data: { telefone: query.trim() } });
      else r = await sip.mutateAsync({ data: { cpf: query.trim() } });
      setResult(r);
    } catch (err: any) {
      setResult({ success: false, error: err?.data?.error || err?.message || "Falha na requisição", data: {} });
    } finally {
      queryClient.invalidateQueries({ queryKey: getInfinityListConsultasQueryKey({ limit: 20 }) });
    }
  };

  const activeTab = TABS.find((t) => t.id === tab)!;
  const ActiveIcon = activeTab.icon;

  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-bold tracking-[0.25em] neon-text uppercase"
        >
          Consultas
        </motion.h1>
        <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
          Workspace operacional — fontes abertas
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-2 flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 sm:inline-flex sm:mx-0">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setQuery(""); setResult(null); }}
              className={`relative shrink-0 px-4 sm:px-5 py-2.5 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-[0.2em] sm:tracking-[0.25em] transition-all flex items-center gap-2 ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-primary/15 border border-primary/30 rounded-xl shadow-[0_0_20px_-4px_rgba(56,189,248,0.6)]"
                />
              )}
              <Icon className="w-3.5 h-3.5 relative z-10" />
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.4em] text-primary/70">
            <ActiveIcon className="w-3.5 h-3.5" />
            {activeTab.label} — {activeTab.mask}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value.replace(/\D/g, ""))}
                placeholder={activeTab.placeholder}
                inputMode="numeric"
                className="w-full bg-black/40 border border-white/10 rounded-xl pl-12 pr-4 py-3.5 sm:py-4 font-mono tracking-wider text-base sm:text-lg focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={!query.trim() || isPending}
              className="bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold uppercase tracking-[0.3em] text-xs px-6 sm:px-8 py-3.5 sm:py-0 rounded-xl hover:shadow-[0_0_30px_rgba(56,189,248,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isPending ? "Consultando" : "Consultar"}
            </button>
          </div>
        </form>

        <AnimatePresence mode="wait">
          {isPending && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-12 flex items-center justify-center"
            >
              <InfinityLoader size={72} label="Consultando fontes" />
            </motion.div>
          )}
          {!isPending && result && (
            <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ResultViewer tipo={tab} result={result} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.4em] text-muted-foreground">
              Histórico Recente
            </h2>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {history?.length ?? 0} registro(s)
          </span>
        </div>
        {!history || history.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm flex flex-col items-center gap-3">
            <FileText className="w-10 h-10 opacity-20" />
            Nenhuma consulta registrada ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.4) }}
                className="bg-black/30 border border-white/5 rounded-xl p-4 flex items-center justify-between hover:border-primary/30 hover:bg-black/40 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-md shrink-0">
                    {item.tipo}
                  </span>
                  <span className="font-mono text-sm truncate">{item.query}</span>
                  <span className="text-xs text-muted-foreground truncate hidden md:inline">— {item.username}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString("pt-BR")}
                  </span>
                  {item.success ? (
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-[10px] uppercase tracking-[0.4em] text-muted-foreground">
          <span>Made by blxckxyz</span>
          <span className="text-primary/60">Infinity Search</span>
        </div>
      </div>
    </div>
  );
}
