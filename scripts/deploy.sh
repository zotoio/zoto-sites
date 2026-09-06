#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy.sh              # deploy on this machine (local / droplet)
  ./scripts/deploy.sh <ssh-target> # deploy over SSH (e.g. deploy@203.0.113.10)

Environment (for remote deploy):
  DEPLOY_PATH   App directory on the remote host (default: /opt/zoto-sites)
  DEPLOY_BRANCH Git branch to deploy (default: main)

Local / on-droplet deploy runs:
  git pull (if inside a git repo)
  node scripts/generate-nginx.js
  docker compose up -d --build
EOF
}

deploy_local() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    BRANCH="${DEPLOY_BRANCH:-main}"
    echo "Pulling latest ${BRANCH}..."
    git pull origin "${BRANCH}"
  fi

  echo "Generating nginx configs..."
  node scripts/generate-nginx.js

  echo "Building and starting services..."
  docker compose up -d --build

  echo ""
  echo "Deploy complete. Running containers:"
  docker compose ps
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -eq 0 ]]; then
  deploy_local
  exit 0
fi

TARGET="$1"
REMOTE_PATH="${DEPLOY_PATH:-/opt/zoto-sites}"
REMOTE_BRANCH="${DEPLOY_BRANCH:-main}"

echo "Deploying to ${TARGET}:${REMOTE_PATH} (branch ${REMOTE_BRANCH})..."

ssh "${TARGET}" "set -euo pipefail
  cd '${REMOTE_PATH}'
  git fetch origin '${REMOTE_BRANCH}'
  git checkout '${REMOTE_BRANCH}'
  git pull origin '${REMOTE_BRANCH}'
  node scripts/generate-nginx.js
  docker compose up -d --build
  docker compose ps
"

echo "Remote deploy complete."
