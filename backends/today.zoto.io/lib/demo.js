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
      sunrise: dailyTime.map((d) => `${d}T06:48:00`),
      sunset: dailyTime.map((d) => `${d}T19:42:00`),
      uv_index_max: [4, 5, 5, 3, 6, 6, 4],
      wind_speed_10m_max: [12, 18, 15, 22, 10, 14, 16],
    },
  };
}

export function demoNews() {
  const items = [
    {
      title: 'Demo: Regional outlook highlights calm conditions',
      url: 'https://example.com/demo/1',
      image_url: '',
      source: 'Demo Wire',
      published_at: new Date().toISOString(),
    },
    {
      title: 'Demo: Transit agency previews weekend service',
      url: 'https://example.com/demo/2',
      image_url: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&q=60',
      source: 'Demo Herald',
      published_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      title: 'Demo: City council approves waterfront upgrades',
      url: 'https://example.com/demo/3',
      image_url: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=400&q=60',
      source: 'Demo Post',
      published_at: new Date(Date.now() - 7200000).toISOString(),
    },
    {
      title: 'Demo: Tech campus expansion moves ahead',
      url: 'https://example.com/demo/4',
      image_url: '',
      source: 'Demo Journal',
      published_at: new Date(Date.now() - 10800000).toISOString(),
    },
    {
      title: 'Demo: Farmers market returns to the plaza',
      url: 'https://example.com/demo/5',
      image_url: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=400&q=60',
      source: 'Demo Times',
      published_at: new Date(Date.now() - 14400000).toISOString(),
    },
    {
      title: 'Demo: Coastal fog gives way to afternoon sun',
      url: 'https://example.com/demo/6',
      image_url: '',
      source: 'Demo Chronicle',
      published_at: new Date(Date.now() - 18000000).toISOString(),
    },
    {
      title: 'Demo: Museum opens night gallery hours',
      url: 'https://example.com/demo/7',
      image_url: 'https://images.unsplash.com/photo-1460661414731-2287630e45e0?w=400&q=60',
      source: 'Demo Arts',
      published_at: new Date(Date.now() - 21600000).toISOString(),
    },
    {
      title: 'Demo: Bike share stations expand downtown',
      url: 'https://example.com/demo/8',
      image_url: '',
      source: 'Demo Metro',
      published_at: new Date(Date.now() - 25200000).toISOString(),
    },
    {
      title: 'Demo: Startup hub reports hiring uptick',
      url: 'https://example.com/demo/9',
      image_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=60',
      source: 'Demo Business',
      published_at: new Date(Date.now() - 28800000).toISOString(),
    },
    {
      title: 'Demo: Evening ferry schedule adds departures',
      url: 'https://example.com/demo/10',
      image_url: '',
      source: 'Demo Bay',
      published_at: new Date(Date.now() - 32400000).toISOString(),
    },
  ];
  return { source: 'demo', locale: 'us', articles: items };
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
