#!/usr/bin/env bash
# Deploy ONE backend service with automatic rollback (crash-loop guard, 2026-10-29).
#
#   scripts/deploy-backend.sh <service> <new-source-dir>
#     service         botz-mcp | swarm
#     new-source-dir  prepared checkout/extract of the new source (moved into place)
#
# Steps: back up backends/<src> as backends/<src>.prev-<ts>, tag the running image
# rollback-<ts>, swap in the new source, rebuild and recreate ONLY that service,
# wait for the health endpoint (botz-mcp /healthz, swarm /health) to return 200 inside the container network. If it never becomes healthy,
# restore the backup and the previous image and recreate again (rollback), keeping
# the failed tree as backends/<src>.failed-<ts> for inspection.
#
# Never touches other services, volumes, or the botz.ai mounted cache (read-only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVC="${1:?usage: deploy-backend.sh <botz-mcp|swarm> <new-source-dir>}"
NEW="${2:?usage: deploy-backend.sh <botz-mcp|swarm> <new-source-dir>}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

case "$SVC" in
  botz-mcp) SRC=botz-mcp; IMAGE=zoto-sites-botz-mcp; PORT=4444; HEALTH_PATH=/healthz ;;
  swarm) SRC=botz-mcp-swarm; IMAGE=zoto-sites-swarm; PORT=4310; HEALTH_PATH=/health ;;
  *) echo "deploy-backend: unknown service $SVC" >&2; exit 2 ;;
esac

B="$ROOT/backends"
TS="$(date -u +%Y%m%d%H%M%S)"
[[ -d "$NEW" ]] || { echo "deploy-backend: $NEW is not a directory" >&2; exit 2; }

# shellcheck disable=SC1091
source "$ROOT/scripts/compose-stack.sh"
zoto_compose_init "$ROOT"
dc() { docker compose --project-directory "$ROOT" "${COMPOSE_FILE_ARGS[@]}" "$@"; }

healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) code
  while (( SECONDS < deadline )); do
    # Probe over the compose network from the nginx container (it ships curl).
    code="$(docker exec nginx curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
      "http://${SVC}:${PORT}${HEALTH_PATH}" 2>/dev/null || true)"
    if [[ "$code" == "200" ]]; then
      echo "deploy-backend: $SVC ${HEALTH_PATH} 200"
      return 0
    fi
    sleep 5
  done
  echo "deploy-backend: $SVC ${HEALTH_PATH} not 200 after ${HEALTH_TIMEOUT}s (last: ${code:-none})" >&2
  return 1
}

echo "deploy-backend: backing up $B/$SRC -> $B/$SRC.prev-$TS"
cp -a "$B/$SRC" "$B/$SRC.prev-$TS"
docker tag "$IMAGE:latest" "$IMAGE:rollback-$TS"

rm -rf "${B:?}/${SRC:?}"
mv "$NEW" "$B/$SRC"

if dc build "$SVC" && dc up -d --no-deps --force-recreate "$SVC" && healthy; then
  echo "deploy-backend: $SVC deployed (backup $B/$SRC.prev-$TS, image $IMAGE:rollback-$TS)"
  exit 0
fi

echo "deploy-backend: ROLLING BACK $SVC to $SRC.prev-$TS" >&2
dc logs --no-color --tail 60 "$SVC" >&2 || true
mv "$B/$SRC" "$B/$SRC.failed-$TS"
cp -a "$B/$SRC.prev-$TS" "$B/$SRC"
docker tag "$IMAGE:rollback-$TS" "$IMAGE:latest"
dc up -d --no-deps --force-recreate --no-build "$SVC"
if healthy; then
  echo "deploy-backend: rollback healthy; failed tree kept at $B/$SRC.failed-$TS" >&2
else
  echo "deploy-backend: rollback ALSO unhealthy; manual attention needed" >&2
fi
exit 1
