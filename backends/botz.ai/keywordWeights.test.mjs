import assert from 'node:assert/strict';
import test from 'node:test';
import { KEYWORD_PASS_THRESHOLD, KEYWORD_TABLE, scoreKeywords, WEIGHT } from './keywordWeights.js';
import { classifyCandidate, passesLocalAiTermGate, selectBestQualifyingStory } from './storySelection.js';
import { buildJevRequest, combineScores, createJevClassifierFromEnv, parseJevResponse } from './jevClassifier.js';
import { fixtures } from './storySelection.fixtures.js';

const steam = {
    title: 'ACTUALLY: Steam Users Beg for "No AI" Filter as Vibecoders Flood Next Fest',
    url: 'https://www.ign.com/articles/steam-fans-are-begging-for-a-no-ai-filter-as-steam-next-fest-is-filled-with-slop',
    source: 'ign.com',
    description: '',
};

test('weights: vendor > high > medium > low; single table', () => {
    const w = (id) => KEYWORD_TABLE.find((e) => e.id === id).weight;
    assert.ok(w('openai') > w('llm') && w('llm') > w('AI') && w('AI') > w('GPU'));
    for (const id of ['openai', 'claude', 'gemini', 'grok', 'deepseek', 'qwen', 'llama', 'mistral']) {
        assert.equal(w(id), WEIGHT.VENDOR, id);
    }
    for (const id of ['generative-ai', 'llm', 'agentic', 'ai-agent', 'vibe-coding', 'ai-slop']) {
        assert.equal(w(id), WEIGHT.HIGH, id);
    }
    for (const id of ['AI', 'artificial-intelligence', 'machine-learning', 'neural-network']) {
        assert.equal(w(id), WEIGHT.MEDIUM, id);
    }
});

test('Steam "No AI" Filter title passes (case-sensitive whole word AI)', () => {
    assert.equal(passesLocalAiTermGate(steam), true);
    assert.ok(scoreKeywords(steam).score >= KEYWORD_PASS_THRESHOLD);
});

test('slug no-ai-filter alone (plus domain) passes', () => {
    const slugOnly = { title: 'Steam Next Fest is a mess', url: 'https://www.ign.com/articles/steam-fans-no-ai-filter', source: 'ign.com' };
    const result = scoreKeywords(slugOnly);
    assert.ok(result.matches.some((m) => m.id === 'AI' && m.where === 'slug'));
    assert.equal(passesLocalAiTermGate(slugOnly), true);
});

test('lowercase ai inside words does not match (said, Hawaii, maintain, AIR)', () => {
    for (const title of ['He said it was fine', 'Trip to Hawaii and Thailand', 'Maintain the AIRPORT', 'Mountain rain said Bain']) {
        assert.equal(scoreKeywords({ title, url: 'https://example.com/news/x', source: 'example.com' }).score, 0, title);
    }
});

test('vendor, high and medium terms pass; a single low term does not; two low terms do', () => {
    const t = (title) => passesLocalAiTermGate({ title, url: 'https://e.com/a', source: 'e.com' });
    assert.equal(t('DeepSeek releases new model'), true);
    assert.equal(t('Agentic coding gets popular'), true);
    assert.equal(t('Machine learning in hospitals'), true);
    assert.equal(t('Neural networks explained'), true);
    assert.equal(t('New GPU shipping in Q4'), false);
    assert.equal(t('Prompt inference tricks'), true);
});

test('existing off-topic fixtures still fail and GenAI fixture passes', () => {
    assert.equal(passesLocalAiTermGate(fixtures.tokyoAssault), false);
    assert.equal(passesLocalAiTermGate(fixtures.nycPhoneBan), false);
    assert.equal(passesLocalAiTermGate(fixtures.benzingaMarket), false);
    assert.equal(passesLocalAiTermGate(fixtures.openAiRelease), true);
});

test('sensitive-harm text is rejected even with AI terms', () => {
    assert.equal(passesLocalAiTermGate({ title: 'AI used in murder investigation', url: 'https://e.com/a' }), false);
});

test('jev: request/response shapes and env gating (no key => null, skipped with log)', async () => {
    const req = buildJevRequest(steam, { model: 'jev-1.13.0' });
    assert.equal(req.model, 'jev-1.13.0');
    assert.equal(req.questions.relevant.type, 'noul');
    assert.match(req.state, /Steam Users/);
    assert.equal(parseJevResponse({ answers: { relevant: { type: 'noul', noul: 0.87 } } }), 0.87);
    assert.equal(parseJevResponse({ answers: { relevant: { type: 'noul', noul: 7 } } }), 1);
    assert.equal(parseJevResponse({ answers: {} }), null);

    const logs = [];
    assert.equal(createJevClassifierFromEnv({ env: {}, log: (m) => logs.push(m) }), null);
    assert.match(logs[0], /jev_classifier_skipped/);

    let seen;
    const classifier = createJevClassifierFromEnv({
        env: { TYPESAFE_API_KEY: 'test-key', TYPESAFE_BASE_URL: 'https://jev.test/', JEV_MODEL: 'jev-1.13.0' },
        fetchImpl: async (url, opts) => {
            seen = { url, opts };
            return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { relevant: { type: 'noul', noul: 0.91 } }, usage: {} }), { status: 200 });
        },
    });
    assert.equal(await classifier(steam), 0.91);
    assert.equal(seen.url, 'https://jev.test/v1/systemone');
    assert.equal(seen.opts.method, 'POST');
    assert.equal(seen.opts.headers.Authorization, 'Bearer test-key');
    assert.equal(JSON.parse(seen.opts.body).model, 'jev-1.13.0');
});

test('combine: jev rescues zero-keyword story, vetoes weak keyword hit, errors fall back to keywords', async () => {
    assert.ok(combineScores({ keywordScore: 0, keywordCap: 10, jev: 0.9 }) >= 0.35);
    assert.ok(combineScores({ keywordScore: 0, keywordCap: 10, jev: 0.5 }) < 0.35);
    assert.ok(combineScores({ keywordScore: 2, keywordCap: 10, jev: 0.1 }) < 0.35);

    const noKw = { title: 'Robots take over warehouse picking', url: 'https://e.com/robots' };
    assert.equal((await classifyCandidate(noKw, { jevClassifier: null })).passes, false);
    const rescued = await classifyCandidate(noKw, { jevClassifier: async () => 0.9 });
    assert.equal(rescued.passes, true);
    assert.equal(rescued.mode, 'keyword+jev');
    const vetoed = await classifyCandidate(steam, { jevClassifier: async () => 0.05 });
    assert.equal(vetoed.passes, false);

    const logs = [];
    const fell = await classifyCandidate(steam, { jevClassifier: async () => { throw new Error('jev_http_500'); }, log: (m) => logs.push(m) });
    assert.equal(fell.passes, true);
    assert.equal(fell.mode, 'keyword');
    assert.match(logs[0], /falling back/);
});

test('selectBestQualifyingStory consults Jev before the gate (mocked) and keeps downstream scoring', async () => {
    const calls = [];
    const jevClassifier = async (a) => {
        calls.push(a.title);
        return a.title.includes('Robots') ? 0.95 : 0.0;
    };
    const scoreArticle = async () => JSON.stringify({ qualifies: true, score: 75, sensitive_harm: false, reason: 'ok' });
    const picked = await selectBestQualifyingStory(
        [{ title: 'Robots learn to cook', url: 'https://e.com/r' }, fixtures.benzingaMarket],
        { scoreArticle, jevClassifier }
    );
    assert.equal(picked.title, 'Robots learn to cook');
    assert.equal(calls.length, 2);
});
