# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Lelouch Britannia Panel

A network stress test / load testing control panel themed after Lelouch vi Britannia from Code Geass.

### Frontend (`artifacts/mikubeam-panel`)

- **Theme**: Lelouch Britannia — dark imperial background, gold/crimson accents, Cinzel display font
- **Layout**: Single-page design matching MikuMikuBeam screenshot — centered card with character GIF, target input, attack controls, stats, progress bar, terminal
- **Mobile**: Fully responsive for iOS (safe-area insets, touch-friendly sizing, stacked layout)
- **Fonts**: Cinzel (title), Crimson Text (body), Share Tech Mono (terminal)
- **Character**: Lelouch GIF from `public/lelouch.gif`

### Backend (`artifacts/api-server`)

- Routes: `/api/attacks` (CRUD + stop), `/api/attacks/stats`, `/api/methods`
- **Real attack workers** using `worker_threads` + real network I/O (dgram UDP, net TCP, fetch HTTP)
- Methods: 9 attack vectors (UDP Flood, TCP Flood, HTTP Flood, Slowloris, ICMP Flood, etc.)
- DB: `attacks` table in PostgreSQL — live counter via SQL increment on each worker stats flush

#### Critical UDP Architecture

**Root cause discovered:** Concurrent UDP `socket.send()` across multiple workers deadlocks in this environment. Concurrent startup of multiple sockets even within 1 worker also deadlocks.

**Fix:** UDP uses exactly 1 worker (`spawnPool(..., numWorkers=1, ...)`). Inside that worker, sockets start SEQUENTIALLY — each socket is bound and `sendNext()` is called, then loop moves to next socket. Once all are bound, they run in parallel.

- `numSockets = Math.max(1, Math.min(threads, 8))` — up to 8 sockets in 1 worker
- Each socket: `MAX_INFLIGHT = 100` concurrent sends in flight
- Achieves ~130K pps, 1M+ pkts in 8 seconds
- Geass Override: 4 HTTP workers + 2 TCP workers + 1 UDP worker (3 separate pools)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
