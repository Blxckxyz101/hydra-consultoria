import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Plus, Trash2, Download, Copy, Check, FileText,
  ChevronDown, ChevronUp, StickyNote, Search, X, AlertTriangle,
} from "lucide-react";

type EvidenceItem = {
  id: string;
  tipo: string;
  query: string;
  addedAt: string;
  note: string;
  fields: Array<{ key: string; value: string }>;
  sections: Array<{ name: string; items: string[] }>;
  raw: string;
};

type Dossie = {
  id: string;
  title: string;
  createdAt: string;
  items: EvidenceItem[];
};

const STORAGE_KEY = "infinity_dossies";

function loadDossies(): Dossie[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveDossies(d: Dossie[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

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

function buildReport(dossie: Dossie): string {
  const lines: string[] = [
    "═══════════════════════════════════════",
    `  INFINITY SEARCH — DOSSIÊ FORENSE`,
    "═══════════════════════════════════════",
    `Título: ${dossie.title}`,
    `Criado: ${new Date(dossie.createdAt).toLocaleString("pt-BR")}`,
    `Exportado: ${new Date().toLocaleString("pt-BR")}`,
    `Evidências: ${dossie.items.length}`,
    "",
  ];

  dossie.items.forEach((item, idx) => {
    lines.push(`━━━ [${idx + 1}] ${item.tipo.toUpperCase()} — ${item.query} ━━━`);
    lines.push(`Adicionado: ${new Date(item.addedAt).toLocaleString("pt-BR")}`);
    if (item.note) lines.push(`Nota: ${item.note}`);
    lines.push("");
    item.fields.forEach((f) => lines.push(`  ${f.key}: ${f.value}`));
    item.sections.forEach((s) => {
      lines.push(`  ── ${s.name} (${s.items.length}) ──`);
      s.items.forEach((it) => lines.push(`    • ${it}`));
    });
    if (!item.fields.length && !item.sections.length && item.raw) {
      lines.push(`  ${item.raw.slice(0, 500)}`);
    }
    lines.push("");
  });

  lines.push("═══════════════════════════════════════");
  lines.push("Made by blxckxyz · Infinity Search");
  return lines.join("\n");
}

function downloadTxt(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function EvidenceCard({
  item, onDelete, onNoteChange,
}: {
  item: EvidenceItem;
  onDelete: () => void;
  onNoteChange: (note: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const [noteVal, setNoteVal] = useState(item.note);

  const totalFields = item.fields.length + item.sections.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="rounded-xl border border-white/8 bg-black/30 backdrop-blur-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-md shrink-0">
          {item.tipo}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm truncate">{item.query}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {new Date(item.addedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {" · "}{totalFields} campo{totalFields !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setEditNote((v) => !v); }}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-amber-400/10 hover:text-amber-300 transition-colors"
            title="Adicionar nota"
          >
            <StickyNote className="w-3.5 h-3.5" />
          </button>
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

      {/* Note */}
      <AnimatePresence>
        {editNote && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-white/5"
          >
            <div className="p-3 bg-amber-400/5">
              <textarea
                value={noteVal}
                onChange={(e) => setNoteVal(e.target.value)}
                onBlur={() => onNoteChange(noteVal)}
                placeholder="Adicione uma nota a esta evidência..."
                rows={2}
                className="w-full bg-black/40 border border-amber-400/20 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-amber-400/50 transition-colors"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Note preview */}
      {item.note && !editNote && (
        <div className="px-4 pb-2 flex items-start gap-2">
          <StickyNote className="w-3 h-3 text-amber-400/60 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-200/70 italic">{item.note}</p>
        </div>
      )}

      {/* Expanded details */}
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
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
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
                  {item.raw.slice(0, 800)}
                </pre>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function Dossie() {
  const [dossies, setDossies] = useState<Dossie[]>(loadDossies);
  const [selected, setSelected] = useState<string | null>(() => loadDossies()[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const persist = useCallback((updated: Dossie[]) => {
    setDossies(updated);
    saveDossies(updated);
  }, []);

  const activeDossie = useMemo(() => dossies.find((d) => d.id === selected) ?? null, [dossies, selected]);

  const filteredItems = useMemo(() => {
    if (!activeDossie) return [];
    const q = search.toLowerCase();
    if (!q) return activeDossie.items;
    return activeDossie.items.filter((it) =>
      it.query.toLowerCase().includes(q) ||
      it.tipo.toLowerCase().includes(q) ||
      it.note.toLowerCase().includes(q) ||
      it.fields.some((f) => f.value.toLowerCase().includes(q))
    );
  }, [activeDossie, search]);

  const createDossie = () => {
    if (!newTitle.trim()) return;
    const d: Dossie = { id: newId(), title: newTitle.trim(), createdAt: new Date().toISOString(), items: [] };
    const updated = [d, ...dossies];
    persist(updated);
    setSelected(d.id);
    setNewTitle("");
    setShowCreate(false);
  };

  const deleteDossie = (id: string) => {
    const updated = dossies.filter((d) => d.id !== id);
    persist(updated);
    if (selected === id) setSelected(updated[0]?.id ?? null);
  };

  const deleteItem = (itemId: string) => {
    const updated = dossies.map((d) =>
      d.id === selected ? { ...d, items: d.items.filter((it) => it.id !== itemId) } : d
    );
    persist(updated);
  };

  const updateNote = (itemId: string, note: string) => {
    const updated = dossies.map((d) =>
      d.id === selected ? { ...d, items: d.items.map((it) => it.id === itemId ? { ...it, note } : it) } : d
    );
    persist(updated);
  };

  const exportDossie = () => {
    if (!activeDossie) return;
    const text = buildReport(activeDossie);
    downloadTxt(text, `dossie-${activeDossie.title.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.txt`);
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-gradient-to-r from-amber-300 to-orange-200 bg-clip-text text-transparent"
          >
            Dossiê
          </motion.h1>
          <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
            Evidências forenses compiladas
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-300 text-xs font-bold uppercase tracking-widest hover:bg-amber-400/20 transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> Novo Dossiê
        </button>
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl border border-amber-400/30 bg-amber-400/5 backdrop-blur-xl p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen className="w-4 h-4 text-amber-300" />
              <span className="text-xs uppercase tracking-[0.35em] text-amber-300 font-semibold">Criar Dossiê</span>
            </div>
            <div className="flex gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createDossie()}
                placeholder="Titulo do dossiê (ex: João Silva - CPF 123...)"
                className="flex-1 bg-black/40 border border-amber-400/20 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-400/60 transition-colors"
                autoFocus
              />
              <button
                onClick={createDossie}
                className="px-5 py-3 rounded-xl bg-amber-400 text-black font-bold text-xs uppercase tracking-widest hover:bg-amber-300 transition-colors"
              >
                Criar
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewTitle(""); }}
                className="p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {dossies.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-12 text-center">
          <FolderOpen className="w-12 h-12 opacity-20 mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Nenhum dossiê criado ainda.</p>
          <p className="text-[11px] text-muted-foreground/50 mt-2">
            Crie um dossiê e adicione evidências a partir da aba Consultas.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Sidebar — list of dossies */}
          <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 space-y-2 self-start">
            <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground px-2 mb-3">Dossiês</p>
            {dossies.map((d) => (
              <div
                key={d.id}
                onClick={() => setSelected(d.id)}
                className={`group flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${
                  selected === d.id
                    ? "bg-amber-400/10 border border-amber-400/30"
                    : "hover:bg-white/5 border border-transparent"
                }`}
              >
                <FolderOpen className={`w-4 h-4 shrink-0 ${selected === d.id ? "text-amber-300" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${selected === d.id ? "text-amber-200" : ""}`}>{d.title}</p>
                  <p className="text-[10px] text-muted-foreground">{d.items.length} evidência{d.items.length !== 1 ? "s" : ""}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteDossie(d.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-destructive transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Main — selected dossie */}
          <div className="space-y-4">
            {activeDossie ? (
              <>
                {/* Dossie header */}
                <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h2 className="text-lg font-bold tracking-[0.15em] text-amber-200">{activeDossie.title}</h2>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                        Criado {new Date(activeDossie.createdAt).toLocaleDateString("pt-BR")} · {activeDossie.items.length} evidência{activeDossie.items.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <CopyBtn text={buildReport(activeDossie)} />
                      <button
                        onClick={exportDossie}
                        className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-amber-300 transition-colors"
                      >
                        <Download className="w-3 h-3" /> Exportar .txt
                      </button>
                    </div>
                  </div>

                  {/* Search in dossie */}
                  <div className="mt-4 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Filtrar evidências..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-amber-400/40 transition-colors"
                    />
                  </div>
                </div>

                {/* Evidence items */}
                {filteredItems.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-10 text-center">
                    <FileText className="w-10 h-10 opacity-20 mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm">
                      {activeDossie.items.length === 0
                        ? "Nenhuma evidência ainda. Use as Consultas e salve resultados aqui."
                        : "Nenhuma evidência encontrada para esse filtro."}
                    </p>
                    {activeDossie.items.length === 0 && (
                      <p className="text-[11px] text-muted-foreground/50 mt-2 flex items-center gap-1 justify-center">
                        <AlertTriangle className="w-3 h-3" />
                        Após uma consulta, clique em "Salvar no Dossiê"
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <AnimatePresence mode="popLayout">
                      {filteredItems.map((item) => (
                        <EvidenceCard
                          key={item.id}
                          item={item}
                          onDelete={() => deleteItem(item.id)}
                          onNoteChange={(note) => updateNote(item.id, note)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-10 text-center">
                <p className="text-muted-foreground text-sm">Selecione um dossiê à esquerda.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="text-center text-[10px] uppercase tracking-[0.5em] text-muted-foreground/60 pt-2">
        Made by blxckxyz · Infinity Search
      </div>
    </div>
  );
}
