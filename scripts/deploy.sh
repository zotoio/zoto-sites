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
  DEPLOY_PATH   App directory on the remote host (default: /home/andrewv/git/zoto-sites)
  DEPLOY_BRANCH Git branch to deploy (default: main)

Local / on-droplet deploy runs scripts/deploy-safe.sh (guards, ff-only pull, compose).
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -eq 0 ]]; then
  bash scripts/deploy-safe.sh
  exit 0
fi

TARGET="$1"
REMOTE_PATH="${DEPLOY_PATH:-/home/andrewv/git/zoto-sites}"
REMOTE_BRANCH="${DEPLOY_BRANCH:-main}"

echo "Deploying to ${TARGET}:${REMOTE_PATH} (branch ${REMOTE_BRANCH})..."

ssh "${TARGET}" "set -euo pipefail
  cd '${REMOTE_PATH}'
  export DEPLOY_BRANCH='${REMOTE_BRANCH}'
  git fetch origin '${REMOTE_BRANCH}'
  bash scripts/deploy-safe.sh
"

echo "Remote deploy complete."
