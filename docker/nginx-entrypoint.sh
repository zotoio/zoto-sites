#!/bin/sh
# krewh/hardened-nginx generates certs in /etc/nginx/ssl at startup; vhosts inherit those paths.
# Host LE or migrated certs live in /etc/nginx/certs (bind mount from ./ssl). Copy into /etc/nginx/ssl
# when present so a recreated container serves the same material without writing over a :ro mount.
set -e

CERT_DIR=/etc/nginx/ssl
MOUNT_DIR=/etc/nginx/certs

mkdir -p "${CERT_DIR}"

if [ -s "${MOUNT_DIR}/fullchain.pem" ] && [ -s "${MOUNT_DIR}/privkey.pem" ]; then
  cp "${MOUNT_DIR}/fullchain.pem" "${CERT_DIR}/default_cert.pem"
  cp "${MOUNT_DIR}/privkey.pem" "${CERT_DIR}/default_key.pem"
elif [ -s "${MOUNT_DIR}/default_cert.pem" ] && [ -s "${MOUNT_DIR}/default_key.pem" ]; then
  cp "${MOUNT_DIR}/default_cert.pem" "${CERT_DIR}/default_cert.pem"
  cp "${MOUNT_DIR}/default_key.pem" "${CERT_DIR}/default_key.pem"
elif [ ! -s "${CERT_DIR}/default_cert.pem" ] || [ ! -s "${CERT_DIR}/default_key.pem" ]; then
  openssl req -subj '/CN=localhost' -x509 -newkey rsa:4096 -nodes \
    -keyout "${CERT_DIR}/default_key.pem" \
    -out "${CERT_DIR}/default_cert.pem" -days 365
fi

exec nginx -g 'daemon off;'
