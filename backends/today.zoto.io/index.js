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
  demoTransit,
  demoWeather,
  demoWikiNearby,
  isDemoRequest,
} from './lib/demo.js';
import { fetchAirQuality } from './lib/air-quality.js';
import { fetchNearbyBikes } from './lib/bikes.js';
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
import { fetchTopNews } from './lib/news.js';
import { fetchNearbyTransit } from './lib/overpass.js';
import { fetchWeather } from './lib/weather.js';
import { fetchOnThisDay, fetchWikiNearby } from './lib/wiki.js';

dotenv.config();

const { NEWS_API_KEY, PORT = 3001 } = process.env;

if (!NEWS_API_KEY) {
  console.warn('NEWS_API_KEY is not set — /api/news will use demo data only until configured.');
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
  const locale = (req.query.locale || req.query.country || 'us').toString().toLowerCase().slice(0, 2);
  if (!NEWS_API_KEY) {
    return res.json(demoNews(topic));
  }
  try {
    const data = await fetchTopNews(NEWS_API_KEY, locale, { topic });
    return res.json(data);
  } catch {
    return res.json(demoNews(topic));
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

app.listen(Number(PORT), () => {
  console.log(`today.zoto.io API listening on ${PORT}`);
});
