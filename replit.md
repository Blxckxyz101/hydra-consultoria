# Workspace

## Overview

This project is a pnpm workspace monorepo utilizing TypeScript, designed to provide a comprehensive suite of network testing, credential checking, and reconnaissance tools. The core purpose is to offer advanced capabilities for load testing, network stress, and security analysis, themed around "Lelouch vi Britannia" from Code Geass.

Key capabilities include:
- **Lelouch Britannia Panel**: A web-based control panel for initiating and monitoring network attacks, themed with dark imperial aesthetics, gold/crimson accents, and a responsive design. It offers 47 different attack vectors, including advanced HTTP/2, TLS, and UDP floods, with sophisticated bypass techniques for WAFs and CDNs.
- **Telegram Bot**: Integrates with Telegram for launching and monitoring attacks, managing checkers, and accessing statistics.
- **Discord Bot**: Provides extensive slash commands for managing attacks, analyzing targets, and utilizing darkflow APIs, with live monitoring and a health-check system.
- **Credential Checkers**: A robust system for checking various online service credentials (Spotify, Receita Federal, Roblox, Epic Games, Steam, PlayStation, PayPal, etc.) with adaptive concurrency, 2FA detection, and anti-false-positive measures.
- **DNS Recon Tool**: A comprehensive tool for performing DNS intelligence sweeps, including record lookups, AXFR zone transfer attempts, wildcard detection, subdomain enumeration, and CDN/provider fingerprinting.
- **WhatsApp Report & SMS Code Blast**: Tools for sending abuse reports to WhatsApp and triggering OTP codes across multiple services.
- **Advanced Network Exploitation**: Features like IPv6 dual-stack support, H3/QUIC version negotiation attacks, JA3/JA4 browser fingerprint diversity, and dynamic origin IP pivoting to bypass CDN protections.

The project aims to be a powerful and visually distinctive platform for offensive security research and network performance analysis.

## User Preferences

I prefer iterative development with detailed explanations of changes. I like functional programming paradigms where applicable. Ask before making major architectural changes.

## System Architecture

The project is structured as a pnpm workspace monorepo.

**UI/UX Decisions:**
- **Lelouch Britannia Panel**: Features a dark imperial background, gold/crimson accents, and the Cinzel display font. It's a single-page design with a centered card, character GIF, target input, attack controls, statistics, and a terminal output. The design is fully responsive, optimized for mobile devices with safe-area insets and touch-friendly sizing.
- **Telegram Bot Theme**: "Lelouch Britannia / GEASS COMMAND CENTER" with a single message interface using inline keyboards to avoid message flooding. Live progress updates within the same message.
- **Discord Bot Theme**: Crimson/gold for embeds and progress bars.
- **Mini-App Telegram**: `public/miniapp.html` uses a Lelouch theme (dark purple/red/gold).
- **Assets**: `lelouch.png`, `lelouch-eyes.jpg`, `geass.jpg` in the `public/` folder.

**Technical Implementations & Design Choices:**
- **Monorepo Tool**: pnpm workspaces for managing packages.
- **Node.js**: Version 24.
- **TypeScript**: Version 5.9 for strong typing across the codebase.
- **API Framework**: Express 5 for backend API services.
- **Database**: PostgreSQL with Drizzle ORM for data persistence.
- **Validation**: Zod (`zod/v4`) and `drizzle-zod` for schema validation.
- **API Codegen**: Orval for generating API hooks and Zod schemas from OpenAPI specifications.
- **Build Tool**: esbuild for CJS bundles.
- **Attack Workers**: Utilizes `worker_threads` for real network I/O (dgram UDP, net TCP, fetch HTTP) to execute attack vectors.
- **Proxy System**: Supports HTTP and SOCKS5 proxies from multiple public sources, with real-time testing, caching, and intelligent routing based on proxy type. Incorporates residential proxy configurations for deploy-safe operations.
- **Credential Checker Architecture**: Employs an `AdaptiveSem` class for adaptive concurrency with rate-limit detection and exponential backoff. Supports cluster-based checking and deduplication of results. Includes a `detect2FA` helper for identifying two-factor authentication requirements across various services.
- **Attack Vector Design**:
    - **Geass Override ARES OMNIVECT ∞**: A composite attack featuring 33 simultaneous vectors in 6 layers (L7 App, L7 H2, TLS, Extended App, L4, L3, UDP) with a Smart Adaptive Burst Mode.
    - **Chrome TLS Fingerprinting**: Simulates Chrome 130-135 TLS profiles and HTTP/2 settings for WAF/CDN bypass.
    - **HTTP Bypass (3-layer)**: Combines fetch with Chrome headers and proxy rotation, raw HTTP/1.1 high-concurrency, and slow-drain incomplete requests.
    - **WAF Bypass (`waf-bypass`)**: A 4-layer Cloudflare/Akamai evasion technique involving JA3 TLS fingerprint randomization, Chrome-exact HTTP/2 settings, header ordering, and realistic cookie simulation.
    - **Origin IP Pivot**: Automatically discovers origin IPs behind CDNs and launches direct attacks, leveraging techniques like subdomain enumeration, IPv6 AAAA records, SPF/TXT entries, MX records, and SSL certificate history.
    - **DNS Water Torture v2**: Enhanced with EDNS(0) OPT records, targeting all IPs per NS server, 43-character random labels, 12 query types (including NSEC, NSEC3, CAA, RRSIG), and CHAOS class queries for increased server load.
    - **IPv6 Dual-Stack**: Alternates between `udp4` and `udp6` sockets for UDP, QUIC, and H3 attacks, exploiting separate CDN rate-limit pools.
    - **H3/QUIC Version Negotiation**: Implements a 4-phase QUIC packet cycle to force RFC-9000-compliant stacks to perform computationally intensive version negotiation.
    - **JA3/JA4 Browser Diversity**: Dynamically randomizes browser fingerprints (Chrome, Safari, Firefox) for HTTP requests and TLS ciphers to evade detection.
- **Monitoring**: Live probe system for real-time target status, HTTP response codes, and latency tracking.
- **Concurrency Management**: Critical UDP architecture uses a single worker with sequentially started sockets to avoid deadlocks, achieving high packet rates.
- **API Endpoints**: Comprehensive set of RESTful APIs for managing attacks, checkers, proxies, DNS reconnaissance, and WhatsApp functionalities.
- **Error Handling**: Improved worker error logging and robust handling of network disconnections and proxy issues.

## External Dependencies

- **pnpm**: Monorepo management.
- **Node.js**: Runtime environment.
- **TypeScript**: Programming language.
- **Express**: Web application framework.
- **PostgreSQL**: Relational database.
- **Drizzle ORM**: Object-relational mapper for PostgreSQL.
- **Zod**: TypeScript-first schema declaration and validation library.
- **Orval**: OpenAPI to TypeScript client generator.
- **esbuild**: Bundler for JavaScript and TypeScript.
- **Telegraf**: Framework for Telegram bots.
- **discord.js**: Library for Discord bots.
- **Groq API**: For AI tool calling functionalities.
- **cURL**: Used for residential proxy probing.
- **Cloudflare**: (Implicit, as a target for bypass techniques).
- **Akamai**: (Implicit, as a target for bypass techniques).
- **darkflowapis.space**: External API for various data lookups (used by Discord bot).
- **skynetchat.net**: External chat service (used by Discord bot for account pools).
- **ProxyScrape, TheSpeedX, clarketm, monosans, hideip.me**: Public proxy sources.
- **ViewDNS.info**: Used for historical IP lookup.
- **iFood, Rappi, PicPay, MercadoLivre, Shopee, TikTok, Nubank, ZeDelivery, Amazon**: Services for OTP code blasting.
- **WhatsApp**: Target for abuse reporting functionality.
- **Geass API** (`http://149.56.18.68:25584/api/consulta/<TIPO>`): OSINT provider with 24 tipos (cpf, nome, placa, chassi, telefone, pix, nis, cns, mae, pai, parentes, cep, frota, cnpj, fucionarios, score, email, rg, ip, titulo, endereco, irpf, obito, cheque). Key: `GeassZero` (env: `GEASS_API_KEY`).

## Infinity Search (artifacts/infinity-search)

- Sky/cyan branding, pt-BR UI, glass card design
- 24 OSINT consulta tipos organized in category pills: Pessoa / Veículo / Empresa / Saúde / Outros
- Generic backend proxy at `/api/infinity/consultas/:tipo` — parses the U+23AF-delimited provider text into structured fields + sections
- Parser: split-based on ` ⎯ ` (U+23AF), supports multi-word known keys (NOME MÃE, NOME PAI, MUNICÍPIO DE NASCIMENTO, ESTADO CIVIL, STATUS NA RECEITA, TITULO ELEITOR, CLASSE SOCIAL, etc.), detects bullet-list sections
- API key fix: uses `GEASS_API_KEY ?? "GeassZero"` (NOT DARKFLOW_TOKEN — that var holds a different credential)
- Pages: Login, Overview, Consultas (24 tipos), Dossiê (forensic evidence, localStorage), Configurações
- ResultViewer: headline cards, fields grid, section lists, raw toggle, export .txt, copy all, SaveToDossieButton
- Dossiê: localStorage-backed, multi-dossie, per-evidence notes, search, export .txt

## Lelouch Britannia Panel (artifacts/mikubeam-panel)

- Wallboard tab: Grafana-style metrics (attack stats), Infinity API `/api/infinity/overview` auto-refresh 15s
- Geass Voice Mode: speechSynthesis pt-BR, 12s interval, dramatic Code Geass lines
- Admin: admin/admin123

## Key env vars / secrets

- `GEASS_API_KEY` — Geass OSINT provider key (default: "GeassZero")
- `DARKFLOW_TOKEN` — different credential, do NOT use for Geass API
- `SKYNETCHAT_COOKIE` — SkyNetChat pool auth
- `WEBSHARE_PROXY_PASS` — residential proxy password