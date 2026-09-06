# Repository Analysis

Generated on 2026-06-05.

## Executive Summary

This repository is a small multi-domain website monorepo. It serves several static sites through nginx and includes two Node.js backend services:

- `botz.ai`: a GenAI news/editorial site backed by an Express API that fetches AI news, generates editorial text with OpenAI, generates images with DALL-E, caches the results on disk, and exposes archive/image endpoints.
- `discord`: a Discord slash-command service that can request a botz.ai editorial for a supplied article URL.

The repository is deployable with Docker Compose, but it has minimal documentation, no tests, no CI configuration, and a few incomplete or fragile pieces that would affect onboarding and production reliability.

## Top-Level Structure

```text
.
|-- Dockerfile
|-- docker-compose.yml
|-- package.json
|-- yarn.lock
|-- nginx-conf/
|   |-- botz.ai.conf
|   |-- halt.sh.conf
|   |-- k8s.com.au.conf
|   |-- smartcreations.com.au.conf
|   `-- zoto.io.conf
|-- www/
|   |-- botz.ai/
|   |-- halt.sh/
|   |-- k8s.com.au/
|   |-- smartcreations.com.au/
|   `-- zoto.io/
`-- backends/
    |-- botz.ai/
    |-- discord/
    `-- zoto.io/
```

## Runtime and Deployment Model

### Docker Compose

`docker-compose.yml` defines three services:

| Service | Build context | Purpose |
| --- | --- | --- |
| `nginx` | `.` | Serves static files from `www/` and loads virtual host configs from `nginx-conf/`. Publishes ports `80` and `443`. |
| `botz` | `./backends/botz.ai` | Express API for editorial generation, archive retrieval, and cached image serving. Publishes port `3000`. |
| `discord` | `./backends/discord` | Discord gateway client that registers and handles the `/editorial` slash command. |

The nginx service mounts `./backends/botz.ai/cache` to `/usr/share/nginx/html/botz.ai/cache`, while the botz service mounts the same host directory to `/home/root/cache`.

### nginx

The root `Dockerfile` uses `krewh/hardened-nginx`, copies `www/` into `/usr/share/nginx/html`, and copies `nginx-conf/` into `/etc/nginx/conf.d/sites`.

There are five virtual host configs:

- `botz.ai` / `www.botz.ai` / `localhost`
- `halt.sh` / `www.halt.sh`
- `k8s.com.au`
- `smartcreations.com.au`
- `zoto.io`

`nginx-conf/botz.ai.conf` proxies `/editorials` and `/archive` to `http://botz:3000`. The app also exposes `/cache/images/:image` from the botz API, although nginx does not currently proxy that route explicitly.

All virtual hosts reference `/error.html`, but no tracked `error.html` file was found.

## Frontend Sites

### `www/botz.ai`

`botz.ai` is a vanilla HTML/CSS/JavaScript frontend. It:

- Fetches editorial content from `/editorials`.
- Uses URL hash values as cache keys, for example `/#2026-06-05-12`.
- Fetches paginated archive data from `/archive`.
- Displays generated article text, generated images, metadata, and previous/next/random navigation.
- Includes Google Analytics with measurement ID `G-3HMC4TBL9L`.

Notable observations:

- `www/botz.ai/index.html` references `favicon.ico`, but no tracked favicon was found for that site.
- The generated article HTML template contains a malformed closing tag: `</<article>`.
- The frontend assumes `articles[0].navigation` exists after fetching editorials, so empty API responses may cause client-side errors.

### `www/halt.sh`

`halt.sh` is a retro terminal-style static site using:

- `index.html`
- `terminal.js`
- JSON files such as `boot.json`, `splash.json`, `ls.json`, and `contact.json`
- A GPLv3 `LICENSE`

It animates a fake boot or terminal sequence and updates the displayed hostname from the URL hash.

### `www/zoto.io`, `www/k8s.com.au`, `www/smartcreations.com.au`

These sites are static Three.js visualizations using shared patterns and local `3js-extra.js` files. They load older CDN dependencies:

- jQuery 3.3.1 slim
- Three.js r90

Notable observations:

- `www/k8s.com.au/index.html` has `<title>botz.ai</title>`, which appears to be copy-paste drift.
- `www/smartcreations.com.au/index.html` links its reboot flow to `https://halt.sh/#k8s.com.au`, which may be intentional but looks suspicious.
- These sites reference `/favicon.ico`, but no tracked favicon files were found.

## Backend Services

### `backends/botz.ai`

The main API is implemented in `backends/botz.ai/index.js` as an Express app.

Key endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/editorials` | Generate or return cached AI editorials. Supports `cacheKey` and privileged article generation via `articleUrl`. |
| `GET` | `/archive` | Return paginated metadata for cached editorial JSON files. |
| `GET` | `/cache/images/:image` | Serve locally cached generated images. |

Core flow for `/editorials`:

1. Determine a cache key from `FREQUENCY`, request parameters, and admin authorization.
2. Return cached JSON when available for non-admin requests.
3. Fetch AI-related news from TheNewsAPI, or use an admin-supplied `articleUrl`.
4. Generate article commentary via OpenAI chat completions.
5. Sanitize generated editorial HTML with `sanitize-html`.
6. Generate an image prompt and image via DALL-E 3.
7. Save generated image and editorial JSON to the configured cache directory.
8. Optionally purge Cloudflare cache and trigger pregeneration after admin requests.

Runtime dependencies include `express`, `axios`, `openai`, `cheerio`, `helmet`, `express-rate-limit`, `sanitize-html`, and `sanitize-filename`.

Configuration is loaded from environment variables. `backends/botz.ai/example.env` documents:

- `NEWS_API_KEY`
- `OPENAI_API_KEY`
- `FREQUENCY`
- `PAGE_SIZE`
- `PAGE_COUNT`
- `SINGLE_RANDOM`
- `CATEGORY_HOURS`
- `CACHE_DIR`
- `CACHE`
- `SHARED_SECRET`
- `CF_ZONE_ID`
- `CF_API_TOKEN`

Notable observations:

- `CACHE_DIR` defaults to `/var/lib/cache` in code and in `example.env`, but Docker Compose mounts cache storage at `/home/root/cache` inside the botz container. Production likely needs an overriding `.env` value.
- `extractSummary()` contains `if (!response.status >= 400)`, which is likely an operator-precedence bug. The intended check was probably `if (response.status >= 400)`.
- `authorisedAdminRequest()` computes `validSecret || (validSecret && isLocalhost)`, which is equivalent to just `validSecret`; the localhost branch is redundant.
- `getNextAndPreviousFilenames()` sorts date-like cache keys with subtraction on strings, which is unreliable for keys that contain dashes.
- The rate limit is set to 5000 requests per 15 minutes per IP, which is permissive for an endpoint that can trigger paid OpenAI calls for authorized/admin paths.
- `cors` is listed in `package.json` but is not imported or used in `index.js`.
- There is no health endpoint.

### `backends/discord`

The Discord backend:

- Loads environment variables with `dotenv`.
- Registers a global `/editorial` slash command using `discord.js`.
- Accepts an article URL from a command option.
- Calls `http://botz:3000/editorials` with `articleUrl`, a generated `cacheKey`, and the shared secret header.
- Replies with a frontend URL built from `EDITORIAL_FRONTEND_URL_PREFIX`.

Configuration is documented in `backends/discord/example.env`:

- `DISCORD_APPLICATION_ID`
- `DISCORD_TOKEN`
- `SHARED_SECRET`
- `EDITORIAL_FRONTEND_URL_PREFIX`

Notable observations:

- The service does not expose an HTTP port, which is expected for a Discord gateway client.
- There is little error handling around the botz API request; failures may leave users without a clear follow-up response.

### `backends/zoto.io`

This directory only contains a `package.json` with:

```json
{
  "scripts": {
    "start:dev": "nodemon index.js"
  }
}
```

No `index.js` exists, so the root `start:zoto:dev` script currently cannot start successfully.

## Scripts and Package Management

The repository currently uses Yarn lockfiles. No pnpm lockfile was found.

Root scripts:

| Script | Command |
| --- | --- |
| `start:dev` | Runs the botz backend and botz frontend dev server concurrently. |
| `start:zoto:dev` | Attempts to run zoto backend and frontend dev servers concurrently. The backend target is incomplete. |

Other scripts:

- `backends/botz.ai`: `start:dev` kills port 3000 and starts `nodemon index.js`.
- `www/botz.ai`: `start:dev` serves the frontend on port 8080 and proxies to port 3000.
- `www/zoto.io`: `start` runs `serve -s .`; `start:dev` wraps it with nodemon.

## Documentation, Tests, and CI

No tracked Markdown documentation was found before this report was added.

Notable absences:

- No root `README.md`
- No test files found via `*.test.*` or `*.spec.*`
- No `.github/workflows` CI configuration
- No lint or formatter configuration
- No API contract or OpenAPI description
- No PR template

## Security and Reliability Notes

Positive signals:

- The botz API uses `helmet`.
- The botz API applies `express-rate-limit`.
- Generated editorial HTML is sanitized.
- Cache keys and image names are constrained or sanitized before filesystem access.
- Secrets are expected from `.env` files, and `.env` is ignored.

Risks and gaps:

- Docker image builds for `backends/botz.ai` copy `node_modules` from the build context instead of installing dependencies in the image. This makes builds dependent on local state and can break clean Docker builds.
- `backends/discord/Dockerfile` copies the whole backend directory and also does not install dependencies in the image.
- There are no health checks for Compose services.
- External API failures from OpenAI, TheNewsAPI, Cloudflare, or Discord are not comprehensively surfaced.
- Cost controls are limited for OpenAI-backed workflows.
- Several frontend dependencies are loaded from old CDN versions.
- No automated tests or CI protect critical generation/cache behavior.

## Prioritized Recommendations

1. Add a root `README.md` with setup, environment variables, Docker Compose usage, local development commands, and deployment assumptions.
2. Align `CACHE_DIR` between `example.env`, `docker-compose.yml`, and runtime defaults.
3. Fix likely correctness bugs:
   - `extractSummary()` status check.
   - malformed `</<article>` tag in `www/botz.ai/index.html`.
   - `k8s.com.au` page title.
   - missing or incorrect reboot target in `smartcreations.com.au` if unintentional.
4. Add a minimal health endpoint to the botz API and Compose health checks for nginx and botz.
5. Make Docker builds self-contained by installing dependencies during image build with the repository's package manager and lockfiles.
6. Add tests around cache-key parsing, archive pagination, admin authorization, and cache-hit behavior.
7. Add CI for dependency installation, linting, and the minimal test suite.
8. Add missing static assets or remove references to missing `favicon.ico` and `error.html`.
9. Tighten OpenAI-triggering paths with stricter authorization, lower rate limits, and better cost/usage logging.
10. Decide whether `backends/zoto.io` should be implemented or removed from root dev scripts.

## Quick Reference

Important files:

- `docker-compose.yml`
- `Dockerfile`
- `package.json`
- `nginx-conf/botz.ai.conf`
- `www/botz.ai/index.html`
- `backends/botz.ai/index.js`
- `backends/botz.ai/example.env`
- `backends/discord/index.js`
- `backends/discord/example.env`
- `www/halt.sh/terminal.js`

Suggested first commands for a new maintainer, after preparing required `.env` files:

```sh
yarn install
yarn --cwd backends/botz.ai install
yarn --cwd www/botz.ai install
yarn start:dev
```

For Compose deployment, the environment files expected by `docker-compose.yml` are:

```text
backends/botz.ai/.env
backends/discord/.env
```
