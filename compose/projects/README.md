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

3. Merge the fragment at deploy time (pick one approach):

   **A. Multiple compose files (recommended)**

   ```bash
   docker compose -f docker-compose.yml -f compose/projects/myapp.yml up -d --build
   ```

   Document any project-specific files in your deploy runbook or wrap in a small script.

   **B. `include` in `docker-compose.yml`** (Compose v2.24+)

   ```yaml
   include:
     - path: compose/projects/*.yml
   ```

   Only add fragments for services you actually run in production.

## Persistent data

If a project service bind-mounts host paths, add each path to `deploy/persistent-data.txt` under **DATA** or **ALLOWED_COMPOSE_BIND_SOURCES** so `scripts/check-persistent-mounts.js` and `scripts/deploy-safe.sh` stay green.

The botz editorial archive at `backends/botz.ai/cache` is guarded separately — never remove or weaken that entry.

## Internal networking

- Service name in `proxy.upstream` must match the Compose service name (e.g. `http://myapp:8080`).
- `nginx` depends on `botz` today; add `depends_on` for your service if nginx must wait for it on startup.
