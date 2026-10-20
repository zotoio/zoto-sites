import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GENERATION_SCHEDULE, generationConfigFromEnv, generationInfo, parseGenerationSchedule, upcomingRuns } from './generationSchedule.js';

const iso = ms => new Date(ms).toISOString();

test('default schedule: hourly at :01 plus 20:00 UTC', () => {
    const rules = parseGenerationSchedule(DEFAULT_GENERATION_SCHEDULE);
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
    assert.equal(c.schedule, DEFAULT_GENERATION_SCHEDULE); assert.equal(c.delayS, 90); assert.equal(c.tzOffsetMin, 0);
    const g = generationInfo(generationConfigFromEnv({ GENERATION_SCHEDULE: '30 * * * *', GENERATION_DELAY_S: '60' }), new Date('2026-10-20T10:40:00Z'));
    assert.deepEqual(g, { schedule: '30 * * * *', tz_offset_min: 0, typical_delay_s: 60,
        upcoming: ['2026-10-20T11:30:00.000Z', '2026-10-20T12:30:00.000Z', '2026-10-20T13:30:00.000Z', '2026-10-20T14:30:00.000Z'] });
});
