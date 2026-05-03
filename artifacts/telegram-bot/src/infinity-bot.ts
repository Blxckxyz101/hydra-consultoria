import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";

const INFINITY_BOT_TOKEN = process.env.INFINITY_BOT_TOKEN ?? "";
const GEASS_API_BASE = "http://149.56.18.68:25584/api/consulta";
const GEASS_API_KEY = process.env.GEASS_API_KEY ?? "GeassZero";
const SUPPORT_URL = "https://t.me/Blxckxyz";
const AUTHOR = "blxckxyz";

// ── Categories & tipos ────────────────────────────────────────────────────────
const CATEGORIES = [
  {
    id: "pessoa", label: "👤 Pessoa",
    tipos: [
      { id: "cpf", label: "📋 CPF" },
      { id: "nome", label: "🔤 Nome" },
      { id: "mae", label: "👩 Mãe" },
      { id: "pai", label: "👨 Pai" },
      { id: "parentes", label: "👨‍👩‍👧 Parentes" },
      { id: "rg", label: "🪪 RG" },
      { id: "cns", label: "🏥 CNS" },
      { id: "nis", label: "💰 NIS" },
    ],
  },
  {
    id: "veiculo", label: "🚗 Veículo",
    tipos: [
      { id: "placa", label: "🔖 Placa" },
      { id: "chassi", label: "🔩 Chassi" },
      { id: "renavam", label: "📄 Renavam" },
      { id: "motor", label: "⚙️ Motor" },
      { id: "frota", label: "🚛 Frota" },
      { id: "cnh", label: "🪪 CNH" },
    ],
  },
  {
    id: "empresa", label: "🏢 Empresa",
    tipos: [
      { id: "cnpj", label: "🏭 CNPJ" },
      { id: "fucionarios", label: "👷 Funcionários" },
      { id: "socios", label: "🤝 Sócios" },
      { id: "empregos", label: "💼 Empregos" },
    ],
  },
  {
    id: "contato", label: "📱 Contato",
    tipos: [
      { id: "telefone", label: "📞 Telefone" },
      { id: "email", label: "📧 E-mail" },
      { id: "pix", label: "💳 PIX" },
    ],
  },
  {
    id: "outros", label: "📋 Outros",
    tipos: [
      { id: "cep", label: "📍 CEP" },
      { id: "obito", label: "🕊️ Óbito" },
      { id: "vacinas", label: "💉 Vacinas" },
    ],
  },
] as const;

type CatId = (typeof CATEGORIES)[number]["id"];

interface BotSession {
  state: "idle" | "awaiting_query";
  tipo?: string;
}

const sessions = new Map<number, BotSession>();
function getSession(userId: number): BotSession {
  if (!sessions.has(userId)) sessions.set(userId, { state: "idle" });
  return sessions.get(userId)!;
}

// ── Parser ────────────────────────────────────────────────────────────────────
function parseGeassResult(raw: string): { fields: [string, string][]; sections: { name: string; items: string[] }[] } {
  const fields: [string, string][] = [];
  const sections: { name: string; items: string[] }[] = [];

  // BASE N format (e.g. telefone)
  if (/\bBASE\s+\d+\b/i.test(raw)) {
    const segs = raw.split(/\s*BASE\s+\d+\s*/i).filter((s) => s.includes(":"));
    const items: string[] = [];
    for (const seg of segs) {
      const pairs: string[] = [];
      const re =
        /\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*)\s*:\s*`?([^:]+?)(?=\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*\s*:|$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg)) !== null) {
        const k = m[1].trim();
        const v = m[2].trim().replace(/`/g, "").replace(/\s+/g, " ");
        if (k && v) pairs.push(`${k}: ${v}`);
      }
      if (pairs.length > 0) items.push(pairs.join(" | "));
    }
    if (items.length > 0) sections.push({ name: "REGISTROS", items });
    return { fields, sections };
  }

  // ⎯ format
  const SEP = " \u23AF ";
  if (raw.includes("\u23AF")) {
    const parts = raw.split(SEP);
    let currentKey = parts[0].match(/\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,})$/)?.[1] ?? "";
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      // Bullet sections
      if (part.includes("•")) {
        const secMatch = /^([A-Za-záéíóúÁÉÍÓÚ_0-9 ]+):\s*\(\s*\d+\s*-\s*Encontrados?\s*\)/i.exec(part.trim());
        if (secMatch) {
          const bulletIdx = part.indexOf("•");
          const items = part.slice(bulletIdx).split("•").map((s) => s.trim()).filter(Boolean);
          sections.push({ name: secMatch[1].trim().toUpperCase(), items });
          currentKey = items[items.length - 1]?.match(/\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,})$/)?.[1] ?? "";
          continue;
        }
      }
      if (i === parts.length - 1) {
        if (currentKey && part.trim()) fields.push([currentKey, part.trim()]);
        break;
      }
      const nk = part.match(/^(.*?)\s+([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,})*)$/);
      if (nk) {
        if (currentKey && nk[1].trim()) fields.push([currentKey, nk[1].trim()]);
        currentKey = nk[2].trim();
      }
    }
    return { fields, sections };
  }

  // Colon format
  const re =
    /\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*)\s*:\s*`?([^:\n]+?)(?=\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*\s*:|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    fields.push([m[1].trim(), m[2].trim().replace(/`/g, "").replace(/\s+/g, " ")]);
  }
  return { fields, sections };
}

// ── Text formatter ────────────────────────────────────────────────────────────
function formatResultTxt(
  tipo: string,
  dados: string,
  parsed: { fields: [string, string][]; sections: { name: string; items: string[] }[] },
  raw: string
): string {
  const D = "═".repeat(44);
  const T = "─".repeat(44);
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const lines: string[] = [];

  lines.push(D);
  lines.push(`       ∞  INFINITY SEARCH  ∞`);
  lines.push(D);
  lines.push(`  Consulta  : ${tipo.toUpperCase()}`);
  lines.push(`  Dado      : ${dados}`);
  lines.push(`  Data      : ${now}`);
  lines.push(D);
  lines.push("");

  if (parsed.fields.length > 0) {
    lines.push("DADOS ENCONTRADOS");
    lines.push(T);
    const maxKey = Math.min(22, Math.max(...parsed.fields.map(([k]) => k.length)));
    for (const [k, v] of parsed.fields) {
      lines.push(`  ${k.padEnd(maxKey)} : ${v}`);
    }
    lines.push("");
  }

  for (const sec of parsed.sections) {
    lines.push(`${sec.name}  (${sec.items.length} registro${sec.items.length !== 1 ? "s" : ""})`);
    lines.push(T);
    sec.items.forEach((item, idx) => {
      lines.push(`  ${String(idx + 1).padStart(3)}.  ${item}`);
    });
    lines.push("");
  }

  if (parsed.fields.length === 0 && parsed.sections.length === 0 && raw) {
    lines.push("RESPOSTA BRUTA");
    lines.push(T);
    lines.push(raw.slice(0, 3000));
    lines.push("");
  }

  lines.push(D);
  lines.push(`  Made by ${AUTHOR} | Infinity Search`);
  lines.push(`  Suporte : ${SUPPORT_URL}`);
  lines.push(D);
  return lines.join("\n");
}

// ── Keyboard builders ─────────────────────────────────────────────────────────
function buildHomeKeyboard() {
  return Markup.inlineKeyboard([
    ...CATEGORIES.map((cat) => [Markup.button.callback(cat.label, `cat:${cat.id}`)]),
    [Markup.button.url("💬 Suporte", SUPPORT_URL)],
  ]);
}

function buildCatKeyboard(cat: (typeof CATEGORIES)[number]) {
  const tipoRows: ReturnType<typeof Markup.button.callback>[][] = [];
  const arr = [...cat.tipos];
  for (let i = 0; i < arr.length; i += 2) {
    tipoRows.push([
      Markup.button.callback(arr[i].label, `tipo:${arr[i].id}`),
      ...(arr[i + 1] ? [Markup.button.callback(arr[i + 1].label, `tipo:${arr[i + 1].id}`)] : []),
    ]);
  }
  tipoRows.push([Markup.button.callback("◀️ Voltar", "home"), Markup.button.url("💬 Suporte", SUPPORT_URL)]);
  return Markup.inlineKeyboard(tipoRows);
}

const TIPO_PROMPTS: Record<string, string> = {
  cpf: "CPF (somente números, 11 dígitos)",
  nome: "nome completo da pessoa",
  telefone: "número de telefone com DDD",
  placa: "placa do veículo (ex: ABC1D23)",
  cnpj: "CNPJ (somente números, 14 dígitos)",
  cep: "CEP (somente números, 8 dígitos)",
  email: "endereço de e-mail",
  rg: "número do RG",
  pix: "chave PIX (CPF, e-mail, telefone ou chave aleatória)",
  chassi: "número do chassi",
  renavam: "número do Renavam",
  motor: "número do motor",
  frota: "placa ou CNPJ da frota",
  nis: "número do NIS/PIS",
  cns: "número do CNS (Cartão Nacional de Saúde)",
  mae: "CPF ou nome da mãe",
  pai: "CPF ou nome do pai",
  parentes: "CPF da pessoa",
  cnh: "número da CNH ou CPF",
  obito: "CPF da pessoa",
  vacinas: "CPF da pessoa",
  socios: "CNPJ da empresa",
  fucionarios: "CNPJ da empresa",
  empregos: "CPF da pessoa",
};

// ── Bot factory ───────────────────────────────────────────────────────────────
export function startInfinityBot(): void {
  if (!INFINITY_BOT_TOKEN) {
    console.log("[InfinityBot] INFINITY_BOT_TOKEN não configurado — bot não iniciado.");
    return;
  }

  const bot = new Telegraf(INFINITY_BOT_TOKEN);

  const HOME_TEXT =
    `🌐 *INFINITY SEARCH*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Olá, operador! Bem-vindo ao *Infinity Search Bot*.\n` +
    `Realize consultas OSINT em tempo real.\n\n` +
    `Selecione uma categoria para começar:`;

  // /start
  bot.command("start", async (ctx) => {
    getSession(ctx.from.id).state = "idle";
    await ctx.reply(HOME_TEXT, { parse_mode: "Markdown", ...buildHomeKeyboard() });
  });

  // /consultar alias
  bot.command("consultar", async (ctx) => {
    getSession(ctx.from.id).state = "idle";
    await ctx.reply(HOME_TEXT, { parse_mode: "Markdown", ...buildHomeKeyboard() });
  });

  // Category selection
  bot.action(/^cat:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const catId = ctx.match[1] as CatId;
    const cat = CATEGORIES.find((c) => c.id === catId);
    if (!cat) return;
    getSession(ctx.from.id).state = "idle";
    await ctx.editMessageText(
      `${cat.label}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nSelecione o tipo de consulta:`,
      { parse_mode: "Markdown", ...buildCatKeyboard(cat) }
    );
  });

  // Tipo selection
  bot.action(/^tipo:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const tipoId = ctx.match[1];
    const session = getSession(ctx.from.id);
    session.state = "awaiting_query";
    session.tipo = tipoId;
    const prompt = TIPO_PROMPTS[tipoId] ?? "o dado para consultar";
    await ctx.editMessageText(
      `🔍 *Consulta: ${tipoId.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nEnvie o ${prompt}:`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "home")]]),
      }
    );
  });

  // Home button (edit)
  bot.action("home", async (ctx) => {
    await ctx.answerCbQuery();
    getSession(ctx.from.id).state = "idle";
    await ctx.editMessageText(HOME_TEXT, { parse_mode: "Markdown", ...buildHomeKeyboard() });
  });

  // New message home
  bot.action("home_new", async (ctx) => {
    await ctx.answerCbQuery();
    getSession(ctx.from.id).state = "idle";
    await ctx.reply(HOME_TEXT, { parse_mode: "Markdown", ...buildHomeKeyboard() });
  });

  // Handle text (query input)
  bot.on(message("text"), async (ctx) => {
    const session = getSession(ctx.from.id);
    if (session.state !== "awaiting_query" || !session.tipo) {
      await ctx.reply(
        "Use /start para iniciar uma consulta.",
        Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "home_new")]])
      );
      return;
    }

    const dados = ctx.message.text.trim();
    const tipo = session.tipo;
    session.state = "idle";

    const loadMsg = await ctx.reply(
      `⏳ *Consultando ${tipo.toUpperCase()}...*\n\`${dados}\``,
      { parse_mode: "Markdown" }
    );

    try {
      const url = `${GEASS_API_BASE}/${tipo}?dados=${encodeURIComponent(dados)}&apikey=${encodeURIComponent(GEASS_API_KEY)}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(25000) });

      if (!resp.ok) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, loadMsg.message_id, undefined,
          `❌ Erro HTTP ${resp.status} ao consultar o provedor.`,
          Markup.inlineKeyboard([[Markup.button.callback("🔄 Nova Consulta", "home_new"), Markup.button.url("💬 Suporte", SUPPORT_URL)]])
        );
        return;
      }

      const json = await resp.json() as { status?: string; resposta?: string };

      if (!json.resposta || json.status === "erro" || json.resposta.trim() === "") {
        await ctx.telegram.editMessageText(
          ctx.chat.id, loadMsg.message_id, undefined,
          `⚠️ *Sem resultado*\n\nNenhum dado encontrado para:\nTipo: \`${tipo.toUpperCase()}\`\nDado: \`${dados}\``,
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Nova Consulta", "home_new"), Markup.button.url("💬 Suporte", SUPPORT_URL)]]),
          }
        );
        return;
      }

      const raw = json.resposta;
      const parsed = parseGeassResult(raw);
      const totalRegistros = parsed.sections.reduce((a, s) => a + s.items.length, 0);
      const txtContent = formatResultTxt(tipo, dados, parsed, raw);

      const summaryLines = [
        `✅ *Resultado encontrado!*`,
        ``,
        `📌 Tipo   : \`${tipo.toUpperCase()}\``,
        `🔎 Dado   : \`${dados}\``,
      ];
      if (parsed.fields.length > 0) summaryLines.push(`📊 Campos  : ${parsed.fields.length}`);
      if (totalRegistros > 0) summaryLines.push(`📋 Registros: ${totalRegistros}`);

      await ctx.telegram.editMessageText(
        ctx.chat.id, loadMsg.message_id, undefined,
        summaryLines.join("\n"),
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Nova Consulta", "home_new"), Markup.button.url("💬 Suporte", SUPPORT_URL)]]),
        }
      );

      // Send .txt file
      const filename = `infinity-${tipo}-${Date.now()}.txt`;
      await ctx.replyWithDocument(
        { source: Buffer.from(txtContent, "utf-8"), filename },
        {
          caption: `📄 *${tipo.toUpperCase()}* · Made by ${AUTHOR} | Infinity Search`,
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Nova Consulta", "home_new"), Markup.button.url("💬 Suporte", SUPPORT_URL)]]),
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      await ctx.telegram
        .editMessageText(
          ctx.chat.id, loadMsg.message_id, undefined,
          `❌ *Erro:* ${msg.slice(0, 200)}`,
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Nova Consulta", "home_new")]]),
          }
        )
        .catch(() => {});
    }
  });

  bot
    .launch(() => {
      console.log("🌐 Infinity Search Bot iniciado com sucesso!");
    })
    .catch((err: unknown) => {
      const msg = String((err as Error)?.message ?? err);
      if (msg.includes("409") || msg.includes("Conflict") || msg.includes("terminated by other")) {
        console.warn("⚠️  InfinityBot: outra instância já está ativa.");
      } else {
        console.error("[InfinityBot] Erro ao iniciar:", err);
      }
    });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
