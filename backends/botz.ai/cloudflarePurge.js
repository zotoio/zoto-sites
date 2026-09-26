/**
 * Cloudflare cache purge by URL (native fetch — no curl logging).
 */

function formatCloudflareErrorMessage(data) {
  if (data?.errors?.length) {
    const messages = data.errors.map((e) => e?.message).filter(Boolean);
    if (messages.length) {
      return messages.join('; ');
    }
  }
  if (typeof data?.message === 'string' && data.message) {
    return data.message;
  }
  return 'unknown error';
}

/**
 * @param {object} opts
 * @param {string} [opts.zoneId]
 * @param {string} [opts.apiToken]
 * @param {string} opts.url - Purge target (editorial URL)
 * @param {(msg: string) => void} [opts.log]
 * @param {(msg: string) => void} [opts.errorLog]
 */
export async function purgeCloudflareCacheByUrl({
  zoneId,
  apiToken,
  url,
  log = console.log,
  errorLog = console.error,
}) {
  if (!zoneId || !apiToken) {
    return { skipped: true };
  }

  const apiUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ files: [url] }),
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (response.ok && data.success) {
      log(`Cloudflare cache purge: success target=${url}`);
      return { ok: true };
    }

    const message = formatCloudflareErrorMessage(data);
    errorLog(`Cloudflare cache purge: failed target=${url} message=${message}`);
    return { ok: false, message };
  } catch (error) {
    const message = error?.message || String(error);
    errorLog(`Cloudflare cache purge: error target=${url} message=${message}`);
    return { ok: false, message };
  }
}
