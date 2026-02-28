#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
BASE_DIR="${1:-$ROOT_DIR/../arena-worktrees}"
MASTER_DIR="$BASE_DIR/master"
DEV_DIR="$BASE_DIR/dev"

ensure_branch() {
  local branch="$1"
  if git -C "$ROOT_DIR" show-ref --verify --quiet "refs/heads/$branch"; then
    return 0
  fi
  if git -C "$ROOT_DIR" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    git -C "$ROOT_DIR" branch "$branch" "origin/$branch"
    return 0
  fi
  echo "Missing branch: $branch (local and origin not found)" >&2
  exit 1
}

ensure_worktree() {
  local branch="$1"
  local target_dir="$2"

  if [ "$CURRENT_BRANCH" = "$branch" ] && [ "$ROOT_DIR" != "$target_dir" ]; then
    echo "[skip] branch '$branch' already checked out at current workspace: $ROOT_DIR"
    return 0
  fi

  if [ -d "$target_dir/.git" ] || [ -f "$target_dir/.git" ]; then
    echo "[ok] worktree exists: $target_dir"
    return 0
  fi

  mkdir -p "$(dirname "$target_dir")"
  git -C "$ROOT_DIR" worktree add "$target_dir" "$branch"
  echo "[add] $branch -> $target_dir"
}

mkdir -p "$BASE_DIR"
ensure_branch master
ensure_branch dev
ensure_worktree master "$MASTER_DIR"
ensure_worktree dev "$DEV_DIR"

if [ "$CURRENT_BRANCH" = "master" ]; then
  MASTER_DIR="$ROOT_DIR"
fi
if [ "$CURRENT_BRANCH" = "dev" ]; then
  DEV_DIR="$ROOT_DIR"
fi

cat <<EOF

Worktree setup complete.

Dev workspace:
  $DEV_DIR
  cd "$DEV_DIR" && npm run start:resident -- --env dev --port 3000

Prod workspace (master):
  $MASTER_DIR
  cd "$MASTER_DIR" && npm run start:resident -- --env prod --port 3001

Quick checks:
  curl --noproxy '*' -sS -m 3 http://localhost:3000/api/env
  curl --noproxy '*' -sS -m 3 http://localhost:3001/api/env
EOF
