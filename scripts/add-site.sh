#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: ./scripts/add-site.sh <site-id> <domain> [extra-domains...]

Examples:
  ./scripts/add-site.sh example.com example.com www.example.com
  ./scripts/add-site.sh blog.zoto.io blog.zoto.io

Creates:
  - sites/<site-id>.json   (virtual host manifest)
  - www/<site-id>/         (static site directory with a starter index.html)

After adding a site, run:
  node scripts/generate-nginx.js
  docker compose up -d --build
EOF
}

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

SITE_ID="$1"
shift
DOMAINS=("$@")

if [[ -f "sites/${SITE_ID}.json" ]]; then
  echo "Site manifest already exists: sites/${SITE_ID}.json"
  exit 1
fi

if [[ -d "www/${SITE_ID}" ]]; then
  echo "www/${SITE_ID} already exists"
  exit 1
fi

DOMAINS_JSON=$(printf '"%s",' "${DOMAINS[@]}")
DOMAINS_JSON="[${DOMAINS_JSON%,}]"

cat > "sites/${SITE_ID}.json" <<EOF
{
  "id": "${SITE_ID}",
  "domains": ${DOMAINS_JSON}
}
EOF

mkdir -p "www/${SITE_ID}"

cat > "www/${SITE_ID}/index.html" <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${SITE_ID}</title>
</head>
<body>
  <h1>${SITE_ID}</h1>
  <p>Replace this page with your site content.</p>
</body>
</html>
EOF

node scripts/generate-nginx.js

echo ""
echo "Created site ${SITE_ID}:"
echo "  manifest: sites/${SITE_ID}.json"
echo "  content:  www/${SITE_ID}/"
echo "  nginx:    nginx-conf/${SITE_ID}.conf (generated)"
echo ""
echo "Next steps:"
echo "  1. Edit www/${SITE_ID}/"
echo "  2. Point DNS for ${DOMAINS[*]} at your droplet"
echo "  3. Redeploy: ./scripts/deploy.sh"
