/**
 * /lelouch — Rede de Inteligência de Zero
 * 21 módulos de consulta via darkflowapis.space
 * Subcomandos nomeados pelo TIPO de consulta (cpf, placa, telefone, etc.)
 */

import { AttachmentBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { COLORS, AUTHOR } from "./config.js";

const DARKFLOW_TOKEN = process.env.DARKFLOW_TOKEN ?? "";
const DARKFLOW_BASE  = "https://darkflowapis.space/api.php";

// ── Tema ─────────────────────────────────────────────────────────────────────

const LELOUCH_FOOTER = `👁️ Rede Zero  •  ${AUTHOR}`;
const LELOUCH_ICON   = "https://i.imgur.com/2T82TzL.png"; // Geass symbol (fallback gracioso se offline)

// ── Module metadata ──────────────────────────────────────────────────────────

export interface DarkflowModule {
  label:      string;   // nome amigável para o embed
  emoji:      string;
  category:   string;
  paramName:  string;   // nome do option no slash command
  paramDesc:  string;
  color:      number;
  apiModule:  string;   // módulo real na API darkflowapis.space
}

/**
 * Chaves = nome do subcomando Discord (por tipo de consulta).
 * apiModule = nome real do módulo na API.
 */
export const DARKFLOW_MODULES: Record<string, DarkflowModule> = {
  // ── Pessoas / Identidade ──────────────────────────────────────────────────
  cpf:        { label: "Consulta CPF",            emoji: "🪪", category: "Identidade",  paramName: "cpf",       paramDesc: "CPF (apenas números)",                         color: COLORS.TEAL,    apiModule: "credilink_cpf"    },
  nome:       { label: "Consulta por Nome",        emoji: "👤", category: "Identidade",  paramName: "nome",      paramDesc: "Nome completo ou parcial",                     color: COLORS.TEAL,    apiModule: "credilink_nome"   },
  telefone:   { label: "Consulta por Telefone",    emoji: "📞", category: "Identidade",  paramName: "telefone",  paramDesc: "Telefone com DDD (ex: 11999990000)",            color: COLORS.TEAL,    apiModule: "credilink_telefone"},
  pai:        { label: "Dados do Pai",             emoji: "👨", category: "Família",     paramName: "cpf",       paramDesc: "CPF do filho(a) (apenas números)",              color: COLORS.PURPLE,  apiModule: "pai"              },
  mae:        { label: "Dados da Mãe",             emoji: "👩", category: "Família",     paramName: "cpf",       paramDesc: "CPF do filho(a) (apenas números)",              color: COLORS.PURPLE,  apiModule: "mae"              },
  foto:       { label: "Foto MG",                  emoji: "📸", category: "Identidade",  paramName: "cpf",       paramDesc: "CPF (apenas números)",                         color: COLORS.PURPLE,  apiModule: "foto_mg"          },
  cadsus:     { label: "CADSUS",                   emoji: "🏥", category: "Saúde",       paramName: "cpf",       paramDesc: "CPF (apenas números)",                         color: COLORS.GREEN,   apiModule: "cadsus"           },
  sisreg:     { label: "SISREG",                   emoji: "🏥", category: "Saúde",       paramName: "cpf",       paramDesc: "CPF (apenas números)",                         color: COLORS.GREEN,   apiModule: "sisreg"           },

  // ── Habilitação ───────────────────────────────────────────────────────────
  cnh:        { label: "CNH por CPF",              emoji: "🪪", category: "Habilitação", paramName: "cpf",       paramDesc: "CPF do condutor (apenas números)",              color: COLORS.GOLD,    apiModule: "cnh"              },
  cnh_sv:     { label: "CNH — Situação Veicular",  emoji: "🚘", category: "Habilitação", paramName: "cpf",       paramDesc: "CPF do condutor (apenas números)",              color: COLORS.GOLD,    apiModule: "cnh_sv"           },

  // ── Veículos ──────────────────────────────────────────────────────────────
  placa:      { label: "Placa Veicular",           emoji: "🚗", category: "Veículos",    paramName: "placa",     paramDesc: "Placa do veículo (ex: ABC1234 ou ABC1D23)",     color: COLORS.BLUE,    apiModule: "placa"            },
  renavam:    { label: "RENAVAM",                  emoji: "📋", category: "Veículos",    paramName: "renavam",   paramDesc: "Número RENAVAM do veículo",                     color: COLORS.BLUE,    apiModule: "renavam"          },
  chassi:     { label: "Chassi (VIN)",             emoji: "🔩", category: "Veículos",    paramName: "chassi",    paramDesc: "Número do chassi (VIN)",                        color: COLORS.BLUE,    apiModule: "chassi"           },
  sesp:       { label: "Placa SESP",               emoji: "🚔", category: "Veículos",    paramName: "placa",     paramDesc: "Placa do veículo (ex: ABC1234)",                color: COLORS.BLUE,    apiModule: "placa_sesp"       },
  ard:        { label: "ARD Veicular",             emoji: "📄", category: "Veículos",    paramName: "placa",     paramDesc: "Placa do veículo (ex: ABC1234)",                color: COLORS.BLUE,    apiModule: "ard"              },
  infracao:   { label: "Infrações de Trânsito",    emoji: "🚦", category: "Veículos",    paramName: "placa",     paramDesc: "Placa do veículo (ex: ABC1234)",                color: COLORS.ORANGE,  apiModule: "infracao"         },

  // ── Financeiro ────────────────────────────────────────────────────────────
  bancos:     { label: "Dados Bancários",          emoji: "🏦", category: "Financeiro",  paramName: "cpf",       paramDesc: "CPF (apenas números)",                         color: COLORS.GOLD,    apiModule: "busca_bancos"     },
  score:      { label: "Score de Crédito",         emoji: "📊", category: "Financeiro",  paramName: "cpf",       paramDesc: "CPF (apenas números)",                         color: COLORS.GOLD,    apiModule: "score"            },

  // ── Jurídico ──────────────────────────────────────────────────────────────
  processos:  { label: "Processos Judiciais",      emoji: "⚖️", category: "Jurídico",    paramName: "documento", paramDesc: "CPF ou CNPJ (apenas números)",                  color: COLORS.CRIMSON, apiModule: "processos"        },
  processo:   { label: "Consulta por Nº Processo", emoji: "📁", category: "Jurídico",    paramName: "numero",    paramDesc: "Número completo do processo judicial",          color: COLORS.CRIMSON, apiModule: "numero_processo"  },
  oab:        { label: "OAB",                      emoji: "⚖️", category: "Jurídico",    paramName: "numero",    paramDesc: "Número de inscrição OAB",                       color: COLORS.CRIMSON, apiModule: "oab"              },
};

// ── API caller ──────────────────────────────────────────────────────────────

export async function callDarkflow(apiModule: string, consulta: string): Promise<unknown> {
  if (!DARKFLOW_TOKEN) throw new Error("DARKFLOW_TOKEN não configurado.");
  const url = new URL(DARKFLOW_BASE);
  url.searchParams.set("token",    DARKFLOW_TOKEN);
  url.searchParams.set("modulo",   apiModule);
  url.searchParams.set("consulta", consulta);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(25_000) });

  // Sempre tenta ler o body JSON, mesmo em respostas 4xx/5xx —
  // a API retorna { error: "CPF invalido" } com HTTP 400, por exemplo.
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status} — ${res.statusText} (body não é JSON)`);
  }

  // Repassa o body para o caller tratar; a checagem de hasError cobre os 4xx/5xx
  return body;
}

// ── Formatters ──────────────────────────────────────────────────────────────

const DIV = "═".repeat(42);
const SEP = "─".repeat(42);

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
        out.push(...renderValue(item, depth + 1));
        out.push(`${pad}└${"─".repeat(22)}`);
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

export function buildDarkflowFile(sub: string, consulta: string, data: unknown): string {
  const cfg = DARKFLOW_MODULES[sub];
  const now  = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const lines: string[] = [
    DIV,
    `  👁️  REDE DE INTELIGÊNCIA DE ZERO`,
    `  ${cfg?.emoji ?? "🔍"}  ${(cfg?.label ?? sub).toUpperCase()}`,
    DIV,
    `  Módulo    : ${cfg?.apiModule ?? sub}`,
    `  Consulta  : ${consulta}`,
    `  Data/Hora : ${now}`,
    SEP,
    "",
  ];

  if (Array.isArray(data)) {
    lines.push(`  Total de resultados: ${data.length}`);
    lines.push("");
    data.forEach((item, i) => {
      lines.push(`  ┌── Resultado ${i + 1} ${"─".repeat(24)}`);
      renderValue(item, 1).forEach(l => lines.push(l));
      lines.push(`  └${"─".repeat(30)}`);
      lines.push("");
    });
  } else {
    renderValue(data).forEach(l => lines.push(`  ${l}`));
    lines.push("");
  }

  lines.push(DIV);
  lines.push(`  ${AUTHOR}`);
  lines.push(DIV);
  return lines.join("\n");
}

// ── Embed field extractor ────────────────────────────────────────────────────

const PRIORITY_KEYS = [
  "nome","name","NOME",
  "cpf","CPF",
  "rg","RG",
  "data_nascimento","nascimento","NASCIMENTO","DATA_NASCIMENTO",
  "telefone","TELEFONE","celular","CELULAR",
  "email","EMAIL",
  "situacao","SITUACAO","status","STATUS",
  "score","SCORE",
  "categoria","CATEGORIA",
  "validade","VALIDADE",
  "proprietario","PROPRIETARIO",
  "marca","MARCA","modelo","MODELO",
  "ano","ANO","cor","COR",
  "municipio","MUNICIPIO","cidade","CIDADE","uf","UF",
  "renavam","RENAVAM","chassi","CHASSI","placa","PLACA",
  "endereco","ENDERECO","numero","NUMERO",
];

type EmbedField = { name: string; value: string; inline: boolean };

function extractFromObject(obj: Record<string, unknown>, limit: number): EmbedField[] {
  const fields: EmbedField[] = [];
  const added = new Set<string>();

  const addField = (k: string, v: unknown) => {
    if (fields.length >= limit) return;
    if (typeof v === "object" || v === null || v === undefined || v === "") return;
    fields.push({ name: k.replace(/_/g, " ").toUpperCase(), value: `\`${String(v).slice(0, 60)}\``, inline: true });
    added.add(k);
  };

  for (const key of PRIORITY_KEYS) {
    if (obj[key] !== undefined) addField(key, obj[key]);
    if (fields.length >= limit) break;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (added.has(k)) continue;
    if (fields.length >= limit) break;
    addField(k, v);
  }
  return fields;
}

/**
 * Muitas APIs retornam { status, meta, dados: {...} } ou { data: [...] }.
 * Esta função desempacota o wrapper e extrai os campos de dentro.
 */
function unwrapData(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;

  // Wrapper comum: { dados: {...} } ou { data: {...} } ou { result: {...} } ou { resultado: {...} }
  for (const key of ["dados", "data", "result", "resultado", "retorno", "response"]) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return raw;
}

export function extractEmbedFields(data: unknown, limit = 8): EmbedField[] {
  if (!data) return [];

  const unwrapped = unwrapData(data);

  if (Array.isArray(unwrapped)) {
    if (unwrapped.length === 0) return [];
    const first = unwrapped[0] as Record<string, unknown>;
    const fields = typeof first === "object" && first !== null
      ? extractFromObject(first, limit - 1)
      : [];
    if (unwrapped.length > 1) fields.push({ name: "📦 Total", value: `\`${unwrapped.length} registros\``, inline: true });
    return fields;
  }

  if (typeof unwrapped === "object" && unwrapped !== null) {
    return extractFromObject(unwrapped as Record<string, unknown>, limit);
  }

  return [{ name: "Resultado", value: `\`${String(unwrapped)}\``, inline: false }];
}

// ── Discord handler ──────────────────────────────────────────────────────────

export async function handleZeroIntel(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const cfg = DARKFLOW_MODULES[sub];

  if (!cfg) {
    await interaction.reply({ content: "❌ Módulo inválido.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const consulta = interaction.options.getString(cfg.paramName, true).trim();

  // ── Chamada à API ────────────────────────────────────────────────────────
  let data: unknown;
  try {
    data = await callDarkflow(cfg.apiModule, consulta);
  } catch (err) {
    const errEmbed = new EmbedBuilder()
      .setColor(COLORS.RED)
      .setTitle("❌ ERRO NA CONSULTA")
      .setDescription(`\`\`\`${String(err)}\`\`\``)
      .addFields(
        { name: "🔍 Tipo",     value: `\`${sub}\``,      inline: true },
        { name: "📡 Módulo",   value: `\`${cfg.apiModule}\``, inline: true },
        { name: "🎯 Consulta", value: `\`${consulta}\``, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: LELOUCH_FOOTER });
    await interaction.editReply({ embeds: [errEmbed] });
    return;
  }

  // ── Erro retornado pela API ───────────────────────────────────────────────
  const d = data as Record<string, unknown>;
  const hasError = d?.status === false || d?.status === "error" || d?.error || d?.erro;
  if (hasError) {
    const msg = String(d?.message ?? d?.error ?? d?.erro ?? "Sem resultado para a consulta.");
    const errEmbed = new EmbedBuilder()
      .setColor(COLORS.ORANGE)
      .setTitle(`${cfg.emoji}  SEM RESULTADO`)
      .setDescription(`**Tipo:** \`${cfg.label}\`\n**Consulta:** \`${consulta}\`\n\n> ${msg}`)
      .setTimestamp()
      .setFooter({ text: LELOUCH_FOOTER });
    await interaction.editReply({ embeds: [errEmbed] });
    return;
  }

  // ── Campos de preview no embed ───────────────────────────────────────────
  const previewFields  = extractEmbedFields(data, 8);
  const totalResults   = Array.isArray(data) ? data.length : null;

  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${cfg.emoji}  ${cfg.label.toUpperCase()}`)
    .setDescription(
      [
        `**🎯 Consulta:** \`${consulta}\``,
        totalResults !== null ? `**📦 Resultados:** \`${totalResults}\`` : "",
        "",
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📎 Resultado completo em anexo (.txt)`,
      ].filter(Boolean).join("\n"),
    )
    .setTimestamp()
    .setFooter({ text: `${LELOUCH_FOOTER}  •  ${cfg.category}` });

  if (previewFields.length > 0) embed.addFields(previewFields);

  // ── Arquivo .txt em anexo ────────────────────────────────────────────────
  const fileContent = buildDarkflowFile(sub, consulta, data);
  const safeName    = consulta.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
  const attachment  = new AttachmentBuilder(
    Buffer.from(fileContent, "utf-8"),
    { name: `lelouch_${sub}_${safeName}.txt` },
  );

  await interaction.editReply({ embeds: [embed], files: [attachment] });
}
