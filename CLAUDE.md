# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

卡密激活系统 — customers input activation cards to obtain temporary NewAPI `sk-xxx` keys for accessing AI models (DeepSeek, GPT, Claude). Built with Next.js 14 App Router + TypeScript + SQLite.

## Commands

```bash
npm run dev          # Start dev server on port 3100
npm run build        # Production build
npm run start        # Production start on port 3100
npm run gen-cards    # Generate cards via CLI (tsx scripts/gen-cards.ts)
npm test             # Run vitest (2 test files currently)
npm run test:watch   # Run vitest in watch mode
```

## Architecture

### Data flow (core loop)

```
Customer inputs card code
  → POST /api/redeem
  → validate → claimCard (unused → activating, atomic SQLite UPDATE)
  → NewAPI HTTP API: create token + get sk-key
  → activateCard (activating → activated)
  → Return { api_key, base_url, expires_at }

Customer uses the key
  → /v1/[...path] (OpenAI-compatible proxy)
  → auth by sk-key → look up card in SQLite
  → RPH rate limit (hourly fixed window, reserved in transaction before forwarding)
  → proxy to NewAPI upstream (127.0.0.1:3000 or NEWAPI_INTERNAL_URL)
  → response pipeline: audit accumulator → think stripper → model rewriter → heartbeat → resilient body
```

### Database

Single SQLite file at `data/cards.db` (WAL mode). Tables: `cards`, `request_logs`, `admin_sessions`, `rate_limit`, `renewals`, `video_tasks`. Schema migrations are inline in `lib/db.ts` `init()` via `ALTER TABLE` + `PRAGMA table_info` checks.

A separate `data/audit.db` stores conversation logs for audit purposes (controlled by `AUDIT_ENABLED` env).

### Key files

| File | Role |
|---|---|
| `lib/db.ts` | SQLite schema, card CRUD, rate limiting, request logging, renewals |
| `lib/newapi.ts` | NewAPI HTTP API client (create token, search, get key, update expiry/quota) |
| `lib/newapi-db.ts` | Direct MySQL access to NewAPI's database (when `NEWAPI_SQL_DSN` is set) |
| `lib/categories.ts` | Card categories (deepseek/gpt/claude) with models, prefixes, RPH defaults |
| `lib/plans.ts` | Plan definitions (0.5d, 1d, 7d, 30d, 30d-unlimited) |
| `lib/codes.ts` | Card code generation and format validation |
| `lib/auth.ts` | Admin session management (SQLite-backed cookies, timing-safe password check) |
| `lib/audit.ts` | Conversation audit logging (+ jailbreak keyword detection) |
| `lib/strip-think.ts` | Stream transformer that strips `<think>...</think>` from model responses |
| `lib/normalize-messages.ts` | Merges multiple `system` messages into one (prevents MiniMax 2013 errors) |
| `lib/cleanup-bootstrap.ts` | Background cron (every 6h): marks expired cards, prunes old logs |
| `lib/minimax-video.ts` | MiniMax video generation API client |
| `app/v1/[...path]/route.ts` | The OpenAI-compatible proxy — auth, rate limit, forward, transform |
| `app/api/redeem/route.ts` | Card redemption endpoint |
| `app/api/admin/cards/route.ts` | Admin card CRUD (generate, list, filter) |

### Card states

`unused` → (claim) → `activating` → (NewAPI success) → `activated` → (expiry) → `expired`
Any state can go to `disabled` via admin action. Stale `activating` claims (60s) are auto-recycled to `unused`.

### Response pipeline order (in /v1 proxy)

1. **Audit accumulator** — captures content before any stripping, for complete audit trail
2. **Think stripper** — removes `<think>...</think>` blocks from content (MiniMax models embed CoT inline)
3. **Model rewriter** — replaces upstream model name in JSON responses with the model the client requested
4. **SSE heartbeat** — injects SSE comments every 25s to prevent Cloudflare 524 timeouts during long reasoning
5. **Resilient body** — catches upstream stream errors and converts to clean SSE error + [DONE] instead of crashing

### NewAPI integration modes

- **HTTP API** (default): uses `NEWAPI_ACCESS_TOKEN` + `NEWAPI_USER_ID` to call NewAPI's management API
- **Direct DB** (optional): when `NEWAPI_SQL_DSN` is set, token operations go directly to NewAPI's MySQL `tokens` table. This is used when the token's `user_id` needs to be migrated to a customer account.

## Environment variables

See `.env.local.example` for all vars. Critical ones:
- `NEWAPI_BASE_URL`, `NEWAPI_ACCESS_TOKEN`, `NEWAPI_USER_ID` — NewAPI backend connection
- `NEWAPI_SQL_DSN` — optional direct MySQL access to NewAPI DB
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` — admin panel auth
- `PUBLIC_API_BASE`, `PUBLIC_API_BASE_ROOT` — customer-facing base URLs
- `AUDIT_ENABLED=false` — disable audit logging (used when audit.db grows too large)
- `COOKIE_SECURE=true` — force secure cookies (enable behind HTTPS/Cloudflare)

## Tests

Vitest with 2 test files: `lib/normalize-messages.test.ts` and `lib/strip-think.test.ts`. Pure logic tests, no database mocking infrastructure.
