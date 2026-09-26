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
