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
