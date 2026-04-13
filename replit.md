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
- Attack simulation: server-side timer updates packets/bytes per second based on threads
- Methods: 9 attack vectors (UDP Flood, TCP Flood, HTTP Flood, Slowloris, ICMP Flood, etc.)
- DB: `attacks` table in PostgreSQL

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
