// PM2 Ecosystem — Lelouch Britannia Panel
// Uso: pm2 start pm2.config.cjs
//      pm2 save
//      pm2 startup

const BASE = __dirname;

module.exports = {
  apps: [
    {
      name: "api-server",
      cwd: `${BASE}/artifacts/api-server`,
      script: "node",
      args: "--max-old-space-size=512 --max-http-header-size=16384 ./dist/index.mjs",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        PORT: "8080",
      },
      watch: false,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "5s",
      restart_delay: 2000,
      out_file: `${BASE}/logs/api-server.log`,
      error_file: `${BASE}/logs/api-server.error.log`,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: "telegram-bot",
      cwd: `${BASE}/artifacts/telegram-bot`,
      script: "node",
      args: "--max-old-space-size=256 ./dist/index.mjs",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
      },
      watch: false,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "5s",
      restart_delay: 3000,
      out_file: `${BASE}/logs/telegram-bot.log`,
      error_file: `${BASE}/logs/telegram-bot.error.log`,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: "discord-bot",
      cwd: `${BASE}/artifacts/discord-bot`,
      script: "node",
      args: "--max-old-space-size=512 ./dist/index.mjs",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
      },
      watch: false,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "5s",
      restart_delay: 3000,
      out_file: `${BASE}/logs/discord-bot.log`,
      error_file: `${BASE}/logs/discord-bot.error.log`,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: "panel",
      cwd: `${BASE}/artifacts/mikubeam-panel`,
      script: "npx",
      args: "serve -s dist/public -l 22453",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      out_file: `${BASE}/logs/panel.log`,
      error_file: `${BASE}/logs/panel.error.log`,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
