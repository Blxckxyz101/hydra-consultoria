/**
 * DARKFLOW APIs — darkflowapis.space
 * 21 módulos de consulta: placa, cnh, renavam, processos, chassi, credilink, bancos, cadsus, etc.
 */

import { AttachmentBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { COLORS, AUTHOR } from "./config.js";

const DARKFLOW_TOKEN = process.env.DARKFLOW_TOKEN ?? "";
const DARKFLOW_BASE  = "https://darkflowapis.space/api.php";

// ── Module metadata ─────────────────────────────────────────────────────────

export interface DarkflowModule {
  label:      string;
  emoji:      string;
  category:   string;
  paramName:  string;   // option name in slash command
  paramDesc:  string;   // placeholder / description shown in Discord
  color:      number;
}

export const DARKFLOW_MODULES: Record<string, DarkflowModule> = {
  placa:              { label: "Placa Veicular",          emoji: "🚗", category: "Veículos",   paramName: "placa",     paramDesc: "Placa do veículo (ex: ABC1234 ou ABC1D23)",    color: COLORS.BLUE    },
  cnh:                { label: "CNH por CPF",             emoji: "🪪", category: "Pessoas",    paramName: "cpf",       paramDesc: "CPF do condutor (apenas números)",              color: COLORS.TEAL    },
  renavam:            { label: "RENAVAM",                 emoji: "📋", category: "Veículos",   paramName: "renavam",   paramDesc: "Número RENAVAM do veículo",                     color: COLORS.BLUE    },
  processos:          { label: "Processos Judiciais",     emoji: "⚖️", category: "Jurídico",   paramName: "documento", paramDesc: "CPF ou CNPJ (apenas números)",                  color: COLORS.PURPLE  },
  numero_processo:    { label: "Número do Processo",      emoji: "📁", category: "Jurídico",   paramName: "numero",    paramDesc: "Número completo do processo judicial",          color: COLORS.PURPLE  },
  chassi:             { label: "Chassi",                  emoji: "🔩", category: "Veículos",   paramName: "chassi",    paramDesc: "Número do chassi (VIN)",                        color: COLORS.BLUE    },
  credilink_cpf:      { label: "Credilink — CPF",         emoji: "💳", category: "Crédito",    paramName: "cpf",       paramDesc: "CPF (apenas números)",                          color: COLORS.GOLD    },
  credilink_nome:     { label: "Credilink — Nome",        emoji: "💳", category: "Crédito",    paramName: "nome",      paramDesc: "Nome completo ou parcial",                      color: COLORS.GOLD    },
  credilink_telefone: { label: "Credilink — Telefone",    emoji: "📞", category: "Crédito",    paramName: "telefone",  paramDesc: "Telefone com DDD (ex: 11999990000)",            color: COLORS.GOLD    },
  busca_bancos:       { label: "Busca Bancária",          emoji: "🏦", category: "Financeiro", paramName: "cpf",       paramDesc: "CPF (apenas números)",                          color: COLORS.GREEN   },
  cadsus:             { label: "CADSUS",                  emoji: "🏥", category: "Saúde",      paramName: "cpf",       paramDesc: "CPF (apenas números)",                          color: COLORS.TEAL    },
  pai:                { label: "Dados do Pai",            emoji: "👨", category: "Pessoas",    paramName: "cpf",       paramDesc: "CPF do filho(a) (apenas números)",              color: COLORS.ORANGE  },
  mae:                { label: "Dados da Mãe",            emoji: "👩", category: "Pessoas",    paramName: "cpf",       paramDesc: "CPF do filho(a) (apenas números)",              color: COLORS.ORANGE  },
  score:              { label: "Score de Crédito",        emoji: "📊", category: "Financeiro", paramName: "cpf",       paramDesc: "CPF (apenas números)",                          color: COLORS.GREEN   },
  oab:                { label: "OAB",                     emoji: "⚖️", category: "Jurídico",   paramName: "numero",    paramDesc: "Número de inscrição OAB",                       color: COLORS.PURPLE  },
  sisreg:             { label: "SISREG",                  emoji: "🏥", category: "Saúde",      paramName: "cpf",       paramDesc: "CPF (apenas números)",                          color: COLORS.TEAL    },
  placa_sesp:         { label: "Placa SESP",              emoji: "🚔", category: "Veículos",   paramName: "placa",     paramDesc: "Placa do veículo (ex: ABC1234)",                color: COLORS.BLUE    },
  ard:                { label: "ARD Veicular",            emoji: "📄", category: "Veículos",   paramName: "placa",     paramDesc: "Placa do veículo (ex: ABC1234)",                color: COLORS.BLUE    },
  infracao:           { label: "Infrações de Trânsito",  emoji: "🚦", category: "Veículos",   paramName: "placa",     paramDesc: "Placa do veículo (ex: ABC1234)",                color: COLORS.RED     },
  cnh_sv:             { label: "CNH — Situação Veicular", emoji: "🪪", category: "Veículos",   paramName: "cpf",       paramDesc: "CPF do condutor (apenas números)",              color: COLORS.TEAL    },
  foto_mg:            { label: "Foto MG",                 emoji: "📸", category: "Pessoas",    paramName: "cpf",       paramDesc: "CPF (apenas números)",                          color: COLORS.CRIMSON },
};

// ── API caller ──────────────────────────────────────────────────────────────

export async function callDarkflow(modulo: string, consulta: string): Promise<unknown> {
  if (!DARKFLOW_TOKEN) throw new Error("DARKFLOW_TOKEN não configurado.");
  const url = new URL(DARKFLOW_BASE);
  url.searchParams.set("token",    DARKFLOW_TOKEN);
  url.searchParams.set("modulo",   modulo);
  url.searchParams.set("consulta", consulta);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  return res.json() as Promise<unknown>;
}

// ── Formatters ──────────────────────────────────────────────────────────────

const DIV = "━".repeat(38);
const SEP = "─".repeat(38);

/** Convert any value to indented human-readable text lines */
function renderValue(val: unknown, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  if (val === null || val === undefined) return [`${pad}—`];
  if (typeof val === "string")  return [`${pad}${val || "—"}`];
  if (typeof val === "number" || typeof val === "boolean") return [`${pad}${val}`];

  if (Array.isArray(val)) {
    if (val.length === 0) return [`${pad}(lista vazia)`];
    const out: string[] = [];
    val.forEach((item, i) => {
      if (typeof item === "object" && item !== null) {
        out.push(`${pad}┌─ Item ${i + 1}`);
        out.push(...renderValue(item, depth + 1).map(l => l));
        out.push(`${pad}└${"─".repeat(20)}`);
      } else {
        out.push(`${pad}• ${item}`);
      }
    });
    return out;
  }

  if (typeof val === "object") {
    const out: string[] = [];
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const key = k.replace(/_/g, " ").toUpperCase();
      if (typeof v === "object" && v !== null) {
        out.push(`${pad}${key}:`);
        out.push(...renderValue(v, depth + 1));
      } else {
        out.push(`${pad}${key}: ${v ?? "—"}`);
      }
    }
    return out;
  }

  return [`${pad}${String(val)}`];
}

/** Build the full .txt file content */
export function buildDarkflowFile(modulo: string, consulta: string, data: unknown): string {
  const cfg = DARKFLOW_MODULES[modulo];
  const lines: string[] = [
    DIV,
    `  ${cfg?.emoji ?? "🔍"}  ${(cfg?.label ?? modulo).toUpperCase()}`,
    DIV,
    `  Módulo   : ${modulo}`,
    `  Consulta : ${consulta}`,
    `  Data/Hora: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    DIV,
    "",
  ];

  if (Array.isArray(data)) {
    lines.push(`  Total de resultados: ${data.length}`);
    lines.push("");
    data.forEach((item, i) => {
      lines.push(`  ┌── Resultado ${i + 1} ${"─".repeat(20)}`);
      renderValue(item, 1).forEach(l => lines.push(l));
      lines.push(`  └${"─".repeat(26)}`);
      lines.push("");
    });
  } else {
    renderValue(data).forEach(l => lines.push(`  ${l}`));
    lines.push("");
  }

  lines.push(DIV);
  lines.push(`  Bot made by blxckxyz`);
  lines.push(DIV);

  return lines.join("\n");
}

// ── Embed field extractor ──────────────────────────────────────────────────

const PRIORITY_KEYS = [
  "nome", "name", "NOME",
  "cpf", "CPF",
  "rg", "RG",
  "data_nascimento", "nascimento", "NASCIMENTO", "DATA_NASCIMENTO",
  "telefone", "TELEFONE", "celular", "CELULAR",
  "email", "EMAIL",
  "situacao", "SITUACAO", "status", "STATUS",
  "score", "SCORE",
  "categoria", "CATEGORIA",
  "validade", "VALIDADE",
  "proprietario", "PROPRIETARIO",
  "marca", "MARCA",
  "modelo", "MODELO",
  "ano", "ANO",
  "cor", "COR",
  "municipio", "MUNICIPIO", "cidade", "CIDADE",
  "uf", "UF", "estado", "ESTADO",
  "renavam", "RENAVAM",
  "chassi", "CHASSI",
  "placa", "PLACA",
  "endereco", "ENDERECO",
  "numero", "NUMERO",
];

type EmbedField = { name: string; value: string; inline: boolean };

function extractFromObject(obj: Record<string, unknown>, limit: number): EmbedField[] {
  const fields: EmbedField[] = [];
  const added = new Set<string>();

  const addField = (k: string, v: unknown) => {
    if (fields.length >= limit) return;
    if (typeof v === "object" || v === null || v === undefined || v === "") return;
    const name = k.replace(/_/g, " ").toUpperCase();
    const value = `\`${String(v).slice(0, 60)}\``;
    fields.push({ name, value, inline: true });
    added.add(k);
  };

  // Priority keys first
  for (const key of PRIORITY_KEYS) {
    if (obj[key] !== undefined) addField(key, obj[key]);
    if (fields.length >= limit) break;
  }

  // Fill remaining from other keys
  for (const [k, v] of Object.entries(obj)) {
    if (added.has(k)) continue;
    if (fields.length >= limit) break;
    addField(k, v);
  }

  return fields;
}

export function extractEmbedFields(data: unknown, limit = 8): EmbedField[] {
  if (!data) return [];

  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    const first = data[0] as Record<string, unknown>;
    const fields = typeof first === "object" && first !== null
      ? extractFromObject(first, limit - 1)
      : [];
    if (data.length > 1) {
      fields.push({ name: "📦 Total", value: `\`${data.length} registros\``, inline: true });
    }
    return fields;
  }

  if (typeof data === "object" && data !== null) {
    return extractFromObject(data as Record<string, unknown>, limit);
  }

  return [{ name: "Resultado", value: `\`${String(data)}\``, inline: false }];
}

// ── Discord handler ─────────────────────────────────────────────────────────

export async function handleDarkflow(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const cfg = DARKFLOW_MODULES[sub];

  if (!cfg) {
    await interaction.reply({ content: "❌ Módulo inválido.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const consulta = interaction.options.getString(cfg.paramName, true).trim();

  // ── Call API ──────────────────────────────────────────────────────────────
  let data: unknown;
  try {
    data = await callDarkflow(sub, consulta);
  } catch (err) {
    const errEmbed = new EmbedBuilder()
      .setColor(COLORS.RED)
      .setTitle("❌ ERRO NA CONSULTA")
      .setDescription(`\`\`\`${String(err)}\`\`\``)
      .addFields({ name: "📡 Módulo", value: `\`${sub}\``, inline: true }, { name: "🔍 Consulta", value: `\`${consulta}\``, inline: true })
      .setTimestamp()
      .setFooter({ text: AUTHOR });
    await interaction.editReply({ embeds: [errEmbed] });
    return;
  }

  // ── Check for API-level errors ────────────────────────────────────────────
  const d = data as Record<string, unknown>;
  const hasError = d?.status === false || d?.status === "error" || d?.error || d?.erro;
  if (hasError) {
    const msg = String(d?.message ?? d?.error ?? d?.erro ?? "Consulta sem resultado.");
    const errEmbed = new EmbedBuilder()
      .setColor(COLORS.ORANGE)
      .setTitle(`${cfg.emoji} SEM RESULTADO`)
      .setDescription(`**Módulo:** \`${cfg.label}\`\n**Consulta:** \`${consulta}\`\n\n> ${msg}`)
      .setTimestamp()
      .setFooter({ text: AUTHOR });
    await interaction.editReply({ embeds: [errEmbed] });
    return;
  }

  // ── Extract embed preview fields ──────────────────────────────────────────
  const previewFields = extractEmbedFields(data, 8);
  const totalResults  = Array.isArray(data) ? data.length : null;

  // ── Build embed ────────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${cfg.emoji}  ${cfg.label.toUpperCase()}`)
    .setDescription(
      [
        `**🔍 Consulta:** \`${consulta}\``,
        totalResults !== null ? `**📦 Resultados:** \`${totalResults}\`` : "",
        "",
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📎 *Resultado completo no arquivo .txt em anexo*`,
      ].filter(Boolean).join("\n"),
    )
    .setTimestamp()
    .setFooter({ text: `${AUTHOR} • ${cfg.category}` });

  if (previewFields.length > 0) {
    embed.addFields(previewFields);
  }

  // ── Build .txt attachment ─────────────────────────────────────────────────
  const fileContent = buildDarkflowFile(sub, consulta, data);
  const safeName    = consulta.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
  const attachment  = new AttachmentBuilder(
    Buffer.from(fileContent, "utf-8"),
    { name: `${sub}_${safeName}.txt` },
  );

  await interaction.editReply({ embeds: [embed], files: [attachment] });
}
