# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

卡密激活系统 — customers input activation cards to obtain temporary NewAPI `sk-xxx` keys for accessing AI models (DeepSeek, GPT, Codex). Also includes a MiniMax video generation workbench and an invite reward system. Built with Next.js 14 App Router + TypeScript + SQLite.

Production: `https://card.nassaapi.xyz` (port 3100, PM2 managed)

## Commands

```bash
npm run dev          # Start dev server on port 3100
npm run build        # Production build
npm run start        # Production start on port 3100
npm run gen-cards    # Generate cards via CLI (tsx scripts/gen-cards.ts)
npm test             # Run vitest (5 test files, 108+ tests)
npm run test:watch   # Run vitest in watch mode
```

Run a single test file:
```bash
npx vitest run lib/strip-think.test.ts
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
  → model access check (card category must include requested model)
  → RPH rate limit (hourly fixed window, reserved in transaction before forwarding)
  → daily/total cost cap (1d cards only, queries NewAPI logs table)
  → proxy to NewAPI upstream (127.0.0.1:3000 or NEWAPI_INTERNAL_URL)
  → response pipeline: audit accumulator → think stripper → model rewriter → heartbeat → resilient body
```

### Cost cap protection (1d cards only)

The `/v1` proxy enforces spending limits for 1-day cards to prevent abuse:
- **DeepSeek**: $500/day, resets at midnight Beijing time (Shanghai timezone)
- **Codex**: $350 total from activation
- **GPT**: $250 total from activation

Cap check uses `getTokenUsageQuotaSince()` in `lib/newapi-db.ts` which queries the NewAPI `logs` table SUM — independent of `tokens.remain_quota`. Quota rate: 1 USD = 500,000 quota units (`QUOTA_PER_USD` in `lib/newapi.ts`).

### Database

Single SQLite file at `data/cards.db` (WAL mode). Key tables: `cards`, `request_logs`, `admin_sessions`, `rate_limit`, `renewals`, `video_tasks`, `invite_links`, `invite_visits`, `invite_attributions`, `invite_redemptions`. Schema migrations are inline in `lib/db.ts` `init()` via `ALTER TABLE` + `PRAGMA table_info` checks.

A separate `data/audit.db` stores conversation logs for audit purposes (controlled by `AUDIT_ENABLED` env).

### Key files

| File | Role |
|---|---|
| `lib/db.ts` | SQLite schema, card CRUD, rate limiting, request logging, renewals |
| `lib/newapi.ts` | NewAPI HTTP API client (create token, search, get key, update expiry/quota) |
| `lib/newapi-db.ts` | Direct MySQL access to NewAPI's database (quota queries, token ops) |
| `lib/categories.ts` | Card categories (deepseek/gpt/Codex) with models, prefixes, RPH, baseUrlSuffix |
| `lib/plans.ts` | Plan definitions (0.5d, 1d, 7d, 30d, 30d-unlimited) + custom days support |
| `lib/codes.ts` | Card code generation and format validation |
| `lib/auth.ts` | Admin session management (SQLite-backed cookies, timing-safe password check) |
| `lib/audit.ts` | Conversation audit logging (+ jailbreak keyword detection) |
| `lib/strip-think.ts` | Stream transformer that strips `<think>...</think>` from model responses |
| `lib/normalize-messages.ts` | Merges multiple `system` messages into one (prevents MiniMax 2013 errors) |
| `lib/cleanup-bootstrap.ts` | Background cron (every 6h): marks expired cards, prunes old logs |
| `lib/minimax-video.ts` | MiniMax video generation API client |
| `lib/video-sync.ts` | Video task polling, download URL retrieval, invite reward settlement |
| `lib/video-quota.ts` | Per-card daily video generation quota enforcement |
| `lib/invite-reward.ts` | Invite link creation, visit tracking, attribution, reward settlement |
| `lib/risk-hash.ts` | HMAC-based IP/device hashing for anti-fraud (uses `RISK_HASH_SECRET`) |
| `lib/client-ip.ts` | Extract client IP from request headers (Cloudflare/X-Forwarded-For) |
| `app/v1/[...path]/route.ts` | The OpenAI-compatible proxy — auth, rate limit, cap, forward, transform |
| `app/api/redeem/route.ts` | Card redemption endpoint |
| `app/api/admin/cards/route.ts` | Admin card CRUD (generate, list, filter) |
| `app/api/admin/invites/route.ts` | Admin invite reward review (list pending) |
| `app/api/video/*/route.ts` | Video generation endpoints (create, status, quota) |
| `app/api/invite/*/route.ts` | Invite link + stats endpoints |

### Card states

`unused` → (claim) → `activating` → (NewAPI success) → `activated` → (expiry) → `expired`
Any state can go to `disabled` via admin action. Stale `activating` claims (60s) are auto-recycled to `unused`.

### Response pipeline order (in /v1 proxy)

1. **Audit accumulator** — captures content before any stripping, for complete audit trail
2. **Think stripper** — removes `<think>...</think>` blocks from content
3. **Model rewriter** — replaces upstream model name with the model the client requested
4. **SSE heartbeat** — injects SSE comments every 25s to prevent Cloudflare 524 timeouts
5. **Resilient body** — catches upstream stream errors and converts to clean SSE error + [DONE]

### Invite reward system

```
Inviter generates link → /api/invite/link (stores creator IP/device hash)
Invitee visits link → /invite/[code] page (creates invite_visit with token cookie)
Invitee redeems card + completes video task
  → invite_attribution created (links inviter ↔ invitee ↔ video task)
  → video task reaches terminal state (Success)
  → settleInviteReward(): risk check (same_ip, same_device) → auto-approve or pending_review
  → Admin approves/rejects in /admin (invites tab)
  → Approved: adds bonus quota to inviter's NewAPI token
```

Risk flags (`same_ip`, `same_device`) trigger `pending_review` for manual admin approval.

### NewAPI integration modes

- **HTTP API** (default): uses `NEWAPI_ACCESS_TOKEN` + `NEWAPI_USER_ID` to call NewAPI's management API
- **Direct DB** (optional): when `NEWAPI_SQL_DSN` is set, token operations and usage queries go directly to NewAPI's MySQL

## Environment variables

See `.env.local.example` for all vars. Critical ones:
- `NEWAPI_BASE_URL`, `NEWAPI_ACCESS_TOKEN`, `NEWAPI_USER_ID` — NewAPI backend connection
- `NEWAPI_SQL_DSN` — optional direct MySQL access to NewAPI DB
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` — admin panel auth
- `PUBLIC_API_BASE`, `PUBLIC_API_BASE_ROOT` — customer-facing base URLs
- `AUDIT_ENABLED=false` — disable audit logging
- `COOKIE_SECURE=true` — force secure cookies (enable behind HTTPS/Cloudflare)
- `MINIMAX_API_KEY`, `MINIMAX_API_BASE` — MiniMax video generation
- `RISK_HASH_SECRET` — HMAC secret for IP/device hashing (required in production)

## Deployment

Production server: `root@207.244.243.12`, path `/opt/nassa-cards`. Not a git repo on server — deploy via rsync.

```bash
# From local machine (deploy changed files)
rsync -avz --exclude node_modules --exclude .next --exclude data \
  ./ root@207.244.243.12:/opt/nassa-cards/

# On server
ssh root@207.244.243.12
cd /opt/nassa-cards && npm test && npm run build && pm2 restart nassa-cards
```

PM2 process name: `nassa-cards` (port 3100). A separate `nassa-cards-partner` process runs a partner site — do not touch it.

## Tests

Vitest with `@` path alias configured in `vitest.config.ts`. Test files live alongside source in `lib/`. Current test coverage:
- `lib/strip-think.test.ts` — think tag stripping (streaming + non-streaming)
- `lib/normalize-messages.test.ts` — system message merging
- `lib/video-infra.test.ts` — video infrastructure utilities
- `lib/video-quota.test.ts` — video quota enforcement
- `lib/video-sync.test.ts` — video task sync + invite reward settlement + risk detection
