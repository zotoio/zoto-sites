# AGENTS.md

## Cursor Cloud specific instructions

### Product focus

Primary development target is **botz.ai** (GenAI news): Express API in `backends/botz.ai` plus static frontend in `www/botz.ai`. Other `www/*` sites are static-only; `backends/zoto.io` has no `index.js` yet.

### Dependencies

Use **Yarn v1** (lockfiles at repo root and per package). Install before first run:

- `yarn install` (repo root — `concurrently` / `nodemon`)
- `yarn --cwd backends/botz.ai install`
- `yarn --cwd www/botz.ai install`

There is **no** ESLint, test runner, or `lint`/`test` npm scripts in this repo. Use `node --check backends/botz.ai/index.js` for a quick syntax check.

### Environment

Copy `backends/botz.ai/example.env` to `backends/botz.ai/.env` and set:

- `OPENAI_API_KEY`, `SHARED_SECRET` (required at startup; process exits if missing)
- `NEWS_SOURCE` — `hn` (default, keyless HN Algolia) or `thenewsapi` (requires `NEWS_API_KEY`)
- `CACHE_DIR` — use a writable path under the repo for local dev, e.g. `/workspace/backends/botz.ai/cache` (not `/var/lib/cache` unless that directory exists)

Optional: `backends/discord/.env` from `example.env` for the Discord bot (needs `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`).

### Run (botz.ai)

From repo root after deps + `.env`:

```bash
yarn start:dev
```

- Frontend: http://localhost:8080 (http-server; proxies `/editorials`, `/archive`, `/cache` to the API)
- API: http://localhost:3000

Run in a **tmux** session for long-lived dev (`botz-dev` or similar). Nodemon restarts the API when cache files change.

### Cached editorials without live APIs

Fresh `/editorials` generation calls NewsAPI and OpenAI. For UI/API wiring tests without real keys, use placeholder keys in `.env` and add several hourly cache files under `CACHE_DIR` named `YYYY-MM-DD-HH.json` (see existing production cache layout). **Navigation logic can throw if fewer than ~4 cache JSON files exist** when serving cached editorials (edge case in `getNextAndPreviousFilenames`).

### Docker (optional)

`docker compose up` builds nginx + botz + discord; requires real `.env` files and TLS-capable nginx image. Local dev is usually simpler with `yarn start:dev`.

### Other sites

- `yarn start:zoto:dev` — zoto frontend works; backend entrypoint is missing.
- `yarn start:today:dev` — today.zoto.io UI + API; news via Hacker News Algolia (no `NEWS_API_KEY`). Copy `backends/today.zoto.io/.env.example` to `.env` for optional camera keys only.
- Static demos: serve `www/halt.sh`, `www/k8s.com.au`, etc. with any static file server.
