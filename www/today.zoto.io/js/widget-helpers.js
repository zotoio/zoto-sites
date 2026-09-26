/** Shared demo banner + settings popover helpers for widgets. */

export function demoBadge(source) {
  if (source && source !== 'demo') return '';
  return '<p class="demo-badge" role="note">Demo sample — not live data</p>';
}

export function attachSettingsPopover(container, { title, fields, settings, onSave }) {
  const btn = container.querySelector('.widget-settings');
  if (!btn) return;
  container._settingsState = { title, fields, settings, onSave };
  let pop = container.querySelector('.widget-settings-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'widget-settings-pop';
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    container.querySelector('.widget-head')?.appendChild(pop);
  }

  const render = () => {
    const { title: t, fields: flds, settings: st, onSave: save } = container._settingsState;
    pop.setAttribute('aria-label', `${t} settings`);
    pop.innerHTML = `
      <form class="settings-form">
        ${flds
          .map(
            (f) => `<label>${f.label}
          <input name="${f.name}" type="${f.type || 'text'}" value="${String(st[f.name] ?? f.default ?? '').replace(/"/g, '&quot;')}" /></label>`
          )
          .join('')}
        <div class="settings-actions">
          <button type="submit">Save</button>
          <button type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    pop.querySelector('[data-cancel]').addEventListener('click', () => {
      pop.hidden = true;
    });
    pop.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const next = { ...st };
      for (const f of flds) {
        next[f.name] = fd.get(f.name);
      }
      container._settingsState.settings = next;
      save(next);
      pop.hidden = true;
    });
  };

  if (btn.dataset.settingsBound === '1') return;
  btn.dataset.settingsBound = '1';
  btn.addEventListener('click', () => {
    container._settingsState.settings = { ...settings, ...container._settingsState.settings };
    render();
    pop.hidden = !pop.hidden;
  });
}

export const PRODUCTIVITY_STORE = {
  load(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
    } catch {
      return fallback;
    }
  },
  save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

export function cameraFavKey(cam) {
  return `${cam.provider || 'x'}:${cam.id}`;
}

export function toggleCameraFavorite(storeKey, cam) {
  const id = cameraFavKey(cam);
  const list = PRODUCTIVITY_STORE.load(storeKey, []);
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  PRODUCTIVITY_STORE.save(storeKey, next);
  return next;
}

export function isCameraFavorite(storeKey, cam) {
  return PRODUCTIVITY_STORE.load(storeKey, []).includes(cameraFavKey(cam));
}

function formatUpdated(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

export function openCameraLightbox(container, { title, subtitle, imageSrc, attribution }) {
  let lb = container.querySelector('.cam-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.className = 'cam-lightbox';
    lb.hidden = true;
    lb.innerHTML = `
      <div class="cam-lightbox-backdrop" data-close></div>
      <figure class="cam-lightbox-panel" role="dialog" aria-modal="true">
        <button type="button" class="cam-lightbox-close" aria-label="Close">×</button>
        <img class="cam-lightbox-img" alt="" />
        <figcaption><strong class="cam-lightbox-title"></strong><span class="cam-lightbox-sub"></span>
        <span class="cam-lightbox-attr"></span></figcaption>
      </figure>`;
    container.appendChild(lb);
    lb.querySelector('[data-close]').addEventListener('click', () => {
      lb.hidden = true;
    });
    lb.querySelector('.cam-lightbox-close').addEventListener('click', () => {
      lb.hidden = true;
    });
  }
  lb.querySelector('.cam-lightbox-img').src = imageSrc;
  lb.querySelector('.cam-lightbox-title').textContent = title;
  lb.querySelector('.cam-lightbox-sub').textContent = subtitle ? ` · ${subtitle}` : '';
  lb.querySelector('.cam-lightbox-attr').textContent = attribution ? ` · ${attribution}` : '';
  lb.hidden = false;
}

/**
 * @param {HTMLElement} body
 * @param {object} opts
 */
export function renderCameraGrid(body, opts) {
  const {
    data,
    favoritesKey,
    favoritesOnly,
    onFavoriteChange,
  } = opts;
  const cameras = (data.cameras || []).filter((c) => {
    if (!favoritesOnly) return true;
    return isCameraFavorite(favoritesKey, c);
  });

  const statusParts = [];
  if (data.message) statusParts.push(data.message);
  if (data.messages?.length) statusParts.push(...data.messages);
  if (data.configured?.windy === false && opts.kind === 'webcam') {
    statusParts.push('Windy Webcams: not configured (WINDY_WEBCAMS_KEY).');
  }
  if (data.configured?.nsw === false && opts.kind === 'traffic') {
    statusParts.push('NSW Live Traffic: not configured (TRANSPORT_NSW_API_KEY).');
  }

  body.innerHTML =
    demoBadge(data.source) +
    (statusParts.length
      ? `<p class="cam-status muted-note">${statusParts.map((s) => s.replace(/</g, '&lt;')).join(' ')}</p>`
      : '') +
    `<div class="cam-grid"></div>`;

  const grid = body.querySelector('.cam-grid');
  if (!cameras.length) {
    grid.innerHTML = '<p class="muted-note">No cameras to show.</p>';
    return;
  }

  for (const cam of cameras) {
    const card = document.createElement('article');
    card.className = 'cam-card';
    const imgSrc = cam.imageKey ? `/api/camera-image?key=${encodeURIComponent(cam.imageKey)}` : '';
    const fav = isCameraFavorite(favoritesKey, cam);
    card.innerHTML = `
      <button type="button" class="cam-fav ${fav ? 'is-fav' : ''}" aria-label="Favourite">★</button>
      <button type="button" class="cam-thumb-btn">
        <img class="cam-thumb" alt="" loading="lazy" src="${imgSrc}" />
      </button>
      <p class="cam-name">${(cam.name || 'Camera').replace(/</g, '&lt;')}</p>
      <p class="cam-meta">${cam.distKm != null ? `${cam.distKm} km` : ''} · updated ${formatUpdated(cam.updatedAt)}</p>`;
    card.querySelector('.cam-fav').addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleCameraFavorite(favoritesKey, cam);
      onFavoriteChange?.();
    });
    card.querySelector('.cam-thumb-btn').addEventListener('click', () => {
      openCameraLightbox(body.closest('.widget') || body, {
        title: cam.name || 'Camera',
        subtitle: cam.view || (cam.distKm != null ? `${cam.distKm} km away` : ''),
        imageSrc: imgSrc,
        attribution: cam.attribution || data.attribution || '',
      });
    });
    grid.appendChild(card);
  }
}
