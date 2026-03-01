#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="dev"
KIND="hourly"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --kind) KIND="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ "$ENV_NAME" != "dev" && "$ENV_NAME" != "prod" ]]; then
  echo "--env must be dev or prod"; exit 1
fi
if [[ "$KIND" != "hourly" && "$KIND" != "daily" ]]; then
  echo "--kind must be hourly or daily"; exit 1
fi

if [[ "$ENV_NAME" == "prod" ]]; then
  REDIS_URL="${ARENA_REDIS_URL_PROD:-redis://127.0.0.1:6380}"
else
  REDIS_URL="${ARENA_REDIS_URL_DEV:-redis://127.0.0.1:6379}"
fi

if ! command -v redis-cli >/dev/null 2>&1; then
  echo "redis-cli not found"; exit 1
fi

BASE_DIR="$(pwd)/backups/${ENV_NAME}"
mkdir -p "$BASE_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
NAME="${KIND}-${TS}"
TMP_DIR="$(mktemp -d)"
OUT_TAR="${BASE_DIR}/${NAME}.tar.gz"

redis-cli -u "$REDIS_URL" ping >/dev/null
redis-cli -u "$REDIS_URL" --rdb "${TMP_DIR}/dump.rdb" >/dev/null
redis-cli -u "$REDIS_URL" info server > "${TMP_DIR}/info-server.txt"
redis-cli -u "$REDIS_URL" info memory > "${TMP_DIR}/info-memory.txt"
redis-cli -u "$REDIS_URL" info persistence > "${TMP_DIR}/info-persistence.txt"

cat > "${TMP_DIR}/manifest.json" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "env": "${ENV_NAME}",
  "kind": "${KIND}",
  "redisUrl": "${REDIS_URL}",
  "files": ["dump.rdb", "info-server.txt", "info-memory.txt", "info-persistence.txt"]
}
EOF

tar -C "$TMP_DIR" -czf "$OUT_TAR" dump.rdb manifest.json info-server.txt info-memory.txt info-persistence.txt
rm -rf "$TMP_DIR"

if [[ "$KIND" == "hourly" ]]; then
  ls -1t "$BASE_DIR"/hourly-*.tar.gz 2>/dev/null | tail -n +49 | xargs -r rm -f
else
  ls -1t "$BASE_DIR"/daily-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
fi

echo "backup_ok env=${ENV_NAME} kind=${KIND} file=${OUT_TAR}"
