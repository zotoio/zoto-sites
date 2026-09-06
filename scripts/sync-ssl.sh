#!/usr/bin/env bash
set -euo pipefail

# Copy existing host Let's Encrypt certificates into ssl/ for the nginx container.
# Production droplets already have certs under /etc/letsencrypt/live/<name>/.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSL_DIR="${SSL_DIR:-${ROOT}/ssl}"
LE_CERT_DIR="${LE_CERT_DIR:-/etc/letsencrypt/live/botz.ai}"

if [[ ! -f "${LE_CERT_DIR}/fullchain.pem" || ! -f "${LE_CERT_DIR}/privkey.pem" ]]; then
  echo "No Let's Encrypt certs at ${LE_CERT_DIR} — skipping ssl sync (ok for local dev)."
  exit 0
fi

mkdir -p "${SSL_DIR}"

if [[ ! -w "${SSL_DIR}" ]]; then
  echo "ssl/ is not writable. Run with sudo or fix permissions: ${SSL_DIR}"
  exit 1
fi

cp "${LE_CERT_DIR}/fullchain.pem" "${SSL_DIR}/fullchain.pem"
cp "${LE_CERT_DIR}/privkey.pem" "${SSL_DIR}/privkey.pem"
chmod 644 "${SSL_DIR}/fullchain.pem"
chmod 600 "${SSL_DIR}/privkey.pem"

echo "Synced TLS certs from ${LE_CERT_DIR} → ${SSL_DIR}/"
