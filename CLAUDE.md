# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Overview

This is the **NassaAPI platform monorepo** — an AI API resale business providing unified access to 40+ AI models (OpenAI, Claude, Gemini, DeepSeek, etc.) through a gateway at `api.nassaapi.xyz`. The platform spans API gateway, card-based activation, landing pages, admin tools, and health monitoring.

## Project Map

| Directory | Role | Stack | Port |
|---|---|---|---|
| `new-api-fork/` | AI API gateway (fork of Calcium-Ion/new-api) | Go + Gin + GORM + React 19 | 3000 |
| `nassa-cards/` | Card activation system (kami) | Next.js 14 + SQLite | 3100 |
| `nassaapi-frontend/` | Public marketing landing page + admin redeem tool | Next.js 14 + SQLite | 3000 |
| `ccx/` | Multi-provider proxy (Claude/Codex/Gemini/Images) | Go + Vue 3 + Vuetify | 3000 |
| `model-health-check/` | Model availability monitoring dashboard | Next.js 14 | 3030 |
| `openclaw-admin/` | OpenClaw provider/model config manager | Next.js 14 | — |
| `status-page/` | Public status page | Next.js | — |
| `upgrade-api/` | Payment/upgrade handling | Python FastAPI | — |
| `minimax-vision-bridge/` | MiniMax vision API bridge | Python Flask | — |
| `deepseek-gpt-bridge/` | DeepSeek → GPT format conversion | Python Flask | — |
| `chatgpt2cpa/` | ChatGPT → CPA conversion tool | Python | — |
| `minimax-token-monitor/` | MiniMax token usage monitor | Python | — |
| `codex-provider-sync/` | Codex provider sync | — | — |
| `nassa-error-log-viewer/` | Error log viewer | — | — |
| `vip-onekey/` | VIP one-key activation | — | — |
| `xianyu-auto-reply-fix/` | Xianyu auto-reply (闲鱼自动回复) | — | — |
| `tosell/` | Tosell platform deployment variant | — | — |

Each major subproject has its own `CLAUDE.md` with detailed architecture and commands. The table above tells you where to look.

## Domain & Routing Architecture

```
nassaapi.xyz         → nassaapi-frontend (marketing landing page)
api.nassaapi.xyz     → new-api-fork (AI API gateway, port 3000)
kami.nassaapi.xyz    → nassa-cards (card activation, port 3100)
```

The gateway (`new-api-fork`) is the central service. `nassa-cards` creates temporary API tokens in the gateway's database. `nassaapi-frontend` links users to the gateway's register/login pages.

## How the Card System Works (cross-project)

1. Admin generates cards in `nassa-cards` admin panel
2. Customer redeems card → `nassa-cards` calls `new-api-fork` HTTP API to create a time-limited `sk-xxx` token
3. Customer uses `sk-xxx` against `api.nassaapi.xyz/v1/*` → `new-api-fork` validates and proxies to upstream AI providers
4. Optional: `nassa-cards` also proxies `/v1/[...path]` directly (with rate limiting, think-stripping, audit logging)

## Key Integration Points

- **nassa-cards → new-api-fork**: Uses `NEWAPI_ACCESS_TOKEN` + `NEWAPI_USER_ID` env vars to call the NewAPI management API for token CRUD. Can also use direct MySQL access via `NEWAPI_SQL_DSN`.
- **nassaapi-frontend → new-api-fork**: Links users to the gateway. The `/admin/redeem` tool calls NewAPI's admin API to create redemption codes.
- **openclaw-admin**: Reads/writes OpenClaw's config file (`/root/.openclaw/openclaw.json`), which configures how OpenClaw routes to the gateway.

## Development Environment

### Prerequisites
- Go 1.22+ (for `new-api-fork`, `ccx`)
- Node.js 18+ with Bun (preferred package manager for frontend projects)
- Python 3.10+ (for bridge services)
- Docker + Docker Compose (for production-like setups)

### Common Workflows

**Work on the API gateway:**
```bash
cd new-api-fork
# See new-api-fork/CLAUDE.md for full commands
make dev            # Start backend + frontend dev servers
```

**Work on the card system:**
```bash
cd nassa-cards
npm run dev         # Starts on port 3100
npm test            # Run vitest
```

**Work on the landing page:**
```bash
cd nassaapi-frontend
npm run dev         # Starts on port 3000
```

**Work on the CCX proxy:**
```bash
cd ccx
make dev            # Start frontend + backend with hot reload
```

### Deployment Context

The production environment runs on VPS servers. The gateway (`new-api-fork`) is Docker-deployed. Frontend projects are deployed via PM2 or Cloudflare Pages. See individual project READMEs for deployment instructions.

### Git Workflow

The default branch is `main`. The project uses conventional commits (`feat:`, `fix:`, `refactor:`, etc.). See `~/.claude/rules/common/git-workflow.md` for the full commit format.

## Subproject CLAUDE.md Index

When working in a specific subproject, read its CLAUDE.md first:
- `new-api-fork/CLAUDE.md` — API gateway architecture, Go rules, DB compatibility rules, billing expression system
- `nassa-cards/CLAUDE.md` — Card system data flow, response pipeline, card states, NewAPI integration modes
- `ccx/CLAUDE.md` — CCX architecture, provider/converter patterns, API routes, configuration
- `new-api-fork/AGENTS.md` — Same content as new-api-fork/CLAUDE.md (agent-specific copy)
