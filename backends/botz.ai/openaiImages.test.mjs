import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildImageGenerateParams,
    mapImageQuality,
    DEFAULT_OPENAI_IMAGE_MODEL,
} from './openaiImages.js';

test('buildImageGenerateParams never sends DALL·E style', () => {
    const params = buildImageGenerateParams('a robot reading news', {
        model: 'gpt-image-1',
        quality: 'standard',
    });
    assert.equal('style' in params, false);
    assert.equal(params.model, 'gpt-image-1');
    assert.equal(params.quality, 'medium');
    assert.equal(params.size, '1024x1024');
    assert.equal(params.n, 1);
});

test('mapImageQuality maps legacy standard and hd', () => {
    assert.equal(mapImageQuality('standard'), 'medium');
    assert.equal(mapImageQuality('hd'), 'high');
    assert.equal(mapImageQuality('high'), 'high');
});

test('mocked OpenAI client receives generate body without style', async () => {
    const calls = [];
    const mockClient = {
        images: {
            generate: async (body) => {
                calls.push(body);
                return { data: [{ b64_json: Buffer.from('fake').toString('base64') }] };
            },
        },
    };

    const { requestGeneratedImage } = await import('./openaiImages.js');
    await requestGeneratedImage(mockClient, 'test prompt');

    assert.equal(calls.length, 1);
    assert.equal('style' in calls[0], false);
    assert.equal(calls[0].model, DEFAULT_OPENAI_IMAGE_MODEL);
});
