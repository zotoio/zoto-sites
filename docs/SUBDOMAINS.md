# botz.ai subdomains (`*.botz.ai`)

Add small projects as subdomains of **botz.ai** (for example `demo.botz.ai`) without hand-writing nginx vhosts. Manifests live under `projects/botz.ai/<name>/`; nginx configs are generated with `node scripts/generate-nginx.js`.

## One-time Cloudflare DNS

Cloudflare **Universal SSL** on the free plan covers **one** level of wildcard: `*.botz.ai` (not `a.b.botz.ai`).

In the **botz.ai** zone, add a **proxied** (orange cloud) record:

| Type | Name | Content |
| --- | --- | --- |
| `A` | `*` | `170.64.250.36` (droplet origin IP) |

Alternatively: `CNAME` `*` → `botz.ai` (if `botz.ai` already points at the droplet).

Optional: add `www` → same origin if you want `www.botz.ai` (the main site manifest already lists `www.botz.ai`).

After this wildcard exists, **new subdomains do not need per-host DNS records** — only repo changes and deploy.

Origin TLS: Cloudflare connects to the droplet with the existing default/LE cert in `ssl/` (or self-signed in dev). No per-subdomain certificates on the origin.

## Three-step flow

### 1. Scaffold

**Static site** (HTML/JS in `public/`, optional SPA history fallback in `project.yml`):

```bash
./scripts/new-botz-project.sh demo --static
```

**Reverse proxy** to a Compose service (internal port only):

```bash
./scripts/new-botz-project.sh myapp --proxy myapp:8080
```

Then add `compose/projects/myapp.yml` using [compose/projects/README.md](../compose/projects/README.md).

### 2. Commit and push

```bash
git add projects/botz.ai/demo/ nginx-conf/
git commit -m "Add demo.botz.ai subdomain project"
git push
```

CI validates manifests, regenerates nginx checks, and runs `nginx -t` in the hardened nginx image.

### 3. Deploy

On the droplet as **`andrewv`** (Docker via the `docker` group — see [DEPLOYMENT.md](./DEPLOYMENT.md)):

```bash
cd /home/andrewv/git/zoto-sites
setpriv --reuid=andrewv --regid=docker --init-groups -- ./scripts/deploy-safe.sh
```

Or `./scripts/deploy.sh` from the same directory (it invokes `deploy-safe.sh`).

Rebuild picks up new static files under `projects/botz.ai/` and new generated vhosts under `nginx-conf/`.

## Project manifest

Each project folder contains `project.yml` (or `project.json`):

| Field | Required | Description |
| --- | --- | --- |
| `enabled` | No (default `true`) | When `false`, no vhost is emitted (example: `hello`). |
| `type` | Yes (if enabled) | `static` or `proxy` |
| `title` | No | Comment in generated nginx config |
| `spa_fallback` | No | For `static`: `try_files` → `/index.html` |
| `proxy.upstream` | For `proxy` | e.g. `http://myservice:8080` |
| `proxy.websocket` | No | Enable WebSocket upgrade headers |
| `headers` | No | Map of extra `add_header` values |

**Reserved names** (refused by scaffold and CI): `www`, `api`, `mail`, `mx`, `admin`, `botz`, `discord`, and others — see `scripts/lib/botz-projects.js`.

Static files go in `projects/botz.ai/<name>/public/`.

## Unknown subdomains

A catch-all vhost `*.botz.ai` returns a friendly 404 page (`www/botz.ai/subdomain-not-found.html`) so mistyped hosts do not fall through to another site (for example `k8s.com.au`).

## Example in the repo

`projects/botz.ai/hello/` is a **disabled** static example. Enable it with `enabled: true` in `project.yml`, regenerate nginx, and deploy to serve `hello.botz.ai`.

## Related docs

- [DEPLOYMENT.md](./DEPLOYMENT.md) — droplet, Cloudflare SSL, compose
- [compose/projects/README.md](../compose/projects/README.md) — proxy services without published ports
