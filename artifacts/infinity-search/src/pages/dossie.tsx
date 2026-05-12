import { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Plus, Trash2, Download, Copy, Check, FileText,
  ChevronDown, ChevronUp, StickyNote, Search, X, AlertTriangle, FileDown,
  BookOpen, Layers,
} from "lucide-react";

const LS_PHYSICAL_MODE = "infinity_dossie_physical";

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
const API_BASE = "/api/infinity";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function loadDossiesLocal(): Dossie[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}

async function fetchDossiesAPI(): Promise<Dossie[]> {
  try {
    const r = await fetch(`${API_BASE}/me/dossies`, { headers: authHeaders() });
    if (!r.ok) return [];
    const rows = await r.json() as Array<{ id: string; title: string; items: unknown[]; createdAt: string }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      items: row.items as EvidenceItem[],
      createdAt: row.createdAt,
    }));
  } catch { return []; }
}

async function upsertDossieAPI(d: Dossie): Promise<void> {
  try {
    await fetch(`${API_BASE}/me/dossies/${d.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ title: d.title, items: d.items }),
    });
  } catch {}
}

async function deleteDossieAPI(id: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/me/dossies/${id}`, { method: "DELETE", headers: authHeaders() });
  } catch {}
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
    `  HYDRA CONSULTORIA — DOSSIÊ FORENSE`,
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
  lines.push("Hydra Consultoria");
  return lines.join("\n");
}

function downloadTxt(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportPdf(dossie: Dossie) {
  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #fff; color: #1a1a2e; padding: 32px; font-size: 13px; }
    .header { background: linear-gradient(135deg, #0ea5e9, #06b6d4); color: white; padding: 24px 32px; border-radius: 12px; margin-bottom: 24px; }
    .header h1 { font-size: 22px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; }
    .header .meta { opacity: 0.85; margin-top: 8px; font-size: 11px; letter-spacing: 0.05em; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
    .stat { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px 16px; }
    .stat .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.25em; color: #0ea5e9; font-weight: 600; margin-bottom: 4px; }
    .stat .value { font-size: 20px; font-weight: 700; color: #0c4a6e; }
    .evidence { background: #fafafa; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
    .ev-header { background: linear-gradient(90deg, #f0f9ff, #e0f2fe); padding: 12px 16px; border-bottom: 1px solid #bae6fd; display: flex; align-items: center; gap: 12px; }
    .ev-badge { background: #0ea5e9; color: white; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.2em; padding: 3px 8px; border-radius: 4px; }
    .ev-query { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; color: #0c4a6e; }
    .ev-date { font-size: 10px; color: #64748b; margin-top: 2px; }
    .ev-body { padding: 16px; }
    .fields { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 24px; margin-bottom: 12px; }
    .field { border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; }
    .field-key { font-size: 9px; text-transform: uppercase; letter-spacing: 0.25em; color: #94a3b8; font-weight: 600; margin-bottom: 2px; }
    .field-val { font-size: 12px; font-weight: 500; color: #1e293b; font-family: 'JetBrains Mono', monospace; }
    .section { margin-top: 12px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.2em; color: #0ea5e9; margin-bottom: 6px; }
    .items-list { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; max-height: 160px; overflow: hidden; }
    .item-row { font-size: 11px; font-family: 'JetBrains Mono', monospace; padding: 2px 0; color: #475569; border-bottom: 1px solid #f1f5f9; }
    .note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 12px; margin-top: 10px; font-size: 11px; color: #92400e; font-style: italic; }
    .raw { font-family: 'JetBrains Mono', monospace; font-size: 10px; background: #1e293b; color: #94a3b8; padding: 10px; border-radius: 6px; margin-top: 10px; white-space: pre-wrap; overflow: hidden; max-height: 100px; }
    .footer { text-align: center; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; letter-spacing: 0.3em; text-transform: uppercase; }
    @media print { body { padding: 16px; } .evidence { break-inside: avoid; } }
  `;

  const itemsHtml = dossie.items.map((item, idx) => {
    const fieldsHtml = item.fields.length > 0
      ? `<div class="fields">${item.fields.map((f) =>
          `<div class="field"><div class="field-key">${f.key}</div><div class="field-val">${f.value || "—"}</div></div>`
        ).join("")}</div>`
      : "";

    const sectionsHtml = item.sections.map((s) =>
      `<div class="section">
        <div class="section-title">${s.name} (${s.items.length})</div>
        <div class="items-list">${s.items.slice(0, 15).map((it) =>
          `<div class="item-row">• ${it}</div>`
        ).join("")}${s.items.length > 15 ? `<div class="item-row" style="color:#94a3b8">... e mais ${s.items.length - 15}</div>` : ""}</div>
      </div>`
    ).join("");

    const noteHtml = item.note ? `<div class="note">📝 ${item.note}</div>` : "";
    const rawHtml = !item.fields.length && !item.sections.length && item.raw
      ? `<div class="raw">${item.raw.slice(0, 400)}</div>`
      : "";

    return `
      <div class="evidence">
        <div class="ev-header">
          <span class="ev-badge">${idx + 1}</span>
          <span class="ev-badge" style="background:#6366f1">${item.tipo.toUpperCase()}</span>
          <div>
            <div class="ev-query">${item.query}</div>
            <div class="ev-date">${new Date(item.addedAt).toLocaleString("pt-BR")}</div>
          </div>
        </div>
        <div class="ev-body">${fieldsHtml}${sectionsHtml}${noteHtml}${rawHtml}</div>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<title>Dossiê — ${dossie.title}</title>
<style>${styles}</style>
</head>
<body>
  <div class="header">
    <h1>⚔ Hydra Consultoria · Dossiê Forense</h1>
    <div class="meta">
      ${dossie.title} &nbsp;·&nbsp;
      Criado: ${new Date(dossie.createdAt).toLocaleString("pt-BR")} &nbsp;·&nbsp;
      Exportado: ${new Date().toLocaleString("pt-BR")}
    </div>
  </div>
  <div class="stats">
    <div class="stat"><div class="label">Evidências</div><div class="value">${dossie.items.length}</div></div>
    <div class="stat"><div class="label">Campos Total</div><div class="value">${dossie.items.reduce((s, it) => s + it.fields.length, 0)}</div></div>
    <div class="stat"><div class="label">Seções Total</div><div class="value">${dossie.items.reduce((s, it) => s + it.sections.length, 0)}</div></div>
  </div>
  ${itemsHtml}
  <div class="footer">Hydra Consultoria · Confidencial</div>
  <script>window.onload=()=>{window.print();}</script>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

function EvidenceCard({ item, onDelete, onNoteChange }: {
  item: EvidenceItem; onDelete: () => void; onNoteChange: (note: string) => void;
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
            onClick={() => setEditNote((v) => !v)}
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

      {item.note && !editNote && (
        <div className="px-4 pb-2 flex items-start gap-2">
          <StickyNote className="w-3 h-3 text-amber-400/60 mt-0.5 shrink-0" />
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

function PhysicalEvidenceCard({ item, onDelete, onNoteChange }: {
  item: EvidenceItem; onDelete: () => void; onNoteChange: (note: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const [noteVal, setNoteVal] = useState(item.note);
  const totalFields = item.fields.length + item.sections.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, rotate: -0.3 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      exit={{ opacity: 0, x: -30 }}
      whileHover={{ y: -2, rotate: 0.2 }}
      className="relative overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #f5e6c8 0%, #f0ddb4 40%, #e8d49a 100%)",
        border: "1px solid rgba(160,120,60,0.35)",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.5)",
        color: "#2a1a0a",
      }}
    >
      {/* Paper texture lines */}
      <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage: "repeating-linear-gradient(transparent, transparent 27px, #8b6914 27px, #8b6914 28px)",
          backgroundPosition: "0 32px",
        }}
      />
      {/* Fold corner */}
      <div className="absolute top-0 right-0 w-8 h-8 pointer-events-none"
        style={{
          background: "linear-gradient(225deg, #c9a85c 0%, #c9a85c 45%, #f0ddb4 45%)",
          clipPath: "polygon(100% 0, 0 0, 100% 100%)",
        }}
      />

      <div className="relative z-10 flex items-center gap-3 px-4 pt-4 pb-3">
        <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded"
          style={{ background: "#8b1a1a", color: "#f0ddb4", letterSpacing: "0.3em" }}>
          {item.tipo}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ fontFamily: "monospace", color: "#1a0f00" }}>{item.query}</p>
          <p className="text-[10px] mt-0.5" style={{ color: "#7a5c2a" }}>
            {new Date(item.addedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {" · "}{totalFields} dado{totalFields !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => setEditNote(v => !v)}
            className="p-1.5 rounded transition-colors hover:opacity-70"
            style={{ background: "rgba(139,106,20,0.15)", color: "#8b6414" }}>
            <StickyNote className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded transition-colors hover:opacity-70"
            style={{ background: "rgba(139,26,26,0.12)", color: "#8b1a1a" }}>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onDelete}
            className="p-1.5 rounded transition-colors hover:opacity-70"
            style={{ background: "rgba(139,26,26,0.12)", color: "#8b1a1a" }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {editNote && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden relative z-10" style={{ borderTop: "1px solid rgba(139,106,20,0.2)" }}>
            <div className="p-3" style={{ background: "rgba(139,106,20,0.06)" }}>
              <textarea value={noteVal} onChange={e => setNoteVal(e.target.value)} onBlur={() => onNoteChange(noteVal)}
                placeholder="Anotação do agente..." rows={2}
                className="w-full rounded px-3 py-2 text-sm resize-none focus:outline-none transition-colors"
                style={{ background: "rgba(255,248,220,0.7)", border: "1px solid rgba(139,106,20,0.3)", color: "#2a1a0a", fontFamily: "monospace" }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {item.note && !editNote && (
        <div className="relative z-10 px-4 pb-2 flex items-start gap-2">
          <StickyNote className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "#8b6414" }} />
          <p className="text-xs italic" style={{ color: "#6b4c1a", fontFamily: "Georgia, serif" }}>{item.note}</p>
        </div>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden relative z-10" style={{ borderTop: "1px solid rgba(139,106,20,0.2)" }}>
            {/* CONFIDENCIAL stamp */}
            <div className="absolute top-4 right-6 select-none pointer-events-none z-20" style={{
              transform: "rotate(-15deg)",
              border: "2px solid #8b1a1a",
              color: "#8b1a1a",
              padding: "2px 8px",
              borderRadius: 2,
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: "0.4em",
              opacity: 0.2,
            }}>CONFIDENCIAL</div>
            <div className="p-4 space-y-3">
              {item.fields.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {item.fields.map((f, i) => (
                    <div key={i} className="flex flex-col gap-0.5 py-1" style={{ borderBottom: "1px solid rgba(139,106,20,0.2)" }}>
                      <p className="text-[9px] uppercase tracking-[0.25em] font-bold" style={{ color: "#8b6414" }}>{f.key}</p>
                      <p className="text-sm break-words" style={{ fontFamily: "monospace", color: "#1a0f00" }}>{f.value}</p>
                    </div>
                  ))}
                </div>
              )}
              {item.sections.map((sec, i) => (
                <div key={i} className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: "#8b1a1a" }}>
                    {sec.name} <span style={{ color: "#7a5c2a" }}>({sec.items.length})</span>
                  </p>
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                    {sec.items.map((it, j) => (
                      <div key={j} className="flex items-start gap-2 text-xs p-2 rounded"
                        style={{ background: "rgba(255,248,220,0.5)", border: "1px solid rgba(139,106,20,0.15)" }}>
                        <span style={{ color: "#8b6414" }}>{j + 1}.</span>
                        <span style={{ fontFamily: "monospace", color: "#1a0f00" }} className="break-all">{it}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!item.fields.length && !item.sections.length && item.raw && (
                <pre className="text-xs whitespace-pre-wrap break-words max-h-40 overflow-y-auto p-2 rounded"
                  style={{ fontFamily: "monospace", color: "#4a3010", background: "rgba(255,248,220,0.5)" }}>
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
  const [dossies, setDossies] = useState<Dossie[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [physicalMode, setPhysicalMode] = useState<boolean>(
    () => localStorage.getItem(LS_PHYSICAL_MODE) === "true"
  );

  const togglePhysicalMode = () => {
    setPhysicalMode(v => {
      const next = !v;
      next ? localStorage.setItem(LS_PHYSICAL_MODE, "true") : localStorage.removeItem(LS_PHYSICAL_MODE);
      return next;
    });
  };

  // On mount: fetch from API, migrate any localStorage-only dossiers
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [apiDossies, localDossies] = await Promise.all([fetchDossiesAPI(), Promise.resolve(loadDossiesLocal())]);
      if (cancelled) return;
      const apiIds = new Set(apiDossies.map((d) => d.id));
      const localOnly = localDossies.filter((d) => !apiIds.has(d.id));
      // Migrate local-only dossiers to API
      localOnly.forEach((d) => upsertDossieAPI(d));
      const merged = [...apiDossies, ...localOnly];
      setDossies(merged);
      if (merged.length > 0) setSelected(merged[0].id);
      if (localDossies.length > 0) localStorage.removeItem(STORAGE_KEY);
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback((updated: Dossie[], changedId?: string) => {
    setDossies(updated);
    // Only sync the changed dossier (or all if no specific id)
    if (changedId) {
      const changed = updated.find((d) => d.id === changedId);
      if (changed) upsertDossieAPI(changed);
    } else {
      updated.forEach((d) => upsertDossieAPI(d));
    }
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
    const next = [d, ...dossies];
    setDossies(next);
    upsertDossieAPI(d);
    setSelected(d.id);
    setNewTitle("");
    setShowCreate(false);
  };

  const deleteDossie = (id: string) => {
    const updated = dossies.filter((d) => d.id !== id);
    setDossies(updated);
    deleteDossieAPI(id);
    if (selected === id) setSelected(updated[0]?.id ?? null);
  };

  const deleteItem = (itemId: string) => {
    if (!selected) return;
    const updated = dossies.map((d) => d.id === selected ? { ...d, items: d.items.filter((it) => it.id !== itemId) } : d);
    persist(updated, selected);
  };

  const updateNote = (itemId: string, note: string) => {
    if (!selected) return;
    const updated = dossies.map((d) => d.id === selected ? { ...d, items: d.items.map((it) => it.id === itemId ? { ...it, note } : it) } : d);
    persist(updated, selected);
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
        <div className="flex items-center gap-2">
          <button
            onClick={togglePhysicalMode}
            title={physicalMode ? "Modo Digital" : "Modo Físico (pasta manila)"}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border"
            style={physicalMode ? {
              background: "linear-gradient(135deg, #c9a85c20, #8b691410)",
              borderColor: "rgba(139,106,20,0.5)",
              color: "#c9a85c",
            } : {
              background: "rgba(255,255,255,0.04)",
              borderColor: "rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.4)",
            }}
          >
            {physicalMode ? <BookOpen className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5" />}
            {physicalMode ? "Físico" : "Digital"}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-300 text-xs font-bold uppercase tracking-widest hover:bg-amber-400/20 transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> Novo Dossiê
          </button>
        </div>
      </div>

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
              <button onClick={createDossie} className="px-5 py-3 rounded-xl bg-amber-400 text-black font-bold text-xs uppercase tracking-widest hover:bg-amber-300 transition-colors">
                Criar
              </button>
              <button onClick={() => { setShowCreate(false); setNewTitle(""); }} className="p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
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
          {/* Sidebar */}
          <div
            className="rounded-2xl p-4 space-y-2 self-start"
            style={physicalMode ? {
              background: "linear-gradient(160deg, #e8d49a, #d4b877)",
              border: "1px solid rgba(160,120,60,0.4)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            } : {
              background: "rgba(0,0,0,0.3)",
              backdropFilter: "blur(24px)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <p className="text-[10px] uppercase tracking-[0.4em] px-2 mb-3"
              style={{ color: physicalMode ? "#7a5c2a" : "rgba(255,255,255,0.4)" }}>
              Dossiês
            </p>
            {dossies.map((d) => (
              <div
                key={d.id}
                onClick={() => setSelected(d.id)}
                className="group flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all"
                style={selected === d.id
                  ? physicalMode
                    ? { background: "rgba(139,106,20,0.25)", border: "1px solid rgba(139,106,20,0.4)" }
                    : { background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" }
                  : physicalMode
                    ? { background: "rgba(139,106,20,0.08)", border: "1px solid transparent" }
                    : { background: "transparent", border: "1px solid transparent" }
                }
              >
                <FolderOpen className="w-4 h-4 shrink-0"
                  style={{ color: selected === d.id
                    ? physicalMode ? "#8b6414" : "#fbbf24"
                    : physicalMode ? "#a07830" : "rgba(255,255,255,0.4)"
                  }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate"
                    style={{ color: physicalMode ? "#2a1a0a" : selected === d.id ? "#fde68a" : undefined }}>
                    {d.title}
                  </p>
                  <p className="text-[10px]" style={{ color: physicalMode ? "#7a5c2a" : "rgba(255,255,255,0.35)" }}>
                    {d.items.length} evidência{d.items.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteDossie(d.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded transition-all"
                  style={{ color: physicalMode ? "#8b1a1a" : undefined }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Main */}
          <div className="space-y-4">
            {activeDossie ? (
              <>
                <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h2 className="text-lg font-bold tracking-[0.15em] text-amber-200">{activeDossie.title}</h2>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                        Criado {new Date(activeDossie.createdAt).toLocaleDateString("pt-BR")} · {activeDossie.items.length} evidência{activeDossie.items.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <CopyBtn text={buildReport(activeDossie)} />
                      <button
                        onClick={() => downloadTxt(buildReport(activeDossie), `dossie-${activeDossie.title.replace(/\s+/g, "-").toLowerCase()}.txt`)}
                        className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-amber-300 transition-colors"
                      >
                        <Download className="w-3 h-3" /> Exportar .txt
                      </button>
                      <button
                        onClick={() => exportPdf(activeDossie)}
                        className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-sky-300 transition-colors"
                      >
                        <FileDown className="w-3 h-3" /> Exportar PDF
                      </button>
                    </div>
                  </div>

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
                      {filteredItems.map((item) => physicalMode ? (
                        <PhysicalEvidenceCard
                          key={item.id}
                          item={item}
                          onDelete={() => deleteItem(item.id)}
                          onNoteChange={(note) => updateNote(item.id, note)}
                        />
                      ) : (
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
        Hydra Consultoria
      </div>
    </div>
  );
}
