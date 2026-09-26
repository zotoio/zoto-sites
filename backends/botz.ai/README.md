# botz.ai backend

Express API for GenAI news editorials, image generation, and archive listing.

## Editorial backfill (missing days)

OpenAI editorial generation was unavailable from **2026-05-13** through **2026-09-25**. Use the backfill CLI to create **one editorial per missing calendar day** (default cache key hour **12** → `YYYY-MM-DD-12.json`, which sorts correctly in `/archive`).

### On the production droplet

From the compose project checkout (typically `/home/andrewv/git/zoto-sites`):

```bash
cd /home/andrewv/git/zoto-sites

# Preview dates and News API queries (no OpenAI, no writes)
docker compose exec botz node scripts/backfill-editorials.mjs \
  --from 2026-05-13 --to 2026-09-25 --hour 12

# Generate for real (136 days in the gap window if none exist yet)
docker compose exec botz node scripts/backfill-editorials.mjs \
  --from 2026-05-13 --to 2026-09-25 --hour 12 --execute --limit 5

# After the full run, optionally purge CDN once
docker compose exec botz node scripts/backfill-editorials.mjs \
  --from 2026-05-13 --to 2026-09-25 --hour 12 --execute --purge-cf
```

The script:

- Skips any day that already has **any** `cache/YYYY-MM-DD-*.json` file (idempotent).
- Never overwrites an existing cache file.
- Defaults to **dry-run**; pass **`--execute`** to call the live generation path (`GET /editorials?cacheKey=…&asOf=…&purgeCache=false` with `x-shared-secret`).
- Dry-run writes **nothing** under the archive/cache directory (no log file unless you pass `--log`).
- Execute mode appends progress to `/tmp/backfill-editorials.log.jsonl` by default (override with `--log`).
- Stops on the first error with a clear message (including News API plan/historical query failures).

### News sources (`NEWS_SOURCE`)

| Source | Env | Typical upstream fetches / editorial |
| --- | --- | --- |
| **hn** (default) | No API key; optional `HN_MIN_POINTS` (default 20) | **1** HN Algolia request (page 2 only if none qualify) |
| **thenewsapi** (legacy) | `NEWS_API_KEY` required | **1** typical (limit 25), **2** worst case |

**Hacker News path:** Algolia `search_by_date` (backfill) or `search` (live ~24h), `tags=story`, UTC `created_at_i` window, points threshold. Candidates pass a local AI-term gate, skip Ask/Show HN unless clearly AI, then `gpt-6-luna` relevance scoring; ties break toward higher points/comments. Linked articles are fetched server-side (timeout, size cap, robots-aware UA) for `og:title` / `og:description` / excerpt; fallback uses HN comment context. Editorials store `hn_url`, `source` (domain), and `url`.

Days with no qualifying story return HTTP **422** (`no_qualifying_story`, logged `no_articles` / `no_match`). Each backfilled editorial includes `as_of`, `backfilled: true`, display `generated_at`, and `backfilled_at`.

Preview HN picks without OpenAI: `node scripts/hn-sample-candidates.mjs 2026-06-10 2026-07-15`.

OpenAI usage totals are stored under `backends/botz.ai/usage` on the host (`USAGE_LOG_DIR=/home/root/usage` in compose), not in public editorial JSON. Nginx denies `/cache/.*` dot-paths (e.g. `.replaced` archives). Legacy `_openai_usage` keys in cache files: `node scripts/strip-usage-from-cache.mjs` (dry-run; pass `--execute`). Use `--replace <cacheKey> --execute` to regenerate a single backfilled day (archives the prior file under `cache/.replaced/`).

### Rough API cost (136 days)

Per day (one article):

| Step | Model (typical) |
| --- | --- |
| Editorial HTML | `gpt-6-sol` (override via `OPENAI_MODEL_STRONG`) |
| Categories, author, phrases, image style, summary, image prompt | several `gpt-6-luna` calls (`OPENAI_MODEL_WEAK`) |
| Hero image | `gpt-image-2` (via `openaiImages.js`) |

Multiply by **136** days for the May–September 2026 gap. Exact spend depends on prompt length and image retries.

## Local development

See repo root `AGENTS.md` and `README.md`. Quick syntax check:

```bash
node --check backends/botz.ai/index.js
yarn --cwd backends/botz.ai test
```
