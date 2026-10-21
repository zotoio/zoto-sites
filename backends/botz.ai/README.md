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

**Hacker News path:** Algolia `search_by_date` (backfill) or `search` (live ~24h), `tags=story`, UTC `created_at_i` window, points threshold. Candidates pass a local AI-term gate, skip Ask/Show HN unless clearly AI, then `gpt-6-luna` relevance scoring; ties break toward higher points/comments. Linked articles are fetched server-side (timeout, size cap, browser-like headers, no robots.txt check) for `og:title` / `og:description` / excerpt; fallback uses HN comment context. Editorials store `hn_url`, `source` (domain), and `url`.

Days with no qualifying story return HTTP **422** (`no_qualifying_story`, logged `no_articles` / `no_match`). Each backfilled editorial includes `as_of`, `backfilled: true`, display `generated_at`, and `backfilled_at`.

### Multiple providers (`NEWS_PROVIDERS`)

`NEWS_PROVIDERS=hn,thenewsapi,ddg` runs several candidate sources together (code: `newsProviders/`). Unset (or `hn` only) keeps the original HN-only path unchanged.

| Name | Source | Key |
| --- | --- | --- |
| `hn` | Hacker News Algolia (same query as before) | none |
| `thenewsapi` | `GET https://api.thenewsapi.com/v1/news/top` (`api_token`, `search`, `categories=tech`) | `NEWS_API_KEY`; skipped with a `news_provider_skipped` log line if missing |
| `ddg` | `html.duckduckgo.com/html/` (past day) | none, live only |
| `gnews` | Google News RSS search (`when:1d`) | none, live only |
| `bingnews` | Bing News RSS | none, live only |

Keyless providers query `generative AI`, `OpenAI`, `LLM` sequentially (500 ms apart, 8 s timeout, one attempt, no retries). Candidates are normalized (`title, url, source, published_at, snippet, points/num_comments/engagement, provider`), merged and deduped by normalized URL (scheme, `www.`, tracking params, fragment, trailing slash ignored), then go through the existing enrichment, gate and `gpt-6-luna` scoring. Logs carry `news_source` (e.g. `hn+gnews`, the providers that contributed).

### Article fetch proxy (optional)

`ARTICLE_FETCH_PROXY=http://100.x.y.z:8888` routes linked **article page** fetches (`fetchLinkedArticleMetadata`) through an undici `ProxyAgent`; nothing else uses it. `ARTICLE_FETCH_PROXY_MODE=fallback` (default) tries direct first and retries once via the proxy on 403, 429 or a Cloudflare challenge (`cf-mitigated`); `always` uses the proxy only. Each fetch logs `article_fetch: route=direct|proxy|direct->proxy(reason) status=...`.

**429 backoff (article pages only):** on HTTP 429 the article fetch retries up to `ARTICLE_FETCH_429_RETRIES` (default 3) times with delay `min(ARTICLE_FETCH_429_BASE_MS * 2^attempt, ARTICLE_FETCH_429_MAX_MS)` (defaults 1000 / 30000 ms), honouring a numeric `Retry-After` (clamped to the cap) plus up to 20% jitter. Applies to the direct and proxy routes; in fallback mode direct retries are exhausted before the proxy is tried. 403/`cf-mitigated` are not backed off. Each retry logs `article_fetch_retry route=… attempt=… delay_ms=… status=429 host=…`.

### Keyword gate and optional Jev classifier

The gate is a weighted keyword score (`keywordWeights.js`, one table) over title + snippet + URL slug + domain; weights: vendors/models 5, GenAI concepts 3, general AI terms (case-sensitive `AI`, artificial intelligence, machine learning, neural network) 2, weak terms 1; sum capped at 10; pass at **>= 2**. If `TYPESAFE_API_KEY` is set, Jev (Typesafe.ai System One, `POST /v1/systemone`, a `noul` yes/no question, `Authorization: Bearer`) scores each candidate first and the gate becomes `0.4 * keyword/10 + 0.6 * jev >= 0.35`; without a key, or if Jev errors, the keyword score alone decides. Optional: `TYPESAFE_BASE_URL`, `JEV_MODEL` (default `jev-latest`).

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
