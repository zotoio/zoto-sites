/** WMO weather code labels (Open-Meteo). */
export function weatherLabel(code) {
  const map = {
    0: 'Clear',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Fog',
    51: 'Drizzle',
    53: 'Drizzle',
    55: 'Drizzle',
    61: 'Rain',
    63: 'Rain',
    65: 'Heavy rain',
    71: 'Snow',
    73: 'Snow',
    75: 'Heavy snow',
    80: 'Showers',
    81: 'Showers',
    82: 'Heavy showers',
    95: 'Thunderstorm',
  };
  return map[code] || 'Weather';
}

export function weatherIcon(code) {
  if (code === 0 || code === 1) return '☀️';
  if (code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

export function formatTime(iso, tzHint) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tzHint || undefined,
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

export function formatDay(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(iso));
  } catch {
    return iso.slice(5, 10);
  }
}

export function formatSunTime(iso, timeZone) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timeZone || undefined,
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

export function moonPhaseInfo(date = new Date()) {
  const synodic = 29.530588853;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14, 0);
  const days = (date.getTime() - knownNew) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic;
  const fraction = phase / synodic;
  const illumination = Math.round((1 - Math.cos(2 * Math.PI * fraction)) / 2 * 100);
  const names = [
    'New moon',
    'Waxing crescent',
    'First quarter',
    'Waxing gibbous',
    'Full moon',
    'Waning gibbous',
    'Last quarter',
    'Waning crescent',
  ];
  const idx = Math.floor(fraction * 8 + 0.5) % 8;
  const emojis = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  return { fraction, illumination, name: names[idx], emoji: emojis[idx] };
}
