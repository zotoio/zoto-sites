import axios from 'axios';
import { cached } from './cache.js';

const NOMINATIM_UA = 'today.zoto.io/1.0 (zoto-sites; contact io@zoto.io)';

export function locationFromCloudflareHeaders(req) {
  const lat = parseFloat(req.get('cf-iplatitude') || '');
  const lon = parseFloat(req.get('cf-iplongitude') || '');
  const city = req.get('cf-ipcity') || '';
  const countryCode = (req.get('cf-ipcountry') || '').toLowerCase();
  const timezone = req.get('cf-timezone') || '';

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    source: 'cloudflare',
    lat,
    lon,
    city,
    region: '',
    country: countryCode.toUpperCase(),
    countryCode: countryCode || 'us',
    timezone,
    placeName: city ? `${city}` : `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
  };
}

export async function locationFromIp(req) {
  const forwarded = req.get('x-forwarded-for') || req.get('x-real-ip') || req.ip || '';
  const ip = String(forwarded).split(',')[0].trim();
  if (!ip || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }

  const cacheKey = `ip:${ip}`;
  return cached(
    cacheKey,
    async () => {
      const { data } = await axios.get(`https://ipwho.is/${encodeURIComponent(ip)}`, {
        timeout: 8000,
        validateStatus: (s) => s < 500,
      });
      if (!data?.success) {
        return null;
      }
      return {
        source: 'ipwho',
        lat: data.latitude,
        lon: data.longitude,
        city: data.city || '',
        region: data.region || '',
        country: data.country || '',
        countryCode: (data.country_code || 'us').toLowerCase(),
        timezone: data.timezone?.id || '',
        placeName: [data.city, data.region, data.country].filter(Boolean).join(', '),
      };
    },
    3600000
  );
}

export async function reverseGeocode(lat, lon) {
  const key = `rev:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  return cached(
    key,
    async () => {
      try {
        const { data } = await axios.get('https://geocoding-api.open-meteo.com/v1/reverse', {
          params: { latitude: lat, longitude: lon, language: 'en', count: 1 },
          timeout: 8000,
        });
        const r = data?.results?.[0];
        if (r) {
          const placeName = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
          return {
            placeName: placeName || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
            city: r.name || '',
            region: r.admin1 || '',
            country: r.country || '',
            countryCode: (r.country_code || '').toLowerCase(),
          };
        }
      } catch {
        /* fall through */
      }

      try {
        const { data } = await axios.get('https://nominatim.openstreetmap.org/reverse', {
          params: { lat, lon, format: 'json', zoom: 10, addressdetails: 1 },
          headers: { 'User-Agent': NOMINATIM_UA },
          timeout: 8000,
        });
        const addr = data?.address || {};
        const city = addr.city || addr.town || addr.village || addr.suburb || '';
        const region = addr.state || addr.region || '';
        const country = addr.country || '';
        const placeName = data?.display_name || [city, region, country].filter(Boolean).join(', ');
        const cc = (addr.country_code || '').toLowerCase();
        return { placeName, city, region, country, countryCode: cc };
      } catch {
        return {
          placeName: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          city: '',
          region: '',
          country: '',
          countryCode: '',
        };
      }
    },
    86400000
  );
}

export async function enrichPlaceName(location) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
    return location;
  }
  const geo = await reverseGeocode(location.lat, location.lon);
  return {
    ...location,
    ...geo,
    placeName: geo.placeName || location.placeName,
  };
}
