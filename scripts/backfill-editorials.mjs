#!/usr/bin/env node
/**
 * Backfill missing botz.ai editorials (one per calendar day).
 * Run inside the botz container against the local API (default http://127.0.0.1:3000).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { fetchWithRetries } from './lib/backfillHttp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const botzPackageRoot =
    process.env.BOTZ_PACKAGE_ROOT || path.resolve(__dirname, '../backends/botz.ai');

const {
    assertCacheFileWritable,
    cacheFilePathForKey,
    dateHasAnyEditorialCache,
    editorialCacheKeyForDate,
    enumerateDatesInclusive,
} = await import(pathToFileURL(path.join(botzPackageRoot, 'backfillDates.js')).href);

const { buildTopNewsParams, describeTopNewsRequest } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'newsApi.js')).href
);

const { buildHnAlgoliaParams, describeHnAlgoliaRequest } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'hnAlgolia.js')).href
);

const { NEWS_CANDIDATE_LIMIT_PER_REQUEST } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'newsFetchPlan.js')).href
);

const { parseNewsSource } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'newsSourceConfig.js')).href
);

const { purgeCloudflareCacheByUrl } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'cloudflarePurge.js')).href
);

const { sumUsageCalls } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'openaiUsageLog.js')).href
);

const { buildGenAiNewsSearchQuery, GENAI_NEWS_CATEGORIES } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'storySelection.js')).href
);

const { readEditorialUsage } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'editorialUsageStore.js')).href
);

const { archiveBackfilledEditorial } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'editorialReplace.js')).href
);

const DEFAULT_EXECUTE_LOG = '/tmp/backfill-editorials.log.jsonl';
const CACHE_KEY_RE = /^(\d{4}-\d{2}-\d{2})-\d{2}(-\d{13})?$/;

function printUsage() {
    console.log(`Usage: node scripts/backfill-editorials.mjs --from YYYY-MM-DD --to YYYY-MM-DD [options]

Options:
  --hour <0-99>       Cache key hour suffix (default: 12 → YYYY-MM-DD-12.json)
  --execute           Perform OpenAI generation and cache writes (default: dry-run only)
  --replace <cacheKey>  Regenerate one backfilled editorial (requires --execute); archives prior JSON/image to cache/.replaced/
  --limit <N>         Process at most N pending days after skips
  --max-news-requests <N>  Stop after N upstream news fetch requests per editorial (HN Algolia or The News API)
  --delay-ms <ms>     Pause between successful days (default: 5000)
  --log <path>        Append-only JSONL progress log (execute mode default: ${DEFAULT_EXECUTE_LOG}; dry-run writes no log unless this is set)
  --base-url <url>    botz API base URL (default: http://127.0.0.1:3000)
  --purge-cf          Purge Cloudflare cache once after the run (requires CF_* env vars)
  --help              Show this help
`);
}

function parseArgs(argv) {
    const options = {
        from: null,
        to: null,
        hour: 12,
        dryRun: true,
        limit: Infinity,
        maxNewsRequests: null,
        delayMs: 5000,
        logPath: undefined,
        baseUrl: process.env.BACKFILL_BASE_URL || 'http://127.0.0.1:3000',
        purgeCf: false,
        replace: null,
        help: false,
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--execute') {
            options.dryRun = false;
            continue;
        }
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg === '--purge-cf') {
            options.purgeCf = true;
            continue;
        }
        const readValue = () => {
            if (i + 1 >= argv.length) {
                throw new Error(`Missing value for ${arg}`);
            }
            i += 1;
            return argv[i];
        };
        if (arg === '--from') options.from = readValue();
        else if (arg === '--to') options.to = readValue();
        else if (arg === '--hour') options.hour = Number(readValue());
        else if (arg === '--limit') options.limit = Number(readValue());
        else if (arg === '--max-news-requests') options.maxNewsRequests = Number(readValue());
        else if (arg === '--delay-ms') options.delayMs = Number(readValue());
        else if (arg === '--log') options.logPath = readValue();
        else if (arg === '--base-url') options.baseUrl = readValue();
        else if (arg === '--replace') options.replace = readValue();
        else throw new Error(`Unknown argument: ${arg}`);
    }

    return options;
}

function resolveLogPath(options) {
    if (options.logPath !== undefined) {
        return options.logPath;
    }
    if (options.dryRun) {
        return null;
    }
    return DEFAULT_EXECUTE_LOG;
}

function appendLog(logPath, entry) {
    if (!logPath) {
        return;
    }
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatUsageSummary(totals) {
    return (
        `tokens prompt=${totals.prompt_tokens} completion=${totals.completion_tokens} ` +
        `reasoning=${totals.reasoning_tokens} total=${totals.total_tokens} ` +
        `image_in=${totals.input_tokens} image_out=${totals.output_tokens} ` +
        `chat_calls=${totals.chat_calls} image_calls=${totals.image_calls}`
    );
}

function dateFromCacheKey(cacheKey) {
    const match = CACHE_KEY_RE.exec(cacheKey);
    return match ? match[1] : null;
}

function buildResumeCommand(options, fromDate) {
    const parts = [
        'node scripts/backfill-editorials.mjs',
        `--from ${fromDate}`,
        `--to ${options.to}`,
        `--hour ${options.hour}`,
        '--execute',
    ];
    if (options.maxNewsRequests != null) {
        parts.push(`--max-news-requests ${options.maxNewsRequests}`);
    }
    return parts.join(' ');
}

async function requestEditorial({ baseUrl, sharedSecret, cacheKey, asOfDate, maxNewsRequests }) {
    const url = new URL('/editorials', baseUrl);
    url.searchParams.set('cacheKey', cacheKey);
    url.searchParams.set('asOf', asOfDate);
    url.searchParams.set('purgeCache', 'false');
    if (maxNewsRequests != null && Number.isFinite(maxNewsRequests)) {
        url.searchParams.set('maxNewsRequests', String(maxNewsRequests));
    }

    const response = await fetchWithRetries(url.toString(), {
        headers: { 'x-shared-secret': sharedSecret },
        signal: AbortSignal.timeout(600000),
    });

    const body = await response.json().catch(() => ({}));
    if (response.status === 503 && body?.error === 'news_quota_exhausted') {
        const err = new Error('The News API quota is exhausted (news_quota_exhausted).');
        err.isNewsQuotaExhausted = true;
        err.resumeFromDate = asOfDate;
        throw err;
    }
    if (response.status === 422) {
        const err = new Error(
            `SKIP ${asOfDate} (${cacheKey}): no qualifying GenAI news story (HTTP 422). See botz logs (no_articles / no_match).`
        );
        err.isNoQualifyingStory = true;
        throw err;
    }
    if (response.status >= 400) {
        const err = new Error(
            `Editorial generation failed for ${asOfDate} (${cacheKey}): HTTP ${response.status}. ` +
                'The botz server logs a redacted editorial_generation_error entry with details.'
        );
        err.status = response.status;
        throw err;
    }

    const newsRequests = Number.parseInt(
        response.headers.get('x-news-fetch-requests') ||
            response.headers.get('x-thenewsapi-requests') ||
            '0',
        10
    );
    return { body, newsRequests: Number.isFinite(newsRequests) ? newsRequests : 0 };
}

function recordDayUsage(cacheDir, cacheKey, date, usageCalls) {
    const usageRecord = readEditorialUsage(cacheDir, cacheKey);
    if (usageRecord?.totals) {
        console.log(`Usage ${date}: ${formatUsageSummary(usageRecord.totals)}`);
        if (usageRecord.calls?.length) {
            usageCalls.push(...usageRecord.calls);
        }
        return usageRecord.totals;
    }
    return null;
}

async function runReplaceMode(options, cacheDir, sharedSecret, logPath) {
    const cacheKey = options.replace;
    if (!CACHE_KEY_RE.test(cacheKey)) {
        throw new Error(`Invalid --replace cacheKey: ${cacheKey}`);
    }
    const asOfDate = dateFromCacheKey(cacheKey);
    console.log(`Replace mode: archiving and regenerating ${cacheKey} (as-of ${asOfDate})`);
    archiveBackfilledEditorial(cacheDir, cacheKey);

    const cacheFilePath = cacheFilePathForKey(cacheDir, cacheKey);
    assertCacheFileWritable(cacheFilePath);

    await requestEditorial({
        baseUrl: options.baseUrl,
        sharedSecret,
        cacheKey,
        asOfDate,
        maxNewsRequests: options.maxNewsRequests,
    });

    const usageCalls = [];
    const totals = recordDayUsage(cacheDir, cacheKey, asOfDate, usageCalls);
    appendLog(logPath, {
        at: new Date().toISOString(),
        date: asOfDate,
        cacheKey,
        status: 'replaced',
        usage: totals,
    });
    if (usageCalls.length > 0) {
        console.log(`Replace usage: ${formatUsageSummary(sumUsageCalls(usageCalls))}`);
    }
}

async function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        printUsage();
        return;
    }

    if (options.replace) {
        if (options.dryRun) {
            throw new Error('--replace requires --execute');
        }
    } else if (!options.from || !options.to) {
        throw new Error('--from and --to are required (YYYY-MM-DD) unless using --replace');
    }

    const cacheDir = process.env.CACHE_DIR || '/home/root/cache';
    const sharedSecret = process.env.SHARED_SECRET;
    const newsApiKey = process.env.NEWS_API_KEY || 'REDACTED';
    const newsSource = parseNewsSource(process.env.NEWS_SOURCE);
    const logPath = resolveLogPath(options);

    if (!options.dryRun && !sharedSecret) {
        throw new Error('SHARED_SECRET is required when using --execute');
    }

    if (options.replace) {
        await runReplaceMode(options, cacheDir, sharedSecret, logPath);
        console.log('Backfill finished.');
        return;
    }

    const allDates = enumerateDatesInclusive(options.from, options.to);
    const pending = allDates.filter((date) => !dateHasAnyEditorialCache(cacheDir, date));

    console.log(
        `Backfill window ${options.from} → ${options.to}: ${allDates.length} day(s), ${pending.length} pending after skip-existing (${allDates.length - pending.length} skipped).`
    );
    console.log(options.dryRun ? 'Mode: dry-run (pass --execute to generate).' : 'Mode: execute');

    const usageCalls = [];
    let processed = 0;
    let newsRequestsUsed = 0;

    for (const date of pending) {
        if (processed >= options.limit) {
            console.log(`Reached --limit ${options.limit}; stopping.`);
            break;
        }

        if (
            options.maxNewsRequests != null &&
            Number.isFinite(options.maxNewsRequests) &&
            newsRequestsUsed >= options.maxNewsRequests
        ) {
            console.log(
                `News fetch request budget (${options.maxNewsRequests}) exhausted after ${newsRequestsUsed} request(s). Stopping.`
            );
            console.log(`Resume with: ${buildResumeCommand(options, date)}`);
            break;
        }

        const cacheKey = editorialCacheKeyForDate(date, options.hour);
        const cacheFilePath = cacheFilePathForKey(cacheDir, cacheKey);

        let newsRequest;
        if (newsSource === 'hn') {
            const hnParams = buildHnAlgoliaParams({ asOfDate: date, page: 0 });
            newsRequest = describeHnAlgoliaRequest(hnParams, { asOfDate: date });
        } else {
            const newsParams = buildTopNewsParams({
                apiToken: newsApiKey,
                search: buildGenAiNewsSearchQuery(),
                language: 'en',
                limit: NEWS_CANDIDATE_LIMIT_PER_REQUEST,
                page: 1,
                asOfDate: date,
                categories: GENAI_NEWS_CATEGORIES,
            });
            newsRequest = describeTopNewsRequest(newsParams, { redactToken: true });
        }

        if (options.dryRun) {
            console.log(`[dry-run] ${date} cacheKey=${cacheKey} news_source=${newsSource}`);
            console.log(
                `[dry-run] news fetch (typical 1 req/editorial): ${newsRequest.method} ${newsRequest.url}?${newsRequest.query}`
            );
            appendLog(logPath, {
                at: new Date().toISOString(),
                date,
                cacheKey,
                status: 'dry-run',
                news_source: newsSource,
                newsRequest: { method: newsRequest.method, url: newsRequest.url, query: newsRequest.query },
            });
            processed += 1;
            continue;
        }

        try {
            assertCacheFileWritable(cacheFilePath);
            if (dateHasAnyEditorialCache(cacheDir, date)) {
                console.log(`SKIP ${date} (cache appeared since planning)`);
                appendLog(logPath, { at: new Date().toISOString(), date, status: 'skipped', reason: 'race' });
                continue;
            }

            const remainingBudget =
                options.maxNewsRequests != null
                    ? Math.max(0, options.maxNewsRequests - newsRequestsUsed)
                    : null;

            console.log(`Generating ${date} → ${cacheKey} ...`);
            const { newsRequests } = await requestEditorial({
                baseUrl: options.baseUrl,
                sharedSecret,
                cacheKey,
                asOfDate: date,
                maxNewsRequests: remainingBudget,
            });
            newsRequestsUsed += newsRequests || 0;

            const totals = recordDayUsage(cacheDir, cacheKey, date, usageCalls);

            appendLog(logPath, {
                at: new Date().toISOString(),
                date,
                cacheKey,
                status: 'ok',
                usage: totals,
                news_api_requests: newsRequests,
            });
            processed += 1;
            if (options.delayMs > 0) {
                await sleep(options.delayMs);
            }
        } catch (error) {
            if (error.isNewsQuotaExhausted) {
                const resumeFrom = error.resumeFromDate || date;
                const resumeCmd = buildResumeCommand(options, resumeFrom);
                console.error(`${error.message} Resume with: ${resumeCmd}`);
                appendLog(logPath, {
                    at: new Date().toISOString(),
                    date,
                    cacheKey,
                    status: 'news_quota_exhausted',
                    resume_command: resumeCmd,
                });
                process.exit(1);
            }
            if (error.isNoQualifyingStory) {
                console.log(error.message);
                appendLog(logPath, {
                    at: new Date().toISOString(),
                    date,
                    cacheKey,
                    status: 'skipped_no_qualifying_story',
                    message: error.message,
                });
                processed += 1;
                continue;
            }
            appendLog(logPath, {
                at: new Date().toISOString(),
                date,
                cacheKey,
                status: 'error',
                message: error.message,
            });
            console.error(error.message);
            process.exit(1);
        }
    }

    if (!options.dryRun) {
        console.log(`The News API requests this run: ${newsRequestsUsed}`);
    }

    if (!options.dryRun && usageCalls.length > 0) {
        console.log(`Run usage total: ${formatUsageSummary(sumUsageCalls(usageCalls))}`);
    }

    if (!options.dryRun && options.purgeCf) {
        const editorialUrl = process.env.EDITORIAL_API_URL_PREFIX
            ? `${process.env.EDITORIAL_API_URL_PREFIX}/editorials`
            : null;
        if (!editorialUrl) {
            console.warn('--purge-cf set but EDITORIAL_API_URL_PREFIX is missing; skipping purge.');
        } else {
            console.log('Purging Cloudflare cache once for latest editorials URL...');
            const result = await purgeCloudflareCacheByUrl({
                zoneId: process.env.CF_ZONE_ID,
                apiToken: process.env.CF_API_TOKEN,
                url: editorialUrl,
            });
            if (result.skipped) {
                console.warn('Cloudflare purge skipped (CF_ZONE_ID or CF_API_TOKEN not set).');
            } else if (!result.ok) {
                throw new Error(`Cloudflare purge failed: ${result.message || 'unknown'}`);
            }
        }
    }

    console.log('Backfill finished.');
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
