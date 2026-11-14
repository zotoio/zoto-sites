#!/usr/bin/env bash
# Pipeline deploy for the zoto-sites stack: exact commit, build first, then deploy, health-checked, auto-rollback.
# Usage (on the droplet, as the SSH deploy user with sudo): scripts/deploy-sites.sh <full-commit-sha>
#
# Every deploy builds and then recreates every service whose source this deploy owns:
#   botz, nginx, today, discord (sources in this repo) and studio (backends/grok-agent-studio).
# botz-mcp and swarm are not touched: they have their own blue/green deploy (scripts/deploy-backend.sh).
#
# Studio source: before building, the checkout at backends/grok-agent-studio is refreshed to the latest
# zotoio/grok-agent-studio main when a newer commit is available, either
#   1. staged by the operator as backends/grok-agent-studio.next (a `git archive` extract with COMMIT_SHA), or
#   2. fetched by the droplet from $STUDIO_REPO (default git@github.com:zotoio/grok-agent-studio.git) when the
#      checkout owner has read access.
# Otherwise the current checkout is rebuilt as is. A refreshed tree replaces the live one only after the
# old tree is moved to backends/grok-agent-studio.prev-<ts>; existing .prev copies are never touched.
#
# A failed build fails the deploy before any container is replaced. After `up`, every service is health-checked;
# any failure rolls back code, studio source and images.
#
# Data safety: never touches backends/botz.ai/cache (images, article JSON), usage, backends/studio/.env,
# backends/studio/data or /etc/botz/secrets. No git clean/reset --hard, no compose down, no volume removal,
# no rsync. Rollback restores only code images, nginx config, the studio source tree and the git ref.
set -euo pipefail

SHA="${1:?usage: deploy-sites.sh <commit-sha>}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "deploy: expected a full 40-char commit sha" >&2; exit 2; }

ROOT="${DEPLOY_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
OWNER="$(stat -c %U "$ROOT")"
LOCK=/var/lock/zoto-sites-deploy.lock
LOG_DIR=/var/log/zoto-sites-deploy
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo -n"
SERVICES=(botz nginx today discord studio)
STUDIO_SRC="$ROOT/backends/grok-agent-studio"
STUDIO_NEXT="$STUDIO_SRC.next"
STUDIO_REPO="${STUDIO_REPO:-git@github.com:zotoio/grok-agent-studio.git}"

log() { echo "deploy: $*"; }
g() { $SUDO -u "$OWNER" git -C "$ROOT" "$@"; }
# shellcheck source=compose-stack.sh
source "$ROOT/scripts/compose-stack.sh"
dc() { zoto_compose_init "$ROOT"; (cd "$ROOT" && $SUDO docker compose -p zoto-sites "${COMPOSE_FILE_ARGS[@]}" "$@"); }

$SUDO touch "$LOCK"; $SUDO chmod 666 "$LOCK"
exec 9>"$LOCK"
flock -w 600 9 || { echo "deploy: another deploy holds the lock" >&2; exit 3; }

$SUDO mkdir -p "$LOG_DIR"
PREV="$(g rev-parse HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
log "${PREV:0:12} -> ${SHA:0:12} ($STAMP)"

[ -z "$(g status --porcelain --untracked-files=no)" ] || { echo "deploy: checkout has local edits to tracked files; refusing" >&2; g status --short --untracked-files=no >&2; exit 4; }

mounts() { dc config --format json | python3 -c 'import sys,json;d=json.load(sys.stdin)["services"];print(json.dumps({s:d[s].get("volumes",[]) for s in sys.argv[1:]},sort_keys=True))' "${SERVICES[@]}"; }
MOUNTS_BEFORE="$(mounts)"

g fetch --quiet origin main
g merge-base --is-ancestor "$SHA" origin/main || { echo "deploy: $SHA is not on origin/main" >&2; exit 5; }
g merge --ff-only --quiet "$SHA"

if [ "$(mounts)" != "$MOUNTS_BEFORE" ]; then
  echo "deploy: service volume config changed; refusing automated deploy" >&2
  g reset --quiet --keep "$PREV"
  exit 6
fi

for s in "${SERVICES[@]}"; do
  id="$($SUDO docker inspect -f '{{.Image}}' "$s" 2>/dev/null || true)"
  [ -n "$id" ] && $SUDO docker tag "$id" "zoto-sites-$s:rollback-$STAMP"
done

# --- studio source refresh -----------------------------------------------------------
studio_sha() { cat "$1/COMMIT_SHA" 2>/dev/null || echo unknown; }
STUDIO_SWAPPED=0
refresh_studio() {
  local cur remote tmp
  cur="$(studio_sha "$STUDIO_SRC")"
  if [ ! -d "$STUDIO_NEXT" ]; then
    remote="$($SUDO -u "$OWNER" env GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=15' \
      timeout 60 git ls-remote "$STUDIO_REPO" refs/heads/main 2>/dev/null | cut -f1 || true)"
    if [ -z "$remote" ]; then
      log "studio: $STUDIO_REPO not readable from the droplet; building current checkout (${cur:0:12})"
      return 0
    fi
    if [ "$remote" = "$cur" ]; then
      log "studio: checkout already at grok-agent-studio main (${cur:0:12})"
      return 0
    fi
    tmp="$($SUDO -u "$OWNER" mktemp -d /tmp/studio-src.XXXXXX)"
    if ! $SUDO -u "$OWNER" env GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=15' \
        timeout 300 git clone --quiet --depth 1 --branch main "$STUDIO_REPO" "$tmp/repo"; then
      $SUDO rm -rf "${tmp:?}"
      echo "deploy: studio: fetch of $STUDIO_REPO failed" >&2; return 1
    fi
    $SUDO -u "$OWNER" mkdir "$STUDIO_NEXT"
    $SUDO -u "$OWNER" sh -c 'git -C "$1/repo" archive HEAD | tar -x -C "$2" && git -C "$1/repo" rev-parse HEAD > "$2/COMMIT_SHA"' _ "$tmp" "$STUDIO_NEXT"
    $SUDO rm -rf "${tmp:?}"
  fi
  [ -f "$STUDIO_NEXT/COMMIT_SHA" ] || { echo "deploy: studio: $STUDIO_NEXT has no COMMIT_SHA; refusing" >&2; return 1; }
  [ -f "$STUDIO_NEXT/Dockerfile" ] || { echo "deploy: studio: $STUDIO_NEXT has no Dockerfile; refusing" >&2; return 1; }
  log "studio: source ${cur:0:12} -> $(studio_sha "$STUDIO_NEXT" | cut -c1-12) (old tree kept at backends/grok-agent-studio.prev-$STAMP)"
  $SUDO mv "$STUDIO_SRC" "$STUDIO_SRC.prev-$STAMP"
  $SUDO mv "$STUDIO_NEXT" "$STUDIO_SRC"
  STUDIO_SWAPPED=1
}

health() {
  local ok=0 c code
  local checks=(botz.ai/ botz.ai/archive/index botz.ai/archive/latest studio.botz.ai/api/health today.zoto.io/api/health)
  for _ in $(seq 1 30); do
    ok=1
    for c in "${checks[@]}"; do
      code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve "${c%%/*}:443:127.0.0.1" "https://$c" || true)"
      [ "$code" = 200 ] || { ok=0; break; }
    done
    if [ $ok = 1 ]; then
      [ "$($SUDO docker inspect -f '{{.State.Running}}' discord 2>/dev/null)" = true ] || { ok=0; c=discord; code="not running"; }
    fi
    [ $ok = 1 ] && { log "health ok (${checks[*]} = 200; discord running)"; return 0; }
    sleep 6
  done
  echo "deploy: health failed ($c -> $code)" >&2; return 1
}

rollback() {
  echo "deploy: rolling back to ${PREV:0:12}" >&2
  g reset --quiet --keep "$PREV"
  if [ "$STUDIO_SWAPPED" = 1 ]; then
    $SUDO mv "$STUDIO_SRC" "$STUDIO_SRC.failed-$STAMP"
    $SUDO cp -a "$STUDIO_SRC.prev-$STAMP" "$STUDIO_SRC"
    echo "deploy: studio source restored; failed tree kept at backends/grok-agent-studio.failed-$STAMP" >&2
  fi
  for s in "${SERVICES[@]}"; do
    $SUDO docker image inspect "zoto-sites-$s:rollback-$STAMP" >/dev/null 2>&1 && $SUDO docker tag "zoto-sites-$s:rollback-$STAMP" "zoto-sites-$s:latest"
  done
  dc up -d --no-deps --no-build "${SERVICES[@]}"
  health || echo "deploy: WARNING health still failing after rollback" >&2
  exit 1
}

refresh_studio || rollback

# --- build (all services) then deploy ---------------------------------------------------
log "building ${SERVICES[*]}"
dc build "${SERVICES[@]}" || { echo "deploy: build failed; nothing was replaced" >&2; rollback; }
for s in studio today discord botz nginx; do
  dc up -d --no-deps --no-build "$s" || rollback
done
# Health first: the nginx entrypoint copies TLS material on start, so config tests are only meaningful once it serves.
health || rollback
$SUDO docker exec nginx nginx -t >/dev/null 2>&1 || { echo "deploy: nginx -t failed after start" >&2; rollback; }
[ "$($SUDO docker inspect -f '{{.State.Restarting}}' "${SERVICES[@]}" | sort -u)" = "false" ] || { echo "deploy: a container is restart-looping" >&2; rollback; }

echo "$STAMP ${PREV} -> ${SHA} ok studio=$(studio_sha "$STUDIO_SRC")" | $SUDO tee -a "$LOG_DIR/receipts.log" >/dev/null
log "deployed ${SHA:0:12} (studio $(studio_sha "$STUDIO_SRC" | cut -c1-12))"
