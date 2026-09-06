# Deploying zoto-sites on DigitalOcean

Production runs on a **DigitalOcean droplet** behind **Cloudflare CDN**. TLS certificates are issued on the **host VM** with Let's Encrypt (already in place) and copied into the repo `ssl/` directory for the nginx container.

## Architecture

```text
Browser ──HTTPS──► Cloudflare (CDN, orange-cloud proxy)
                         │
                         └──HTTPS (Full Strict)──► droplet:443 ──► nginx (Docker)
                                                           ├── static files from www/<site>/
                                                           └── /editorials, /archive → botz:3000
discord (Docker) ◄── Discord API (outbound only)
```

| Layer | Role |
| --- | --- |
| **Cloudflare** | Public DNS, TLS to visitors, CDN caching for static assets |
| **Droplet (host)** | Docker Compose, Let's Encrypt cert storage, `deploy` user |
| **nginx container** | Terminates origin TLS using certs mounted from `./ssl/` |
| **botz container** | Dynamic editorial API; optional Cloudflare cache purge via API |

All services are managed with **Docker Compose** from the repository root.

## Production TLS (existing Let's Encrypt on the host)

Certificates already live on the droplet under `/etc/letsencrypt/live/<name>/` (typical layout). The nginx container does **not** read `/etc/letsencrypt` directly — it mounts `./ssl/` from the repo:

| File in `ssl/` | Source on host |
| --- | --- |
| `fullchain.pem` | `/etc/letsencrypt/live/<name>/fullchain.pem` |
| `privkey.pem` | `/etc/letsencrypt/live/<name>/privkey.pem` |

### Sync certs into the repo before deploy

Use the helper script (default cert dir: `/etc/letsencrypt/live/botz.ai`):

```bash
# On the droplet, after certbot renew or before deploy
sudo ./scripts/sync-ssl.sh
# Or override the live cert directory:
sudo LE_CERT_DIR=/etc/letsencrypt/live/botz.ai ./scripts/sync-ssl.sh
```

`./scripts/deploy.sh` runs `sync-ssl.sh` automatically when host LE certs are present.

### Renewal

Certbot renewal stays on the **host** (existing cron/systemd timer). After renewal, sync and restart nginx:

```bash
sudo certbot renew --quiet
sudo ./scripts/sync-ssl.sh
docker compose restart nginx
```

A typical host cron hook (adjust paths to match your setup):

```bash
0 3 * * * certbot renew --quiet && /opt/zoto-sites/scripts/sync-ssl.sh && cd /opt/zoto-sites && docker compose restart nginx
```

### Local development

Leave `ssl/` empty. `krewh/hardened-nginx` generates a **self-signed** certificate — fine for `curl -k` testing only.

### Greenfield droplet only

If you are standing up a **new** VM with no certificates yet, see [Greenfield TLS (optional)](#greenfield-tls-optional) at the end. Production today already has LE on the host.

## Cloudflare CDN

Every public domain is proxied through Cloudflare (orange cloud ☁️). The origin droplet is not meant to receive unproxied public traffic for site hostnames.

### DNS

| Record | Type | Value | Proxy |
| --- | --- | --- | --- |
| `botz.ai`, `www`, other site hostnames | `A` or `CNAME` | Droplet IP (or tunnel) | **Proxied** (orange) |

When adding a site, create the DNS record in Cloudflare **before** expecting traffic. `./scripts/add-site.sh` only creates repo files — DNS is configured in the Cloudflare dashboard (or API).

### SSL/TLS mode (required: Full (strict))

In Cloudflare → **SSL/TLS** → **Overview**:

- Set encryption mode to **Full (strict)** (not Flexible, not Full without valid origin cert).
- Cloudflare terminates HTTPS for visitors; it connects to the origin on **port 443** using the Let's Encrypt cert nginx presents from `ssl/`.
- **Flexible** mode (HTTPS visitor → HTTP origin) is **not** compatible with this stack: nginx vhosts listen on 443 with SSL only for site traffic.

Edge certificates (Cloudflare → browser) are managed by Cloudflare. Origin certificates are the host LE certs synced into `ssl/`.

### What stays on the origin

| Concern | Setting |
| --- | --- |
| Origin TLS | Valid LE `fullchain.pem` / `privkey.pem` in `ssl/` |
| Cloudflare SSL mode | **Full (strict)** |
| Origin ports | `80` and `443` open on droplet (Cloudflare connects to both depending on config; 443 + strict is the production path) |
| Bot secrets / API keys | Host `.env` files only — never in Cloudflare |
| Editorial disk cache | `backends/botz.ai/cache` volume on droplet |

### Caching and botz.ai dynamic routes

**Static sites** (`zoto.io`, `halt.sh`, etc.): default Cloudflare caching is generally fine for HTML/CSS/JS. Purge cache in Cloudflare after deploy if you need instant updates.

**botz.ai — do not cache these at the CDN edge:**

| Path | Why |
| --- | --- |
| `/editorials` | Generated per-request or per-cache-key; stale edge cache would serve wrong editorials |
| `/archive` | Paginated, changes as new editorials are created |
| `/cache/images/*` | Served via botz API; content updates when new images are generated |

Recommended Cloudflare **Cache Rules** (or Page Rules on older plans) for zone `botz.ai`:

- **Bypass cache** for path `/editorials*` and `/archive*`
- Optionally bypass or short TTL for `/cache/*` if images change frequently

The botz backend can purge Cloudflare after publishing when `CF_ZONE_ID` and `CF_API_TOKEN` are set in `backends/botz.ai/.env` (see `.env.example`). That complements — does not replace — bypass rules for dynamic API paths.

Static assets on botz.ai (`/`, `/index.html`, CSS, JS under `/`) may be cached at the edge; purge after frontend deploys if needed.

## Secrets and environment files

On the droplet (never commit real `.env` files):

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
| `CF_ZONE_ID` | No | Cloudflare zone ID for cache purge after new editorials |
| `CF_API_TOKEN` | No | API token with `Cache Purge` permission |

### discord (`backends/discord/.env`)

| Variable | Required | Notes |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Bot token |
| `DISCORD_APPLICATION_ID` | Yes | Application ID for slash commands |
| `SHARED_SECRET` | Yes | Must match botz.ai |
| `EDITORIAL_FRONTEND_URL_PREFIX` | No | URL shown to users (e.g. `https://botz.ai/#`) |

## Deploy and update

On the droplet as `deploy`:

```bash
cd /opt/zoto-sites
./scripts/deploy.sh
```

From your laptop (SSH to droplet IP — not the Cloudflare edge IP):

```bash
DEPLOY_PATH=/opt/zoto-sites ./scripts/deploy.sh deploy@YOUR_DROPLET_IP
```

Each deploy:

1. `git pull` (branch `main` by default)
2. `scripts/sync-ssl.sh` — copy host LE certs into `ssl/` when present
3. `node scripts/generate-nginx.js` — render vhosts from `sites/`
4. `docker compose up -d --build`

GitHub Actions (`.github/workflows/deploy.yml`) runs the same steps over SSH when `DEPLOY_*` secrets are set.

## Add a site in production

```bash
./scripts/add-site.sh newsite.example newsite.example www.newsite.example
git add sites/ www/ nginx-conf/
git commit -m "Add newsite.example"
git push
```

Then in **Cloudflare**:

1. Add proxied DNS for the new hostname(s) → droplet IP
2. Confirm SSL mode remains **Full (strict)**
3. If the hostname is on a new LE certificate, renew/reissue on the host and run `./scripts/sync-ssl.sh`
4. Deploy: `./scripts/deploy.sh`

## Bootstrap (new droplet only)

`scripts/bootstrap-droplet.sh` installs Docker, configures UFW (SSH + 80 + 443), and clones the repo. It does **not** configure Cloudflare or Certbot — production already has those on the existing host.

Use bootstrap only for disaster recovery or a second environment. After bootstrap, point Cloudflare DNS at the new IP, sync or issue LE certs on the host, then deploy.

## GitHub Actions deploy

| Secret | Example |
| --- | --- |
| `DEPLOY_HOST` | Droplet **origin** IP or SSH hostname (not a Cloudflare edge IP) |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | Private key matching `authorized_keys` on the droplet |
| `DEPLOY_PATH` | `/opt/zoto-sites` |

## Troubleshooting

```bash
docker compose ps
docker compose logs nginx
docker compose logs botz
docker compose logs discord
```

| Symptom | Likely cause |
| --- | --- |
| **502 on /editorials** | botz container down or missing `.env` |
| **525 / SSL handshake failed** (Cloudflare) | Origin cert missing/expired — run `sync-ssl.sh`, check `ssl/*.pem` |
| **Stale editorials at edge** | CDN caching `/editorials` — add bypass rule; optional `CF_*` purge in botz |
| **Stale nginx config** | Run `node scripts/generate-nginx.js` before deploy |
| **Redirect loops** | Cloudflare SSL mode set to Flexible while origin requires HTTPS |

## Migration from hand-written nginx configs

1. Pull this branch on the droplet
2. `node scripts/generate-nginx.js` — regenerates `nginx-conf/` from `sites/`
3. `./scripts/sync-ssl.sh` — refresh `ssl/` from existing host LE certs
4. `./scripts/deploy.sh` — rebuild nginx with new configs

Existing `www/` content, host LE setup, Cloudflare DNS, and botz.ai proxy behavior are unchanged. Edit `sites/*.json` instead of `nginx-conf/*.conf` going forward.

---

## Greenfield TLS (optional)

Only for a **new** droplet with no certificates yet. Production already uses host-managed Let's Encrypt.

```bash
sudo apt install -y certbot
# DNS must already point at this host (or use DNS challenge via Cloudflare plugin)
sudo certbot certonly --standalone -d botz.ai -d www.botz.ai -d zoto.io ...
sudo LE_CERT_DIR=/etc/letsencrypt/live/botz.ai ./scripts/sync-ssl.sh
```

Prefer **DNS-01** challenge via Cloudflare when the site is already proxied (HTTP-01 to the origin can fail while orange-cloud is on). After issuance, use **Full (strict)** and the sync/deploy flow above.
