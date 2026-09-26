import assert from 'node:assert/strict';
import test from 'node:test';
import { sumUsageCalls, usageFromChatCompletion } from './openaiUsageLog.js';

test('usageFromChatCompletion extracts token fields', () => {
    const record = usageFromChatCompletion('gpt-6-luna', {
        usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            completion_tokens_details: { reasoning_tokens: 3 },
        },
    });
    assert.equal(record.model, 'gpt-6-luna');
    assert.equal(record.prompt_tokens, 10);
    assert.equal(record.reasoning_tokens, 3);
});

test('sumUsageCalls aggregates chat and image calls', () => {
    const totals = sumUsageCalls([
        {
            kind: 'chat.completions',
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            reasoning_tokens: 10,
        },
        { kind: 'images.generate', model: 'gpt-image-2.5-flare' },
    ]);
    assert.equal(totals.chat_calls, 1);
    assert.equal(totals.image_calls, 1);
    assert.equal(totals.prompt_tokens, 100);
    assert.equal(totals.reasoning_tokens, 10);
});
