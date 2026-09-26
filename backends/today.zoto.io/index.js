import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import {
  demoAirQuality,
  demoBikes,
  demoChargers,
  demoCommons,
  demoCountry,
  demoCurrency,
  demoEarthquakes,
  demoHolidays,
  demoIss,
  demoLocation,
  demoMarine,
  demoNews,
  demoOnThisDay,
  demoTrafficCameras,
  demoTransit,
  demoWeather,
  demoWebcams,
  demoWikiNearby,
  isDemoRequest,
} from './lib/demo.js';
import { fetchAirQuality } from './lib/air-quality.js';
import { fetchNearbyBikes } from './lib/bikes.js';
import { fetchProxiedCameraImage } from './lib/camera-images.js';
import { fetchEvChargers } from './lib/chargers.js';
import { fetchCommonsNearby } from './lib/commons.js';
import { fetchCountryFacts } from './lib/country.js';
import { fetchExchangeRate } from './lib/currency.js';
import { fetchEarthquakesNear } from './lib/earthquakes.js';
import {
  enrichPlaceName,
  locationFromCloudflareHeaders,
  locationFromIp,
} from './lib/geocode.js';
import { fetchHolidays } from './lib/holidays.js';
import { fetchIssNow } from './lib/iss.js';
import { fetchMarine } from './lib/marine.js';
import { fetchHackerNewsTop } from './lib/news.js';
import { fetchNearbyTransit } from './lib/overpass.js';
import { fetchNearbyTrafficCameras } from './lib/traffic-cams.js';
import { fetchWeather } from './lib/weather.js';
import { fetchOnThisDay, fetchWikiNearby } from './lib/wiki.js';
import { fetchNearbyWebcams } from './lib/webcams.js';

dotenv.config();

const { PORT = 3001 } = process.env;
if (!process.env.WINDY_WEBCAMS_KEY) {
  console.warn('WINDY_WEBCAMS_KEY is not set — /api/webcams uses Wikimedia/demo unless configured.');
}
if (!process.env.TRANSPORT_NSW_API_KEY) {
  console.warn('TRANSPORT_NSW_API_KEY is not set — NSW traffic cameras unavailable (demo for traffic widget).');
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/place', async (req, res) => {
  if (isDemoRequest(req)) {
    return res.json(demoLocation());
  }
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon required' });
  }
  try {
    const loc = await enrichPlaceName({
      source: 'coordinates',
      lat,
      lon,
      placeName: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    });
    return res.json(loc);
  } catch {
    return res.json(demoLocation());
  }
});

app.get('/api/location', async (req, res) => {
  if (isDemoRequest(req)) {
    return res.json(demoLocation());
  }
  try {
    let loc = locationFromCloudflareHeaders(req);
    if (!loc) {
      loc = await locationFromIp(req);
    }
    if (!loc) {
      return res.json(demoLocation());
    }
    loc = await enrichPlaceName(loc);
    return res.json(loc);
  } catch {
    return res.json(demoLocation());
  }
});

app.get('/api/weather', async (req, res) => {
  if (isDemoRequest(req)) {
    return res.json(demoWeather());
  }
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon required' });
  }
  try {
    const data = await fetchWeather(lat, lon);
    return res.json(data);
  } catch {
    return res.json(demoWeather());
  }
});

app.get('/api/news', async (req, res) => {
  const topic = (req.query.topic || 'top').toString().toLowerCase();
  if (isDemoRequest(req)) {
    return res.json(demoNews(topic));
  }
  try {
    const data = await fetchHackerNewsTop({ topic });
    if (!data.articles?.length) {
      return res.json({
        source: 'unavailable',
        topic,
        articles: [],
        message: 'Hacker News feed temporarily unavailable',
      });
    }
    return res.json(data);
  } catch {
    return res.json({
      source: 'unavailable',
      topic,
      articles: [],
      message: 'Hacker News feed temporarily unavailable',
    });
  }
});

app.get('/api/transit', async (req, res) => {
  if (isDemoRequest(req)) {
    return res.json(demoTransit());
  }
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon required' });
  }
  try {
    const data = await fetchNearbyTransit(lat, lon);
    return res.json(data);
  } catch {
    return res.json({ source: 'overpass', stops: [] });
  }
});

app.get('/api/air-quality', async (req, res) => {
  if (isDemoRequest(req)) {
    return res.json(demoAirQuality());
  }
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon required' });
  }
  try {
    const data = await fetchAirQuality(lat, lon);
    return res.json({ ...data, pollen: { grass: null, tree: null, weed: null, label: 'Pollen data unavailable for this region' } });
  } catch {
    return res.json(demoAirQuality());
  }
});

function latLonRequired(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'lat and lon required' });
    return null;
  }
  return { lat, lon };
}

app.get('/api/holidays', async (req, res) => {
  if (isDemoRequest(req)) return res.json(demoHolidays(req.query.country));
  const country = (req.query.country || 'US').toString();
  try {
    return res.json(await fetchHolidays(country));
  } catch {
    return res.json(demoHolidays(country));
  }
});

app.get('/api/wiki-nearby', async (req, res) => {
  const pos = latLonRequired(req, res);
  if (!pos) return;
  if (isDemoRequest(req)) return res.json(demoWikiNearby());
  try {
    return res.json(await fetchWikiNearby(pos.lat, pos.lon));
  } catch {
    return res.json(demoWikiNearby());
  }
});

app.get('/api/on-this-day', async (req, res) => {
  if (isDemoRequest(req)) return res.json(demoOnThisDay());
  const month = Number(req.query.month || new Date().getMonth() + 1);
  const day = Number(req.query.day || new Date().getDate());
  try {
    return res.json(await fetchOnThisDay(month, day));
  } catch {
    return res.json(demoOnThisDay());
  }
});

app.get('/api/country', async (req, res) => {
  if (isDemoRequest(req)) return res.json(demoCountry());
  const code = (req.query.code || 'us').toString();
  try {
    return res.json(await fetchCountryFacts(code));
  } catch {
    return res.json(demoCountry());
  }
});

app.get('/api/currency', async (req, res) => {
  if (isDemoRequest(req)) return res.json(demoCurrency());
  try {
    return res.json(await fetchExchangeRate(req.query.from, req.query.to));
  } catch {
    return res.json(demoCurrency());
  }
});

app.get('/api/iss', async (req, res) => {
  if (isDemoRequest(req)) return res.json(demoIss());
  try {
    return res.json(await fetchIssNow());
  } catch {
    return res.json(demoIss());
  }
});

app.get('/api/earthquakes', async (req, res) => {
  const pos = latLonRequired(req, res);
  if (!pos) return;
  if (isDemoRequest(req)) return res.json(demoEarthquakes());
  try {
    return res.json(await fetchEarthquakesNear(pos.lat, pos.lon));
  } catch {
    return res.json(demoEarthquakes());
  }
});

app.get('/api/marine', async (req, res) => {
  const pos = latLonRequired(req, res);
  if (!pos) return;
  if (isDemoRequest(req)) return res.json(demoMarine());
  try {
    return res.json(await fetchMarine(pos.lat, pos.lon));
  } catch {
    return res.json(demoMarine());
  }
});

app.get('/api/commons', async (req, res) => {
  const pos = latLonRequired(req, res);
  if (!pos) return;
  if (isDemoRequest(req)) return res.json(demoCommons());
  try {
    return res.json(await fetchCommonsNearby(pos.lat, pos.lon));
  } catch {
    return res.json(demoCommons());
  }
});

app.get('/api/bikes', async (req, res) => {
  const pos = latLonRequired(req, res);
  if (!pos) return;
  if (isDemoRequest(req)) return res.json(demoBikes());
  try {
    return res.json(await fetchNearbyBikes(pos.lat, pos.lon));
  } catch {
    return res.json(demoBikes());
  }
});

app.get('/api/chargers', async (req, res) => {
  const pos = latLonRequired(req, res);
  if (!pos) return;
  if (isDemoRequest(req)) return res.json(demoChargers());
  try {
    return res.json(await fetchEvChargers(pos.lat, pos.lon));
  } catch {
    return res.json(demoChargers());
  }
});

app.get('/api/webcams', async (req, res) => {
  const pos = latLonRequired(req, res);
  if (!pos) return;
  if (isDemoRequest(req)) return res.json(demoWebcams());
  try {
    const data = await fetchNearbyWebcams(pos.lat, pos.lon);
    if (!data.cameras?.length) {
      return res.json({
        ...demoWebcams(),
        configured: data.configured,
        message: data.message || demoWebcams().message,
      });
    }
    return res.json(data);
  } catch {
    return res.json(demoWebcams());
  }
});

app.get('/api/traffic-cams', async (req, res) => {
  const pos = latLonRequired(req, res);
  if (!pos) return;
  const country = (req.query.country || '').toString();
  if (isDemoRequest(req)) return res.json(demoTrafficCameras());
  try {
    const data = await fetchNearbyTrafficCameras(pos.lat, pos.lon, country);
    if (!data.cameras?.length) {
      return res.json({
        ...demoTrafficCameras(),
        configured: data.configured,
        messages: data.messages?.length ? data.messages : demoTrafficCameras().messages,
      });
    }
    return res.json(data);
  } catch {
    return res.json(demoTrafficCameras());
  }
});

app.get('/api/camera-image', async (req, res) => {
  const key = (req.query.key || '').toString();
  if (!key || key.length > 120) {
    return res.status(400).send('key required');
  }
  try {
    const img = await fetchProxiedCameraImage(key);
    if (!img) return res.status(404).send('not found or expired');
    res.set('Cache-Control', 'public, max-age=60');
    if (img.attribution) res.set('X-Camera-Attribution', img.attribution.slice(0, 200));
    res.type(img.contentType).send(img.buffer);
  } catch {
    return res.status(502).send('upstream error');
  }
});

app.listen(Number(PORT), () => {
  console.log(`today.zoto.io API listening on ${PORT}`);
});
