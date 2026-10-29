#!/usr/bin/env bash
# Rotate / migrate a backend's data-at-rest key (security D3/D4/D6, 2026-10-29).
#
#   sudo scripts/rotate-storage-key.sh <botz-mcp|swarm> --dry-run
#       Simulate a rotation: a throwaway key is prepended in a temp root-only env file and the
#       re-encryption runs in report-only mode. Nothing is written. Prints counts only.
#   sudo scripts/rotate-storage-key.sh <botz-mcp|swarm> [--migrate-only] [--remove-client <id>]...
#       1. scripts/backup-data.sh <svc>   (every data file -> <file>.bak-<ts>, root 0400)
#       2. scripts/botz-keys.sh add-key <svc>   (skipped with --migrate-only: use the current keys)
#       3. recreate the service so it loads the new key list (old ids stay readable)
#       4. re-encrypt everything with the active key (botz-mcp online; swarm with the service stopped)
#       5. health check; on failure the previous key file (.bak) can be restored, data backups stay.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "rotate-storage-key: run as root" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVC="${1:?usage: rotate-storage-key.sh <botz-mcp|swarm> [--dry-run|--migrate-only] [--remove-client <id>]}"
shift
DRY=0; MIGRATE_ONLY=0; REMOVE=()
while (($#)); do
  case "$1" in
    --dry-run) DRY=1 ;;
    --migrate-only) MIGRATE_ONLY=1 ;;
    --remove-client) REMOVE+=(--remove-client "${2:?client id}"); shift ;;
    *) echo "rotate-storage-key: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
KEYDIR="${BOTZ_KEYS_DIR:-/etc/botz/keys}"
F="$KEYDIR/$SVC.env"
case "$SVC" in
  botz-mcp) P=BOTZ; HEALTH=http://botz-mcp:4444/healthz
    REKEY=(python -m botz_mcp.storage.oauth_store reencrypt) ;;
  swarm) P=SWARM; HEALTH=http://swarm:4310/health
    REKEY=(node /app/packages/core/dist/store/storage-rekey.js rekey) ;;
  *) echo "rotate-storage-key: unknown service $SVC" >&2; exit 2 ;;
esac
[[ ${#REMOVE[@]} -gt 0 && "$SVC" != swarm ]] && { echo "rotate-storage-key: --remove-client is swarm-only" >&2; exit 2; }
[[ -f "$F" ]] || { echo "rotate-storage-key: $F missing (sudo scripts/botz-keys.sh init $SVC)" >&2; exit 1; }
# shellcheck disable=SC1091
source "$ROOT/scripts/compose-stack.sh"
zoto_compose_init "$ROOT"
dc() { docker compose --project-directory "$ROOT" "${COMPOSE_FILE_ARGS[@]}" "$@"; }
healthy() {
  local _
  for _ in $(seq 1 60); do
    [[ "$(docker exec nginx curl -s -o /dev/null -w '%{http_code}' "$HEALTH" 2>/dev/null || true)" == 200 ]] && return 0
    sleep 3
  done
  return 1
}

if ((DRY)); then
  tmp="$(mktemp "$KEYDIR/.dryrun-$SVC.XXXXXX")"; chmod 0400 "$tmp"
  trap 'rm -f "$tmp"' EXIT
  cur="$(sed -n "s/^${P}_STORAGE_KEYS=//p" "$F" | tail -1)"
  {
    echo "${P}_STORAGE_KEYS=kdryrun:$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))'),${cur}"
    grep "^${P}_STORAGE_HASH_PEPPER=" "$F" || true
  } > "$tmp"
  echo "rotate-storage-key: dry run for $SVC (throwaway key id kdryrun, nothing written)"
  docker exec --env-file "$tmp" "$SVC" "${REKEY[@]}" --dry-run "${REMOVE[@]}"
  exit $?
fi

"$ROOT/scripts/backup-data.sh" "$SVC"
((MIGRATE_ONLY)) || "$ROOT/scripts/botz-keys.sh" add-key "$SVC"
if [[ "$SVC" == swarm ]]; then
  dc stop swarm
  dc run --rm --no-deps -T --entrypoint "" swarm "${REKEY[@]}" "${REMOVE[@]}"
  dc up -d --no-build --no-deps swarm
else
  dc up -d --no-build --no-deps --force-recreate botz-mcp
  healthy || { echo "rotate-storage-key: botz-mcp unhealthy after key reload" >&2; exit 1; }
  docker exec botz-mcp "${REKEY[@]}"
fi
healthy || { echo "rotate-storage-key: $SVC unhealthy; restore with the .bak key file + data backups (docs/security)" >&2; exit 1; }
st="$("$ROOT/scripts/botz-keys.sh" status "$SVC" | head -1)"
echo "rotate-storage-key: $SVC healthy; $st"
