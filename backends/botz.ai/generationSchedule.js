/**
 * When the next story is expected: the host crontab that runs story generation, as one config value.
 *
 * GENERATION_SCHEDULE   cron "minute hour" pairs (the remaining cron fields must be *), separated by ";".
 *                       Default "1 * * * *": hourly at minute 1 (the daily 20:00 run is disabled); e.g. "1 * * * *;0 20 * * *" adds it.
 * GENERATION_TZ_OFFSET_MIN  minutes east of UTC of the host clock the crontab runs on (default 0: the droplet is UTC).
 * GENERATION_DELAY_S    typical seconds from a run starting to its story being published (default 180).
 *
 * The archive endpoints publish `generation: { schedule, tz_offset_min, typical_delay_s, upcoming: [ISO...] }` so
 * clients never hard-code the schedule. `upcoming` lists several runs, so a response served a few minutes stale by
 * the CDN (short TTL + stale-while-revalidate) still contains the right next run. A run does not always publish a
 * story (nothing new qualifies), so clients move on to the following run after a grace period.
 */
export const DEFAULT_GENERATION_SCHEDULE = '1 * * * *';   // hourly; the daily 20:00 UTC run is disabled on the host
export const DEFAULT_GENERATION_DELAY_S = 180;   // runs take ~175 s to publish
/** How long after a run's expected publish time clients keep waiting ("any moment now") before giving up on it. */
export const GENERATION_GRACE_S = 600;

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
export function upcomingRuns(rules, now = new Date(), count = 4, tzOffsetMin = 0, lookbackMs = 0) {
    const out = new Set();
    const shift = tzOffsetMin * 60000;
    // walk whole minutes on the host clock; at most count * 24h for hourly-or-sparser rules
    const startLocal = Math.floor((now.getTime() - lookbackMs + shift) / 60000) * 60000 + 60000;
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
/**
 * `upcoming` starts with any run still inside its wait window (started less than delay + grace ago): a story whose
 * publishing overruns the typical delay is still awaited instead of the countdown jumping to the next run.
 * `stamp_tz_offset_min` is the offset of the clock that writes stories' `generated_at` (local wall time, no zone):
 * clients convert those stamps with it rather than assuming UTC.
 */
export function generationInfo(config, now = new Date(), stampTzOffsetMin = -now.getTimezoneOffset()) {
    const lookbackMs = (config.delayS + GENERATION_GRACE_S) * 1000;
    const runs = upcomingRuns(config.rules, now, 8, config.tzOffsetMin, lookbackMs);
    const future = runs.filter(ms => ms > now.getTime()).slice(0, 4);
    return {
        schedule: config.schedule,
        tz_offset_min: config.tzOffsetMin,
        stamp_tz_offset_min: stampTzOffsetMin,
        typical_delay_s: config.delayS,
        grace_s: GENERATION_GRACE_S,
        upcoming: [...runs.filter(ms => ms <= now.getTime()), ...future].map(ms => new Date(ms).toISOString()),
    };
}
