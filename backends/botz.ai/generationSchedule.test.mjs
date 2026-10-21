import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GENERATION_DELAY_S, DEFAULT_GENERATION_SCHEDULE, generationConfigFromEnv, generationInfo, parseGenerationSchedule, upcomingRuns } from './generationSchedule.js';

const iso = ms => new Date(ms).toISOString();

test('default schedule is hourly at :01 only (the daily 20:00 run is disabled), 180 s delay', () => {
    assert.equal(DEFAULT_GENERATION_SCHEDULE, '1 * * * *');
    assert.equal(DEFAULT_GENERATION_DELAY_S, 180);
    assert.deepEqual(upcomingRuns(parseGenerationSchedule(), new Date('2026-10-20T19:30:00Z'), 3).map(iso), [
        '2026-10-20T20:01:00.000Z', '2026-10-20T21:01:00.000Z', '2026-10-20T22:01:00.000Z',
    ]);
});

test('extra cron lines: hourly at :01 plus 20:00 UTC', () => {
    const rules = parseGenerationSchedule('1 * * * *;0 20 * * *');
    assert.deepEqual(upcomingRuns(rules, new Date('2026-10-20T18:30:00Z'), 4).map(iso), [
        '2026-10-20T19:01:00.000Z', '2026-10-20T20:00:00.000Z', '2026-10-20T20:01:00.000Z', '2026-10-20T21:01:00.000Z',
    ]);
    // strictly after now: at exactly :01 the next run is the following hour
    assert.equal(iso(upcomingRuns(rules, new Date('2026-10-20T10:01:00Z'), 1)[0]), '2026-10-20T11:01:00.000Z');
    assert.equal(iso(upcomingRuns(rules, new Date('2026-10-20T10:00:59Z'), 1)[0]), '2026-10-20T10:01:00.000Z');
});

test('host clock offset shifts the cron times (e.g. a host on AEDT, +11:00)', () => {
    const rules = parseGenerationSchedule('0 20 * * *');
    assert.equal(iso(upcomingRuns(rules, new Date('2026-10-20T00:00:00Z'), 1, 660)[0]), '2026-10-20T09:00:00.000Z');
});

test('bad schedules are rejected', () => {
    for (const s of ['', '* * * * *', '1 * * * 1', '61 * * * *', '1 25 * * *', 'x']) assert.throws(() => parseGenerationSchedule(s), s);
});

test('config from env with defaults, and the published field', () => {
    const c = generationConfigFromEnv({});
    assert.equal(c.schedule, DEFAULT_GENERATION_SCHEDULE); assert.equal(c.delayS, 180); assert.equal(c.tzOffsetMin, 0);
    const g = generationInfo(generationConfigFromEnv({ GENERATION_SCHEDULE: '30 * * * *', GENERATION_DELAY_S: '60' }), new Date('2026-10-20T10:40:00Z'), 0);
    assert.deepEqual(g, { schedule: '30 * * * *', tz_offset_min: 0, stamp_tz_offset_min: 0, typical_delay_s: 60, grace_s: 600,
        // 10:30 started 10 min ago: still inside delay (1 min) + grace (10 min), so it is still awaited
        upcoming: ['2026-10-20T10:30:00.000Z', '2026-10-20T11:30:00.000Z', '2026-10-20T12:30:00.000Z', '2026-10-20T13:30:00.000Z', '2026-10-20T14:30:00.000Z'] });
});

test('a run whose publishing overruns the delay stays in upcoming until delay + grace has passed', () => {
    const c = generationConfigFromEnv({});   // hourly :01, delay 180 s, grace 600 s -> waited for until :14
    // now 20:05 (past the 180 s delay, story not out yet): the 20:01 run is still listed first
    let g = generationInfo(c, new Date('2026-10-20T20:05:00Z'), 0);
    assert.deepEqual(g.upcoming.slice(0, 2), ['2026-10-20T20:01:00.000Z', '2026-10-20T21:01:00.000Z']);
    assert.equal(g.upcoming.filter(t => Date.parse(t) > Date.parse('2026-10-20T20:05:00Z')).length, 4);
    // 20:15 = 20:01 + 180 s + 600 s + 60 s: given up, the next run leads
    g = generationInfo(c, new Date('2026-10-20T20:15:00Z'), 0);
    assert.equal(g.upcoming[0], '2026-10-20T21:01:00.000Z');
    // with the daily line configured, both 20:00 and 20:01 are awaited at 20:05
    g = generationInfo(generationConfigFromEnv({ GENERATION_SCHEDULE: '1 * * * *;0 20 * * *' }), new Date('2026-10-20T20:05:00Z'), 0);
    assert.deepEqual(g.upcoming.slice(0, 3), ['2026-10-20T20:00:00.000Z', '2026-10-20T20:01:00.000Z', '2026-10-20T21:01:00.000Z']);
});

test('stamp offset comes from the clock writing generated_at (default: this process)', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    assert.equal(generationInfo(generationConfigFromEnv({}), now).stamp_tz_offset_min, -now.getTimezoneOffset());
    assert.equal(generationInfo(generationConfigFromEnv({}), now, 660).stamp_tz_offset_min, 660);
});
