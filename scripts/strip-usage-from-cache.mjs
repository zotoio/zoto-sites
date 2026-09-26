#!/usr/bin/env node
/**
 * One-off: remove legacy _openai_usage from backfilled editorial cache JSON files.
 * Default dry-run; pass --execute to write changes.
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const botzPackageRoot =
    process.env.BOTZ_PACKAGE_ROOT || path.resolve(__dirname, '../backends/botz.ai');

const { listPublicEditorialCacheFileNames } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'cacheListing.js')).href
);
const { stripUsageFromCacheFile } = await import(
    pathToFileURL(path.join(botzPackageRoot, 'stripUsageFromCache.js')).href
);

function printUsage() {
    console.log(`Usage: node scripts/strip-usage-from-cache.mjs [options]

Options:
  --cache-dir <path>   Editorial cache directory (default: CACHE_DIR or backends/botz.ai/cache)
  --execute            Write changes (default: dry-run only)
  --help               Show this help
`);
}

function parseArgs(argv) {
    const options = { cacheDir: null, execute: false, help: false };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--execute') {
            options.execute = true;
            continue;
        }
        if (arg === '--cache-dir') {
            i += 1;
            options.cacheDir = argv[i];
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}

async function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        printUsage();
        return;
    }

    const cacheDir =
        options.cacheDir ||
        process.env.CACHE_DIR ||
        path.resolve(__dirname, '../backends/botz.ai/cache');

    const files = listPublicEditorialCacheFileNames(cacheDir);
    let wouldChange = 0;
    let changed = 0;

    for (const name of files) {
        const filePath = path.join(cacheDir, name);
        const result = stripUsageFromCacheFile(filePath, { execute: options.execute });
        if (result.wouldChange) {
            wouldChange += 1;
            console.log(`[dry-run] would strip _openai_usage from ${name}`);
        } else if (result.changed) {
            changed += 1;
            console.log(`stripped _openai_usage from ${name}`);
        }
    }

    if (options.execute) {
        console.log(`Done. Updated ${changed} file(s).`);
    } else {
        console.log(`Dry-run complete. ${wouldChange} file(s) would be updated (pass --execute to apply).`);
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
