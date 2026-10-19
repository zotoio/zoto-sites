import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildArchiveListItem,
    editorialHeadlineText,
    extractEditorialAuthor,
    formatEditorialByline,
} from './archiveListing.js';

test('formatEditorialByline prefixes plain persona names and keeps AInonymous', () => {
    assert.equal(formatEditorialByline('Henry Ford'), 'Agent Henry Ford');
    assert.equal(formatEditorialByline('Agent ChatGPT'), 'Agent ChatGPT');
    assert.equal(formatEditorialByline('agent  Steve Jobs'), 'Agent Steve Jobs');
    assert.equal(formatEditorialByline('AInonymous'), 'AInonymous');
    assert.equal(formatEditorialByline(''), '');
    assert.equal(formatEditorialByline(undefined), '');
});

test('extractEditorialAuthor reads nested span byline in h2', () => {
    const html = '<h2>When AI Safety Waits for Catastrophe <span><strong><em>Agent ChatGPT</em></strong></span></h2><p>Body</p>';
    assert.equal(extractEditorialAuthor(html), 'Agent ChatGPT');
});

test('extractEditorialAuthor prefers class="byline"', () => {
    const html = '<h2 class="ai-title">Ford Tough AI 🚗 <em class="byline">Agent Henry Ford</em></h2><p>x</p>';
    assert.equal(extractEditorialAuthor(html), 'Agent Henry Ford');
});

test('extractEditorialAuthor uses the trailing generation-time author span first', () => {
    assert.equal(extractEditorialAuthor('<h2>No byline here</h2><p>Body text</p><span>Steve Jobs</span>'), 'Agent Steve Jobs');
    assert.equal(
        extractEditorialAuthor('<h2>The Quiet Transfer<br /><strong><em>AInonymous</em></strong></h2> <p>x</p><span>AInonymous</span>'),
        'AInonymous'
    );
});

test('extractEditorialAuthor reads strong/em byline in h2 when no trailing span (older cache files)', () => {
    assert.equal(
        extractEditorialAuthor('<h2>Why AI Interfaces Keep Converging <strong><em>Agent ChatGPT</em></strong></h2> <p>Body</p>'),
        'Agent ChatGPT'
    );
    assert.equal(
        extractEditorialAuthor('<h2>The Quiet Transfer of the Controls<br /><strong><em>AInonymous</em></strong></h2><p>b</p>'),
        'AInonymous'
    );
});

test('extractEditorialAuthor ignores non-byline styled spans in h2 and returns empty when absent', () => {
    assert.equal(extractEditorialAuthor('<h2>Big <span style="color:red">News</span></h2><p>Body</p>'), '');
    assert.equal(extractEditorialAuthor(''), '');
});

test('editorialHeadlineText strips tags like cheerio text()', () => {
    assert.equal(
        editorialHeadlineText('<h2>A &amp; B <span><strong><em>Agent ChatGPT</em></strong></span></h2><p>x</p>'),
        'A & B Agent ChatGPT'
    );
});

test('buildArchiveListItem exposes author and dates, null when missing', () => {
    const item = buildArchiveListItem('2026-10-18-21', {
        article: {
            image_url: '/cache/images/x.png',
            generated_at: '2026-10-18-20-01-20',
            published_at: '2026-10-18T14:30:27.000Z',
            authorAlias: 'Apt Gnat Tech',
        },
        editorial: '<h2>When AI Safety Waits <span><strong><em>Agent ChatGPT</em></strong></span></h2><p>b</p>',
    });
    assert.deepEqual(item, {
        cache_key: '2026-10-18-21',
        title: 'When AI Safety Waits Agent ChatGPT',
        image_url: '/cache/images/x.png',
        generated_at: '2026-10-18-20-01-20',
        published_at: '2026-10-18T14:30:27.000Z',
        author: 'Agent ChatGPT',
    });

    const bare = buildArchiveListItem('2023-11-20-10', { article: {}, editorial: '<h2>Old</h2><p>b</p>' });
    assert.equal(bare.author, null);
    assert.equal(bare.published_at, null);
});

test('buildArchiveListItem prefers persisted article.author', () => {
    const item = buildArchiveListItem('k', {
        article: { author: 'Henry Ford' },
        editorial: '<h2>T <span>Agent Someone Else</span></h2>',
    });
    assert.equal(item.author, 'Agent Henry Ford');
});

test('archivePageWindow serves the final partial page and reports totals', async () => {
    const { archivePageWindow } = await import('./archiveListing.js');
    assert.deepEqual(archivePageWindow(69, 3, NaN), { valid: true, start: 48, end: 69,
        pagination: { has_next: false, page: 3, size: 24, total: 69, total_pages: 3 } });
    assert.equal(archivePageWindow(69, 1, NaN).pagination.has_next, true);
    assert.equal(archivePageWindow(69, 4, NaN).valid, false);
    // 24 or fewer stories used to return an empty page 1
    assert.deepEqual(archivePageWindow(10, 1, NaN).pagination, { has_next: false, page: 1, size: 24, total: 10, total_pages: 1 });
    assert.equal(archivePageWindow(48, 2, NaN).valid, true);
    assert.equal(archivePageWindow(48, 2, NaN).pagination.has_next, false);
    assert.equal(archivePageWindow(30, 2, 10).end, 20);
    assert.equal(archivePageWindow(0, 1, NaN).valid, false);
    assert.equal(archivePageWindow(5, NaN, NaN).pagination.page, 1);
});

// date-paged archive tests live alongside; imported here so the existing test script runs them
import './archiveDays.test.mjs';
