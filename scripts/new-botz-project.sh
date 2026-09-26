#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/new-botz-project.sh <name> --static
  ./scripts/new-botz-project.sh <name> --proxy <service:port>

Creates projects/botz.ai/<name>/ with project.yml and public/index.html (static).

Examples:
  ./scripts/new-botz-project.sh demo --static
  ./scripts/new-botz-project.sh myapp --proxy myapp:8080

Next steps are printed after scaffolding.
EOF
}

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

NAME="$1"
shift

# Validate DNS label via node (shared rules with CI)
if ! node -e "
const { validateDnsLabel } = require('./scripts/lib/botz-projects');
const err = validateDnsLabel(process.argv[1]);
if (err) { console.error(err); process.exit(1); }
" "$NAME"; then
  exit 1
fi

PROJECT_DIR="projects/botz.ai/${NAME}"
if [[ -e "$PROJECT_DIR" ]]; then
  echo "Project already exists: $PROJECT_DIR"
  exit 1
fi

MODE=""
PROXY_TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --static)
      MODE=static
      shift
      ;;
    --proxy)
      MODE=proxy
      shift
      PROXY_TARGET="${1:-}"
      if [[ -z "$PROXY_TARGET" ]]; then
        echo "--proxy requires service:port (e.g. myservice:8080)"
        exit 1
      fi
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "Specify --static or --proxy <service:port>"
  usage
  exit 1
fi

mkdir -p "${PROJECT_DIR}/public"

if [[ "$MODE" == "static" ]]; then
  cat > "${PROJECT_DIR}/project.yml" <<EOF
enabled: true
type: static
title: ${NAME}.botz.ai
spa_fallback: false
EOF

  cat > "${PROJECT_DIR}/public/index.html" <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${NAME}.botz.ai</title>
</head>
<body>
  <h1>${NAME}.botz.ai</h1>
  <p>Replace this page with your project files in <code>public/</code>.</p>
</body>
</html>
EOF

else
  cat > "${PROJECT_DIR}/project.yml" <<EOF
enabled: true
type: proxy
title: ${NAME}.botz.ai
proxy:
  upstream: http://${PROXY_TARGET}
  websocket: false
EOF

  cat > "${PROJECT_DIR}/public/.gitkeep" <<'EOF'
EOF
fi

node scripts/generate-nginx.js

echo ""
echo "Created botz.ai subdomain project: ${NAME}"
echo "  manifest: ${PROJECT_DIR}/project.yml"
if [[ "$MODE" == "static" ]]; then
  echo "  content:  ${PROJECT_DIR}/public/"
else
  echo "  proxy:    http://${PROXY_TARGET} (add a Compose service — see docs/SUBDOMAINS.md)"
  echo "  compose:  compose/projects/${NAME}.yml (create from compose/projects/README.md)"
fi
echo "  nginx:    nginx-conf/botz.ai-sub-${NAME}.conf (generated)"
echo ""
echo "Next steps:"
echo "  1. Edit ${PROJECT_DIR}/"
if [[ "$MODE" == "proxy" ]]; then
  echo "  2. Add docker compose service (internal network only, no host ports)"
fi
echo "  3. git add projects/ nginx-conf/"
echo "  4. git commit && git push"
echo "  5. On the droplet: ./scripts/deploy-safe.sh  (or ./scripts/deploy.sh)"
echo ""
echo "DNS: wildcard *.botz.ai in Cloudflare is a one-time step — see docs/SUBDOMAINS.md"
