# Optional Compose services for `*.botz.ai` proxy projects

Proxy-type subdomain projects (`projects/botz.ai/<name>/project.yml`) reverse-proxy to a container on the **default Compose network**. Do **not** publish host ports for these services.

## Pattern

1. Scaffold the project:

   ```bash
   ./scripts/new-botz-project.sh myapp --proxy myapp:8080
   ```

2. Add a compose fragment for the service (this directory):

   ```yaml
   # compose/projects/myapp.yml
   services:
     myapp:
       image: your-image:tag
       restart: unless-stopped
       # No `ports:` — reachable only as http://myapp:8080 from nginx
       expose:
         - "8080"
   ```

3. **Deploy:** `scripts/deploy-safe.sh` and `./scripts/deploy.sh` automatically merge every `compose/projects/*.yml` fragment with `docker-compose.yml` (compose project name stays `zoto-sites`). When there are no fragments, behaviour matches a plain `docker compose up`.

   Manual equivalent:

   ```bash
   docker compose -p zoto-sites -f docker-compose.yml -f compose/projects/myapp.yml up -d --build
   ```

## Persistent data

If a project service bind-mounts host paths, add each path to `deploy/persistent-data.txt` under **DATA** or **ALLOWED_COMPOSE_BIND_SOURCES** so `scripts/check-persistent-mounts.js` and `scripts/deploy-safe.sh` stay green.

The botz editorial archive at `backends/botz.ai/cache` is guarded separately — never remove or weaken that entry.

## today.zoto.io

`compose/projects/today.yml` runs the today API on port 3001 (internal). Copy `backends/today.zoto.io/.env.example` to `.env` if you need optional webcam/traffic keys; **news uses Hacker News (Algolia) and needs no API key.**

## Internal networking

- Service name in `proxy.upstream` must match the Compose service name (e.g. `http://myapp:8080`).
- `nginx` depends on `botz` today; add `depends_on` for your service if nginx must wait for it on startup.

## mcp.botz.ai

`compose/projects/botz-mcp.yml` runs [zotoio/botz-mcp](https://github.com/zotoio/botz-mcp) from a gitignored checkout at `backends/botz-mcp` (image built with `BOTZ_EXTRAS=cursor`). Secrets live in `backends/mcp/.env` (see `backends/mcp/.env.example`); state in `backends/mcp/data`. The vhost (`projects/botz.ai/mcp/project.yml`) uses `proxy.streaming: true`: unbuffered streamable HTTP, 900s timeouts, `X-Forwarded-Proto https`, and `cache: no-store`. Full env reference: botz-mcp `docs/deploy/mcp.botz.ai.md`.

## studio.botz.ai

`compose/projects/studio.yml` runs [zotoio/grok-agent-studio](https://github.com/zotoio/grok-agent-studio) from a gitignored checkout at `backends/grok-agent-studio` (`STUDIO_HOSTING=public`). Visitors get the simulated site. GitHub sign-in uses the botzai-studio GitHub App; members of the `botzai-studio/studio-users` team get live runs on `grok-4.7` under the daily cap, and access requests and guard alerts go to the alert webhook. Secrets live in `backends/studio/.env` (chmod 600; `CURSOR_API_KEY`, `TYPESAFE_API_KEY`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`, `STUDIO_SESSION_SECRET`, `STUDIO_ALERT_WEBHOOK_URL`, `STUDIO_ALERT_WEBHOOK_TOKEN`). The App private key is `/etc/botz/secrets/studio/github-app.pem` (dir 0500, file 0400, owner 1000:1000), mounted read-only at `/run/secrets/studio`. Signed-in members and admins get live GitHub through the App installation token (`GITHUB_MODE=live`); visitors get the simulated board. The container runs as uid 1000 with a read-only root filesystem, tmpfs `/tmp`, `/app/.next/cache` and `/home/node` (the Cursor SDK agent store lives in `~/.cursor`), all capabilities dropped and `no-new-privileges`. State lives in `backends/studio/data` (create it owned by 1000:1000 before the first `up`), the only writable path. Health: `GET /api/health`. Every Deploy workflow run (`scripts/deploy-sites.sh`) builds studio along with botz, nginx, today and discord, then recreates them; a failed build fails the deploy before any container is replaced, and `/api/health` is checked afterwards with automatic rollback. Before building, the checkout is refreshed to the latest `zotoio/grok-agent-studio` main when a newer commit is available: either staged as `backends/grok-agent-studio.next` (a `git archive` extract with `COMMIT_SHA`), or fetched by the droplet from `STUDIO_REPO` when the checkout owner has read access to the private repo. Without either, the current checkout (its commit is in `backends/grok-agent-studio/COMMIT_SHA`) is rebuilt as is. The replaced tree is kept as `backends/grok-agent-studio.prev-<ts>`.
