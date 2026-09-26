#!/usr/bin/env node
/**
 * Backfill missing botz.ai editorials (one per calendar day).
 * Run inside the botz container against the local API (default http://127.0.0.1:3000).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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

const { purgeCloudflareCacheByUrl } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'cloudflarePurge.js')).href
);

const { sumUsageCalls } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'openaiUsageLog.js')).href
);

const DEFAULT_KEYWORDS =
    'claude|anthropic|runwayml|llm|ollama|sora|chatgpt|midjourney|dall-e|openai|genai|generative ai|copilot|gemini|bard|gpt-4|hugging face|meta llama';

const DEFAULT_EXECUTE_LOG = '/tmp/backfill-editorials.log.jsonl';

function printUsage() {
    console.log(`Usage: node scripts/backfill-editorials.mjs --from YYYY-MM-DD --to YYYY-MM-DD [options]

Options:
  --hour <0-99>       Cache key hour suffix (default: 12 → YYYY-MM-DD-12.json)
  --execute           Perform OpenAI generation and cache writes (default: dry-run only)
  --limit <N>         Process at most N pending days after skips
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
        delayMs: 5000,
        logPath: undefined,
        baseUrl: process.env.BACKFILL_BASE_URL || 'http://127.0.0.1:3000',
        purgeCf: false,
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
        else if (arg === '--delay-ms') options.delayMs = Number(readValue());
        else if (arg === '--log') options.logPath = readValue();
        else if (arg === '--base-url') options.baseUrl = readValue();
        else throw new Error(`Unknown argument: ${arg}`);
    }

    if (!options.from || !options.to) {
        throw new Error('--from and --to are required (YYYY-MM-DD)');
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
        `chat_calls=${totals.chat_calls} image_calls=${totals.image_calls}`
    );
}

async function requestEditorial({ baseUrl, sharedSecret, cacheKey, asOfDate }) {
    const url = new URL('/editorials', baseUrl);
    url.searchParams.set('cacheKey', cacheKey);
    url.searchParams.set('asOf', asOfDate);
    url.searchParams.set('purgeCache', 'false');

    const response = await fetch(url, {
        headers: { 'x-shared-secret': sharedSecret },
        signal: AbortSignal.timeout(600000),
    });

    const body = await response.json().catch(() => ({}));
    if (response.status >= 400) {
        const err = new Error(
            `Editorial generation failed for ${asOfDate} (${cacheKey}): HTTP ${response.status}. ` +
                'The botz server logs a redacted editorial_generation_error entry with details.'
        );
        err.status = response.status;
        throw err;
    }
    return body;
}

async function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        printUsage();
        return;
    }

    const cacheDir = process.env.CACHE_DIR || '/home/root/cache';
    const sharedSecret = process.env.SHARED_SECRET;
    const newsApiKey = process.env.NEWS_API_KEY || 'REDACTED';
    const logPath = resolveLogPath(options);

    if (!options.dryRun && !sharedSecret) {
        throw new Error('SHARED_SECRET is required when using --execute');
    }

    const allDates = enumerateDatesInclusive(options.from, options.to);
    const pending = allDates.filter((date) => !dateHasAnyEditorialCache(cacheDir, date));

    console.log(
        `Backfill window ${options.from} → ${options.to}: ${allDates.length} day(s), ${pending.length} pending after skip-existing (${allDates.length - pending.length} skipped).`
    );
    console.log(options.dryRun ? 'Mode: dry-run (pass --execute to generate).' : 'Mode: execute');

    const usageCalls = [];
    let processed = 0;
    for (const date of pending) {
        if (processed >= options.limit) {
            console.log(`Reached --limit ${options.limit}; stopping.`);
            break;
        }

        const cacheKey = editorialCacheKeyForDate(date, options.hour);
        const cacheFilePath = cacheFilePathForKey(cacheDir, cacheKey);

        const newsParams = buildTopNewsParams({
            apiToken: newsApiKey,
            search: DEFAULT_KEYWORDS,
            language: 'en',
            limit: 1,
            page: 1,
            asOfDate: date,
        });
        const newsRequest = describeTopNewsRequest(newsParams, { redactToken: true });

        if (options.dryRun) {
            console.log(`[dry-run] ${date} cacheKey=${cacheKey}`);
            console.log(
                `[dry-run] News API: ${newsRequest.method} ${newsRequest.url}?${newsRequest.query}`
            );
            appendLog(logPath, {
                at: new Date().toISOString(),
                date,
                cacheKey,
                status: 'dry-run',
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

            console.log(`Generating ${date} → ${cacheKey} ...`);
            const editorialPayload = await requestEditorial({
                baseUrl: options.baseUrl,
                sharedSecret,
                cacheKey,
                asOfDate: date,
            });

            const dayUsage = editorialPayload?.[0]?._openai_usage;
            if (dayUsage?.totals) {
                console.log(`Usage ${date}: ${formatUsageSummary(dayUsage.totals)}`);
                if (dayUsage.calls?.length) {
                    usageCalls.push(...dayUsage.calls);
                }
            }

            appendLog(logPath, {
                at: new Date().toISOString(),
                date,
                cacheKey,
                status: 'ok',
                usage: dayUsage?.totals,
            });
            processed += 1;
            if (options.delayMs > 0) {
                await sleep(options.delayMs);
            }
        } catch (error) {
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
