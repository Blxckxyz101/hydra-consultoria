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
import { Search, AlertTriangle, CheckCircle2, History, FileText } from "lucide-react";

type Tipo = "cpf" | "cnpj" | "telefone" | "sipni";

const TABS: { id: Tipo; label: string; placeholder: string; mask: string }[] = [
  { id: "cpf", label: "CPF", placeholder: "00000000000", mask: "11 dígitos" },
  { id: "cnpj", label: "CNPJ", placeholder: "00000000000000", mask: "14 dígitos" },
  { id: "telefone", label: "Telefone", placeholder: "5511999999999", mask: "DDI + DDD + número" },
  { id: "sipni", label: "SIPNI", placeholder: "00000000000", mask: "CPF — vacinas" },
];

function ResultViewer({ result }: { result: any }) {
  if (!result) return null;
  const { success, error, data } = result;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-xl p-6 mt-4"
    >
      <div className="flex items-center gap-2 mb-4">
        {success ? (
          <CheckCircle2 className="w-5 h-5 text-primary" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-destructive" />
        )}
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          {success ? "Resultado da consulta" : "Falha na consulta"}
        </span>
      </div>
      {!success && typeof error === "string" && error && (
        <p className="text-sm text-destructive mb-4">{error}</p>
      )}
      <pre className="text-xs font-mono bg-black/40 border border-white/5 rounded-lg p-4 overflow-x-auto max-h-96 overflow-y-auto text-foreground/80">
        {JSON.stringify(data ?? {}, null, 2)}
      </pre>
    </motion.div>
  );
}

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-widest neon-text uppercase">Consultas</h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">
          Workspace operacional — consultas em fontes abertas
        </p>
      </div>

      <div className="glass-panel rounded-xl p-2 inline-flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setQuery(""); setResult(null); }}
            className={`px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
              tab === t.id
                ? "bg-primary/20 text-primary border border-primary/30 shadow-[0_0_15px_rgba(45,212,191,0.2)]"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-xl p-6"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Alvo da consulta — {TABS.find(t => t.id === tab)?.mask}
            </label>
            <div className="flex gap-2 mt-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value.replace(/\D/g, ""))}
                placeholder={TABS.find(t => t.id === tab)?.placeholder}
                className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-3 font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
              />
              <button
                type="submit"
                disabled={!query.trim() || isPending}
                className="bg-primary text-primary-foreground font-bold uppercase tracking-widest px-6 py-3 rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                <Search className="w-4 h-4" />
                {isPending ? "Consultando..." : "Consultar"}
              </button>
            </div>
          </div>
        </form>

        <AnimatePresence>
          {result && <ResultViewer result={result} />}
        </AnimatePresence>
      </motion.div>

      <div className="glass-panel rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Histórico Recente
          </h2>
        </div>
        {!history || history.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm flex flex-col items-center gap-2">
            <FileText className="w-8 h-8 opacity-30" />
            Nenhuma consulta registrada ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="bg-black/30 border border-white/5 rounded-lg p-3 flex items-center justify-between hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-bold uppercase text-primary bg-primary/10 px-2 py-1 rounded shrink-0">
                    {item.tipo}
                  </span>
                  <span className="font-mono text-sm truncate">{item.query}</span>
                  <span className="text-xs text-muted-foreground truncate">— {item.username}</span>
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
      </div>
    </div>
  );
}
