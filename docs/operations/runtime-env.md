# Production runtime notes — do not commit secrets

The variables below must be set in `/opt/nassa-cards/.env.local` on the
production server (`root@207.244.243.12`) for the card redemption flow
(`/api/redeem`) and the daily-quota cap check to work. The repo's
`.env.local.example` shows the same names with empty values; the actual
values live on the server only.

## Required at runtime (in addition to .env.local.example defaults)

- `NEWAPI_SQL_DSN` — direct MySQL DSN to the NewAPI database.
  Used by `lib/newapi-db.ts` to query `logs`/`tokens` for the daily/total
  cost cap on 1d cards (DeepSeek $500/day, Claude $350 total, GPT $250
  total). Format: `root:pass@tcp(172.18.0.2:3306)/new-api`.

- `NEWAPI_INTERNAL_URL` — internal upstream URL. The `/v1/[...path]` proxy
  prefers this over `NEWAPI_BASE_URL` for relaying requests to the
  co-located NewAPI docker container. Set to `http://127.0.0.1:3000`.

- `NEWAPI_TOKEN_ALLOW_IPS` — IP allow-list applied to every new token
  created via `/api/redeem`. Without it, the server refuses to create a
  token (production-only guard). Set to the proxy IP, e.g.
  `172.18.0.1/32`.

- `RISK_HASH_SECRET` — HMAC secret used by `lib/risk-hash.ts` to hash
  client IP / device fingerprint for invite reward risk checks and
  IP-hashing in admin views. Required in production.

- `NEXT_PUBLIC_BUY_CARD_URL` — public buy-card link shown on the redeem
  page when a card doesn't exist.

- `PUBLIC_API_BASE_ROOT` — customer-facing root URL (no `/v1`), used by
  invite links and share copy.

- `AUDIT_ENABLED` — `true` to enable conversation logging into
  `data/audit.db`. `false` disables it.

## Recovery pointers

- Backup of the production `.env.local` lives at:
  `/opt/nassa-cards-3200/.env.local` (sister instance, same values).
- Database backups are timestamped files in `/opt/nassa-cards/data/` named
  `cards.db.YYYYMMDD_HHMMSS.bak`.
- Previous compiled `.next` is at `/opt/nassa-cards-3200/.next` if the
  primary build fails; copy and restart PM2 as a quick unblock.