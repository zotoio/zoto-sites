#!/usr/bin/env node
/**
 * List top local-AI-gated HN candidates for sample dates (no OpenAI).
 */
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const botzRoot = path.resolve(__dirname, '../backends/botz.ai');

const { listHnAiCandidatesForDate } = await import(
    pathToFileURL(path.join(botzRoot, 'hnEditorialFetch.js')).href
);

const dates = process.argv.slice(2);
if (dates.length === 0) {
    console.error('Usage: node scripts/hn-sample-candidates.mjs YYYY-MM-DD ...');
    process.exit(1);
}

const httpGet = async ({ url, params }) => {
    const qs = new URLSearchParams(params).toString();
    const response = await fetch(`${url}?${qs}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return { data: await response.json() };
};

for (const date of dates) {
    console.log(`\n=== ${date} ===`);
    const picks = await listHnAiCandidatesForDate({ asOfDate: date, httpGet, limit: 3 });
    if (!picks.length) {
        console.log('(no AI-gated candidates after enrichment)');
        continue;
    }
    for (const p of picks) {
        console.log(
            `- [${p.points} pts / ${p.num_comments} comments] ${p.title}\n  ${p.url}\n  ${p.hn_url}`
        );
    }
}
