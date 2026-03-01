#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="dev"
BACKUP_FILE=""
FORCE="0"
RESTART="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --backup) BACKUP_FILE="$2"; shift 2 ;;
    --force) FORCE="1"; shift 1 ;;
    --restart) RESTART="1"; shift 1 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ "$ENV_NAME" != "dev" && "$ENV_NAME" != "prod" ]]; then
  echo "--env must be dev or prod"; exit 1
fi
if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "--backup <file> required"; exit 1
fi
if [[ "$FORCE" != "1" ]]; then
  echo "Refusing to restore without --force"; exit 1
fi

if [[ "$ENV_NAME" == "prod" ]]; then
  REDIS_URL="${ARENA_REDIS_URL_PROD:-redis://127.0.0.1:6380}"
else
  REDIS_URL="${ARENA_REDIS_URL_DEV:-redis://127.0.0.1:6379}"
fi

if ! command -v redis-cli >/dev/null 2>&1; then
  echo "redis-cli not found"; exit 1
fi

TMP_DIR="$(mktemp -d)"
tar -xzf "$BACKUP_FILE" -C "$TMP_DIR"
if [[ ! -f "${TMP_DIR}/dump.rdb" ]]; then
  echo "invalid backup: dump.rdb missing"; rm -rf "$TMP_DIR"; exit 1
fi

REDIS_DIR="$(redis-cli -u "$REDIS_URL" CONFIG GET dir | tail -n1)"
DB_FILE="$(redis-cli -u "$REDIS_URL" CONFIG GET dbfilename | tail -n1)"
if [[ -z "$REDIS_DIR" || -z "$DB_FILE" ]]; then
  echo "cannot resolve redis dir/dbfilename"; rm -rf "$TMP_DIR"; exit 1
fi

redis-cli -u "$REDIS_URL" shutdown nosave || true
cp "${TMP_DIR}/dump.rdb" "${REDIS_DIR}/${DB_FILE}"
rm -rf "$TMP_DIR"

if [[ "$RESTART" == "1" ]]; then
  echo "managed mode: restart arena resident stack instead of brew service"
  echo "example: npm run start:branch -- --branch $(git rev-parse --abbrev-ref HEAD) --env ${ENV_NAME} --port $([[ \"$ENV_NAME\" == \"prod\" ]] && echo 3001 || echo 3000)"
fi

echo "restore_staged env=${ENV_NAME} file=${BACKUP_FILE} target=${REDIS_DIR}/${DB_FILE}"
if [[ "$RESTART" != "1" ]]; then
  echo "Please restart arena resident stack, then run integrity check: POST /api/admin/check"
fi
