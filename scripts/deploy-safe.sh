#!/usr/bin/env bash
# Safe production deploy: preflight, data guards, ff-only pull, compose up.
# Does not write into manifest data paths (read-only checks and counts only).
#
# NEVER run from this script (or extend it to run):
#   git clean, git reset --hard, git stash,
#   docker compose down -v / --volumes, docker volume rm/prune,
#   rm -rf on manifest data paths.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=compose-stack.sh
source "$ROOT/scripts/compose-stack.sh"
zoto_compose_init "$ROOT"

MANIFEST="${ROOT}/deploy/persistent-data.txt"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
STATE_FILE=""

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-safe.sh

Environment:
  DEPLOY_BRANCH   Git branch to deploy (default: main)

Runs from the repository root. Refuses dirty trees, mount regressions, and data loss.
Backups are handled outside this repository; this script only guards persistent paths.
EOF
}

die() {
  echo "deploy-safe: $*" >&2
  exit 1
}

# Preflight uses small Node snippets; host Node is optional (see docs/DEPLOYMENT.md).
run_node() {
  if command -v node >/dev/null 2>&1; then
    node "$@"
  else
    docker run --rm -i node:18-alpine node "$@"
  fi
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ -f "$MANIFEST" ]] || die "missing manifest at deploy/persistent-data.txt (run from checkout root)"

STATE_FILE="$(mktemp)"
trap 'rm -f "$STATE_FILE"' EXIT

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

read_manifest_paths() {
  local section=""
  DATA_PATHS=()
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

pre_count_for() {
  grep "^count:${1}=" "$STATE_FILE" 2>/dev/null | cut -d= -f2- || echo "0"
}

record_data_counts() {
  {
    for p in "${DATA_PATHS[@]}"; do
      echo "count:${p}=$(count_data_files "$ROOT/$p")"
    done
  } > "$STATE_FILE"
}

assert_data_guards() {
  local label="$1"
  for p in "${DATA_PATHS[@]}"; do
    local pre
    pre="$(pre_count_for "$p")"
    if [[ "$pre" -gt 0 ]]; then
      local now
      now="$(count_data_files "$ROOT/$p")"
      if [[ ! -d "$ROOT/$p" ]] || [[ "$now" -eq 0 ]]; then
        die "${label}: data path ${p} missing or empty (had ${pre} files)"
      fi
      if [[ "$now" -lt "$pre" ]]; then
        die "${label}: data path ${p} file count dropped (${now} < ${pre})"
      fi
    fi
  done
}

compose_bind_sources() {
  zoto_compose config --format json | run_node -e "
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

  for c in nginx botz discord today; do
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

  local botz_cache_mount
  botz_cache_mount="$(zoto_compose config --format json | run_node -e "
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

resolve_ssl_dir() {
  local ssl="${SSL_CERT_DIR:-./ssl}"
  if [[ "$ssl" != /* ]]; then
    echo "${ROOT}/${ssl#./}"
  else
    echo "$ssl"
  fi
}

assert_host_ssl_dir_consistent() {
  local d="$1"
  [[ -d "$d" ]] || return 0

  local le_cert=0 le_key=0 def_cert=0 def_key=0
  [[ -e "${d}/fullchain.pem" ]] && le_cert=1
  [[ -e "${d}/privkey.pem" ]] && le_key=1
  [[ -e "${d}/default_cert.pem" ]] && def_cert=1
  [[ -e "${d}/default_key.pem" ]] && def_key=1

  if [[ "$le_cert" -eq 1 || "$le_key" -eq 1 ]]; then
    if [[ ! -s "${d}/fullchain.pem" || ! -s "${d}/privkey.pem" ]]; then
      die "host ssl/ has a partial LE pair (need non-empty fullchain.pem and privkey.pem, or remove both)"
    fi
    echo "Host TLS: LE fullchain.pem + privkey.pem in ${d}"
    return 0
  fi

  if [[ "$def_cert" -eq 1 || "$def_key" -eq 1 ]]; then
    if [[ ! -s "${d}/default_cert.pem" || ! -s "${d}/default_key.pem" ]]; then
      die "host ssl/ has a partial default pair (need non-empty default_cert.pem and default_key.pem, or remove both)"
    fi
    echo "Host TLS: default_cert.pem + default_key.pem in ${d}"
    return 0
  fi

  echo "Host ssl/ empty — nginx entrypoint will use self-signed origin TLS (same as today)."
}

assert_host_ssl_dir_consistent "$(resolve_ssl_dir)"

TODAY_ENV="${ROOT}/backends/today.zoto.io/.env"
if [[ ! -f "$TODAY_ENV" ]]; then
  echo "Note: $TODAY_ENV missing — today API will serve demo news until configured; nginx and other sites are unaffected."
fi

# --- (b) Record pre-deploy counts and data guards ---
record_data_counts
for p in "${DATA_PATHS[@]}"; do
  c="$(pre_count_for "$p")"
  if [[ "$c" -gt 0 ]]; then
    echo "Data guard: ${p} has ${c} files"
  elif [[ -d "$ROOT/$p" ]]; then
    echo "Note: ${p} exists but has no json/image files yet."
  fi
done

assert_data_guards "pre-deploy"

# --- (c) Update ---
echo "Checking out ${DEPLOY_BRANCH} and pulling (ff-only)..."
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"

assert_data_guards "post-pull"

# --- (d) Build and start ---
echo "Syncing host Let's Encrypt certs (if present)..."
bash scripts/sync-ssl.sh

assert_host_ssl_dir_consistent "$(resolve_ssl_dir)"

if command -v node >/dev/null 2>&1; then
  node scripts/generate-nginx.js
  if ! git diff --quiet -- nginx-conf/; then
    die "generate-nginx.js changed tracked nginx-conf/ files; aborting"
  fi
else
  echo "node not found on host; skipping generate-nginx.js (image regenerates confs at build)."
fi

echo "Building and starting services..."
zoto_compose up -d --build

# --- (e) Post-check ---
assert_data_guards "post-deploy"
for p in "${DATA_PATHS[@]}"; do
  pre="$(pre_count_for "$p")"
  if [[ "$pre" -gt 0 ]]; then
    now="$(count_data_files "$ROOT/$p")"
    echo "Post-deploy ${p}: ${now} files (>= ${pre})"
  fi
done

warn_container() {
  echo "deploy-safe: warning: $*" >&2
}

echo "Waiting ~20s for containers to settle..."
sleep 20
for c in nginx botz discord; do
  status="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
  restarting="$(docker inspect -f '{{.State.Restarting}}' "$c" 2>/dev/null || echo true)"
  if [[ "$status" != "running" ]] || [[ "$restarting" == "true" ]]; then
    die "container $c not healthy (status=$status restarting=$restarting)"
  fi
done

for c in today; do
  status="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
  restarting="$(docker inspect -f '{{.State.Restarting}}' "$c" 2>/dev/null || echo true)"
  if [[ "$status" != "running" ]] || [[ "$restarting" == "true" ]]; then
    warn_container "optional container $c not healthy (status=$status restarting=$restarting) — other sites remain up"
  fi
done

echo ""
echo "Deploy complete."
zoto_compose ps
