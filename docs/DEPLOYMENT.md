# Deploying zoto-sites on DigitalOcean

This guide covers first-time droplet setup, TLS, secrets, and ongoing deploys.

## Architecture

```text
Internet → droplet:443/80 → nginx (Docker)
                              ├── static files from www/<site>/
                              └── /editorials, /archive → botz:3000 (Docker)
discord (Docker) ← Discord API (outbound only)
```

All services are managed with **Docker Compose** from the repository root.

## 1. Create a droplet

- **Image**: Ubuntu 24.04 LTS (or 22.04)
- **Size**: 1 GB RAM minimum (2 GB recommended if botz.ai generates content actively)
- **Firewall**: allow SSH (22), HTTP (80), HTTPS (443)

## 2. Bootstrap the VM

SSH in as root and run the bootstrap script from a clone, or pipe it from GitHub:

```bash
git clone https://github.com/zotoio/zoto-sites.git /opt/zoto-sites
cd /opt/zoto-sites
sudo bash scripts/bootstrap-droplet.sh
```

The script installs Docker, creates a `deploy` user, opens UFW for web traffic, and clones the repo to `/opt/zoto-sites`.

### SSH access for deploys

Add your public key (and a GitHub Actions deploy key) for the `deploy` user:

```bash
sudo -u deploy mkdir -p ~deploy/.ssh
sudo -u deploy nano ~deploy/.ssh/authorized_keys
```

## 3. Secrets and environment files

Copy examples and edit on the droplet (never commit real `.env` files):

```bash
cp backends/botz.ai/.env.example backends/botz.ai/.env
cp backends/discord/.env.example backends/discord/.env
chmod 600 backends/botz.ai/.env backends/discord/.env
```

### botz.ai (`backends/botz.ai/.env`)

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `NEWS_API_KEY` | Yes | News API key for article fetching |
| `SHARED_SECRET` | Yes | Shared with Discord bot for auth |
| `CACHE_DIR` | No | Defaults to `/home/root/cache` in container (mounted volume) |

### discord (`backends/discord/.env`)

| Variable | Required | Notes |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Bot token |
| `DISCORD_APPLICATION_ID` | Yes | Application ID for slash commands |
| `SHARED_SECRET` | Yes | Must match botz.ai |
| `EDITORIAL_FRONTEND_URL_PREFIX` | No | URL prefix shown to users (e.g. `https://botz.ai/#`) |

## 4. TLS / SSL

The nginx image (`krewh/hardened-nginx`) listens on 443 with SSL. For production, mount real certificates.

### Recommended: Certbot on the host

Install Certbot on the droplet and obtain certificates for all site domains. Example for a single cert with multiple names:

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d botz.ai -d www.botz.ai -d zoto.io ...
```

Copy or symlink certs into the repo `ssl/` directory (mounted read-only into nginx):

```bash
sudo mkdir -p /opt/zoto-sites/ssl
sudo cp /etc/letsencrypt/live/botz.ai/fullchain.pem /opt/zoto-sites/ssl/
sudo cp /etc/letsencrypt/live/botz.ai/privkey.pem /opt/zoto-sites/ssl/
sudo chown deploy:deploy /opt/zoto-sites/ssl/*.pem
```

`docker-compose.yml` mounts `./ssl` → `/etc/nginx/ssl`. The hardened-nginx entrypoint uses certificates from that path when present.

### Renewal

Add a cron job to renew and redeploy:

```bash
0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/botz.ai/*.pem /opt/zoto-sites/ssl/ && cd /opt/zoto-sites && docker compose restart nginx
```

### Local / staging without real certs

Leave `ssl/` empty. The container generates a **self-signed** certificate at startup.

## 5. First deploy

On the droplet as `deploy`:

```bash
cd /opt/zoto-sites
./scripts/deploy.sh
```

Or from your laptop:

```bash
DEPLOY_PATH=/opt/zoto-sites ./scripts/deploy.sh deploy@YOUR_DROPLET_IP
```

The deploy script pulls latest `main`, regenerates nginx configs from `sites/`, and runs `docker compose up -d --build`.

## 6. GitHub Actions deploy

Configure these **repository secrets** (and optionally a `production` environment):

| Secret | Example |
| --- | --- |
| `DEPLOY_HOST` | `203.0.113.10` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | Private key matching `authorized_keys` on the droplet |
| `DEPLOY_PATH` | `/opt/zoto-sites` |

Workflow: `.github/workflows/deploy.yml`

- Runs on push to `main` and on manual `workflow_dispatch`
- SSHs to the droplet and runs the same steps as `./scripts/deploy.sh`

Until secrets are configured, the workflow will fail at the SSH step — that is expected.

## 7. Add a site in production

```bash
./scripts/add-site.sh newsite.example newsite.example www.newsite.example
git add sites/ www/ nginx-conf/
git commit -m "Add newsite.example"
git push
```

After CI deploy (or manual `./scripts/deploy.sh` on the droplet), obtain/extend TLS certs for the new domain and restart nginx if needed.

## 8. Troubleshooting

```bash
docker compose ps
docker compose logs nginx
docker compose logs botz
docker compose logs discord
```

- **502 on /editorials**: botz container not running or missing `.env`
- **Certificate warnings**: expected with self-signed certs; install Let's Encrypt certs for production
- **Stale nginx config**: run `node scripts/generate-nginx.js` before deploy

## Migration notes

If upgrading from the pre-manifest layout:

1. Pull this branch on the droplet
2. `node scripts/generate-nginx.js` — regenerates `nginx-conf/` from `sites/`
3. `./scripts/deploy.sh` — rebuilds nginx image with new configs
4. Existing `www/` content and botz.ai proxy behavior are unchanged

Hand-edited `nginx-conf/*.conf` files are replaced by generated output. Future vhost changes go through `sites/*.json` only.
