#!/usr/bin/env bash
# Back up every secret-bearing data file of a backend IN PLACE before a migration
# (security D3/D4/D6, 2026-10-29). Never deletes or modifies the originals.
#
#   sudo scripts/backup-data.sh <botz-mcp|swarm> [ts]
#
# Each file F is copied to F.bak-<ts> owned root:root mode 0400 (SQLite databases
# via the online backup API so the copy is consistent while the service runs).
# Prints only paths and counts, never contents.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "backup-data: run as root" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVC="${1:?usage: backup-data.sh <botz-mcp|swarm> [ts]}"
TS="${2:-$(date -u +%Y%m%dT%H%M%SZ)}"
case "$SVC" in
  botz-mcp) D="$ROOT/backends/mcp/data"
    FILES=(oauth-proxy/cache.db swarm_instrumentation.json org-config.json state/iam.json state/catalogs.json) ;;
  swarm) D="$ROOT/backends/swarm/data/mcp-swarm/data"
    FILES=(oauth_state.json oauth-pending.json iam-tokens.json policy.json)
    while IFS= read -r f; do FILES+=("${f#"$D"/}"); done < <(
      find "$D/sessions" "$D/catalogue" -maxdepth 1 -name '*.json' 2>/dev/null
      find "$D/projects" -name project.json 2>/dev/null) ;;
  *) echo "backup-data: unknown service $SVC" >&2; exit 2 ;;
esac
n=0
for rel in "${FILES[@]}"; do
  src="$D/$rel"; [[ -f "$src" ]] || continue
  dst="$src.bak-$TS"
  [[ -e "$dst" ]] && { echo "backup-data: $dst exists, refusing to overwrite" >&2; exit 1; }
  if [[ "$rel" == *.db ]]; then
    python3 - "$src" "$dst" <<'PY'
import sqlite3, sys
s = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True, timeout=30)
d = sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()
PY
  else
    cp --preserve=timestamps "$src" "$dst"
  fi
  chown root:root "$dst"; chmod 0400 "$dst"; n=$((n + 1))
  echo "backup-data: $dst"
done
echo "backup-data: $SVC $n file(s) backed up with suffix .bak-$TS"
