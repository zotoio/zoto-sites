/**
 * Mount a Leaflet map that fills a grid widget body and stays sized after layout changes.
 * @param {HTMLElement} body - widget body element (should use .widget-body-map)
 * @param {(mapEl: HTMLElement) => import('leaflet').Map} createMap
 */
export function mountLeafletInWidget(body, createMap) {
  body.classList.add('widget-body-map');

  const mapShell = document.createElement('div');
  mapShell.className = 'leaflet-map-shell';
  const mapEl = document.createElement('div');
  mapEl.className = 'leaflet-map';
  mapShell.appendChild(mapEl);
  body.replaceChildren(mapShell);

  const map = createMap(mapEl);

  const invalidate = () => {
    map.invalidateSize({ animate: false });
  };

  map.whenReady(() => {
    invalidate();
    window.setTimeout(invalidate, 50);
    window.setTimeout(invalidate, 300);
  });

  return {
    map,
    mapEl,
    resize: invalidate,
    destroy: () => {
      map.remove();
      body.classList.remove('widget-body-map');
    },
  };
}
