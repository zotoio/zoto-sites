import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import {
  demoAirQuality,
  demoLocation,
  demoNews,
  demoTransit,
  demoWeather,
  isDemoRequest,
} from './lib/demo.js';
import { fetchAirQuality } from './lib/air-quality.js';
import {
  enrichPlaceName,
  locationFromCloudflareHeaders,
  locationFromIp,
} from './lib/geocode.js';
import { fetchTopNews } from './lib/news.js';
import { fetchNearbyTransit } from './lib/overpass.js';
import { fetchWeather } from './lib/weather.js';

dotenv.config();

const { NEWS_API_KEY, PORT = 3001 } = process.env;

if (!NEWS_API_KEY) {
  console.warn('NEWS_API_KEY is not set — /api/news will use demo data only until configured.');
}

const app = express();
app.set('trust proxy', true);
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
  if (isDemoRequest(req)) {
    return res.json(demoNews());
  }
  const locale = (req.query.locale || req.query.country || 'us').toString().toLowerCase().slice(0, 2);
  if (!NEWS_API_KEY) {
    return res.json(demoNews());
  }
  try {
    const data = await fetchTopNews(NEWS_API_KEY, locale);
    return res.json(data);
  } catch {
    return res.json(demoNews());
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
    if (!data.stops?.length) {
      return res.json(demoTransit());
    }
    return res.json(data);
  } catch {
    return res.json(demoTransit());
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

app.listen(Number(PORT), () => {
  console.log(`today.zoto.io API listening on ${PORT}`);
});
