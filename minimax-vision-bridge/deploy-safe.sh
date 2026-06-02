#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@207.244.243.12}"
REMOTE_DIR="${REMOTE_DIR:-/opt/minimax-vision-bridge}"
NEWAPI_ENV="${NEWAPI_ENV:-/www/dk_project/dk_app/newapi-prod/.env}"

cd "$(dirname "$0")"

rsync -az --delete \
  --filter='P .env' \
  --exclude='__pycache__/' \
  --exclude='.pytest_cache/' \
  ./ "${REMOTE_HOST}:${REMOTE_DIR}/"

ssh "${REMOTE_HOST}" "REMOTE_DIR='${REMOTE_DIR}' NEWAPI_ENV='${NEWAPI_ENV}' bash -s" <<'REMOTE'
set -euo pipefail

cd "$REMOTE_DIR"

if [ ! -f .env ]; then
  echo "Refusing deploy: $REMOTE_DIR/.env is missing"
  exit 1
fi

if ! grep -q '^MINIMAX_VLM_API_KEY=.' .env; then
  echo "Refusing deploy: MINIMAX_VLM_API_KEY is missing"
  exit 1
fi

bridge_port="$(awk -F= '/^BRIDGE_HTTP_PORT=/{print $2}' .env | tail -1)"
bridge_port="${bridge_port:-3001}"
if [ "$bridge_port" = "3000" ]; then
  echo "Refusing deploy: bridge must not bind production port 3000"
  exit 1
fi

if ! grep -q '^WEB_HTTP_PORT=3000$' "$NEWAPI_ENV"; then
  echo "Refusing deploy: NewAPI is not pinned to WEB_HTTP_PORT=3000"
  exit 1
fi

docker compose config >/dev/null
docker compose up -d --build --force-recreate minimax-vision-bridge

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --connect-timeout 3 --max-time 8 "http://127.0.0.1:${bridge_port}/health/ready" >/dev/null; then
    break
  fi
  if [ "$attempt" = "10" ]; then
    echo "Bridge readiness check failed"
    exit 1
  fi
  sleep 2
done
curl -sS --connect-timeout 3 --max-time 8 -H 'Authorization: Bearer invalid' \
  http://127.0.0.1:3000/v1/models >/tmp/newapi-invalid-token.json
grep -q 'Invalid token' /tmp/newapi-invalid-token.json

docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' \
  | grep -E 'minimax-vision-bridge|newapi-prod-new-api-1'
REMOTE
