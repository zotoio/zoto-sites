# Deploying zoto-sites on DigitalOcean

Production runs on a **DigitalOcean droplet** behind **Cloudflare CDN**. The **origin** nginx container serves a **self-signed** certificate (`CN=localhost`, 365 days) generated on **every container start** into `/etc/nginx/ssl/default_*` (vhosts inherit those paths). Cloudflare is in front and is **not** validating that origin cert today (e.g. **Full** or **Flexible**, not **Full (strict)**). Optional: install a real origin cert in host `ssl/` (Let's Encrypt via `sync-ssl.sh`, or Cloudflare Origin CA) and move zones to **Full (strict)** — see below.

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

## Production TLS

**Checkout path (live droplet):** `/home/andrewv/git/zoto-sites` — compose project `zoto-sites`, `com.docker.compose.project.working_dir` on all three containers. `DEPLOY_PATH` (GitHub Actions secret and `scripts/deploy.sh` default) must be exactly this path; `deploy-safe.sh` aborts if running containers were started from a different working directory.

**How nginx finds TLS material**

| Stage | Behaviour |
| --- | --- |
| **Origin today** | On each container start, the entrypoint runs `openssl` and writes a fresh self-signed `default_cert.pem` / `default_key.pem` under `/etc/nginx/ssl/`. Site vhosts do not set `ssl_certificate`; they use the base image defaults at those paths. There is no long-lived “real” origin cert to preserve across recreates. |
| **After this PR** | Host `./ssl/` → container `/etc/nginx/certs:ro`. `docker/nginx-entrypoint.sh` copies a **complete** pair from the mount (`fullchain.pem`+`privkey.pem` or `default_cert.pem`+`default_key.pem`) into `/etc/nginx/ssl/` before `nginx` starts. If `ssl/` is empty, it generates the same self-signed fallback as today. |
| **sync-ssl.sh** | When host Let's Encrypt material exists under `/etc/letsencrypt/live/<name>/`, copies `fullchain.pem` and `privkey.pem` into `ssl/` (never committed). |

| File in `ssl/` | Typical source |
| --- | --- |
| `fullchain.pem` | `sync-ssl.sh` from host LE, or Cloudflare Origin CA `origin.pem` renamed |
| `privkey.pem` | `sync-ssl.sh` from host LE, or Origin CA private key |
| `default_cert.pem` / `default_key.pem` | Optional: copy from a running container for debugging (`docker cp nginx:/etc/nginx/ssl/. ssl/`) — not required for deploy |

### Optional: Cloudflare Origin CA + Full (strict)

Not required for the first deploy. When you want Cloudflare to validate the origin:

1. In Cloudflare → SSL/TLS → Origin Server, create an Origin Certificate for your zone hostnames.
2. Save the cert and key into `ssl/fullchain.pem` and `ssl/privkey.pem` (gitignored), or as `default_*` if you prefer that naming.
3. Set Cloudflare SSL mode to **Full (strict)** for the zone(s).

Host LE under `/etc/letsencrypt` can still be synced with `sync-ssl.sh` instead of Origin CA if you prefer.

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

### SSL/TLS mode (Cloudflare)

**Production today:** zones typically use **Full** or **Flexible** — Cloudflare does not validate the self-signed origin cert. Visitor HTTPS is terminated at Cloudflare.

**Recommended when you install a real origin cert in `ssl/`:** **Full (strict)** so Cloudflare checks the origin certificate.

- **Flexible** (HTTPS visitor → HTTP origin) is **not** compatible with this stack if you rely on origin :443 with SSL-only vhosts.
- Edge certificates (visitor → Cloudflare) are managed by Cloudflare.

### What stays on the origin

| Concern | Setting |
| --- | --- |
| Origin TLS | Self-signed per container start, or optional `ssl/*.pem` from LE / Origin CA |
| Cloudflare SSL mode | **Full** or **Flexible** today; **Full (strict)** after real origin cert in `ssl/` |
| Origin ports | `80` and `443` open on droplet (Cloudflare connects to both depending on config; 443 + strict is the production path) |
| Bot secrets / API keys | Host `.env` files only — never in Cloudflare |
| Editorial disk cache | `backends/botz.ai/cache` volume on droplet |

### Caching and botz.ai dynamic routes

**Static sites** (`zoto.io`, `halt.sh`, etc.): default Cloudflare caching is generally fine for HTML/CSS/JS. Purge cache in Cloudflare after deploy if you need instant updates.

**botz.ai archive API: date-paged and cacheable.** The site (grid and desktop carousel alike) reads the archive one
calendar day at a time. Each day's JSON carries the full stories, so there are no per-story requests. The botz API sets
these headers, and nginx passes them through unchanged (`location /archive` proxies every `/archive/...` path to
`botz:3000` and sets no cache headers of its own):

| URL | Body | `Cache-Control` |
| --- | --- | --- |
| `/archive/index` | `{ total, days: [{ date, count }] }`, newest day first | `public, max-age=60, s-maxage=60, stale-while-revalidate=300` |
| `/archive/latest` | Same body as `/archive/day/<newest date>` | `public, max-age=60, s-maxage=60, stale-while-revalidate=300` |
| `/archive/day/YYYY-MM-DD?n=<count>` (day ended 2+ days ago, `n` = that day's story count) | `{ date, count, older, editorials: [{ cache_key, title, image_url, generated_at, published_at, author, entry: { article, editorial } }] }` | `public, max-age=31536000, s-maxage=31536000, immutable` |
| `/archive/day/YYYY-MM-DD` (today, yesterday, no `n`, or `n` ≠ count) | Same | `public, max-age=60, s-maxage=60, stale-while-revalidate=300` |
| `/archive/day/<no stories>` → 404; `/archive/day/<invalid>` → 400 | — | 404: short TTL above; 400: `no-store` |
| `/archive?page=N` (legacy, no longer used by the site) | Unchanged page-number listing; the final partial page is served | `public, max-age=60, s-maxage=60, stale-while-revalidate=300` (was `no-store`) |
| `/editorials`, `/editorials?cacheKey=` (legacy and admin generation) | Unchanged | `no-store, private` (unchanged; the site no longer calls it) |

How the `n` works: clients copy `n` from `/archive/index` into the day URL. An `asOf` backfill that adds a story to a past
day changes that day's count, which gives a new URL, so a stale immutable copy is never requested again and nothing has
to be purged. "Past" means the date ended at least ~36 hours ago on the server clock, which is the clock the cache keys
are named with. After a new story is published, the botz purge (when `CF_*` is set) also purges `/archive/index`,
`/archive/latest` and `/archive/day/<date>` (with and without `?n=`), on top of the legacy URLs.

All of these endpoints only list and read the cache directory. Cache JSON and images are never written, moved or
deleted by them.

**Cloudflare cache rules for zone `botz.ai` (to change by hand; not changed by this repo or by CI):**

1. **Replace** the old "Bypass cache for `/archive*`" rule with a rule that matches
   `starts_with(http.request.uri.path, "/archive")`:
   - Cache eligibility: **Eligible for cache** (Cloudflare does not cache JSON by default)
   - Edge TTL: **Use cache-control header if present** (bypass if missing)
   - Browser TTL: **Respect origin**
   - Cache key: **include the full query string**, because `?n=` and the legacy `?page=` are part of the identity
2. **Keep bypass** for `/editorials*`. Those responses carry per-request navigation/random data, and admin generation
   goes through that path.
3. Optional: **bypass** any request carrying an `x-shared-secret` header, so an admin call routed through Cloudflare
   can never be answered from cache.

Until rule 1 is changed, the edge keeps bypassing `/archive*`. Browsers still cache using the headers above, so the
change is safe to deploy before the Cloudflare rule is updated.

| Path | Edge |
| --- | --- |
| `/editorials*` | Bypass (unchanged) |
| `/archive*` | Cache, honouring origin `Cache-Control` (rule 1) |
| `/cache/images/*` | Served by nginx from the read-only cache mount; default caching is fine |

The botz backend can purge Cloudflare after publishing when `CF_ZONE_ID` and `CF_API_TOKEN` are set in `backends/botz.ai/.env` (see `.env.example`).

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
| `ssl/` | nginx: `/etc/nginx/certs` (read-only) → copied to `/etc/nginx/ssl` at start | optional `sync-ssl.sh`, Origin CA, or manual copy | Optional — empty `ssl/` keeps self-signed origin behaviour |

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

**Git remote (fetch):** The live checkout’s `origin` may still be `git@github.com:zotoio/zoto-sites.git`. If `git fetch` fails with host key verification (`Could not resolve hostname github.com` / rejected key), switch fetch to HTTPS (keep SSH for push if you prefer):

```bash
git remote set-url origin https://github.com/zotoio/zoto-sites.git
# optional: git remote set-url --push origin git@github.com:zotoio/zoto-sites.git
```

**Docker access:** The tree is owned by **`andrewv`**, who is not in the `docker` group by default. Run deploy from the checkout as `andrewv` with the docker group, e.g. from `/home/andrewv/git/zoto-sites`:

```bash
sudo setpriv --reuid="$(id -u andrewv)" --regid="$(id -g andrewv)" \
  --groups="$(id -g andrewv),$(getent group docker | cut -d: -f3)" --reset-env \
  bash scripts/deploy-safe.sh
```

(or add `andrewv` to `docker` once and use a normal login shell).

**Cron windows:** Avoid running deploy during root cron jobs on the hour — roughly **:48–:55** and **:00–:04** past each hour (cert/sync/restart overlap). Pick a quiet minute outside those ranges.

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
4. Confirm your **external backup** is current; count cache files:
   ```bash
   find backends/botz.ai/cache -maxdepth 1 -name '*.json' | wc -l
   ```
5. `git status` clean; no untracked files that would collide with incoming tracked paths; note `git log -1`.
6. Ensure `backends/botz.ai/node_modules` and `backends/discord/node_modules` exist (Dockerfiles `COPY` them).
7. `docker compose version` (v2).
8. Deploy: `./scripts/deploy.sh` or GitHub Actions; verify cache file counts unchanged and https://botz.ai/archive loads.

**Optional (not required for first deploy):** populate `ssl/` with a real origin cert (`sync-ssl.sh`, Cloudflare Origin CA, or `docker cp nginx:/etc/nginx/ssl/. ssl/` for the current self-signed pair) and move Cloudflare to **Full (strict)**. `deploy-safe.sh` only errors if `ssl/` contains a **partial** cert/key pair (one file present or empty, the other missing).

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

## Deploy one backend with auto-rollback (botz-mcp, swarm)

Approved 2026-10-29 (crash-loop guards). Prepare the new source tree next to the live one (for example extract a release tarball into `backends/botz-mcp.new`), then:

```bash
sudo ./scripts/deploy-backend.sh botz-mcp backends/botz-mcp.new   # or: swarm backends/botz-mcp-swarm.new
```

The deploy is **blue/green (zero downtime)**. The script backs up `backends/<src>` as `backends/<src>.prev-<UTC ts>`, tags the running image `<image>:rollback-<ts>`, swaps in and builds the new source while the old container keeps serving, then:

1. starts a candidate `<svc>-next` from the new image next to the old container (same env files, volumes and network) and waits up to `HEALTH_TIMEOUT` (default 300s) for readiness: botz-mcp `/healthz` **and** `/readyz` (200 only once the embedding model has produced a vector), swarm `/health`, probed from the nginx container;
2. switches nginx to the candidate by writing `/etc/nginx/botz-upstreams/<project>.conf` inside the nginx container (included after `set $project_upstream` in every generated proxy location), `nginx -t`, `nginx -s reload`;
3. recreates the compose-managed `<svc>` on the new image (compose sends SIGTERM and waits `stop_grace_period: 30s` so in-flight requests drain), waits for readiness again;
4. removes the override (nginx back to `<svc>`), reloads, then drains the candidate (SIGTERM, 30s) and removes it.

Rollback is automatic: if the candidate never becomes ready, the old container was never touched and the source/image are restored. If the recreated `<svc>` fails, the previous image/source are restored and recreated while nginx keeps routing to the healthy candidate, then traffic switches back. Failed trees stay at `backends/<src>.failed-<ts>`. It never touches other services, volumes or the botz.ai mounted cache (source images and article JSON are read-only).

Both containers share the data dir for a few seconds; stores write with atomic renames. **Check that no swarm suite run is in progress before deploying** (Swarm console → Runs), and wait if one is.

If no backend container answers (`502`/`504`), nginx returns `503` with `Retry-After: 5` and a JSON-RPC-shaped body (`{"jsonrpc":"2.0","id":null,"error":{"code":-32003,"message":"Service temporarily unavailable. Please retry shortly.","data":{"transient":true,"retryAfter":5}}}`); `proxy_next_upstream error timeout http_502` is set on every project proxy. Clients (incl. the swarm harness) treat it as transient and retry.

`botz-mcp` runs with `restart: on-failure:5`: a broken image stops after five failed starts instead of crash-looping. After a host reboot, confirm `docker ps` shows `botz-mcp`; if not, `docker compose ... up -d botz-mcp`.

## Request body caps (reverse proxy)

Every generated nginx `server` block sets `client_max_body_size 16m` (`CLIENT_MAX_BODY_SIZE` in `scripts/generate-nginx.js`). This is the outer backstop; the apps enforce tighter caps and return 413 themselves:

| Service | OAuth | MCP / ingest | Admin JSON | Uploads | Default |
| --- | --- | --- | --- | --- | --- |
| botz-mcp (mcp.botz.ai) | 16 KiB | 4 MiB | 256 KiB | 10 MiB | 1 MiB |
| swarm (swarm.botz.ai) | 16 KiB | 4 MiB (OTLP 8 MiB inflated) | 1 MiB | n/a | 1 MiB |

Each cap is env-configurable in the service (`BOTZ_MAX_BODY_*`, `SWARM_MAX_BODY_*`); see each repo's `docs/security/security-defaults.md`.

## botz.ai subdomains (`*.botz.ai`)

For projects on `something.botz.ai` (not a separate apex domain), use the manifest flow in [SUBDOMAINS.md](./SUBDOMAINS.md) instead of `add-site.sh`.

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
| **Stale editorials at edge** | CDN caching `/editorials` — add bypass rule; optional `CF_*` purge in botz. `/archive*` is meant to be cached (see Caching above): past days are immutable per `?n=` and the index/latest TTL is 60 s |
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

## CI supply chain (D5)

- Every third-party `uses:` is pinned to a full 40-character commit SHA followed by a `# vX.Y.Z` comment. Tags and branches (`@v4`, `@release/v1`) are not allowed.
- Every workflow sets top-level `permissions: contents: read`. Jobs widen only what they need (for example `pages: write` + `id-token: write` for GitHub Pages, `id-token: write` for PyPI/npm trusted publishing).
- `.github/dependabot.yml` runs weekly (Monday 09:00 Australia/Sydney), one grouped PR per ecosystem: `github-actions` plus each package ecosystem the repo uses. Dependabot updates the SHA and the version comment together.
- An `actionlint` CI job (actionlint v1.7.12, download script pinned by commit) lints all workflows, including shellcheck on `run:` blocks.
- To pin a new action: resolve the tag to its commit (`git ls-remote https://github.com/OWNER/REPO refs/tags/vX.Y.Z`) and write `uses: OWNER/REPO@<sha> # vX.Y.Z`.
- `appleboy/ssh-action` (holds the deploy SSH key) is pinned by SHA; replacing it with plain `ssh` and a forced-command key is a follow-up.
