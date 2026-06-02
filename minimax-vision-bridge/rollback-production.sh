#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@207.244.243.12}"
BRIDGE_DIR="${BRIDGE_DIR:-/opt/minimax-vision-bridge}"
NEWAPI_DIR="${NEWAPI_DIR:-/www/dk_project/dk_app/newapi-prod}"

ssh "$REMOTE_HOST" "BRIDGE_DIR='$BRIDGE_DIR' NEWAPI_DIR='$NEWAPI_DIR' bash -s" <<'REMOTE'
set -euo pipefail

set_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

timestamp="$(date +%Y%m%d%H%M%S)"
cp "$NEWAPI_DIR/.env" "$NEWAPI_DIR/.env.rollback-bak-$timestamp"
if [ -f "$BRIDGE_DIR/.env" ]; then
  cp "$BRIDGE_DIR/.env" "$BRIDGE_DIR/.env.rollback-bak-$timestamp"
fi

if [ -f "$BRIDGE_DIR/.env" ]; then
  set_env "$BRIDGE_DIR/.env" BRIDGE_HTTP_PORT 3001
  cd "$BRIDGE_DIR"
  docker compose up -d --force-recreate minimax-vision-bridge
fi

set_env "$NEWAPI_DIR/.env" WEB_HTTP_PORT 3000
cd "$NEWAPI_DIR"
docker compose up -d --force-recreate new-api

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sS --connect-timeout 3 --max-time 8 -H 'Authorization: Bearer invalid' \
    http://127.0.0.1:3000/v1/models | grep -q 'Invalid token'; then
    docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' \
      | grep -E 'newapi-prod-new-api-1|minimax-vision-bridge' || true
    exit 0
  fi
  sleep 2
done

echo "Rollback finished but NewAPI 3000 verification failed"
exit 1
REMOTE
