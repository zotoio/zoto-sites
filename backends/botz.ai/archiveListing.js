/**
 * Build the public /archive list item for one cached editorial.
 * Kept free of cheerio so `node --test` runs without installed dependencies.
 */

/** Display byline for an editorial author name ("ChatGPT" -> "Agent ChatGPT", "AInonymous" unchanged). */
export function formatEditorialByline(name) {
    const raw = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    if (/^agent\s+/i.test(raw)) return raw.replace(/^agent\s+/i, 'Agent ');
    if (raw === 'AInonymous') return raw;
    return `Agent ${raw}`;
}

function decodeBasicEntities(text) {
    return String(text ?? '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}

function textOf(html) {
    return decodeBasicEntities(String(html ?? '').replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

const MAX_BYLINE_CHARS = 80;

function plausibleByline(text) {
    return !!text && text.length <= MAX_BYLINE_CHARS;
}

/** Plain-text headline from the editorial's first <h2> (same as cheerio `$('h2').text()` for the archive). */
export function editorialHeadlineText(editorialHtml) {
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(String(editorialHtml ?? ''));
    return h2 ? textOf(h2[1]) : '';
}

/**
 * Editorial author byline from cached HTML, most reliable first:
 * 1. trailing <span>author name</span> that index.js appends after the body at generation time
 * 2. element with class "byline" inside the <h2>
 * 3. last <span>/<strong>/<em> inside the <h2> whose text is an "Agent …" / "AInonymous" byline
 *    (the model writes e.g. "Title <span><strong><em>Agent X</em></strong></span>")
 */
export function extractEditorialAuthor(editorialHtml) {
    const html = String(editorialHtml ?? '').trim();
    if (!html) return '';

    const trailing = /<span\b[^>]*>([^<]{1,200})<\/span>\s*$/i.exec(html);
    const trailingText = trailing ? textOf(trailing[1]) : '';
    if (plausibleByline(trailingText)) return formatEditorialByline(trailingText);

    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] || '';
    if (!h2) return '';
    const byClass = /<(\w+)[^>]*class=["'][^"']*\bbyline\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i.exec(h2);
    const classText = byClass ? textOf(byClass[2]) : '';
    if (plausibleByline(classText)) return formatEditorialByline(classText);

    const candidates = [...h2.matchAll(/<(span|strong|em)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
        .map((m) => textOf(m[2]))
        .filter((t) => plausibleByline(t) && /^(agent\s+\S|AInonymous$)/i.test(t));
    return candidates.length ? formatEditorialByline(candidates[candidates.length - 1]) : '';
}

/**
 * @param {string} cacheKey
 * @param {{ article?: object, editorial?: string }} entry first row of a cache file
 */
export function buildArchiveListItem(cacheKey, entry) {
    const article = entry?.article || {};
    const editorial = entry?.editorial || '';
    const author = formatEditorialByline(article.author) || extractEditorialAuthor(editorial);
    return {
        cache_key: cacheKey,
        title: editorialHeadlineText(editorial),
        image_url: article.image_url,
        generated_at: article.generated_at,
        published_at: article.published_at || null,
        author: author || null,
    };
}
