import { Router, type IRouter } from "express";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger.js";

// esbuild bundles all routes into dist/index.mjs so import.meta.url always
// resolves to dist/, not dist/routes/. Try multiple candidate paths.
const __dir = path.dirname(fileURLToPath(import.meta.url));

// ── Types ──────────────────────────────────────────────────────────────────
export interface DbRecord {
  prontuario: string;
  nome:       string;
  cpf:        string;
  emissao:    string;
  validade:   string;
  situacao:   string;
  local:      string;
}

// ── Load & index CSV at startup (in-memory — 16K rows ≈ 4MB) ──────────────
// Candidate paths (bundled = dist/; source = src/routes/)
const CSV_CANDIDATES = [
  path.join(__dir, "../data/db.csv"),      // bundled: dist/ → ../data/
  path.join(__dir, "../../data/db.csv"),   // source: src/routes/ → ../../data/
  path.join(process.cwd(), "data/db.csv"), // cwd fallback
];
const CSV_PATH = CSV_CANDIDATES.find(p => existsSync(p)) ?? CSV_CANDIDATES[0];

let records: DbRecord[] = [];
const byProntuario = new Map<string, DbRecord>();
const byCpf        = new Map<string, DbRecord>();

function loadCSV(): void {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split("\n").filter(Boolean);
  const seen = new Set<string>();
  let dupes = 0;
  // skip header line
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(";");
    if (parts.length < 7) continue;
    const rec: DbRecord = {
      prontuario: parts[0].trim(),
      nome:       parts[1].trim(),
      cpf:        parts[2].trim(),
      emissao:    parts[3].trim(),
      validade:   parts[4].trim(),
      situacao:   parts[5].trim(),
      local:      parts[6].trim(),
    };
    // Deduplicate by prontuario+nome+local (same person, same unit)
    const key = `${rec.prontuario}|${rec.nome}|${rec.local}`;
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    records.push(rec);
    if (rec.prontuario) byProntuario.set(rec.prontuario.toLowerCase(), rec);
    if (rec.cpf && rec.cpf !== rec.prontuario) byCpf.set(rec.cpf.toLowerCase(), rec);
  }
  logger.info(`[DB] Loaded ${records.length} unique records from db.csv (${dupes} duplicates removed)`);
}

loadCSV();

// ── Helpers ────────────────────────────────────────────────────────────────
const MAX_RESULTS = 25;

function searchByName(query: string): DbRecord[] {
  const q = query.toLowerCase().trim();
  const results: DbRecord[] = [];
  for (const r of records) {
    if (r.nome.toLowerCase().includes(q)) {
      results.push(r);
      if (results.length >= MAX_RESULTS) break;
    }
  }
  return results;
}

function searchAll(query: string): DbRecord[] {
  const q = query.toLowerCase().replace(/\D/g, ""); // strip non-digits for CPF/prontuario search
  // 1. Exact prontuario match
  const byP = byProntuario.get(q) ?? byProntuario.get(query.toLowerCase());
  if (byP) return [byP];
  // 2. Exact CPF match
  const byC = byCpf.get(q) ?? byCpf.get(query.toLowerCase());
  if (byC) return [byC];
  // 3. Partial name search
  return searchByName(query);
}

// ── Router ─────────────────────────────────────────────────────────────────
const router: IRouter = Router();

// GET /api/query?q=<search>         — smart search (prontuario, CPF, or name)
// GET /api/query?nome=<name>        — search by name only
// GET /api/query?prontuario=<id>    — exact prontuario lookup
// GET /api/query?situacao=<status>  — filter by situacao (Ativo, Vencida, etc.)
// GET /api/query/stats              — aggregate statistics
router.get("/query/stats", (_req, res): void => {
  const total = records.length;
  const counts: Record<string, number> = {};
  for (const r of records) {
    const key = r.situacao.startsWith("Ativo") ? "Ativo"
              : r.situacao.startsWith("Vencida") ? "Vencida"
              : r.situacao || "Desconhecida";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const byLocal: Record<string, number> = {};
  for (const r of records) {
    const dept = r.local.split("-")[0].trim();
    byLocal[dept] = (byLocal[dept] ?? 0) + 1;
  }
  const topLocais = Object.entries(byLocal)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([local, count]) => ({ local, count }));
  res.json({ total, situacao: counts, topLocais });
});

router.get("/query", (req, res): void => {
  const { q, nome, prontuario, situacao, page } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const offset  = (pageNum - 1) * MAX_RESULTS;

  let results: DbRecord[] = [];

  if (prontuario) {
    const r = byProntuario.get(prontuario.toLowerCase());
    if (r) results = [r];
  } else if (q) {
    results = searchAll(q);
  } else if (nome) {
    results = searchByName(nome);
  } else if (situacao) {
    const s = situacao.toLowerCase();
    let count = 0;
    for (const r of records) {
      if (r.situacao.toLowerCase().includes(s)) {
        if (count >= offset && results.length < MAX_RESULTS) results.push(r);
        count++;
        if (count >= offset + MAX_RESULTS * 3) break; // early exit
      }
    }
  } else {
    res.status(400).json({ error: "Provide q, nome, prontuario, or situacao" });
    return;
  }

  res.json({
    total:   results.length,
    page:    pageNum,
    results: results.slice(0, MAX_RESULTS),
  });
});

export default router;
