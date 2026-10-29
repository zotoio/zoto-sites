#!/usr/bin/env bash
# Zero-downtime (blue/green) deploy of ONE backend service with automatic rollback.
#
#   scripts/deploy-backend.sh <service> <new-source-dir>
#     service         botz-mcp | swarm
#     new-source-dir  prepared checkout/extract of the new source (moved into place)
#
# Flow (2026-10-29):
#   1. back up backends/<src> -> backends/<src>.prev-<ts>; tag the running image rollback-<ts>
#   2. swap in the new source and build the image (the old container keeps serving)
#   3. start a candidate container <svc>-next from the new image NEXT TO the old one
#      (same env_file, volumes, network) and wait for health + readiness
#      (botz-mcp: /healthz and /readyz = embedding model loaded; swarm: /health)
#   4. point nginx at the candidate (override file + `nginx -t` + `nginx -s reload`)
#   5. recreate the compose-managed <svc> container from the new image: compose stops the
#      old one with SIGTERM and stop_grace_period (30s) to drain in-flight requests;
#      wait for health + readiness of the new <svc>
#   6. point nginx back at <svc> (remove the override, reload), drain and stop <svc>-next
#      (SIGTERM, 30s grace) and remove it
# Rollback: a failure in 2-3 leaves the old container serving untouched (source and image are
# restored). A failure in 5 restores the previous image/source and recreates <svc> from it while
# nginx keeps routing to the healthy candidate, then switches back. The failed tree is kept as
# backends/<src>.failed-<ts>.
#
# Both containers share the data dir briefly; stores write via atomic rename. Do not deploy
# swarm while a suite run is in progress (the operator checks first).
# Never touches other services, volumes, or the botz.ai mounted cache (read-only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVC="${1:?usage: deploy-backend.sh <botz-mcp|swarm> <new-source-dir>}"
NEW="${2:?usage: deploy-backend.sh <botz-mcp|swarm> <new-source-dir>}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"
DRAIN_SECONDS="${DRAIN_SECONDS:-30}"

case "$SVC" in
  botz-mcp) SRC=botz-mcp; IMAGE=zoto-sites-botz-mcp; PORT=4444; PROJECT=mcp; CHECKS="/healthz /readyz" ;;
  swarm) SRC=botz-mcp-swarm; IMAGE=zoto-sites-swarm; PORT=4310; PROJECT=swarm; CHECKS="/health" ;;
  *) echo "deploy-backend: unknown service $SVC" >&2; exit 2 ;;
esac
NEXT="${SVC}-next"
OVERRIDE_DIR=/etc/nginx/botz-upstreams
OVERRIDE="$OVERRIDE_DIR/${PROJECT}.conf"

B="$ROOT/backends"
TS="$(date -u +%Y%m%d%H%M%S)"
[[ -d "$NEW" ]] || { echo "deploy-backend: $NEW is not a directory" >&2; exit 2; }

# shellcheck disable=SC1091
source "$ROOT/scripts/compose-stack.sh"
zoto_compose_init "$ROOT"
dc() { docker compose --project-directory "$ROOT" "${COMPOSE_FILE_ARGS[@]}" "$@"; }
log() { echo "deploy-backend: $*"; }

# ready <host>: every check path returns 200 from inside the compose network (nginx has curl).
ready() {
  local host="$1" deadline=$((SECONDS + HEALTH_TIMEOUT)) code path ok
  while (( SECONDS < deadline )); do
    ok=1
    for path in $CHECKS; do
      code="$(docker exec nginx curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
        "http://${host}:${PORT}${path}" 2>/dev/null || true)"
      [[ "$code" == "200" ]] || { ok=0; break; }
    done
    if (( ok )); then log "$host ready (${CHECKS// /, } 200)"; return 0; fi
    sleep 3
  done
  echo "deploy-backend: $host not ready after ${HEALTH_TIMEOUT}s (${path:-?}: ${code:-none})" >&2
  return 1
}

# route <host>: switch the nginx upstream for this project, validate, reload.
route() {
  local host="$1"
  if [[ "$host" == "$SVC" ]]; then
    docker exec nginx rm -f "$OVERRIDE"
  else
    docker exec nginx sh -c "mkdir -p '$OVERRIDE_DIR' && printf 'set \$project_upstream \"http://%s:%s\";\n' '$host' '$PORT' > '$OVERRIDE.tmp' && mv '$OVERRIDE.tmp' '$OVERRIDE'"
  fi
  if ! docker exec nginx nginx -t -q; then
    docker exec nginx rm -f "$OVERRIDE"
    echo "deploy-backend: nginx -t failed; override removed" >&2
    return 1
  fi
  docker exec nginx nginx -s reload
  sleep 2  # let old workers finish handing off
  log "nginx upstream for $PROJECT -> $host:$PORT"
}

drain_stop() {  # SIGTERM with grace, then remove
  local c="$1"
  docker inspect "$c" >/dev/null 2>&1 || return 0
  docker stop -t "$DRAIN_SECONDS" "$c" >/dev/null || true
  docker rm -f "$c" >/dev/null 2>&1 || true
}

start_next() {
  drain_stop "$NEXT"
  dc run -d --no-deps --name "$NEXT" "$SVC" >/dev/null
}

restore_old_source() {
  mv "$B/$SRC" "$B/$SRC.failed-$TS"
  cp -a "$B/$SRC.prev-$TS" "$B/$SRC"
  docker tag "$IMAGE:rollback-$TS" "$IMAGE:latest"
}

log "backing up $B/$SRC -> $B/$SRC.prev-$TS"
cp -a "$B/$SRC" "$B/$SRC.prev-$TS"
docker tag "$IMAGE:latest" "$IMAGE:rollback-$TS"
rm -rf "${B:?}/${SRC:?}"
mv "$NEW" "$B/$SRC"

# --- phase 1: candidate next to the old container (old keeps serving) ----------------
if ! { dc build "$SVC" && start_next && ready "$NEXT"; }; then
  echo "deploy-backend: candidate failed; old $SVC untouched, ROLLING BACK source/image" >&2
  docker logs --tail 60 "$NEXT" >&2 2>/dev/null || true
  drain_stop "$NEXT"
  restore_old_source
  ready "$SVC" || echo "deploy-backend: WARNING old $SVC not ready" >&2
  exit 1
fi
route "$NEXT"

# --- phase 2: recreate the compose-managed container on the new image -----------------
if dc up -d --no-deps --force-recreate --no-build "$SVC" && ready "$SVC"; then
  route "$SVC"
  drain_stop "$NEXT"
  log "$SVC deployed with zero downtime (backup $B/$SRC.prev-$TS, image $IMAGE:rollback-$TS)"
  exit 0
fi

echo "deploy-backend: new $SVC failed after switch; ROLLING BACK (nginx stays on $NEXT meanwhile)" >&2
dc logs --no-color --tail 60 "$SVC" >&2 || true
restore_old_source
dc up -d --no-deps --force-recreate --no-build "$SVC"
if ready "$SVC"; then
  route "$SVC"
  drain_stop "$NEXT"
  echo "deploy-backend: rollback healthy; failed tree kept at $B/$SRC.failed-$TS" >&2
else
  echo "deploy-backend: rollback ALSO unhealthy; nginx left on $NEXT (new image) - manual attention needed" >&2
fi
exit 1
