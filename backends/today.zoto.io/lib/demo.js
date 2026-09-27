/** Built-in demo payloads — never ship empty panels. */

export const DEMO_COORDS = { lat: 37.7749, lon: -122.4194 };

export function isDemoRequest(req) {
  if (req.query.demo === '1' || req.query.demo === 'true') {
    return true;
  }
  const h = req.get('x-today-demo');
  return h === '1' || h === 'true';
}

export function demoLocation() {
  return {
    source: 'demo',
    lat: DEMO_COORDS.lat,
    lon: DEMO_COORDS.lon,
    city: 'San Francisco',
    region: 'California',
    country: 'United States',
    countryCode: 'us',
    timezone: 'America/Los_Angeles',
    placeName: 'San Francisco, California, United States',
  };
}

export function demoWeather() {
  const hourlyTime = [];
  const hourlyTemp = [];
  const hourlyPrecip = [];
  const base = Date.now();
  for (let i = 0; i < 24; i += 1) {
    hourlyTime.push(new Date(base + i * 3600000).toISOString());
    hourlyTemp.push(Math.round(14 + 6 * Math.sin((i / 24) * Math.PI * 2)));
    hourlyPrecip.push(i % 5 === 0 ? 35 : 5);
  }
  const dailyTime = [];
  const dailyMax = [];
  const dailyMin = [];
  const dailyCode = [];
  const dailySunrise = [];
  const dailySunset = [];
  for (let d = 0; d < 7; d += 1) {
    dailyTime.push(new Date(base + d * 86400000).toISOString().slice(0, 10));
    dailyMax.push(19 + d % 3);
    dailyMin.push(11 + d % 2);
    dailyCode.push([0, 2, 3, 61, 1, 0, 2][d]);
    const day = dailyTime[d];
    dailySunrise.push(`${day}T06:48:00-07:00`);
    dailySunset.push(`${day}T19:42:00-07:00`);
  }
  return {
    source: 'demo',
    timezone: 'America/Los_Angeles',
    current: {
      time: new Date().toISOString(),
      temperature_2m: 17,
      apparent_temperature: 16,
      weather_code: 2,
      precipitation: 0,
      wind_speed_10m: 14,
      wind_direction_10m: 270,
      uv_index: 4.2,
    },
    hourly: {
      time: hourlyTime,
      temperature_2m: hourlyTemp,
      precipitation_probability: hourlyPrecip,
      apparent_temperature: hourlyTemp.map((t) => t - 1),
    },
    daily: {
      time: dailyTime,
      weather_code: dailyCode,
      temperature_2m_max: dailyMax,
      temperature_2m_min: dailyMin,
      sunrise: dailySunrise,
      sunset: dailySunset,
      uv_index_max: [4, 5, 5, 3, 6, 6, 4],
      wind_speed_10m_max: [12, 18, 15, 22, 10, 14, 16],
    },
  };
}

export function demoNews(topic = 'top') {
  const baseItems = [
    {
      title: 'Demo: Regional outlook highlights calm conditions',
      url: 'https://example.com/demo/1',
      image_url: '',
    },
    {
      title: 'Demo: Transit agency previews weekend service',
      url: 'https://example.com/demo/2',
      image_url: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&q=60',
    },
    {
      title: 'Demo: City council approves waterfront upgrades',
      url: 'https://example.com/demo/3',
      image_url: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=400&q=60',
    },
    {
      title: 'Demo: Tech campus expansion moves ahead',
      url: 'https://example.com/demo/4',
      image_url: '',
    },
    {
      title: 'Demo: Farmers market returns to the plaza',
      url: 'https://example.com/demo/5',
      image_url: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=400&q=60',
    },
    {
      title: 'Demo: Coastal fog gives way to afternoon sun',
      url: 'https://example.com/demo/6',
      image_url: '',
    },
    {
      title: 'Demo: Museum opens night gallery hours',
      url: 'https://example.com/demo/7',
      image_url: 'https://images.unsplash.com/photo-1460661414731-2287630e45e0?w=400&q=60',
    },
    {
      title: 'Demo: Bike share stations expand downtown',
      url: 'https://example.com/demo/8',
      image_url: '',
    },
    {
      title: 'Demo: Startup hub reports hiring uptick',
      url: 'https://example.com/demo/9',
      image_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=60',
    },
    {
      title: 'Demo: Evening ferry schedule adds departures',
      url: 'https://example.com/demo/10',
      image_url: '',
    },
  ];
  const items = baseItems.map((row, i) => ({
    ...row,
    description: 'Demo preview — not a live Hacker News story or article fetch.',
    source: 'Demo (not Hacker News)',
    points: 100 - i * 7,
    num_comments: 40 - i * 3,
    hn_url: `https://news.ycombinator.com/item?id=demo${i + 1}`,
    hn_id: `demo${i + 1}`,
    published_at: new Date(Date.now() - i * 3600000).toISOString(),
  }));
  return {
    source: 'demo',
    topic,
    attribution: 'Demo headlines — not live Hacker News',
    articles: items,
  };
}

export function demoAirQuality() {
  const base = Date.now();
  const hourlyTime = [];
  const uv = [];
  for (let i = 0; i < 24; i += 1) {
    hourlyTime.push(new Date(base + i * 3600000).toISOString());
    uv.push(Number((0.5 + (i / 24) * 5).toFixed(1)));
  }
  return {
    source: 'demo',
    timezone: 'America/Los_Angeles',
    current: {
      us_aqi: 42,
      european_aqi: 35,
      pm2_5: 8.2,
      pm10: 14,
      ozone: 42,
      nitrogen_dioxide: 12,
    },
    hourly: { time: hourlyTime, uv_index: uv },
    pollen: { grass: 2, tree: 1, weed: 0, label: 'Low (demo estimate)' },
  };
}

export function demoHolidays(country = 'US') {
  return {
    source: 'demo',
    country,
    year: new Date().getFullYear(),
    holidays: [
      { date: `${new Date().getFullYear()}-01-01`, localName: 'New Year (demo)', name: 'New Year' },
      { date: `${new Date().getFullYear()}-07-04`, localName: 'Independence Day (demo)', name: 'Independence Day' },
      { date: `${new Date().getFullYear()}-12-25`, localName: 'Christmas (demo)', name: 'Christmas' },
    ],
  };
}

export function demoWikiNearby() {
  return {
    source: 'demo',
    places: [
      { title: 'Demo: Golden Gate Bridge', distanceM: 4200 },
      { title: 'Demo: Ferry Building', distanceM: 1800 },
    ],
  };
}

export function demoOnThisDay() {
  return {
    source: 'demo',
    events: [{ year: 1906, text: 'Demo: Great earthquake remembered in regional history' }],
  };
}

export function demoCountry() {
  return {
    source: 'demo',
    name: 'United States (demo)',
    capital: 'Washington, D.C.',
    population: 331000000,
    region: 'Americas',
    languages: 'English',
    currencies: 'USD',
    flag: '🇺🇸',
  };
}

export function demoCurrency() {
  return { source: 'demo', base: 'USD', target: 'EUR', rate: 0.91, date: new Date().toISOString().slice(0, 10) };
}

export function demoIss() {
  return {
    source: 'demo',
    lat: 37.5,
    lon: -122.2,
    altitude: 420,
    velocity: 27600,
    visibility: 'daylight',
  };
}

export function demoIssTrack() {
  const positions = Array.from({ length: 40 }, (_, i) => ({
    lat: 20 + Math.sin(i / 5) * 35,
    lon: -160 + i * 8,
    timestamp: Date.now() - (40 - i) * 60000,
  }));
  return { source: 'demo', positions };
}

export function demoEarthquakes() {
  return {
    source: 'demo',
    earthquakes: [
      { mag: 2.8, place: 'Demo Bay Area', distKm: 42, time: Date.now(), lat: 37.7, lon: -122.4 },
      { mag: 3.1, place: 'Demo Coast', distKm: 88, time: Date.now(), lat: 37.2, lon: -121.9 },
    ],
  };
}

export function demoMarine() {
  return {
    source: 'demo',
    hourly: { wave_height: [1.2], sea_surface_temperature: [14.5] },
  };
}

export function demoCommons() {
  return {
    source: 'demo',
    photos: [
      {
        title: 'Demo: San Francisco skyline',
        thumb: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=400&q=60',
        url: 'https://example.com/demo-photo',
        artist: 'Demo',
      },
    ],
  };
}

export function demoBikes() {
  return {
    source: 'demo',
    stations: [
      { name: 'Demo Station A', freeBikes: 4, network: 'Demo Bikes' },
      { name: 'Demo Station B', freeBikes: 9, network: 'Demo Bikes' },
      { name: 'Demo Station C', freeBikes: 2, network: 'Demo Bikes' },
    ],
  };
}

export function demoChargers() {
  return {
    source: 'demo',
    stations: [
      { name: 'Demo EV Hub', amenity: 'charging_station', lat: 37.78, lon: -122.42 },
      { name: 'Demo Fuel Stop', amenity: 'fuel', lat: 37.76, lon: -122.39 },
    ],
  };
}

export function demoWebcams() {
  return {
    source: 'demo',
    configured: { windy: false },
    message: 'Demo webcams — not live feeds. Set WINDY_WEBCAMS_KEY for Windy Webcams.',
    cameras: [
      {
        id: 'demo-wc-1',
        name: 'Demo harbour view',
        distKm: 2,
        imageKey: 'demo-wc-1',
        updatedAt: new Date().toISOString(),
        attribution: 'Demo placeholder',
        provider: 'demo',
        live: false,
      },
      {
        id: 'demo-wc-2',
        name: 'Demo city skyline',
        distKm: 5,
        imageKey: 'demo-wc-2',
        updatedAt: new Date().toISOString(),
        attribution: 'Demo placeholder',
        provider: 'demo',
        live: false,
      },
    ],
  };
}

export function demoTrafficCameras() {
  return {
    source: 'demo',
    configured: { nsw: false, qldtrafficApi: false },
    messages: ['Demo traffic cameras — not live. Set TRANSPORT_NSW_API_KEY for Sydney/NSW feeds.'],
    providers: [],
    cameras: [
      {
        id: 'demo-tc-1',
        provider: 'demo',
        name: 'Demo motorway camera',
        view: 'Sample northbound view',
        distKm: 3,
        imageKey: 'demo-traffic-1',
        updatedAt: new Date().toISOString(),
        attribution: 'Demo placeholder',
      },
      {
        id: 'demo-tc-2',
        provider: 'demo',
        name: 'Demo bridge camera',
        view: 'Sample eastbound view',
        distKm: 8,
        imageKey: 'demo-traffic-2',
        updatedAt: new Date().toISOString(),
        attribution: 'Demo placeholder',
      },
    ],
  };
}

export function demoTransit() {
  return {
    source: 'demo',
    stops: [
      {
        id: 'demo-1',
        name: 'Market & 4th Metro',
        lat: 37.7849,
        lon: -122.4094,
        distanceM: 120,
        modes: ['metro', 'bus'],
        lines: ['J', 'K', 'L', 'M', 'N'],
      },
      {
        id: 'demo-2',
        name: 'Embarcadero Station',
        lat: 37.7936,
        lon: -122.3965,
        distanceM: 340,
        modes: ['train', 'ferry'],
        lines: ['BART', 'Muni', 'Ferry'],
      },
      {
        id: 'demo-3',
        name: 'Mission St & 16th',
        lat: 37.765,
        lon: -122.419,
        distanceM: 520,
        modes: ['bus'],
        lines: ['14R', '49'],
      },
      {
        id: 'demo-4',
        name: 'Caltrain 4th & King',
        lat: 37.7763,
        lon: -122.3943,
        distanceM: 680,
        modes: ['train'],
        lines: ['Caltrain'],
      },
    ],
  };
}
