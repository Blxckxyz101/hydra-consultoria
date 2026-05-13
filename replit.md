# Hydra Consultoria

## Overview

pnpm workspace monorepo in TypeScript. The main product is **Hydra Consultoria** (`artifacts/infinity-search`, package `@workspace/hydra-consultoria`) — a Brazilian OSINT platform with sky/cyan branding, pt-BR UI, and a glass-card design. Supporting artifacts include an API server, Telegram bot, and Discord bot.

## User Preferences

Prefer iterative development with detailed explanations of changes. Functional programming paradigms where applicable. Ask before making major architectural changes.

## Artifacts

### Hydra Consultoria — `artifacts/infinity-search` (`@workspace/hydra-consultoria`)
- React + Vite frontend, sky/cyan branding, pt-BR, glass card design
- Auth: `localStorage("infinity_token")` / `Authorization: Bearer <token>`
- **Pages**: Login, Registro, Overview, Consultas (24 OSINT tipos), Dossiê, Histórico, Favoritos, Skylers, Bases, Comunidade, DM, Perfil, Perfil Público, Carteira, Planos, Configurações, Personalizar, Afiliados, Suporte, IA
- **Consultas**: 24 OSINT tipos via Hydra API + Skylers; categories: Pessoa / Veículo / Empresa / Saúde / Outros
- **Parser**: U+23AF-delimited provider text → structured fields + sections; multi-word keys (NOME MÃE, MUNICÍPIO DE NASCIMENTO, STATUS NA RECEITA, etc.)
- **Community**: real-time chat via WebSocket, emoji reactions, GIF picker (Tenor), image URL preview
- **DMs**: real-time direct messages per user pair, reactions, GIFs
- **Notifications**: personal bell (friend requests, DMs, reactions) with unread badge
- **Perfil**: card theme picker (9 themes, 3 free + 6 PRO), PRO plan purchase (R$2,99 from wallet)
- **ResultViewer**: headline cards, fields grid, section lists, raw toggle, export .txt, copy all, SaveToDossieButton
- **Dossiê**: localStorage-backed, multi-dossie, per-evidence notes, search, export .txt
- **Suporte**: Telegram channel `https://t.me/hydraconsultoria`

### API Server — `artifacts/api-server`
- Express 5 + WebSocket (`ws`) backend
- PostgreSQL + Drizzle ORM
- Routes: `/api/infinity/*` — auth, consultas, social (DMs, reactions, notifications), wallet, plan purchase, card themes, admin
- `globalThis.__notifyUser(userId, event)` — per-user WS push

### Telegram Bot — `artifacts/telegram-bot`
- Telegraf framework, pt-BR, "HYDRA COMMAND CENTER" theme
- Single-message interface with inline keyboards

### Discord Bot — `artifacts/discord-bot`
- discord.js, crimson/gold embeds
- Slash commands, live monitoring, health-check system

## System Architecture

- **Monorepo**: pnpm workspaces
- **Node.js**: v24, **TypeScript**: v5.9
- **API Framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (zod/v4) + drizzle-zod
- **Build**: esbuild (CJS bundles for server), Vite (client)
- **Real-time**: WebSocket (`ws`) for community chat, DMs, and notifications
- **AI**: Groq API for IA page tool-calling

## Key env vars / secrets

- `GEASS_API_KEY` — Hydra OSINT provider key (default: `"GeassZero"`)
- `DARKFLOW_TOKEN` — separate credential, NOT for Hydra API
- `SKYNETCHAT_COOKIE` — SkyNetChat pool auth
- `WEBSHARE_PROXY_PASS` — residential proxy password
- `NEDPAY_PRIVATE_KEY` — payment integration

## Segurança de credenciais

- **Nunca commite credenciais reais.** Use `.env.example` como referência; valores reais ficam no painel de secrets do Replit.
- `.gitignore` exclui `.env`, `.env.local`, `.env.production`, `.replit.env`, `secrets.*`, `*.pem`, `*.key`, etc.
- O diretório `.githooks/` contém um **pre-commit hook** que bloqueia commits com padrões de token (GitHub PAT, Telegram, AWS, Stripe, etc.).
- O hook é ativado automaticamente pelo `post-merge.sh` via `git config core.hooksPath .githooks`.
- Para ativar manualmente em um clone novo: `bash scripts/src/install-hooks.sh`

## GitHub

Repo: `https://github.com/Blxckxyz101/hydra-consultoria` (public)
Push: automated via `scripts/push-github.sh` — runs as the last step of `scripts/post-merge.sh` after every task merge.
- Uses `--force-with-lease=refs/heads/main:<remote-sha>` (safe, not bare `--force`)
- Fetches remote state first; aborts explicitly if fetch fails
- No-ops if already up to date or if `GH_TOKEN` is absent
- Push activity is logged in GitHub Actions (`.github/workflows/post-push.yml`)
Note: `GH_TOKEN` must be set via `setEnvVars` (not `setSecret` — token-detection blocks it).
