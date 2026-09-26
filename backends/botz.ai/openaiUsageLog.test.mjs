import assert from 'node:assert/strict';
import test from 'node:test';
import {
    sumUsageCalls,
    usageFromChatCompletion,
    usageFromImageGenerateResponse,
} from './openaiUsageLog.js';

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

test('usageFromImageGenerateResponse records API usage when present', () => {
    const record = usageFromImageGenerateResponse(
        { usage: { total_tokens: 4200, input_tokens: 1000, output_tokens: 3200 } },
        { model: 'gpt-image-2.5-flare', size: '1024x1024', quality: 'medium' }
    );
    assert.equal(record.total_tokens, 4200);
    assert.equal(record.input_tokens, 1000);
});

test('usageFromImageGenerateResponse notes missing usage', () => {
    const record = usageFromImageGenerateResponse({}, { model: 'gpt-image-2', size: '1024x1024', quality: 'medium' });
    assert.equal(record.usage_note, 'images_api_usage_not_returned');
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
