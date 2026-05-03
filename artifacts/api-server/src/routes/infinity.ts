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

// ─── helpers ───────────────────────────────────────────────────────────────
const onlyDigits = (s: string) => String(s ?? "").replace(/\D/g, "");

function serializeUser(row: { username: string; role: string; createdAt: Date; lastLoginAt: Date | null }) {
  return {
    username: row.username,
    role: row.role === "admin" ? "admin" : "user",
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
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
  const { username, password, role } = req.body ?? {};
  if (!username || !password || !role) {
    res.status(400).json({ error: "username, password e role obrigatórios" });
    return;
  }
  const finalRole = role === "admin" ? "admin" : "user";
  const passwordHash = await bcrypt.hash(String(password), 10);
  try {
    const [created] = await db
      .insert(infinityUsersTable)
      .values({ username: String(username), passwordHash, role: finalRole })
      .returning();
    res.status(201).json(serializeUser(created));
  } catch (err) {
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

// ─── consultas ─────────────────────────────────────────────────────────────
function consultaResponse(args: {
  success: boolean; tipo: string; query: string; data: object; error?: string | null;
}) {
  return {
    success: args.success,
    tipo: args.tipo,
    query: args.query,
    data: args.data,
    error: args.error ?? null,
  };
}

router.post("/consultas/cpf", requireAuth, async (req, res) => {
  const cpf = onlyDigits(String(req.body?.cpf ?? ""));
  if (cpf.length !== 11) {
    res.status(400).json({ error: "CPF inválido" });
    return;
  }
  const data = {
    cpf,
    nome: "Consulta indisponível — provedor externo offline",
    nascimento: null as string | null,
    sexo: null as string | null,
    nomeMae: null as string | null,
    fontes: ["pendente_de_provedor"],
  };
  await logConsulta({ tipo: "cpf", query: cpf, username: req.infinityUser!.username, success: false, result: data });
  res.json(consultaResponse({
    success: false,
    tipo: "cpf",
    query: cpf,
    data,
    error: "Provedor de CPF ainda não configurado. Configure uma fonte em /infinity/configuracoes.",
  }));
});

router.post("/consultas/cnpj", requireAuth, async (req, res) => {
  const cnpj = onlyDigits(String(req.body?.cnpj ?? ""));
  if (cnpj.length !== 14) {
    res.status(400).json({ error: "CNPJ inválido" });
    return;
  }
  // Use ReceitaWS public endpoint
  try {
    const r = await fetch(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`, {
      headers: { "User-Agent": "InfinitySearch/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as Record<string, unknown>;
    const success = j.status !== "ERROR";
    await logConsulta({ tipo: "cnpj", query: cnpj, username: req.infinityUser!.username, success, result: j });
    res.json(consultaResponse({
      success,
      tipo: "cnpj",
      query: cnpj,
      data: j,
      error: success ? null : String(j.message ?? "Erro desconhecido"),
    }));
  } catch (e) {
    const err = e instanceof Error ? e.message : "Erro ao consultar";
    await logConsulta({ tipo: "cnpj", query: cnpj, username: req.infinityUser!.username, success: false, result: { error: err } });
    res.json(consultaResponse({ success: false, tipo: "cnpj", query: cnpj, data: {}, error: err }));
  }
});

router.post("/consultas/telefone", requireAuth, async (req, res) => {
  const tel = onlyDigits(String(req.body?.telefone ?? ""));
  if (tel.length < 10 || tel.length > 13) {
    res.status(400).json({ error: "Telefone inválido" });
    return;
  }
  // Best-effort enrichment via numverify-style — not configured by default
  const data = {
    telefone: tel,
    operadora: null as string | null,
    portabilidade: null as string | null,
    fontes: ["pendente_de_provedor"],
  };
  await logConsulta({ tipo: "telefone", query: tel, username: req.infinityUser!.username, success: false, result: data });
  res.json(consultaResponse({
    success: false,
    tipo: "telefone",
    query: tel,
    data,
    error: "Provedor de telefone ainda não configurado.",
  }));
});

router.post("/consultas/sipni", requireAuth, async (req, res) => {
  const cpf = onlyDigits(String(req.body?.cpf ?? ""));
  if (cpf.length !== 11) {
    res.status(400).json({ error: "CPF inválido" });
    return;
  }
  // SIPNI cloud API — currently returns 404 from server IP. Returns
  // structured error so the UI can show it gracefully.
  const data = {
    cpf,
    paciente: null as null | { nome: string; nascimento: string; sexo: string; nomeMae: string },
    vacinas: [] as Array<{ data: string; vacina: string; dose: string; lote: string; estabelecimento: string }>,
    fonte: "sipni_cloud",
  };
  await logConsulta({ tipo: "sipni", query: cpf, username: req.infinityUser!.username, success: false, result: data });
  res.json(consultaResponse({
    success: false,
    tipo: "sipni",
    query: cpf,
    data,
    error: "API SIPNI indisponível no momento (404 do endpoint cloud). Aguardando ajuste de credenciais ou rota.",
  }));
});

// ─── AI chat (streaming via SSE; not in OpenAPI) ───────────────────────────
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
    "Você é o assistente do painel Infinity Search, uma plataforma OSINT brasileira. Responda em português brasileiro, de forma clara, objetiva e profissional. Ajude o operador a interpretar consultas de CPF, CNPJ, telefone, SIPNI e outras fontes. Nunca invente dados; quando não souber, diga que não sabe.";

  const payload = {
    model: "llama-3.3-70b-versatile",
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.filter((m: { role?: string; content?: string }) => m && typeof m.content === "string"),
    ],
  };

  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
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
          if (delta) {
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch {
          /* ignore */
        }
      }
    }
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (e) {
    const err = e instanceof Error ? e.message : "erro";
    res.write(`data: ${JSON.stringify({ error: err })}\n\n`);
    res.end();
  }
});

export default router;
