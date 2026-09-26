import {
  attachSettingsPopover,
  renderCameraGrid,
} from '../widget-helpers.js';
import { getSettingsFields } from '../widget-registry.js';

export async function mount(type, body, ctx, settings = {}, onSettings) {
  const { loc, fetch } = ctx;
  const wrap = body.closest('.widget');
  const fields = getSettingsFields(type);
  if (fields.length) {
    attachSettingsPopover(wrap, {
      title: type,
      fields,
      settings,
      onSave: (s) => onSettings?.(s),
    });
  }

  const favoritesKey = type === 'nearby-webcams' ? 'today.fav.webcams' : 'today.fav.traffic-cams';
  const favoritesOnly = String(settings.favoritesOnly || '').toLowerCase() === 'true';

  let refreshTimer;

  const paint = (data) => {
    renderCameraGrid(body, {
      data,
      favoritesKey,
      favoritesOnly,
      kind: type === 'nearby-webcams' ? 'webcam' : 'traffic',
      onFavoriteChange: () => paint(data),
    });
  };

  const load = async () => {
    body.innerHTML = '<p class="muted-note">Loading cameras…</p>';
    if (type === 'nearby-webcams') {
      const data = await fetch('/api/webcams', { lat: loc.lat, lon: loc.lon });
      paint(data);
      return data;
    }
    const data = await fetch('/api/traffic-cams', {
      lat: loc.lat,
      lon: loc.lon,
      country: loc.countryCode,
    });
    paint(data);
    return data;
  };

  await load();
  refreshTimer = setInterval(() => {
    void load();
  }, 90000);

  return {
    resize() {},
    destroy: () => clearInterval(refreshTimer),
  };
}
