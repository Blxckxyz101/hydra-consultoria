import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, infinityUsersTable, infinityConsultasTable } from "@workspace/db";
import { eq, desc, sql, gte } from "drizzle-orm";
import {
  createSession,
  deleteSession,
  extractToken,
  requireAuth,
  requireAdmin,
} from "../lib/infinity-auth.js";

const router: IRouter = Router();

const PROVIDER_BASE = "http://149.56.18.68:25584/api/consulta";
// GEASS_API_KEY secret holds the provider key; fallback is the known public key
const PROVIDER_KEY = process.env.GEASS_API_KEY ?? "GeassZero";

const SUPPORTED_TIPOS = new Set([
  "nome", "cpf", "pix", "nis", "cns", "placa", "chassi", "telefone",
  "mae", "pai", "parentes", "cep", "frota", "cnpj", "fucionarios",
  "socios", "empregos", "cnh", "renavam", "obito", "rg", "email",
  "motor", "vacinas",
]);

const onlyDigits = (s: string) => String(s ?? "").replace(/\D/g, "");

function serializeUser(row: { username: string; role: string; createdAt: Date; lastLoginAt: Date | null; accountExpiresAt?: Date | null }) {
  return {
    username: row.username,
    role: row.role === "admin" ? "admin" : "user",
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    accountExpiresAt: row.accountExpiresAt ? row.accountExpiresAt.toISOString() : null,
  };
}

async function logConsulta(args: {
  tipo: string; query: string; username: string; success: boolean; result: unknown;
}): Promise<void> {
  try {
    await db.insert(infinityConsultasTable).values({
      tipo: args.tipo,
      query: args.query,
      username: args.username,
      success: args.success,
      result: args.result as object,
    });
  } catch {
    /* swallow */
  }
}

// ─── Provider parser ───────────────────────────────────────────────────────
type ParsedSection = { name: string; items: string[] };
type Parsed = {
  fields: Array<{ key: string; value: string }>;
  sections: ParsedSection[];
  raw: string;
};

// ⎯ is U+23AF HORIZONTAL LINE EXTENSION — the separator used by this provider
const SEP = " \u23AF ";
// Single uppercase word at end of a segment (last resort fallback key)
const LAST_WORD_RE = /\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_][A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_0-9]*)$/;
// Section header: "NAME: ( N - Encontrados)" followed by bullet items
const SEC_HEADER_RE = /^([A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Za-z_0-9 ]+):\s*\(\s*\d+\s*-\s*Encontrados?\s*\)/;

// Known multi-word field names used by this provider (expanded as more tipos are tested)
const KNOWN_MULTIWORD_KEYS = new Set([
  "NOME MÃE", "NOME PAI", "NOME MAE", "NOME PAI",
  "MUNICÍPIO DE NASCIMENTO", "MUNICIPIO DE NASCIMENTO",
  "TIPO SANGÚINEO", "TIPO SANGUINEO",
  "ESTADO CIVIL", "STATUS NA RECEITA",
  "HABILITADO PARA DIRIGIR", "HABILITADO_PARA_DIRIGIR",
  "ANO MODELO", "ANO FABRICACAO", "ANO FABRICAÇÃO",
  "PROPRIETARIO NOME", "PROPRIETARIO CPF",
  "MARCA MODELO", "NUMERO CHASSI",
  "DATA EMISSAO", "DATA NASCIMENTO", "DATA OBITO",
  "NOME FANTASIA", "RAZAO SOCIAL",
  "SITUACAO CADASTRAL", "NATUREZA JURIDICA",
  "CAPITAL SOCIAL", "DATA ABERTURA",
  "ENDERECO COMPLETO", "LOGRADOURO TIPO",
  "TITULO ELEITOR", "CLASSE SOCIAL",
  "RECEBE INSS", "NOME SOCIAL",
  "RACA COR", "TIPO LOGRADOURO",
  "DATA EMISSAO RG", "ORGAO EMISSOR",
  "PAIS NASCIMENTO", "PAIS RESIDENCIA",
  "SITUACAO ESPECIAL", "DATA SITUACAO",
]);

// All-caps single token (no digits, no spaces) — standalone key pattern
const PURE_KEY_RE = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_]+$/;

/** Extract the trailing key from the END of a segment.
 *  Handles empty-value fields (consecutive separators) and known multi-word keys. */
function extractTrailingKey(seg: string): { value: string; key: string } {
  const trimmed = seg.trim();

  // Empty-value case: the entire segment IS a key (no value)
  // 1. Known multi-word key exactly matching the full segment
  if (KNOWN_MULTIWORD_KEYS.has(trimmed)) return { value: "", key: trimmed };
  // 2. Single pure-caps word with no digits (e.g. "RG", "CPF", "SCORE")
  if (PURE_KEY_RE.test(trimmed)) return { value: "", key: trimmed };

  // Try known multi-word keys at the END of the segment (value before, key after)
  for (const n of [3, 2]) {
    const re = new RegExp(
      `^(.*?)\\s+((?:[A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_][A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_0-9]*\\s+){${n - 1}}[A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_][A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_0-9]*)$`
    );
    const m = re.exec(trimmed);
    if (m && KNOWN_MULTIWORD_KEYS.has(m[2].trim())) {
      return { value: m[1].trim(), key: m[2].trim() };
    }
  }
  // Fallback: last single uppercase word
  const lm = LAST_WORD_RE.exec(trimmed);
  if (lm) return { value: trimmed.slice(0, lm.index).trim(), key: lm[1].trim() };
  return { value: trimmed, key: "" };
}

/** Parse "BASE N KEY: VALUE KEY: VALUE BASE N+1 ..." responses (e.g. telefone) */
function parseBaseNFormat(raw: string): Parsed {
  const result: Parsed = { fields: [], sections: [], raw };
  const segments = raw.split(/\s*BASE\s+\d+\s*/i).filter((p) => p.trim().includes(":"));
  const items: string[] = [];
  for (const seg of segments) {
    const pairs: string[] = [];
    const re = /\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*)\s*:\s*`?([^:]+?)(?=\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*\s*:|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg)) !== null) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/`/g, "").replace(/\s+/g, " ");
      if (k && v) pairs.push(`${k}: ${v}`);
    }
    if (pairs.length > 0) items.push(pairs.join(" · "));
  }
  if (items.length > 0) result.sections.push({ name: "REGISTROS", items });
  return result;
}

/** Parse simple "KEY: VALUE KEY: VALUE" colon-separated responses */
function parseColonFormat(raw: string): Parsed {
  const result: Parsed = { fields: [], sections: [], raw };
  const re = /\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*)\s*:\s*`?([^:\n]+?)(?=\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*\s*:|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const k = m[1].trim();
    const v = m[2].trim().replace(/`/g, "").replace(/\s+/g, " ");
    if (k.length >= 2 && v) result.fields.push({ key: k, value: v });
  }
  return result;
}

function parseProviderText(raw: string): Parsed {
  const result: Parsed = { fields: [], sections: [], raw };

  // BASE N multi-record format (e.g. telefone)
  if (/\bBASE\s+\d+\b/i.test(raw)) return parseBaseNFormat(raw);

  if (!raw || !raw.includes("\u23AF")) {
    // Fallback: try simple KEY: VALUE colon format
    if (raw && raw.includes(":")) {
      const colon = parseColonFormat(raw);
      if (colon.fields.length > 0) return colon;
    }
    return result;
  }

  const parts = raw.split(SEP);
  // parts[0] = "RESULTADO ... FIRST_KEY"
  // parts[i>0] = "VALUE [NEXT_KEY]"

  // First key: last word(s) of parts[0]
  const firstExtract = extractTrailingKey(parts[0]);
  let currentKey = firstExtract.key || parts[0].trim();

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    // Detect section list: "SECTIONNAME: ( N - Encontrados) • item • item ..."
    if (part.includes("•")) {
      const secMatch = SEC_HEADER_RE.exec(part.trim());
      if (secMatch) {
        const bulletIdx = part.indexOf("•");
        const itemsRaw = part.slice(bulletIdx);
        const items = itemsRaw.split("•").map((s) => s.trim()).filter(Boolean);
        result.sections.push({ name: secMatch[1].trim().toUpperCase(), items });
        // Find trailing key after the last bullet
        const lastItem = items[items.length - 1] ?? "";
        const lm = LAST_WORD_RE.exec(lastItem);
        currentKey = lm ? lm[1].trim() : "";
        continue;
      }
    }

    // Last part has no next key
    if (i === parts.length - 1) {
      const value = part.trim().replace(/\s+/g, " ");
      if (currentKey && value) result.fields.push({ key: currentKey, value });
      break;
    }

    const { value, key: nextKey } = extractTrailingKey(part);
    const cleanValue = value.replace(/\s+/g, " ");
    if (currentKey && cleanValue) result.fields.push({ key: currentKey, value: cleanValue });
    currentKey = nextKey;
  }

  return result;
}

async function callProvider(tipo: string, dados: string, signal: AbortSignal): Promise<{
  ok: boolean;
  parsed?: Parsed;
  error?: string;
  http?: number;
  raw?: unknown;
}> {
  const url = `${PROVIDER_BASE}/${tipo}?dados=${encodeURIComponent(dados)}&apikey=${encodeURIComponent(PROVIDER_KEY)}`;
  try {
    const r = await fetch(url, { signal });
    const text = await r.text();
    if (!r.ok) {
      return { ok: false, http: r.status, error: `Provedor HTTP ${r.status}`, raw: text.slice(0, 1000) };
    }
    let json: { status?: string; resposta?: string; criador?: string };
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: "Provedor retornou texto inválido", raw: text.slice(0, 500) };
    }
    if (!json.resposta || typeof json.resposta !== "string") {
      return { ok: false, error: "Sem resultado para esta consulta", raw: json };
    }
    const parsed = parseProviderText(json.resposta);
    if (parsed.fields.length === 0 && parsed.sections.length === 0 && parsed.raw.trim().length === 0) {
      return { ok: false, error: "Sem dados retornados", parsed };
    }
    return { ok: true, parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro de rede";
    return { ok: false, error: msg };
  }
}

// ─── auth ──────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "username e password obrigatórios" });
    return;
  }
  const rows = await db
    .select()
    .from(infinityUsersTable)
    .where(eq(infinityUsersTable.username, String(username)))
    .limit(1);
  const u = rows[0];
  if (!u) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }
  const ok = await bcrypt.compare(String(password), u.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }
  const { token } = await createSession(u.username);
  await db.update(infinityUsersTable).set({ lastLoginAt: new Date() }).where(eq(infinityUsersTable.username, u.username));
  res.json({
    token,
    user: serializeUser({ ...u, lastLoginAt: new Date() }),
  });
});

router.post("/logout", async (req, res) => {
  const token = extractToken(req);
  if (token) await deleteSession(token);
  res.status(204).end();
});

router.get("/me", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const rows = await db.select().from(infinityUsersTable).where(eq(infinityUsersTable.username, username)).limit(1);
  const u = rows[0];
  if (!u) {
    res.status(401).json({ error: "Usuário não encontrado" });
    return;
  }
  res.json(serializeUser(u));
});

// ─── users (admin) ─────────────────────────────────────────────────────────
router.get("/users", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(infinityUsersTable).orderBy(desc(infinityUsersTable.createdAt));
  res.json(rows.map(serializeUser));
});

router.post("/users", requireAdmin, async (req, res) => {
  const { username, password, role, expiresInDays } = req.body ?? {};
  if (!username || !password || !role) {
    res.status(400).json({ error: "username, password e role obrigatórios" });
    return;
  }
  const finalRole = role === "admin" ? "admin" : "user";
  const passwordHash = await bcrypt.hash(String(password), 10);
  let accountExpiresAt: Date | null = null;
  if (expiresInDays && Number(expiresInDays) > 0) {
    accountExpiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
  }
  try {
    const [created] = await db
      .insert(infinityUsersTable)
      .values({ username: String(username), passwordHash, role: finalRole, accountExpiresAt })
      .returning();
    res.status(201).json(serializeUser(created));
  } catch {
    res.status(400).json({ error: "Usuário já existe ou dados inválidos" });
  }
});

router.delete("/users/:username", requireAdmin, async (req, res) => {
  const target = String(req.params.username);
  if (target === req.infinityUser!.username) {
    res.status(400).json({ error: "Você não pode deletar sua própria conta" });
    return;
  }
  await db.delete(infinityUsersTable).where(eq(infinityUsersTable.username, target));
  res.status(204).end();
});

router.patch("/users/:username", requireAdmin, async (req, res) => {
  const target = String(req.params.username);
  const { action, expiresInDays } = req.body ?? {};

  let updateData: { accountExpiresAt: Date | null };

  if (action === "revoke") {
    updateData = { accountExpiresAt: new Date(Date.now() - 1000) };
  } else if (action === "restore") {
    updateData = { accountExpiresAt: null };
  } else if (expiresInDays !== undefined) {
    updateData = {
      accountExpiresAt: Number(expiresInDays) > 0
        ? new Date(Date.now() + Number(expiresInDays) * 86_400_000)
        : null,
    };
  } else {
    res.status(400).json({ error: "Ação inválida. Use action=revoke, action=restore ou expiresInDays." });
    return;
  }

  const [updated] = await db
    .update(infinityUsersTable)
    .set(updateData)
    .where(eq(infinityUsersTable.username, target))
    .returning();

  if (!updated) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  res.json(serializeUser(updated));
});

// ─── overview ──────────────────────────────────────────────────────────────
router.get("/overview", requireAuth, async (_req, res) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(infinityConsultasTable);

  const [{ hoje }] = await db
    .select({ hoje: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(gte(infinityConsultasTable.createdAt, startOfDay));

  const [{ semana }] = await db
    .select({ semana: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(gte(infinityConsultasTable.createdAt, weekAgo));

  const [{ usuarios }] = await db
    .select({ usuarios: sql<number>`count(*)::int` })
    .from(infinityUsersTable);

  const porTipo = await db
    .select({
      tipo: infinityConsultasTable.tipo,
      count: sql<number>`count(*)::int`,
    })
    .from(infinityConsultasTable)
    .groupBy(infinityConsultasTable.tipo);

  const recentes = await db
    .select()
    .from(infinityConsultasTable)
    .orderBy(desc(infinityConsultasTable.createdAt))
    .limit(10);

  res.json({
    totalConsultas: total ?? 0,
    consultasHoje: hoje ?? 0,
    consultasSemana: semana ?? 0,
    usuariosAtivos: usuarios ?? 0,
    consultasPorTipo: porTipo.map((p) => ({ tipo: p.tipo, count: p.count })),
    recentes: recentes.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      query: r.query,
      username: r.username,
      success: r.success,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

router.get("/consultas", requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const rows = await db
    .select()
    .from(infinityConsultasTable)
    .orderBy(desc(infinityConsultasTable.createdAt))
    .limit(limit);
  res.json(
    rows.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      query: r.query,
      username: r.username,
      success: r.success,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// ─── consultas universal ───────────────────────────────────────────────────
router.post("/consultas/:tipo", requireAuth, async (req, res) => {
  const tipo = String(req.params.tipo).toLowerCase();
  if (!SUPPORTED_TIPOS.has(tipo)) {
    res.status(404).json({ error: `Tipo de consulta "${tipo}" não suportado` });
    return;
  }
  const dadosRaw = String(req.body?.dados ?? req.body?.query ?? "").trim();
  if (!dadosRaw) {
    res.status(400).json({ error: "Campo 'dados' obrigatório" });
    return;
  }

  // Light validation per tipo (provider does final validation)
  let dados = dadosRaw;
  if (["cpf", "nis", "cns", "mae", "pai", "parentes", "obito", "vacinas"].includes(tipo)) {
    dados = onlyDigits(dadosRaw);
    if (dados.length !== 11) {
      res.status(400).json({ error: "CPF inválido (11 dígitos)" });
      return;
    }
  } else if (tipo === "cnpj" || tipo === "fucionarios" || tipo === "socios") {
    dados = onlyDigits(dadosRaw);
    if (dados.length !== 14) {
      res.status(400).json({ error: "CNPJ inválido (14 dígitos)" });
      return;
    }
  } else if (tipo === "telefone" || tipo === "pix") {
    dados = onlyDigits(dadosRaw);
  } else if (tipo === "cep") {
    dados = onlyDigits(dadosRaw);
    if (dados.length !== 8) {
      res.status(400).json({ error: "CEP inválido (8 dígitos)" });
      return;
    }
  } else if (tipo === "placa") {
    dados = dadosRaw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  }

  const username = req.infinityUser!.username;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);

  const provider = await callProvider(tipo, dados, ctrl.signal);
  clearTimeout(timer);

  const success = provider.ok && !!provider.parsed;
  const data = provider.parsed ?? { fields: [], sections: [], raw: provider.raw ? String(provider.raw) : "" };

  await logConsulta({
    tipo,
    query: dados,
    username,
    success,
    result: data,
  });

  res.json({
    success,
    tipo,
    query: dados,
    data,
    error: provider.error ?? null,
  });
});

// ─── AI chat (streaming via SSE, with tool-calling for consultations) ────────
const CONSULTA_TOOL = {
  type: "function" as const,
  function: {
    name: "consultar_infinity",
    description:
      "Executa uma consulta OSINT no Infinity Search. Use quando o usuário pedir para buscar/consultar CPF, CNPJ, telefone, placa, nome, etc.",
    parameters: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: [
            "cpf", "nome", "placa", "chassi", "telefone", "pix", "nis", "cns",
            "mae", "pai", "parentes", "cep", "frota", "cnpj", "fucionarios",
            "socios", "empregos", "cnh", "renavam", "obito", "rg", "email", "motor", "vacinas",
          ],
          description: "Tipo de consulta OSINT",
        },
        dados: { type: "string", description: "O dado a ser consultado" },
      },
      required: ["tipo", "dados"],
    },
  },
};

async function streamGroq(
  apiKey: string,
  messages: unknown[],
  res: import("express").Response
): Promise<void> {
  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", stream: true, messages }),
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      res.write(`data: ${JSON.stringify({ error: `Groq HTTP ${upstream.status}`, detail: text.slice(0, 200) })}\n\n`);
      res.end();
      return;
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          res.write(`data: [DONE]\n\n`);
          res.end();
          return;
        }
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta?.content ?? "";
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        } catch { /* ignore */ }
      }
    }
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (e) {
    const err = e instanceof Error ? e.message : "erro";
    res.write(`data: ${JSON.stringify({ error: err })}\n\n`);
    res.end();
  }
}

router.post("/ai/chat", requireAuth, async (req, res) => {
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages obrigatório" });
    return;
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GROQ_API_KEY não configurada" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const systemPrompt =
    "Você é o assistente do painel Infinity Search, uma plataforma OSINT brasileira. Responda em português brasileiro, de forma clara, objetiva e profissional. " +
    "Use a ferramenta consultar_infinity SOMENTE quando a mensagem ATUAL do usuário pedir EXPLICITAMENTE uma nova busca/consulta de um dado específico (CPF, CNPJ, telefone, placa, e-mail, etc.). " +
    "NÃO use a ferramenta em resposta a: agradecimentos, saudações, perguntas sobre resultados anteriores, confirmações ou qualquer mensagem que não contenha um pedido claro de nova consulta. " +
    "Nunca repita consultas de mensagens anteriores. Nunca invente dados. " +
    "Suas respostas podem ser lidas em voz alta — seja conciso, use frases naturais e evite listas muito longas.";

  const cleanMessages = messages.filter(
    (m: { role?: string; content?: string }) => m && typeof m.content === "string"
  );

  type AnyMsg = Record<string, unknown>;
  let finalMessages: AnyMsg[] = [
    { role: "system", content: systemPrompt },
    ...cleanMessages,
  ];

  // ── Phase 1: detect tool-call intent (non-streaming) ──────────────────────
  try {
    const phase1Resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        stream: false,
        messages: finalMessages,
        tools: [CONSULTA_TOOL],
        tool_choice: "auto",
        max_tokens: 200,
      }),
    });

    if (phase1Resp.ok) {
      type ToolCall = { id: string; function: { name: string; arguments: string } };
      type Phase1Choice = { finish_reason: string; message: { content: string | null; tool_calls?: ToolCall[] } };
      const phase1Data = await phase1Resp.json() as { choices?: Phase1Choice[] };
      const choice = phase1Data.choices?.[0];

      if (choice?.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
        const toolCall = choice.message.tool_calls[0];
        let args: { tipo?: string; dados?: string } = {};
        try { args = JSON.parse(toolCall.function.arguments); } catch {}
        const tipo = String(args.tipo ?? "");
        const dados = String(args.dados ?? "");

        if (tipo && dados) {
          res.write(`data: ${JSON.stringify({ status: `🔍 Consultando ${tipo.toUpperCase()}: ${dados}...` })}\n\n`);

          const consultResult = await callProvider(tipo, dados, new AbortController().signal);
          let toolContent = "";
          if (consultResult.ok && consultResult.parsed) {
            const p = consultResult.parsed;
            const lines: string[] = [];
            p.fields.forEach((f) => lines.push(`${f.key}: ${f.value}`));
            p.sections.forEach((s) => {
              lines.push(`\n${s.name} (${s.items.length} registros):`);
              s.items.slice(0, 10).forEach((it) => lines.push(`  • ${it}`));
            });
            toolContent = lines.join("\n") || p.raw.slice(0, 800);
          } else {
            toolContent = `Sem resultado: ${consultResult.error ?? "dado não encontrado"}`;
          }

          finalMessages = [
            { role: "system", content: systemPrompt },
            ...cleanMessages,
            { role: "assistant", content: null, tool_calls: [toolCall] },
            { role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: toolContent },
          ];
        }
      }
    }
  } catch { /* phase 1 failed — fall through to normal streaming */ }

  // ── Phase 2: stream final response ────────────────────────────────────────
  await streamGroq(apiKey, finalMessages, res);
});

export default router;
