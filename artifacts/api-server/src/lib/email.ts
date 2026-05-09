import nodemailer from "nodemailer";
import { logger } from "./logger.js";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user ?? "noreply@infinitysearch.pro";

  if (!host || !user || !pass) {
    return null;
  }

  return { transporter: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }), from };
}

export async function sendWelcomeEmail(opts: {
  to: string;
  username: string;
  planLabel: string;
  expiresAt: Date;
}): Promise<void> {
  const config = getTransporter();
  if (!config) {
    logger.warn("SMTP não configurado — e-mail de boas-vindas ignorado");
    return;
  }

  const { transporter, from } = config;
  const expires = opts.expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const panelUrl = process.env.PANEL_URL ?? "https://infinitysearch.pro";

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bem-vindo ao Infinity Search</title>
  <style>
    body { margin: 0; padding: 0; background: #06091a; font-family: 'Segoe UI', Arial, sans-serif; color: #e2e8f0; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #0d1326; border-radius: 20px; overflow: hidden; border: 1px solid rgba(99,210,255,0.15); }
    .header { background: linear-gradient(135deg, #0d1326, #0a1f3f); padding: 40px 36px 28px; text-align: center; border-bottom: 1px solid rgba(99,210,255,0.1); }
    .logo { font-size: 28px; font-weight: 900; letter-spacing: 0.4em; color: #63d2ff; margin-bottom: 6px; }
    .tagline { font-size: 11px; letter-spacing: 0.35em; text-transform: uppercase; color: rgba(99,210,255,0.55); }
    .body { padding: 36px; }
    h1 { font-size: 22px; font-weight: 700; color: #f8fafc; margin: 0 0 12px; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.7; margin: 0 0 16px; }
    .card { background: rgba(99,210,255,0.05); border: 1px solid rgba(99,210,255,0.15); border-radius: 12px; padding: 20px 24px; margin: 24px 0; }
    .card-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; }
    .card-row:last-child { border-bottom: none; }
    .card-label { color: #64748b; }
    .card-value { color: #f8fafc; font-weight: 600; }
    .btn { display: inline-block; background: linear-gradient(135deg, #63d2ff, #4ab8e8); color: #06091a; font-weight: 700; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; padding: 14px 36px; border-radius: 12px; text-decoration: none; margin-top: 8px; }
    .footer { padding: 20px 36px 28px; text-align: center; font-size: 11px; color: #334155; letter-spacing: 0.08em; border-top: 1px solid rgba(255,255,255,0.04); }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo">INFINITY</div>
      <div class="tagline">SEARCH · OSINT PLATFORM</div>
    </div>
    <div class="body">
      <h1>Bem-vindo, ${opts.username}!</h1>
      <p>Sua conta foi criada e o pagamento confirmado com sucesso. Você já pode acessar a plataforma.</p>
      <div class="card">
        <div class="card-row"><span class="card-label">Usuário</span><span class="card-value">${opts.username}</span></div>
        <div class="card-row"><span class="card-label">Plano</span><span class="card-value">${opts.planLabel}</span></div>
        <div class="card-row"><span class="card-label">Acesso válido até</span><span class="card-value">${expires}</span></div>
      </div>
      <p>Use o usuário e a senha que você cadastrou para entrar. Guarde essas informações.</p>
      <div style="text-align:center;margin-top:28px;">
        <a href="${panelUrl}" class="btn">Acessar o Painel →</a>
      </div>
    </div>
    <div class="footer">
      Infinity Search · ${new Date().getFullYear()} · Não compartilhe suas credenciais.
    </div>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"Infinity Search" <${from}>`,
      to: opts.to,
      subject: `✅ Conta criada — Infinity Search (${opts.planLabel})`,
      html,
    });
    logger.info({ username: opts.username }, "E-mail de boas-vindas enviado");
  } catch (err) {
    logger.error({ err, username: opts.username }, "Falha ao enviar e-mail de boas-vindas");
  }
}
