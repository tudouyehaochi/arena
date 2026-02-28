#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
WORKTREE_BASE="${ARENA_WORKTREE_BASE:-$ROOT_DIR/../arena-worktrees}"

TARGET_BRANCH=""
ENV_ARG=""
PORT_ARG=""
API_URL_ARG=""

usage() {
  cat <<EOF
Usage:
  npm run start:branch -- --branch <dev|master> [--env dev|prod] [--port N] [--api-url URL]

Examples:
  npm run start:branch -- --branch dev --env dev --port 3000
  npm run start:branch -- --branch master --env prod --port 3001
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch)
      TARGET_BRANCH="${2:-}"
      shift 2
      ;;
    --env)
      ENV_ARG="${2:-}"
      shift 2
      ;;
    --port)
      PORT_ARG="${2:-}"
      shift 2
      ;;
    --api-url)
      API_URL_ARG="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$TARGET_BRANCH" ]; then
  echo "Missing required arg: --branch" >&2
  usage
  exit 1
fi

if [ "$TARGET_BRANCH" != "dev" ] && [ "$TARGET_BRANCH" != "master" ]; then
  echo "--branch must be dev or master" >&2
  exit 1
fi

if [ "$CURRENT_BRANCH" = "$TARGET_BRANCH" ]; then
  TARGET_DIR="$ROOT_DIR"
else
  TARGET_DIR="$WORKTREE_BASE/$TARGET_BRANCH"
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "Target worktree missing: $TARGET_DIR" >&2
  echo "Run: npm run worktree:setup" >&2
  exit 1
fi

if [ ! -e "$TARGET_DIR/start-resident.js" ]; then
  echo "Invalid arena workspace: $TARGET_DIR" >&2
  exit 1
fi

CMD=(node start-resident.js)
if [ -n "$ENV_ARG" ]; then
  CMD+=(--env "$ENV_ARG")
fi
if [ -n "$PORT_ARG" ]; then
  CMD+=(--port "$PORT_ARG")
fi
if [ -n "$API_URL_ARG" ]; then
  CMD+=(--api-url "$API_URL_ARG")
fi

echo "[start:branch] branch=$TARGET_BRANCH workspace=$TARGET_DIR"
(
  cd "$TARGET_DIR"
  exec "${CMD[@]}"
)
