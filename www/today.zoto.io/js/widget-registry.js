/** Widget catalog: categories, sizing, settings schema, lazy module id. */

export const WIDGET_CATEGORIES = [
  { id: 'core', title: 'Essentials' },
  { id: 'time', title: 'Time' },
  { id: 'sky', title: 'Sky & nature' },
  { id: 'weather', title: 'Weather' },
  { id: 'info', title: 'Info' },
  { id: 'productivity', title: 'Productivity' },
  { id: 'fun', title: 'Fun' },
  { id: 'transport', title: 'Transport' },
  { id: 'cameras', title: 'Local cameras' },
];

function def(partial) {
  return {
    minW: 3,
    minH: 3,
    defaultW: 4,
    defaultH: 4,
    module: 'extra',
    settingsFields: [],
    defaultSettings: {},
    ...partial,
  };
}

export const WIDGET_CATALOG = {
  location: def({
    category: 'core',
    module: 'core',
    title: 'Location',
    description: 'Place name and local context',
    minW: 4,
    minH: 2,
    defaultW: 12,
    defaultH: 2,
  }),
  weather: def({
    category: 'core',
    module: 'core',
    title: 'Weather',
    description: 'Forecast, chart, and 7-day outlook',
    minW: 4,
    minH: 5,
    defaultW: 7,
    defaultH: 9,
  }),
  news: def({
    category: 'core',
    module: 'core',
    title: 'News',
    description: 'Top Hacker News stories with link previews',
    minW: 3,
    minH: 4,
    defaultW: 5,
    defaultH: 8,
    defaultSettings: { maxItems: 10 },
    settingsFields: [{ name: 'maxItems', label: 'Max headlines', type: 'number', default: 10 }],
  }),
  transit: def({
    category: 'core',
    module: 'core',
    title: 'Transit',
    description: 'Nearby stops and lines',
    minW: 4,
    minH: 3,
    defaultW: 6,
    defaultH: 4,
  }),
  map: def({
    category: 'core',
    module: 'core',
    title: 'Map',
    description: 'Street map centered on you',
    minW: 4,
    minH: 4,
    defaultW: 6,
    defaultH: 7,
  }),
  clock: def({
    category: 'time',
    title: 'Clock & sun',
    description: 'Local time with sunrise and sunset',
    defaultW: 4,
    defaultH: 3,
  }),
  'world-clocks': def({
    category: 'time',
    title: 'World clocks',
    description: 'Times in cities you choose',
    defaultSettings: { cities: 'America/Los_Angeles,Europe/London,Asia/Tokyo' },
    settingsFields: [{ name: 'cities', label: 'Timezones (comma-separated)', default: 'America/Los_Angeles,Europe/London,Asia/Tokyo' }],
  }),
  countdown: def({
    category: 'time',
    title: 'Countdown',
    description: 'Count down to a date/time',
    defaultSettings: { target: '2026-12-31T23:59', label: 'New Year' },
    settingsFields: [
      { name: 'target', label: 'Target (ISO local)', default: '2026-12-31T23:59' },
      { name: 'label', label: 'Label', default: 'New Year' },
    ],
  }),
  pomodoro: def({
    category: 'time',
    title: 'Pomodoro',
    description: '25/5 focus timer',
    defaultSettings: { workMin: 25, breakMin: 5 },
    settingsFields: [
      { name: 'workMin', label: 'Work minutes', default: 25 },
      { name: 'breakMin', label: 'Break minutes', default: 5 },
    ],
  }),
  'calendar-month': def({ category: 'time', title: 'Calendar', description: 'Month grid for your timezone', defaultH: 5 }),
  holidays: def({ category: 'time', title: 'Public holidays', description: 'Public holidays in your country (Nager.Date)', defaultH: 5 }),
  'day-progress': def({ category: 'time', title: 'Day progress', description: 'Day, week, and year elapsed', defaultH: 3 }),
  moon: def({ category: 'sky', title: 'Moon phase', description: 'Lunar phase and illumination', defaultW: 3, defaultH: 3 }),
  uv: def({ category: 'sky', title: 'UV index', description: 'Current UV and trend', defaultW: 3, defaultH: 4 }),
  'air-quality': def({ category: 'sky', title: 'Air quality', description: 'AQI and pollutants (Open-Meteo)', defaultW: 4, defaultH: 4 }),
  pollen: def({ category: 'sky', title: 'Pollen', description: 'Pollen estimate when available', defaultW: 3, defaultH: 3 }),
  'sun-hours': def({ category: 'sky', title: 'Sun & twilight', description: 'Sunrise, sunset, golden and blue hour', defaultH: 4 }),
  iss: def({ category: 'sky', title: 'ISS tracker', description: 'Space station position (wheretheiss.at)', defaultH: 5 }),
  planets: def({ category: 'sky', title: 'Planets tonight', description: 'Approximate evening visibility', defaultH: 4 }),
  tides: def({ category: 'sky', title: 'Tides', description: 'Tide table (demo where no live feed)', defaultH: 4 }),
  earthquakes: def({ category: 'sky', title: 'Earthquakes', description: 'Recent quakes near you (USGS)', defaultH: 5 }),
  hazards: def({ category: 'sky', title: 'Hazard alerts', description: 'Advisory placeholder (demo)', defaultH: 3 }),
  radar: def({ category: 'weather', title: 'Rain radar', description: 'RainViewer precipitation overlay', defaultW: 6, defaultH: 6 }),
  'wind-feels': def({ category: 'weather', title: 'Wind & feels', description: 'Feels-like temperature and wind', defaultH: 4 }),
  'what-to-wear': def({ category: 'weather', title: 'What to wear', description: 'Outfit suggestion from forecast', defaultH: 3 }),
  'best-outside': def({ category: 'weather', title: 'Best time outside', description: 'Dryest, mildest hour today', defaultH: 4 }),
  marine: def({ category: 'weather', title: 'Marine / surf', description: 'Wave height and sea temp (Open-Meteo marine)', defaultH: 5 }),
  currency: def({
    category: 'info',
    title: 'Currency',
    description: 'FX rate via frankfurter.app',
    defaultSettings: { from: 'USD', to: 'EUR', amount: 100 },
    settingsFields: [
      { name: 'from', label: 'From', default: 'USD' },
      { name: 'to', label: 'To', default: 'EUR' },
      { name: 'amount', label: 'Amount', default: 100 },
    ],
  }),
  'wiki-nearby': def({ category: 'info', title: 'Wikipedia nearby', description: 'Places around you', defaultH: 5 }),
  'on-this-day': def({ category: 'info', title: 'On this day', description: 'Historical events today', defaultH: 5 }),
  'phrase-day': def({ category: 'info', title: 'Phrase of the day', description: 'Local language snippet', defaultH: 3 }),
  'country-facts': def({ category: 'info', title: 'Country facts', description: 'Country profile (restcountries)', defaultH: 4 }),
  notes: def({
    category: 'productivity',
    title: 'Notes',
    description: 'Sticky note (saved locally)',
    defaultSettings: { text: '' },
    settingsFields: [{ name: 'text', label: 'Note text', default: '' }],
  }),
  todo: def({ category: 'productivity', title: 'Todo list', description: 'Simple checklist (local)', defaultH: 5 }),
  bookmarks: def({ category: 'productivity', title: 'Quick links', description: 'Bookmarks (local)', defaultH: 4 }),
  'search-box': def({ category: 'productivity', title: 'Web search', description: 'Search the web', defaultH: 2 }),
  calculator: def({ category: 'productivity', title: 'Calculator', description: 'Basic calculator', defaultH: 5 }),
  'unit-converter': def({
    category: 'productivity',
    title: 'Unit converter',
    description: 'Length units (local)',
    defaultSettings: { value: 1, from: 'km', to: 'mi' },
    settingsFields: [
      { name: 'value', label: 'Value', default: 1 },
      { name: 'from', label: 'From unit', default: 'km' },
      { name: 'to', label: 'To unit', default: 'mi' },
    ],
  }),
  'commons-photo': def({ category: 'fun', title: 'Area photo', description: 'Wikimedia Commons near you', defaultH: 5 }),
  'daily-quote': def({ category: 'fun', title: 'Daily quote', description: 'Rotating quote (demo pool)', defaultH: 3 }),
  'news-topics': def({
    category: 'fun',
    title: 'Topic news',
    description: 'Hacker News search by topic (24h)',
    defaultSettings: { topic: 'tech' },
    settingsFields: [{ name: 'topic', label: 'Topic (sports|tech|business)', default: 'tech' }],
    defaultH: 6,
  }),
  bikes: def({ category: 'transport', title: 'Bike share', description: 'Nearby GBFS stations (CityBikes)', defaultH: 5 }),
  'walk-rings': def({
    category: 'transport',
    title: 'Walk time rings',
    description: '5/10/15 minute walking radius',
    defaultSettings: { minutes: '5,10,15' },
    settingsFields: [{ name: 'minutes', label: 'Minutes (comma)', default: '5,10,15' }],
    defaultH: 6,
  }),
  'ev-chargers': def({ category: 'transport', title: 'EV & fuel', description: 'Chargers and fuel from OSM', defaultH: 5 }),
  'nearby-webcams': def({
    category: 'cameras',
    module: 'cameras',
    title: 'Nearby webcams',
    description: 'Public webcams near you (Windy + Wikimedia)',
    defaultW: 6,
    defaultH: 6,
    defaultSettings: { favoritesOnly: false },
    settingsFields: [{ name: 'favoritesOnly', label: 'Show favourites only (true/false)', default: false }],
  }),
  'traffic-cams': def({
    category: 'cameras',
    module: 'cameras',
    title: 'Traffic cams',
    description: 'Road authority cameras near you',
    defaultW: 6,
    defaultH: 6,
    defaultSettings: { favoritesOnly: false },
    settingsFields: [{ name: 'favoritesOnly', label: 'Show favourites only (true/false)', default: false }],
  }),
};

export function allWidgetTypes() {
  return Object.keys(WIDGET_CATALOG);
}

export function widgetsByCategory(categoryId) {
  return allWidgetTypes().filter((t) => WIDGET_CATALOG[t].category === categoryId);
}

export function createLayoutEntry(type, x = 0, y = 0) {
  const meta = WIDGET_CATALOG[type];
  if (!meta) throw new Error(`unknown widget ${type}`);
  return {
    id: type,
    type,
    x,
    y,
    w: meta.defaultW,
    h: meta.defaultH,
    settings: { ...meta.defaultSettings },
  };
}

export function getSettingsFields(type) {
  return WIDGET_CATALOG[type]?.settingsFields || [];
}
