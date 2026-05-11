const SALES_CHANNEL_ID = "-5233651097";

function getBotToken(): string {
  return process.env.INFINITY_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN ?? "";
}

function maskUsername(username: string): string {
  const s = username.trim();
  if (s.length <= 6) {
    return s.slice(0, 2) + "****" + s.slice(-2);
  }
  if (s.length <= 9) {
    return s.slice(0, 3) + "****" + s.slice(-3);
  }
  return s.slice(0, 5) + "****" + s.slice(-4);
}

function fmtDateBR(d: Date): string {
  try {
    return (
      d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) +
      " às " +
      d.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "America/Sao_Paulo",
      })
    );
  } catch {
    return d.toISOString();
  }
}

async function sendToChannel(text: string): Promise<void> {
  const token = getBotToken();
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: SALES_CHANNEL_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // non-critical — never throw
  }
}

export interface SaleNotifParams {
  username: string;
  planLabel: string;
  amountCents: number;
  expiresAt: Date;
  isRenewal?: boolean;
}

export async function sendSaleNotification(params: SaleNotifParams): Promise<void> {
  const { username, planLabel, amountCents, expiresAt, isRenewal } = params;
  const maskedId = maskUsername(username);
  const valor = "R$ " + (amountCents / 100).toFixed(2).replace(".", ",");
  const validade = fmtDateBR(expiresAt);

  const divider = "━━━━━━━━━━━━━━━━━━━━━";

  let text: string;

  if (isRenewal) {
    text = [
      divider,
      `⚡ <b>RENOVAÇÃO CONFIRMADA</b>`,
      `<b>⚔ Hydra Consultoria</b>`,
      divider,
      ``,
      `🪪 <b>ID ·········</b> <code>${maskedId}</code>`,
      `💳 <b>Valor ······</b> <b>${valor}</b>`,
      `📦 <b>Plano ······</b> <b>${planLabel}</b>`,
      `⏳ <b>Válido até ·</b> <code>${validade}</code>`,
      ``,
      `<blockquote>Renovação processada com sucesso. Continue explorando sem limites. 🔁</blockquote>`,
    ].join("\n");
  } else {
    text = [
      divider,
      `🔓 <b>NOVO ACESSO VIP</b>`,
      `<b>⚔ Hydra Consultoria</b>`,
      divider,
      ``,
      `🪪 <b>ID ·········</b> <code>${maskedId}</code>`,
      `💳 <b>Valor ······</b> <b>${valor}</b>`,
      `📦 <b>Plano ······</b> <b>${planLabel}</b>`,
      `⏳ <b>Válido até ·</b> <code>${validade}</code>`,
      ``,
      `<blockquote>Acesso ao painel mais completo do Brasil. Bem-vindo ao time. 🇧🇷</blockquote>`,
    ].join("\n");
  }

  await sendToChannel(text);
}

const FAKE_NAMES = [
  "gabriel", "lucas", "matheus", "pedro", "thiago",
  "carlos", "rafael", "anderson", "rodrigo", "eduardo",
  "vinicius", "gustavo", "daniel", "henrique", "felipe",
  "joao", "marcos", "leandro", "diego", "bruno",
];
const FAKE_SUFFIXES = [
  "123", "007", "456", "_br", "pro", "top",
  "777", "42", "xD", "_21", "neo", "alfa",
  "beta", "_oficial", "dev", "_rj", "_sp",
];
const FAKE_PLANS = [
  { label: "1 Dia",   amountCents: 1500,  days: 1  },
  { label: "7 Dias",  amountCents: 4000,  days: 7  },
  { label: "14 Dias", amountCents: 7000,  days: 14 },
  { label: "30 Dias", amountCents: 10000, days: 30 },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export async function sendFakeSaleNotification(isRenewal = false): Promise<void> {
  const name     = pick(FAKE_NAMES);
  const suffix   = pick(FAKE_SUFFIXES);
  const num      = Math.floor(Math.random() * 900) + 100;
  const username = name + suffix + String(num);
  const plan     = pick(FAKE_PLANS);
  const expiresAt = new Date(Date.now() + plan.days * 86_400_000);

  await sendSaleNotification({
    username,
    planLabel: plan.label,
    amountCents: plan.amountCents,
    expiresAt,
    isRenewal,
  });
}
