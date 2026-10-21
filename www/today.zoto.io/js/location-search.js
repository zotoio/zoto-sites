export const LOCATION_STORAGE_KEY = 'today.zoto.io.location.v1';
export const SEARCH_DEBOUNCE_MS = 250;
export const MIN_QUERY_LENGTH = 2;

function defaultStorage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/** Saved manual location ({ lat, lon, placeName }) or null. */
export function loadSavedLocation(storage = defaultStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem(LOCATION_STORAGE_KEY) || 'null');
    if (parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lon)) {
      return parsed;
    }
  } catch {
    /* ignore corrupt value */
  }
  return null;
}

export function saveLocation(place, storage = defaultStorage()) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return;
  storage?.setItem(
    LOCATION_STORAGE_KEY,
    JSON.stringify({ lat: place.lat, lon: place.lon, placeName: place.placeName || place.name || '' })
  );
}

export function clearSavedLocation(storage = defaultStorage()) {
  storage?.removeItem(LOCATION_STORAGE_KEY);
}

/** Wrap-around index for arrow-key navigation; -1 means nothing highlighted. */
export function nextActiveIndex(current, delta, length) {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
}

export function resultLabel(r) {
  return {
    primary: r.name || r.placeName || '',
    secondary: [r.region, r.country].filter(Boolean).join(', '),
  };
}

/**
 * Type-ahead place search inside the Location widget.
 * fetchJson(path, params) performs the API call (ctx.fetch).
 * onSelect(place) receives a normalized result ({ lat, lon, placeName, ... }).
 */
export function attachLocationSearch(container, { fetchJson, onSelect, onReset, hasSaved = false } = {}) {
  const uid = `loc-search-${Math.random().toString(36).slice(2, 8)}`;
  container.innerHTML = `
    <div class="loc-search" role="search">
      <input type="search" class="loc-search-input" placeholder="Search for a place…" autocomplete="off"
        spellcheck="false" aria-label="Search for a place" role="combobox" aria-autocomplete="list"
        aria-expanded="false" aria-controls="${uid}-list" />
      ${hasSaved ? '<button type="button" class="loc-search-reset" title="Use my current location">Use my location</button>' : ''}
      <ul class="loc-search-results" id="${uid}-list" role="listbox" hidden></ul>
      <p class="loc-search-status meta" aria-live="polite"></p>
    </div>`;

  const input = container.querySelector('.loc-search-input');
  const list = container.querySelector('.loc-search-results');
  const status = container.querySelector('.loc-search-status');
  const resetBtn = container.querySelector('.loc-search-reset');
  // Widget bodies clip overflow and create containing blocks, so the listbox lives on <body>.
  document.body.append(list);

  let results = [];
  let active = -1;
  let timer = null;
  let seq = 0;

  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const highlight = (idx) => {
    active = idx;
    [...list.children].forEach((li, i) => {
      li.classList.toggle('active', i === idx);
      li.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    if (idx >= 0 && list.children[idx]) {
      input.setAttribute('aria-activedescendant', list.children[idx].id);
      const li = list.children[idx];
      if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop;
      else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
      }
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const choose = (idx) => {
    const place = results[idx];
    if (!place) return;
    close();
    input.value = place.placeName;
    setStatus(`Switching to ${place.placeName}…`);
    onSelect?.(place);
  };

  // Results float over the dashboard, pinned below the input.
  const place = () => {
    const r = input.getBoundingClientRect();
    list.style.top = `${r.bottom + 4}px`;
    list.style.left = `${r.left}px`;
    list.style.width = `${Math.max(r.width, 260)}px`;
  };
  const onViewportChange = () => {
    if (!list.hidden) place();
  };
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);

  const render = () => {
    list.replaceChildren();
    results.forEach((r, i) => {
      const li = document.createElement('li');
      li.id = `${uid}-opt-${i}`;
      li.setAttribute('role', 'option');
      li.className = 'loc-search-option';
      const { primary, secondary } = resultLabel(r);
      const strong = document.createElement('span');
      strong.className = 'loc-search-name';
      strong.textContent = primary;
      const sub = document.createElement('span');
      sub.className = 'loc-search-sub';
      sub.textContent = secondary;
      li.append(strong, sub);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(i);
      });
      li.addEventListener('mousemove', () => highlight(i));
      list.append(li);
    });
    const open = results.length > 0;
    if (open) place();
    list.hidden = !open;
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
    highlight(-1);
  };

  const runSearch = async (q) => {
    const mine = ++seq;
    setStatus('Searching…', 'loading');
    try {
      const data = await fetchJson('/api/places/search', { q });
      if (mine !== seq) return;
      results = data.results || [];
      render();
      setStatus(results.length ? '' : `No places found for “${q}”.`, results.length ? '' : 'empty');
    } catch {
      if (mine !== seq) return;
      results = [];
      render();
      setStatus('Place search is unavailable right now. Try again shortly.', 'error');
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      seq += 1;
      results = [];
      render();
      setStatus(q.length ? 'Keep typing…' : '');
      return;
    }
    timer = setTimeout(() => runSearch(q), SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      if (list.hidden) {
        place();
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      }
      highlight(nextActiveIndex(active, e.key === 'ArrowDown' ? 1 : -1, results.length));
    } else if (e.key === 'Enter') {
      if (!list.hidden && results.length) {
        e.preventDefault();
        choose(active >= 0 ? active : 0);
      }
    } else if (e.key === 'Escape') {
      if (!list.hidden) {
        e.preventDefault();
        close();
      } else {
        input.value = '';
        setStatus('');
      }
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('focus', () => {
    if (results.length) {
      place();
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
  });
  // Keep typing from triggering widget drag handlers.
  container.addEventListener('pointerdown', (e) => e.stopPropagation());

  resetBtn?.addEventListener('click', () => {
    setStatus('Switching to your current location…');
    onReset?.();
  });

  return {
    destroy() {
      clearTimeout(timer);
      seq += 1;
      list.remove();
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    },
  };
}
