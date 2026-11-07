#!/usr/bin/env bash
# Pipeline deploy for botz.ai: exact commit, botz + nginx only, health-checked, auto-rollback.
# Usage (on the droplet, as the SSH deploy user with sudo): scripts/deploy-botz.sh <full-commit-sha>
#
# Data safety: never touches backends/botz.ai/cache (images, article JSON) or usage. No git clean/reset --hard,
# no compose down, no volume removal, no rsync. Rollback restores only code images, nginx config and the git ref.
set -euo pipefail

SHA="${1:?usage: deploy-botz.sh <commit-sha>}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "deploy-botz: expected a full 40-char commit sha" >&2; exit 2; }

ROOT="${DEPLOY_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
OWNER="$(stat -c %U "$ROOT")"
LOCK=/var/lock/zoto-sites-deploy.lock
LOG_DIR=/var/log/zoto-sites-deploy
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo -n"

g() { $SUDO -u "$OWNER" git -C "$ROOT" "$@"; }
# shellcheck source=compose-stack.sh
source "$ROOT/scripts/compose-stack.sh"
dc() { zoto_compose_init "$ROOT"; (cd "$ROOT" && $SUDO docker compose -p zoto-sites "${COMPOSE_FILE_ARGS[@]}" "$@"); }

$SUDO touch "$LOCK"; $SUDO chmod 666 "$LOCK"
exec 9>"$LOCK"
flock -w 600 9 || { echo "deploy-botz: another deploy holds the lock" >&2; exit 3; }

$SUDO mkdir -p "$LOG_DIR"
PREV="$(g rev-parse HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
echo "deploy-botz: ${PREV:0:12} -> ${SHA:0:12} ($STAMP)"

[ -z "$(g status --porcelain --untracked-files=no)" ] || { echo "deploy-botz: checkout has local edits to tracked files; refusing" >&2; g status --short --untracked-files=no >&2; exit 4; }

botz_mounts() { dc config --format json | python3 -c 'import sys,json;d=json.load(sys.stdin)["services"];print(json.dumps({s:d[s].get("volumes",[]) for s in ("botz","nginx")},sort_keys=True))'; }
MOUNTS_BEFORE="$(botz_mounts)"

g fetch --quiet origin main
g merge-base --is-ancestor "$SHA" origin/main || { echo "deploy-botz: $SHA is not on origin/main" >&2; exit 5; }
g merge --ff-only --quiet "$SHA"

if [ "$(botz_mounts)" != "$MOUNTS_BEFORE" ]; then
  echo "deploy-botz: botz/nginx volume config changed; refusing automated deploy" >&2
  g reset --quiet --keep "$PREV"
  exit 6
fi

for s in botz nginx; do
  id="$($SUDO docker inspect -f '{{.Image}}' "$s" 2>/dev/null || true)"
  [ -n "$id" ] && $SUDO docker tag "$id" "zoto-sites-$s:rollback-$STAMP"
done

health() {
  local ok=0 p code
  for _ in $(seq 1 20); do
    ok=1
    for p in / /archive/index /archive/latest; do
      code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve botz.ai:443:127.0.0.1 "https://botz.ai$p" || true)"
      [ "$code" = 200 ] || { ok=0; break; }
    done
    [ $ok = 1 ] && { echo "deploy-botz: health ok (/, /archive/index, /archive/latest = 200)"; return 0; }
    sleep 6
  done
  echo "deploy-botz: health failed ($p -> $code)" >&2; return 1
}

rollback() {
  echo "deploy-botz: rolling back to ${PREV:0:12}" >&2
  g reset --quiet --keep "$PREV"
  for s in botz nginx; do
    $SUDO docker image inspect "zoto-sites-$s:rollback-$STAMP" >/dev/null 2>&1 && $SUDO docker tag "zoto-sites-$s:rollback-$STAMP" "zoto-sites-$s:latest"
  done
  dc up -d --no-deps --no-build botz nginx
  health || echo "deploy-botz: WARNING health still failing after rollback" >&2
  exit 1
}

dc build botz nginx || rollback
dc up -d --no-deps botz || rollback
dc up -d --no-deps nginx || rollback
$SUDO docker exec nginx nginx -t || rollback
health || rollback

echo "$STAMP ${PREV} -> ${SHA} ok" | $SUDO tee -a "$LOG_DIR/receipts.log" >/dev/null
echo "deploy-botz: deployed ${SHA:0:12}"
