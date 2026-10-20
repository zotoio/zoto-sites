/**
 * When the next story is expected: the host crontab that runs story generation, as one config value.
 *
 * GENERATION_SCHEDULE   cron "minute hour" pairs (the remaining cron fields must be *), separated by ";".
 *                       Default "1 * * * *;0 20 * * *": hourly at minute 1, plus a daily run at 20:00.
 * GENERATION_TZ_OFFSET_MIN  minutes east of UTC of the host clock the crontab runs on (default 0: the droplet is UTC).
 * GENERATION_DELAY_S    typical seconds from a run starting to its story being published (default 90).
 *
 * The archive endpoints publish `generation: { schedule, tz_offset_min, typical_delay_s, upcoming: [ISO...] }` so
 * clients never hard-code the schedule. `upcoming` lists several runs, so a response served a few minutes stale by
 * the CDN (short TTL + stale-while-revalidate) still contains the right next run. A run does not always publish a
 * story (nothing new qualifies), so clients move on to the following run after a grace period.
 */
export const DEFAULT_GENERATION_SCHEDULE = '1 * * * *;0 20 * * *';
export const DEFAULT_GENERATION_DELAY_S = 90;

function parseField(f, max) {
    if (f === '*') return null;   // every value
    const vals = f.split(',').map(v => Number(v));
    if (!vals.length || vals.some(v => !Number.isInteger(v) || v < 0 || v > max)) throw new Error(`bad cron field "${f}"`);
    return vals;
}

/** "m h * * *;..." -> [{ minutes: number[] , hours: number[] | null }] */
export function parseGenerationSchedule(spec = DEFAULT_GENERATION_SCHEDULE) {
    const rules = String(spec).split(';').map(s => s.trim()).filter(Boolean).map(line => {
        const f = line.split(/\s+/);
        if (f.length !== 5 || f.slice(2).some(x => x !== '*')) throw new Error(`unsupported cron line "${line}" (only "m h * * *")`);
        const minutes = parseField(f[0], 59);
        if (!minutes) throw new Error(`cron minute must be fixed in "${line}"`);
        return { minutes, hours: parseField(f[1], 23) };
    });
    if (!rules.length) throw new Error('empty generation schedule');
    return rules;
}

/** The next `count` run times strictly after `now` (Date), as epoch ms, ascending and de-duplicated. */
export function upcomingRuns(rules, now = new Date(), count = 4, tzOffsetMin = 0) {
    const out = new Set();
    const shift = tzOffsetMin * 60000;
    // walk whole minutes on the host clock; at most count * 24h for hourly-or-sparser rules
    const startLocal = Math.floor((now.getTime() + shift) / 60000) * 60000 + 60000;
    for (let t = startLocal, end = startLocal + 2 * 86400000 * count; t < end && out.size < count; t += 60000) {
        const d = new Date(t), m = d.getUTCMinutes(), h = d.getUTCHours();
        if (rules.some(r => r.minutes.includes(m) && (!r.hours || r.hours.includes(h)))) out.add(t - shift);
    }
    return [...out].sort((a, b) => a - b);
}

export function generationConfigFromEnv(env = process.env) {
    const schedule = env.GENERATION_SCHEDULE || DEFAULT_GENERATION_SCHEDULE;
    const tzOffsetMin = Number.isFinite(Number(env.GENERATION_TZ_OFFSET_MIN)) ? Number(env.GENERATION_TZ_OFFSET_MIN) : 0;
    const delay = Number(env.GENERATION_DELAY_S);
    return { schedule, rules: parseGenerationSchedule(schedule), tzOffsetMin, delayS: Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_GENERATION_DELAY_S };
}

/** The `generation` field of /archive/index and /archive/latest. */
export function generationInfo(config, now = new Date()) {
    return {
        schedule: config.schedule,
        tz_offset_min: config.tzOffsetMin,
        typical_delay_s: config.delayS,
        upcoming: upcomingRuns(config.rules, now, 4, config.tzOffsetMin).map(ms => new Date(ms).toISOString()),
    };
}
