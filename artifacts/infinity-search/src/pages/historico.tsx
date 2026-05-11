import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { History, CheckCircle2, XCircle, RefreshCw, Search, Clock, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { InfinityLoader } from "@/components/ui/InfinityLoader";

interface ConsultaItem {
  id: number;
  tipo: string;
  query: string;
  username: string;
  success: boolean;
  createdAt: string;
}

const TIPO_LABEL: Record<string, string> = {
  cpf: "CPF", cpfbasico: "CPF Básico", cpffull: "CPF Full",
  nome: "Nome", rg: "RG", mae: "Mãe", pai: "Pai",
  nasc: "Nascimento", parentes: "Parentes", obito: "Óbito",
  email: "Email", telefone: "Telefone", pix: "PIX",
  endereco: "Endereço", cep: "CEP", nis: "NIS/PIS",
  titulo: "Título", score: "Score", score2: "Score 2",
  irpf: "IRPF", beneficios: "Benefícios", mandado: "Mandado",
  dividas: "Dívidas", bens: "Bens", certidoes: "Certidões",
  vacinas: "Vacinas", rais: "RAIS", faculdades: "Faculdades",
  placa: "Placa", chassi: "Chassi", renavam: "Renavam",
  frota: "Frota", cnpj: "CNPJ", fucionarios: "Funcionários",
  socios: "Sócios", empregos: "Empregos", processo: "Processo",
  processos: "Processos/CPF", cns: "CNS/SUS", foto: "Foto CNH",
  fotodetran: "Foto Detran", placafipe: "Placa FIPE",
  placaserpro: "Placa Serpro", telegram: "Telegram", oab: "OAB",
};

function maskQuery(query: string): string {
  if (!query) return "—";
  if (query.length <= 4) return query.replace(/./g, "•");
  const keep = Math.max(2, Math.floor(query.length * 0.3));
  return query.slice(0, keep) + "•".repeat(Math.min(6, query.length - keep)) + query.slice(-1);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const days = Math.floor(h / 24);
  return `${days}d atrás`;
}

const LIMIT_OPTIONS = [50, 100, 200];

export default function Historico() {
  const [items, setItems] = useState<ConsultaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(50);
  const [filter, setFilter] = useState<"all" | "success" | "fail">("all");
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();

  const load = useCallback(() => {
    setLoading(true);
    const token = localStorage.getItem("infinity_token");
    fetch(`/api/infinity/consultas?limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then((data: ConsultaItem[]) => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter(item => {
    if (filter === "success" && !item.success) return false;
    if (filter === "fail" && item.success) return false;
    if (search) {
      const s = search.toLowerCase();
      const label = (TIPO_LABEL[item.tipo] ?? item.tipo).toLowerCase();
      if (!label.includes(s) && !item.tipo.includes(s)) return false;
    }
    return true;
  });

  const successCount = items.filter(i => i.success).length;
  const failCount = items.length - successCount;
  const successRate = items.length > 0 ? Math.round((successCount / items.length) * 100) : 0;

  const handleReplay = (item: ConsultaItem) => {
    setLocation(`/consultas?tipo=${encodeURIComponent(item.tipo)}&query=${encodeURIComponent(item.query)}`);
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)" }}
          >
            <History className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Histórico</h1>
            <p className="text-xs text-muted-foreground">Suas últimas consultas realizadas</p>
          </div>
        </div>
      </motion.div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: items.length, color: "--color-chart-1" },
          { label: "Sucesso", value: successCount, color: "--color-chart-4", suffix: "" },
          { label: "Taxa", value: successRate, color: "--color-chart-3", suffix: "%" },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="rounded-2xl p-4 backdrop-blur-xl"
            style={{
              background: `color-mix(in srgb, var(${s.color}) 10%, rgba(0,0,0,0.3))`,
              border: `1px solid color-mix(in srgb, var(${s.color}) 20%, transparent)`,
            }}
          >
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: `var(${s.color})` }}>
              {s.value.toLocaleString("pt-BR")}{s.suffix ?? ""}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="flex flex-wrap items-center gap-2 sm:gap-3"
      >
        {/* Search */}
        <div className="relative flex-1 min-w-36 sm:min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Filtrar por tipo..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 transition-colors"
          />
        </div>

        {/* Status filter */}
        <div className="flex gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
          {(["all", "success", "fail"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all ${filter === f ? "text-black" : "text-muted-foreground hover:text-foreground"}`}
              style={filter === f ? { background: "var(--color-primary)" } : {}}
            >
              {f === "all" ? "Todos" : f === "success" ? "Sucesso" : "Falha"}
            </button>
          ))}
        </div>

        {/* Limit */}
        <select
          value={limit}
          onChange={e => setLimit(Number(e.target.value))}
          className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-foreground focus:outline-none focus:border-primary/40 transition-colors"
        >
          {LIMIT_OPTIONS.map(l => (
            <option key={l} value={l} className="bg-[#0d1326]">{l} itens</option>
          ))}
        </select>

        {/* Refresh */}
        <button
          onClick={load}
          className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors"
          aria-label="Atualizar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </motion.div>

      {/* List */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl overflow-hidden"
      >
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <InfinityLoader size={40} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Clock className="w-10 h-10 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">
              {items.length === 0 ? "Nenhuma consulta realizada ainda." : "Nenhuma consulta com esse filtro."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {/* Header */}
            <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_auto] gap-4 px-5 py-2.5 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">
              <span>Tipo</span>
              <span>Consulta</span>
              <span>Data</span>
              <span>Status</span>
            </div>
            {filtered.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.4) }}
                className="group grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 sm:gap-4 px-5 py-4 hover:bg-white/[0.025] transition-colors items-center cursor-pointer"
                onClick={() => handleReplay(item)}
                title="Clique para repetir esta consulta"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[9px] font-bold uppercase tracking-wider text-black"
                    style={{ background: item.success ? "var(--color-chart-4)" : "var(--color-chart-1)" }}
                  >
                    {(TIPO_LABEL[item.tipo] ?? item.tipo).slice(0, 3)}
                  </div>
                  <span className="font-semibold text-sm truncate">{TIPO_LABEL[item.tipo] ?? item.tipo}</span>
                </div>

                <span className="hidden sm:block font-mono text-xs text-muted-foreground truncate">{maskQuery(item.query)}</span>

                <div className="hidden sm:flex flex-col gap-0.5">
                  <span className="text-xs text-foreground">{formatDate(item.createdAt)}</span>
                  <span className="text-[10px] text-muted-foreground/60">{timeAgo(item.createdAt)}</span>
                </div>

                <div className="flex items-center gap-2">
                  {item.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-primary/60 transition-colors" />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      <p className="text-center text-[10px] uppercase tracking-[0.3em] text-muted-foreground/40">
        Exibindo {filtered.length} de {items.length} registros · Clique em um item para repetir a consulta
      </p>
    </div>
  );
}
