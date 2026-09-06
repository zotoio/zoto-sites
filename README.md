# zoto-sites

Multi-domain static sites and small Node backends, served with **Docker Compose** on a DigitalOcean droplet (or locally).

| Path | Purpose |
| --- | --- |
| `www/` | Static site content (one folder per site) |
| `sites/` | Virtual host manifest — **source of truth** for nginx routing |
| `nginx-conf/` | Generated nginx vhost configs (do not edit by hand) |
| `backends/` | `botz.ai` Express API and `discord` slash-command bot |
| `scripts/` | `add-site`, `generate-nginx`, `deploy`, `bootstrap-droplet` |

## Quick start (local)

```bash
# 1. Backend secrets (required for botz + discord services)
cp backends/botz.ai/.env.example backends/botz.ai/.env
cp backends/discord/.env.example backends/discord/.env
# Edit both .env files with real values before starting.

# 2. Generate nginx configs and start the stack
node scripts/generate-nginx.js
docker compose up -d --build
```

Nginx listens on ports **80** and **443**. Without real certificates in `ssl/`, the base image serves a **self-signed** certificate (fine for local testing).

Test botz.ai routing (static + API proxy):

```bash
curl -k https://localhost/ -H 'Host: botz.ai' | head
# API proxy requires a running botz service with valid .env
```

## Add a new site

One command creates the manifest, starter HTML, and nginx vhost:

```bash
./scripts/add-site.sh example.com example.com www.example.com
```

This creates:

- `sites/example.com.json` — domains and optional proxy rules
- `www/example.com/` — static files
- `nginx-conf/example.com.conf` — regenerated automatically

Edit `www/example.com/`, point DNS at your droplet, then redeploy.

### Proxy paths (like botz.ai)

For API routes, add a `proxies` array to the site manifest:

```json
{
  "id": "botz.ai",
  "domains": ["botz.ai", "www.botz.ai", "localhost"],
  "proxies": [
    { "path": "/editorials", "upstream": "http://botz:3000" },
    { "path": "/archive", "upstream": "http://botz:3000" }
  ]
}
```

Then run `node scripts/generate-nginx.js` and redeploy.

## Modify an existing site

| Change | What to edit |
| --- | --- |
| Page content | `www/<site-id>/` |
| Domains or proxy routes | `sites/<site-id>.json`, then `node scripts/generate-nginx.js` |
| Backend env / secrets | `backends/botz.ai/.env` or `backends/discord/.env` |

Redeploy after changes: `./scripts/deploy.sh`

## Deploy to DigitalOcean

Full droplet setup, TLS, secrets, and GitHub Actions are documented in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

Summary:

1. **Bootstrap** a new Ubuntu droplet: `sudo bash scripts/bootstrap-droplet.sh`
2. **Configure secrets** on the VM (`backends/*/.env`)
3. **Install TLS** certs into `ssl/fullchain.pem` and `ssl/privkey.pem`
4. **Deploy**: `./scripts/deploy.sh` on the droplet, or `./scripts/deploy.sh deploy@your-droplet-ip` from your laptop
5. **Optional CI**: set GitHub secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH` — pushes to `main` deploy via `.github/workflows/deploy.yml`

## Migration from hand-written nginx configs

Previously each vhost lived in `nginx-conf/*.conf` and was edited manually. Those files are now **generated** from `sites/*.json`.

- Existing production behavior is preserved (including botz.ai `/editorials` and `/archive` proxying to `botz:3000`).
- After pulling this branch, run `node scripts/generate-nginx.js` once to refresh `nginx-conf/`.
- Do not edit `nginx-conf/*.conf` directly — changes will be overwritten on the next generate/deploy.

## Development without Docker

```bash
yarn start:dev          # botz backend + www/botz.ai static dev server
yarn start:zoto:dev     # zoto.io local stack (if configured)
```

## CI

- **Pull requests**: `.github/workflows/ci.yml` verifies `nginx-conf/` matches `sites/`.
- **Production deploy**: `.github/workflows/deploy.yml` (requires GitHub environment secrets).
