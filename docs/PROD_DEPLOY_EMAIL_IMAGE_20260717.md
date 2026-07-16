# Production deploy record — email template + image workshop

- **Date**: 2026-07-17 (Asia/Shanghai)
- **Source commit**: `50f42ecd` (`codex/prod-baseline-email-image-workshop`)
- **Contents**:
  - Production baseline (`24f8aa17` chain): card-records, GLM tools, wallet link
  - Branded verification email template (`8037581d`)
  - Image + video workshop UI (`gpt-image-2`, `gpt-image-2-4k`)

## Runtime

- **Compose dir**: `/www/dk_project/dk_app/newapi-prod`
- **Container**: `newapi-prod-new-api-1`
- **Running image**: `nassa11111/new-api-hide-model:prod-baseline-email-image-50f42ecd-20260717`
- **docker commit snapshot** (filesystem freeze of live prod):
  - `mynewapi:prod-live-50f42ecd-20260716192633`
  - `ghcr.io/drnu11/mynewapi:prod-live-50f42ecd-20260716192633`
  - `ghcr.io/drnu11/mynewapi:prod-live-50f42ecd`
  - `ghcr.io/drnu11/mynewapi:prod-baseline-email-image-50f42ecd`

## Backup before deploy

- Image: `nassa11111/new-api-hide-model:backup-prod-before-email-image-20260716190816`
- Files: `/opt/backups/newapi-prod-deploy-20260716190816/`

## Rollback

```bash
cd /www/dk_project/dk_app/newapi-prod
# set image to backup-prod-before-email-image-20260716190816
docker compose up -d --no-deps new-api
```

## Test containers stopped (2026-07-17)

Stopped idle/test NewAPI containers to free host resources (prod left running):

- newapi-glm52-tool-delta-test
- newapi-rc4-test
- newapi-v65-test
- newapi-v61-test
- intelligent_carver
- beautiful_swartz
- jolly_mclaren
- tender_ellis
- newapi-3002-test-redis-1

## docker commit status

Live production container was snapshotted with `docker commit` to:

- `mynewapi:prod-live-50f42ecd-20260716192633` (image id `583e1d4a6214`)
- `nassa11111/new-api-hide-model:prod-live-50f42ecd-20260716192633`

GHCR / Docker Hub push was **not** completed from this environment (registry auth lacks package write scope). Snapshot remains on the production host Docker image store and is referenced by the tags above.

Source code for this build is on branch `codex/prod-baseline-email-image-workshop` at `50f42ecd` (+ deploy docs).
