import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtures } from './storySelection.fixtures.js';
import {
    articleTextForMatching,
    buildGenAiNewsSearchQuery,
    isVerdictAcceptable,
    parseRelevanceScoringResponse,
    passesLocalAiTermGate,
    selectBestQualifyingStory,
} from './storySelection.js';

test('buildGenAiNewsSearchQuery focuses on AI vendors and products', () => {
    const q = buildGenAiNewsSearchQuery();
    assert.match(q, /OpenAI/);
    assert.match(q, /Claude/);
    assert.doesNotMatch(q, /breitbart/i);
});

test('passesLocalAiTermGate rejects pilot off-topic fixtures', () => {
    assert.equal(passesLocalAiTermGate(fixtures.tokyoAssault), false);
    assert.equal(passesLocalAiTermGate(fixtures.nycPhoneBan), false);
    assert.equal(passesLocalAiTermGate(fixtures.benzingaMarket), false);
});

test('passesLocalAiTermGate accepts GenAI fixture', () => {
    assert.equal(passesLocalAiTermGate(fixtures.openAiRelease), true);
});

test('selectBestQualifyingStory picks highest scoring qualifying article', async () => {
    const scoreArticle = async (article) => {
        if (article.uuid === 'good') {
            return JSON.stringify({ qualifies: true, score: 92, sensitive_harm: false, reason: 'genai' });
        }
        return JSON.stringify({ qualifies: false, score: 20, sensitive_harm: false, reason: 'off_topic' });
    };

    const picked = await selectBestQualifyingStory(
        [fixtures.nycPhoneBan, { ...fixtures.openAiRelease, uuid: 'good' }],
        { scoreArticle }
    );
    assert.equal(picked.uuid, 'good');
});

test('selectBestQualifyingStory returns null when nothing qualifies', async () => {
    const scoreArticle = async () =>
        JSON.stringify({ qualifies: false, score: 10, sensitive_harm: false, reason: 'off_topic' });

    const picked = await selectBestQualifyingStory([fixtures.benzingaMarket], { scoreArticle });
    assert.equal(picked, null);
});

test('parseRelevanceScoringResponse flags sensitive harm', () => {
    const verdict = parseRelevanceScoringResponse(
        JSON.stringify({ qualifies: false, score: 0, sensitive_harm: true, reason: 'assault' })
    );
    assert.equal(isVerdictAcceptable(verdict), false);
});

test('articleTextForMatching combines title and description', () => {
    const text = articleTextForMatching(fixtures.openAiRelease);
    assert.match(text, /OpenAI/i);
});
