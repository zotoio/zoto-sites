/**
 * @typedef {'location'|'weather'|'news'|'transit'|'clock'|'air-quality'|'uv'|'moon'|'map'|'radar'} WidgetType
 */

/** @type {Record<WidgetType, { title: string, description: string, minW: number, minH: number, defaultW: number, defaultH: number }>} */
export const WIDGET_CATALOG = {
  location: {
    title: 'Location',
    description: 'Place name and local context',
    minW: 4,
    minH: 2,
    defaultW: 12,
    defaultH: 2,
  },
  weather: {
    title: 'Weather',
    description: 'Current conditions, 24h chart, 7-day outlook',
    minW: 4,
    minH: 5,
    defaultW: 7,
    defaultH: 9,
  },
  news: {
    title: 'News',
    description: 'Top headlines for your country',
    minW: 3,
    minH: 4,
    defaultW: 5,
    defaultH: 8,
  },
  transit: {
    title: 'Transit',
    description: 'Nearby stops and lines',
    minW: 4,
    minH: 4,
    defaultW: 6,
    defaultH: 6,
  },
  clock: {
    title: 'Clock & sun',
    description: 'Local time with sunrise and sunset',
    minW: 3,
    minH: 3,
    defaultW: 4,
    defaultH: 3,
  },
  'air-quality': {
    title: 'Air quality',
    description: 'AQI, PM2.5, and pollutants (Open-Meteo)',
    minW: 3,
    minH: 3,
    defaultW: 4,
    defaultH: 4,
  },
  uv: {
    title: 'UV index',
    description: 'Current UV and hourly trend',
    minW: 3,
    minH: 3,
    defaultW: 3,
    defaultH: 4,
  },
  moon: {
    title: 'Moon phase',
    description: 'Current lunar phase and illumination',
    minW: 3,
    minH: 3,
    defaultW: 3,
    defaultH: 3,
  },
  map: {
    title: 'Map',
    description: 'Interactive street map centered on you',
    minW: 4,
    minH: 4,
    defaultW: 6,
    defaultH: 7,
  },
  radar: {
    title: 'Rain radar',
    description: 'Precipitation radar overlay (RainViewer)',
    minW: 4,
    minH: 4,
    defaultW: 6,
    defaultH: 6,
  },
};

/** @returns {WidgetType[]} */
export function allWidgetTypes() {
  return /** @type {WidgetType[]} */ (Object.keys(WIDGET_CATALOG));
}

/**
 * @param {WidgetType} type
 * @param {number} x
 * @param {number} y
 */
export function createLayoutEntry(type, x = 0, y = 0) {
  const def = WIDGET_CATALOG[type];
  return {
    id: type,
    type,
    x,
    y,
    w: def.defaultW,
    h: def.defaultH,
    settings: type === 'news' ? { maxItems: 10 } : {},
  };
}
