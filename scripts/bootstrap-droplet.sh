#!/usr/bin/env bash
set -euo pipefail

# Bootstrap a fresh Ubuntu DigitalOcean droplet for zoto-sites.
# For disaster recovery / greenfield only — production already has Docker,
# Let's Encrypt on the host, and Cloudflare in front of each domain.

REPO_URL="${REPO_URL:-https://github.com/zotoio/zoto-sites.git}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/zoto-sites}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/bootstrap-droplet.sh"
  exit 1
fi

echo "==> Installing Docker..."
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable docker
systemctl start docker

echo "==> Creating deploy user (${DEPLOY_USER})..."
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${DEPLOY_USER}"
  usermod -aG docker "${DEPLOY_USER}"
fi

echo "==> Configuring firewall (SSH, HTTP, HTTPS for Cloudflare origin)..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Cloning repository to ${DEPLOY_PATH}..."
mkdir -p "$(dirname "${DEPLOY_PATH}")"
if [[ ! -d "${DEPLOY_PATH}/.git" ]]; then
  git clone --branch "${DEPLOY_BRANCH}" "${REPO_URL}" "${DEPLOY_PATH}"
fi
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_PATH}"

echo "==> Creating secrets directories..."
mkdir -p "${DEPLOY_PATH}/backends/botz.ai" "${DEPLOY_PATH}/backends/discord"
mkdir -p "${DEPLOY_PATH}/ssl" "${DEPLOY_PATH}/backends/botz.ai/cache"

for example in \
  "${DEPLOY_PATH}/backends/botz.ai/.env.example" \
  "${DEPLOY_PATH}/backends/discord/.env.example"; do
  target="${example%.example}"
  if [[ -f "${example}" && ! -f "${target}" ]]; then
    cp "${example}" "${target}"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "${target}"
    chmod 600 "${target}"
    echo "Created ${target} from example — edit before starting services."
  fi
done

chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_PATH}"

cat <<EOF

Bootstrap complete.

Next steps (as ${DEPLOY_USER}):

  1. Add SSH keys for GitHub Actions / your laptop:
       sudo -u ${DEPLOY_USER} mkdir -p ~${DEPLOY_USER}/.ssh

  2. Edit secrets on the droplet:
       ${DEPLOY_PATH}/backends/botz.ai/.env
       ${DEPLOY_PATH}/backends/discord/.env

  3. TLS (production uses existing host Let's Encrypt — see docs/DEPLOYMENT.md):
       - Point Cloudflare proxied DNS at this droplet
       - Issue or copy LE certs on the host, then: ./scripts/sync-ssl.sh

  4. First deploy:
       sudo -u ${DEPLOY_USER} bash -lc 'cd ${DEPLOY_PATH} && ./scripts/deploy.sh'

  5. Cloudflare: SSL/TLS mode Full (strict); bypass cache for botz.ai /editorials and /archive

  6. GitHub repo secrets for CI deploy:
       DEPLOY_HOST (droplet origin IP), DEPLOY_USER, DEPLOY_SSH_KEY, DEPLOY_PATH

EOF
