import fs from 'fs';
import path from 'path';

export function resolveUsageStoreDir(cacheDir) {
    if (process.env.USAGE_LOG_DIR) {
        return process.env.USAGE_LOG_DIR;
    }
    return path.join(path.dirname(cacheDir), 'botz-usage');
}

export function usageRecordPath(cacheDir, cacheKey) {
    return path.join(resolveUsageStoreDir(cacheDir), `${cacheKey}.usage.json`);
}

export function writeEditorialUsageRecord(cacheDir, cacheKey, { calls, totals }) {
    const dir = resolveUsageStoreDir(cacheDir);
    fs.mkdirSync(dir, { recursive: true });
    const record = {
        cacheKey,
        recorded_at: new Date().toISOString(),
        calls,
        totals,
    };
    fs.writeFileSync(usageRecordPath(cacheDir, cacheKey), JSON.stringify(record));
    fs.appendFileSync(path.join(dir, 'usage-events.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
    return record;
}

export function readEditorialUsage(cacheDir, cacheKey) {
    const filePath = usageRecordPath(cacheDir, cacheKey);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** Remove private fields before any HTTP JSON response. */
export function stripPrivateEditorialFields(editorials) {
    if (!Array.isArray(editorials)) {
        return editorials;
    }
    return editorials.map((entry) => {
        if (!entry || typeof entry !== 'object') {
            return entry;
        }
        const { _openai_usage, ...rest } = entry;
        return rest;
    });
}
