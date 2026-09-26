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
| **nginx container** | Terminates origin TLS; vhosts inherit `krewh/hardened-nginx` paths under `/etc/nginx/ssl/` (populated from `./ssl/` at start — see [Production TLS](#production-tls-existing-lets-encrypt-on-the-host)) |
| **botz container** | Dynamic editorial API; optional Cloudflare cache purge via API |

All services are managed with **Docker Compose** from the repository root.

## Production TLS (existing Let's Encrypt on the host)

**Checkout path (live droplet):** `/home/andrewv/git/zoto-sites` — compose project `zoto-sites`, `com.docker.compose.project.working_dir` on all three containers. `DEPLOY_PATH` (GitHub Actions secret and `scripts/deploy.sh` default) must be exactly this path; `deploy-safe.sh` aborts if running containers were started from a different working directory.

**How nginx finds TLS material**

| Stage | Behaviour |
| --- | --- |
| **Live today (pre-PR)** | No `ssl/` bind mount. Certs at `/etc/nginx/ssl/default_cert.pem` and `default_key.pem` live in the container writable layer (e.g. copied in via `docker cp` / exec). Recreating nginx would lose them. Site vhosts do not set `ssl_certificate`; they use the base image defaults under `/etc/nginx/ssl/`. |
| **After this PR** | Host `./ssl/` → container `/etc/nginx/certs:ro`. `docker/nginx-entrypoint.sh` copies `fullchain.pem`+`privkey.pem` **or** `default_cert.pem`+`default_key.pem` into `/etc/nginx/ssl/` before `nginx` starts. Vhosts still use the same effective paths (`/etc/nginx/ssl/default_*`). Empty `ssl/` on a fresh laptop still gets a one-off self-signed generate inside the container. |
| **sync-ssl.sh** | When host LE exists, writes `ssl/fullchain.pem` and `ssl/privkey.pem` (never committed). |

Certificates also live on the droplet under `/etc/letsencrypt/live/<name>/`. The container does **not** read `/etc/letsencrypt` directly.

| File in `ssl/` | Typical source |
| --- | --- |
| `fullchain.pem` | `/etc/letsencrypt/live/<name>/fullchain.pem` via `sync-ssl.sh` |
| `privkey.pem` | `/etc/letsencrypt/live/<name>/privkey.pem` via `sync-ssl.sh` |
| `default_cert.pem` / `default_key.pem` | `docker cp nginx:/etc/nginx/ssl/. ssl/` before first post-PR recreate (migration) |

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
0 3 * * * certbot renew --quiet && /home/andrewv/git/zoto-sites/scripts/sync-ssl.sh && cd /home/andrewv/git/zoto-sites && docker compose restart nginx
```

### Local development

Leave `ssl/` empty (only `ssl/.gitkeep`). The entrypoint generates a **self-signed** cert under `/etc/nginx/ssl/` — fine for `curl -k` testing only.

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
| `CACHE_DIR` | No | Compose sets `/home/root/cache` (bind mount). Code default matches; keep in `.env` for local non-Docker runs |
| `CF_ZONE_ID` | No | Cloudflare zone ID for cache purge after new editorials |
| `CF_API_TOKEN` | No | API token with `Cache Purge` permission |

### discord (`backends/discord/.env`)

| Variable | Required | Notes |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Bot token |
| `DISCORD_APPLICATION_ID` | Yes | Application ID for slash commands |
| `SHARED_SECRET` | Yes | Must match botz.ai |
| `EDITORIAL_FRONTEND_URL_PREFIX` | No | URL shown to users (e.g. `https://botz.ai/#`) |

## Persistent data

Host paths below are **relative to the git checkout** (`/home/andrewv/git/zoto-sites` on the live droplet). They are listed in `deploy/persistent-data.txt`. **Backups are handled outside this repository** (your own snapshot/backup process). `scripts/deploy-safe.sh` guarantees deploys will not overwrite, delete, or orphan these paths: it refuses mount regressions, dirty trees, and any drop in editorial cache file counts.

| Host path | Container path | Writer | Criticality |
| --- | --- | --- | --- |
| `backends/botz.ai/cache/` | botz: `/home/root/cache`; nginx: `/usr/share/nginx/html/botz.ai/cache` (read-only) | botz API | **Critical** — ~21k+ editorial JSON + PNG archive |
| `backends/botz.ai/.env` | (env_file) | operator | **Critical** — API keys, `SHARED_SECRET`, optional `CACHE_DIR` |
| `backends/discord/.env` | (env_file) | operator | **Critical** — Discord token and shared secret |
| `ssl/` | nginx: `/etc/nginx/certs` (read-only) → copied to `/etc/nginx/ssl` at start | `sync-ssl.sh`, or migration `docker cp` from nginx | **Critical for recreate** — also regenerable from LE or copied from old container layer |

Compose bind-mount sources allowed by policy: `./backends/botz.ai/cache`, `${SSL_CERT_DIR:-./ssl}` → `/etc/nginx/certs`. There are **no** named Docker volumes.

**Never run on the droplet checkout** (they can delete or orphan the archive and secrets):

- `git clean -fdx` / `git clean -X`
- `git reset --hard`
- `git stash`
- `docker compose down -v` or `--volumes`
- `docker volume rm` / `docker volume prune`
- `rm -rf backends/botz.ai/cache` (or other manifest paths)

### FIRST-DEPLOY checklist (live droplet → this PR)

Run on the droplet **before** the first deploy that uses `deploy-safe.sh`. The GitHub Actions deploy job runs `git fetch` then `bash scripts/deploy-safe.sh` from the **current** checkout; the first time this lands, ensure `scripts/deploy-safe.sh` exists (merge this PR, or copy the script and manifest from `main` once manually).

1. Record running mounts and compose labels:
   ```bash
   for c in nginx botz discord; do
     echo "== $c"
     docker inspect -f '{{json .Mounts}}' "$c"
     docker inspect -f 'working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c"
   done
   ```
2. Confirm botz writes to the bind mount, not the container layer:
   ```bash
   docker exec botz printenv CACHE_DIR
   docker exec botz ls /var/lib/cache
   ```
   If files exist under `/var/lib/cache`, copy them **before** recreating botz:
   ```bash
   docker cp botz:/var/lib/cache/. backends/botz.ai/cache/
   ```
3. Confirm checkout path matches `DEPLOY_PATH`: **`/home/andrewv/git/zoto-sites`** (compose `working_dir` on nginx/botz/discord must match).
4. **Migrate nginx TLS off the container layer** (required before the first recreate). Production certs today are only inside the running `nginx` container under `/etc/nginx/ssl/`. Copy them to the host mount source (gitignored), then fix permissions — `deploy-safe.sh` refuses to deploy while `nginx` is running if `ssl/` has no cert/key pair:
   ```bash
   cd /home/andrewv/git/zoto-sites
   docker cp nginx:/etc/nginx/ssl/. ssl/
   chmod 644 ssl/default_cert.pem
   chmod 600 ssl/default_key.pem
   ```
   Alternatively, after `sudo ./scripts/sync-ssl.sh` if host LE paths exist (`fullchain.pem` + `privkey.pem`).
5. Confirm your **external backup** is current; count cache files:
   ```bash
   find backends/botz.ai/cache -maxdepth 1 -name '*.json' | wc -l
   ```
6. `git status` clean; no untracked files that would collide with incoming tracked paths; note `git log -1`.
7. Ensure `backends/botz.ai/node_modules` and `backends/discord/node_modules` exist (Dockerfiles `COPY` them).
8. `docker compose version` (v2).
9. Deploy: `./scripts/deploy.sh` or GitHub Actions; verify cache file counts unchanged and https://botz.ai/archive loads.

## Deploy and update

On the droplet as `deploy`:

```bash
cd /home/andrewv/git/zoto-sites
./scripts/deploy.sh
```

From your laptop (SSH to droplet IP — not the Cloudflare edge IP):

```bash
DEPLOY_PATH=/home/andrewv/git/zoto-sites ./scripts/deploy.sh deploy@YOUR_DROPLET_IP
```

Each deploy runs `scripts/deploy-safe.sh`:

1. Preflight (clean tree, untracked collision check, compose v2, bind-mount regression guard)
2. Data guards on manifest data paths (file counts; abort if non-empty paths would be lost)
3. `git pull --ff-only origin main`
4. `scripts/sync-ssl.sh`
5. `node scripts/generate-nginx.js` only when `node` is on the host (skipped otherwise; image regenerates confs)
6. `docker compose up -d --build` and post-checks (counts and container health)

GitHub Actions (`.github/workflows/deploy.yml`) runs `git fetch origin main` and `bash scripts/deploy-safe.sh` over SSH when `DEPLOY_*` secrets are set.

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
| `DEPLOY_PATH` | `/home/andrewv/git/zoto-sites` |

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
