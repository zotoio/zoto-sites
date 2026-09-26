#!/usr/bin/env bash
# Safe production deploy: preflight, backup, data guards, ff-only pull, compose up.
#
# NEVER run from this script (or extend it to run):
#   git clean, git reset --hard, git stash,
#   docker compose down -v / --volumes, docker volume rm/prune,
#   rm -rf on manifest data paths.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MANIFEST="${ROOT}/deploy/persistent-data.txt"
DATA_PATH="backends/botz.ai/cache"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/zoto-sites}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
STATE_FILE=""
BACKUP_FILE=""

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-safe.sh

Environment:
  DEPLOY_BRANCH   Git branch to deploy (default: main)
  BACKUP_DIR      Directory for tar backups (default: /var/backups/zoto-sites)
  BACKUP_KEEP     Number of backups to retain (default: 7)

Runs from the repository root. Refuses dirty trees, mount regressions, and data loss.
EOF
}

die() {
  echo "deploy-safe: $*" >&2
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ -f "$MANIFEST" ]] || die "missing manifest at deploy/persistent-data.txt (run from checkout root)"

# --- (a) Preflight ---
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "tracked files modified locally; refusing"
fi

if ! docker compose version >/dev/null 2>&1; then
  die "docker compose v2 is required (docker compose version failed)"
fi

echo "Fetching origin/${DEPLOY_BRANCH}..."
git fetch origin "${DEPLOY_BRANCH}"

mapfile -t TRACKED_ON_REMOTE < <(git ls-tree -r --name-only "origin/${DEPLOY_BRANCH}")
mapfile -t UNTRACKED < <(git ls-files --others --exclude-standard)

for u in "${UNTRACKED[@]}"; do
  [[ -n "$u" ]] || continue
  for t in "${TRACKED_ON_REMOTE[@]}"; do
    if [[ "$u" == "$t" ]]; then
      die "untracked file would be overwritten by incoming tree: $u"
    fi
  done
done

REPO_REAL="$(realpath "$ROOT")"
BACKUP_REAL="$(realpath -m "$BACKUP_DIR")"
if [[ "$BACKUP_REAL" == "$REPO_REAL"/* || "$BACKUP_REAL" == "$REPO_REAL" ]]; then
  die "BACKUP_DIR must not be inside the repository ($BACKUP_DIR)"
fi

read_manifest_paths() {
  local section=""
  DATA_PATHS=()
  BACKUP_PATHS=()
  ALLOWED_BINDS=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^#[[:space:]]*DATA ]]; then
      section=data
      continue
    fi
    if [[ "$line" =~ ^#[[:space:]]*CONFIG ]]; then
      section=config
      continue
    fi
    if [[ "$line" =~ ^#[[:space:]]*DERIVED ]]; then
      section=derived
      continue
    fi
    if [[ "$line" =~ ALLOWED_COMPOSE_BIND_SOURCES ]]; then
      section=binds
      continue
    fi
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    case "$section" in
      data)
        DATA_PATHS+=("$line")
        BACKUP_PATHS+=("$line")
        ;;
      config|derived)
        BACKUP_PATHS+=("$line")
        ;;
      binds)
        ALLOWED_BINDS+=("$line")
        ;;
    esac
  done < "$MANIFEST"
}

read_manifest_paths

count_data_files() {
  local dir="$1"
  local n=0
  if [[ -d "$dir" ]]; then
    n="$(find "$dir" -mindepth 1 \( -name '*.json' -o -path '*/images/*' \) -type f 2>/dev/null | wc -l | tr -d ' ')"
  fi
  echo "$n"
}

# Resolve compose bind sources from JSON config.
compose_bind_sources() {
  docker compose config --format json | node -e "
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = new Set();
for (const svc of Object.values(j.services || {})) {
  for (const m of svc.volumes || []) {
    if (typeof m === 'string') {
      const parts = m.split(':');
      if (parts.length >= 2 && !parts[0].startsWith('/var/') && parts[0] !== '') {
        out.add(parts[0]);
      }
    } else if (m && m.type === 'bind' && m.source) {
      out.add(m.source);
    }
  }
}
console.log([...out].sort().join('\n'));
"
}

running_mount_sources() {
  local c="$1"
  if ! docker inspect "$c" >/dev/null 2>&1; then
    return 0
  fi
  docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}
{{end}}{{end}}' "$c" 2>/dev/null | sed '/^$/d' | sort -u
}

compare_mounts_preflight() {
  local new_sources
  new_sources="$(compose_bind_sources | sort -u)"
  local cwd_real
  cwd_real="$(realpath "$ROOT")"

  for c in nginx botz discord; do
    if ! docker inspect "$c" >/dev/null 2>&1; then
      continue
    fi
    local wd
    wd="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null || true)"
    if [[ -n "$wd" && "$(realpath "$wd" 2>/dev/null || echo "$wd")" != "$cwd_real" ]]; then
      die "compose project working_dir for $c ($wd) differs from current checkout ($cwd_real)"
    fi
    local old
    old="$(running_mount_sources "$c")"
    while IFS= read -r src; do
      [[ -z "$src" ]] && continue
      if ! echo "$new_sources" | grep -Fxq "$src"; then
        die "running container $c bind source would no longer be mounted: $src"
      fi
    done <<< "$old"
  done

  # botz must have CACHE_DIR pointing at a mounted path
  local botz_cache_mount
  botz_cache_mount="$(docker compose config --format json | node -e "
const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
const botz = j.services?.botz;
const env = botz?.environment || {};
let cacheDir = env.CACHE_DIR;
if (Array.isArray(env)) {
  const e = env.find(x => String(x).startsWith('CACHE_DIR='));
  if (e) cacheDir = e.split('=').slice(1).join('=');
}
if (!cacheDir) { process.exit(2); }
const vols = botz?.volumes || [];
const targets = vols.map(v => typeof v === 'string' ? v.split(':')[1] : v?.target).filter(Boolean);
if (!targets.some(t => cacheDir === t || cacheDir.startsWith(t + '/'))) {
  console.error('CACHE_DIR', cacheDir, 'not covered by mounts', targets);
  process.exit(1);
}
console.log(cacheDir);
")" || die "botz CACHE_DIR must be set to a mounted path in docker-compose.yml"
  if [[ "$botz_cache_mount" != "/home/root/cache" ]]; then
    die "botz CACHE_DIR must be /home/root/cache (got $botz_cache_mount)"
  fi
}

echo "Checking compose mounts against running containers..."
compare_mounts_preflight

# --- (b) Backup ---
mkdir -p "$BACKUP_DIR"
UTC_TS="$(date -u +%Y%m%dT%H%M%SZ)"
SHORT_SHA="$(git rev-parse --short HEAD)"
BACKUP_FILE="${BACKUP_DIR}/zoto-sites-${UTC_TS}-${SHORT_SHA}.tar.gz"
STATE_FILE="${BACKUP_DIR}/zoto-sites-${UTC_TS}-${SHORT_SHA}.state"

TAR_PATHS=()
for p in "${BACKUP_PATHS[@]}"; do
  if [[ -e "$ROOT/$p" ]]; then
    TAR_PATHS+=("$p")
  fi
done

if [[ ${#TAR_PATHS[@]} -gt 0 ]]; then
  echo "Creating backup ${BACKUP_FILE}..."
  tar -czf "$BACKUP_FILE" -C "$ROOT" "${TAR_PATHS[@]}"
  tar -tzf "$BACKUP_FILE" >/dev/null

  {
    echo "timestamp=${UTC_TS}"
    echo "sha=${SHORT_SHA}"
    for p in "${DATA_PATHS[@]}"; do
      echo "count:${p}=$(count_data_files "$ROOT/$p")"
    done
  } > "$STATE_FILE"
else
  echo "No manifest paths exist yet; skipping tar backup."
fi

if [[ -f "$BACKUP_FILE" ]]; then
  mapfile -t ALL_BACKUPS < <(ls -1t "${BACKUP_DIR}"/zoto-sites-*.tar.gz 2>/dev/null || true)
  if [[ ${#ALL_BACKUPS[@]} -gt "$BACKUP_KEEP" ]]; then
    for ((i = BACKUP_KEEP; i < ${#ALL_BACKUPS[@]}; i++)); do
      old="${ALL_BACKUPS[$i]}"
      [[ "$old" == "$BACKUP_FILE" ]] && continue
      rm -f "$old" "${old%.tar.gz}.state"
    done
  fi
fi

# --- (c) Data guards (before git pull / compose) ---
PRE_COUNT="$(count_data_files "$ROOT/$DATA_PATH")"
for p in "${DATA_PATHS[@]}"; do
  full="$ROOT/$p"
  if [[ -d "$full" ]]; then
    c="$(count_data_files "$full")"
    if [[ "$c" -gt 0 ]]; then
      echo "Data guard: ${p} has ${c} files"
    fi
  fi
done
if [[ -d "$ROOT/$DATA_PATH" ]] && [[ "$PRE_COUNT" -gt 0 ]]; then
  echo "Pre-deploy data file count (${DATA_PATH}): ${PRE_COUNT}"
elif [[ -d "$ROOT/$DATA_PATH" ]]; then
  echo "Note: ${DATA_PATH} exists but has no json/image files yet."
fi

if [[ "$PRE_COUNT" -gt 0 ]]; then
  now="$(count_data_files "$ROOT/$DATA_PATH")"
  if [[ "$now" -eq 0 ]]; then
    die "${DATA_PATH} was non-empty but is empty now; aborting before git pull"
  fi
fi

# --- (d) Update ---
echo "Checking out ${DEPLOY_BRANCH} and pulling (ff-only)..."
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"

# Re-read pre counts from state if we had data before pull
if [[ -f "$STATE_FILE" ]]; then
  PRE_COUNT="$(grep "^count:${DATA_PATH}=" "$STATE_FILE" | cut -d= -f2- || echo "$PRE_COUNT")"
fi

if [[ -d "$ROOT/$DATA_PATH" ]] && [[ "${PRE_COUNT:-0}" -gt 0 ]]; then
  now="$(count_data_files "$ROOT/$DATA_PATH")"
  if [[ ! -d "$ROOT/$DATA_PATH" ]] || [[ "$now" -eq 0 ]]; then
    die "data path ${DATA_PATH} missing or empty after pull (had ${PRE_COUNT} files)"
  fi
fi

# --- (e) Build and start ---
echo "Syncing host Let's Encrypt certs (if present)..."
bash scripts/sync-ssl.sh

if command -v node >/dev/null 2>&1; then
  if ! git diff --quiet -- nginx-conf/ 2>/dev/null; then
    : # tracked changes already blocked
  fi
  node scripts/generate-nginx.js
  if ! git diff --quiet -- nginx-conf/; then
    die "generate-nginx.js changed tracked nginx-conf/ files; aborting"
  fi
else
  echo "node not found on host; skipping generate-nginx.js (image regenerates confs at build)."
fi

echo "Building and starting services..."
docker compose up -d --build

# --- (f) Post-check ---
POST_COUNT="$(count_data_files "$ROOT/$DATA_PATH")"
if [[ "${PRE_COUNT:-0}" -gt 0 ]]; then
  if [[ "$POST_COUNT" -lt "$PRE_COUNT" ]]; then
    die "post-deploy file count dropped (${POST_COUNT} < ${PRE_COUNT}) for ${DATA_PATH}"
  fi
  echo "Post-deploy data file count (${DATA_PATH}): ${POST_COUNT} (>= ${PRE_COUNT})"
fi

echo "Waiting ~20s for containers to settle..."
sleep 20
for c in nginx botz discord; do
  status="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
  restarting="$(docker inspect -f '{{.State.Restarting}}' "$c" 2>/dev/null || echo true)"
  if [[ "$status" != "running" ]] || [[ "$restarting" == "true" ]]; then
    die "container $c not healthy (status=$status restarting=$restarting)"
  fi
done

echo ""
echo "Deploy complete."
if [[ -f "$BACKUP_FILE" ]]; then
  echo "Backup: ${BACKUP_FILE}"
  echo "Restore: docker compose stop && tar -xzf ${BACKUP_FILE} -C ${ROOT} && docker compose up -d"
else
  echo "No backup archive was created (no manifest paths on disk)."
fi
docker compose ps
