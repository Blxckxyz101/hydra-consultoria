import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Star, Trash2, Search, Copy, Check, FileText,
  ChevronDown, ChevronUp, Filter, X,
} from "lucide-react";

type Favorito = {
  id: string;
  tipo: string;
  query: string;
  addedAt: string;
  note: string;
  fields: Array<{ key: string; value: string }>;
  sections: Array<{ name: string; items: string[] }>;
  raw: string;
};

const STORAGE_KEY = "infinity_favoritos";

function loadFavoritos(): Favorito[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}

function saveFavoritos(f: Favorito[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
}

export function addFavorito(item: Omit<Favorito, "id" | "addedAt">) {
  const favs = loadFavoritos();
  const exists = favs.find((f) => f.tipo === item.tipo && f.query === item.query);
  if (exists) return false;
  const newFav: Favorito = {
    ...item,
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    addedAt: new Date().toISOString(),
  };
  saveFavoritos([newFav, ...favs]);
  window.dispatchEvent(new Event("infinity-favoritos-updated"));
  return true;
}

export function isFavorito(tipo: string, query: string): boolean {
  return loadFavoritos().some((f) => f.tipo === tipo && f.query === query);
}

const TIPO_GRADIENT: Record<string, string> = {
  cpf: "from-sky-400/20 to-cyan-400/5",
  cnpj: "from-violet-400/20 to-fuchsia-400/5",
  telefone: "from-emerald-400/20 to-teal-400/5",
  placa: "from-amber-400/20 to-orange-400/5",
  nome: "from-rose-400/20 to-pink-400/5",
};

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
    >
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {done ? "Copiado" : "Copiar"}
    </button>
  );
}

function FavCard({ item, onDelete }: { item: Favorito; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const totalFields = item.fields.length + item.sections.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`rounded-xl border border-white/8 bg-gradient-to-br ${TIPO_GRADIENT[item.tipo] ?? "from-white/5 to-transparent"} bg-black/30 backdrop-blur-xl overflow-hidden`}
    >
      <div className="flex items-center gap-3 p-4">
        <Star className="w-4 h-4 text-amber-400 shrink-0 fill-amber-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-md shrink-0">
          {item.tipo}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm truncate">{item.query}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {new Date(item.addedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {totalFields > 0 && ` · ${totalFields} campo${totalFields !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CopyBtn text={item.query} />
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-primary/10 hover:text-primary transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {item.note && (
        <div className="px-4 pb-2 flex items-start gap-2">
          <Star className="w-3 h-3 text-amber-400/60 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-200/70 italic">{item.note}</p>
        </div>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-white/5"
          >
            <div className="p-4 space-y-3">
              {item.fields.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {item.fields.map((f, i) => (
                    <div key={i} className="flex flex-col gap-0.5 py-1 border-b border-white/5">
                      <p className="text-[9px] uppercase tracking-[0.25em] text-primary/60">{f.key}</p>
                      <p className="text-sm font-mono break-words">{f.value}</p>
                    </div>
                  ))}
                </div>
              )}
              {item.sections.map((sec, i) => (
                <div key={i} className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary">
                    {sec.name} <span className="text-muted-foreground">({sec.items.length})</span>
                  </p>
                  <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                    {sec.items.map((it, j) => (
                      <div key={j} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-white/[0.02] border border-white/5">
                        <span className="text-primary/40 shrink-0">{j + 1}.</span>
                        <span className="font-mono break-all">{it}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!item.fields.length && !item.sections.length && item.raw && (
                <pre className="text-xs font-mono whitespace-pre-wrap break-words text-muted-foreground/70 max-h-40 overflow-y-auto">
                  {item.raw.slice(0, 600)}
                </pre>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const ALL_TIPOS = ["cpf", "cnpj", "telefone", "nome", "placa", "email", "pix", "cep", "chassi", "rg"];

export default function Favoritos() {
  const [favoritos, setFavoritos] = useState<Favorito[]>(loadFavoritos);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState<string>("todos");

  const tiposPresentes = useMemo(() => {
    const set = new Set(favoritos.map((f) => f.tipo));
    return Array.from(set);
  }, [favoritos]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return favoritos.filter((f) => {
      const matchTipo = filterTipo === "todos" || f.tipo === filterTipo;
      const matchSearch = !q || f.query.toLowerCase().includes(q) || f.tipo.toLowerCase().includes(q) ||
        f.fields.some((field) => field.value.toLowerCase().includes(q));
      return matchTipo && matchSearch;
    });
  }, [favoritos, search, filterTipo]);

  const deleteFav = useCallback((id: string) => {
    const updated = loadFavoritos().filter((f) => f.id !== id);
    saveFavoritos(updated);
    setFavoritos(updated);
    window.dispatchEvent(new Event("infinity-favoritos-updated"));
  }, []);

  const clearAll = () => {
    if (!confirm("Remover todos os favoritos? Esta ação é irreversível.")) return;
    saveFavoritos([]);
    setFavoritos([]);
    window.dispatchEvent(new Event("infinity-favoritos-updated"));
  };

  // Listen for external adds (e.g. from ResultViewer)
  useState(() => {
    const handler = () => setFavoritos(loadFavoritos());
    window.addEventListener("infinity-favoritos-updated", handler);
    return () => window.removeEventListener("infinity-favoritos-updated", handler);
  });

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-gradient-to-r from-amber-300 to-yellow-200 bg-clip-text text-transparent"
          >
            Favoritos
          </motion.h1>
          <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
            Consultas salvas para acesso rápido · {favoritos.length} favorito{favoritos.length !== 1 ? "s" : ""}
          </p>
        </div>
        {favoritos.length > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs font-bold uppercase tracking-widest hover:bg-destructive/20 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" /> Limpar tudo
          </button>
        )}
      </div>

      {favoritos.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-16 text-center"
        >
          <Star className="w-12 h-12 opacity-20 mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Nenhum favorito ainda.</p>
          <p className="text-[11px] text-muted-foreground/50 mt-2">
            Após uma consulta, clique na estrela para favoritar o resultado.
          </p>
        </motion.div>
      ) : (
        <>
          {/* Filters */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 space-y-3"
          >
            <div className="flex gap-3 flex-col sm:flex-row">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por query, tipo ou campo..."
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:border-amber-400/40 transition-colors"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                <Filter className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                {["todos", ...tiposPresentes].map((tipo) => (
                  <button
                    key={tipo}
                    onClick={() => setFilterTipo(tipo)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest font-semibold transition-all border ${
                      filterTipo === tipo
                        ? "bg-amber-400/15 border-amber-400/40 text-amber-300"
                        : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tipo === "todos" ? "Todos" : tipo}
                    {tipo !== "todos" && (
                      <span className="ml-1 opacity-60">· {favoritos.filter((f) => f.tipo === tipo).length}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">
              {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
            </div>
          </motion.div>

          {/* List */}
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((item) => (
                <FavCard
                  key={item.id}
                  item={item}
                  onDelete={() => deleteFav(item.id)}
                />
              ))}
            </AnimatePresence>
            {filtered.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-10 text-center">
                <FileText className="w-10 h-10 opacity-20 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Nenhum favorito para esse filtro.</p>
              </div>
            )}
          </div>
        </>
      )}

      <div className="text-center text-[10px] uppercase tracking-[0.5em] text-muted-foreground/60 pt-2">
        Infinity Search
      </div>
    </div>
  );
}
