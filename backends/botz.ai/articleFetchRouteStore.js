import fs from 'fs';
import path from 'path';

export const DEFAULT_ROUTE_TTL_HOURS = 24;
export const DEFAULT_ROUTE_CACHE_FILE = 'article-fetch-routes.json';

/** Lowercase hostname with a leading "www." stripped; null if the URL is invalid. */
export function routeHostKey(url) {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
    } catch {
        return null;
    }
}

export function resolveRouteCachePath(env = process.env) {
    const explicit = (env.ARTICLE_FETCH_ROUTE_CACHE || '').trim();
    if (explicit) return explicit;
    return path.join((env.CACHE_DIR || '/home/root/cache').trim(), DEFAULT_ROUTE_CACHE_FILE);
}

export function resolveRouteTtlMs(env = process.env) {
    const n = Number.parseFloat(String(env.ARTICLE_FETCH_ROUTE_TTL_HOURS ?? '').trim());
    return (Number.isFinite(n) && n > 0 ? n : DEFAULT_ROUTE_TTL_HOURS) * 3600 * 1000;
}

/**
 * Host -> { route: 'direct'|'proxy', at: epochMs } memory, loaded lazily from one small JSON file
 * and saved atomically (temp file + rename) after each update. Touches no other file.
 */
export function createRouteStore({ filePath, ttlMs = DEFAULT_ROUTE_TTL_HOURS * 3600 * 1000, now = Date.now, log = () => {} } = {}) {
    let map = null;

    const load = () => {
        if (map) return map;
        map = new Map();
        if (!filePath) return map;
        let raw;
        try {
            raw = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            if (error.code !== 'ENOENT') log(`article_fetch_route_store: read failed (${error.message}); starting empty`);
            return map;
        }
        try {
            const data = JSON.parse(raw);
            for (const [host, entry] of Object.entries(data?.hosts || {})) {
                if ((entry?.route === 'direct' || entry?.route === 'proxy') && Number.isFinite(entry.at)) {
                    map.set(host, { route: entry.route, at: entry.at });
                }
            }
        } catch (error) {
            log(`article_fetch_route_store: corrupt file (${error.message}); starting empty`);
            map = new Map();
        }
        return map;
    };

    const save = () => {
        if (!filePath) return;
        const tmp = `${filePath}.${process.pid}.tmp`;
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify({ version: 1, hosts: Object.fromEntries(map) }));
            fs.renameSync(tmp, filePath);
        } catch (error) {
            log(`article_fetch_route_store: save failed (${error.message})`);
            try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        }
    };

    return {
        /** @returns {'direct'|'proxy'|null} unexpired remembered route */
        get(host) {
            const entry = load().get(host);
            if (!entry) return null;
            if (now() - entry.at >= ttlMs) {
                map.delete(host);
                return null;
            }
            return entry.route;
        },
        set(host, route) {
            const m = load();
            m.set(host, { route, at: now() });
            save();
        },
        /** Forget a host's remembered route (e.g. the remembered proxy route stopped working). */
        delete(host) {
            const m = load();
            if (m.delete(host)) save();
        },
    };
}

const stores = new Map();
/** Shared per-process store for a given env (one instance per file path). */
export function getDefaultRouteStore(env = process.env, log = () => {}) {
    const filePath = resolveRouteCachePath(env);
    if (!stores.has(filePath)) {
        stores.set(filePath, createRouteStore({ filePath, ttlMs: resolveRouteTtlMs(env), log }));
    }
    return stores.get(filePath);
}
