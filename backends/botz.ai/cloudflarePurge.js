import axios from 'axios';

export async function clearCloudflareCache(url, { zoneId, apiToken } = {}) {
    if (!zoneId || !apiToken) {
        return { skipped: true, reason: 'CF_ZONE_ID or CF_API_TOKEN not set' };
    }

    const apiUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;

    const response = await axios.post(
        apiUrl,
        { files: [url] },
        {
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiToken}`,
            },
        }
    );

    if (response.data.success) {
        return { skipped: false, success: true };
    }
    throw new Error(`Cloudflare purge failed: ${JSON.stringify(response.data)}`);
}
