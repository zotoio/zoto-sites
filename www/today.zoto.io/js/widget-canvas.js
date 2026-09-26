import { WIDGET_CATALOG, WIDGET_CATEGORIES, allWidgetTypes, createLayoutEntry, getSettingsFields } from './widget-registry.js';
import {
  applyGridNodes,
  clearLayout,
  defaultLayout,
  loadLayout,
  saveLayout,
} from './layout-storage.js';
import { mountWidget } from './widget-mount.js';

const MOBILE_MQ = window.matchMedia('(max-width: 768px)');

/**
 * @param {object} ctx
 * @param {(open: boolean) => void} [onLibraryToggle]
 */
export function initWidgetCanvas(ctx, options = {}) {
  let layout = options.initialLayout || loadLayout();
  /** @type {Map<string, { resize: Function, destroy: Function }>} */
  const instances = new Map();

  const gridEl = document.getElementById('widget-grid');
  const libraryEl = document.getElementById('widget-library');
  const libraryList = document.getElementById('widget-library-list');

  const grid = GridStack.init(
    {
      column: 12,
      cellHeight: 72,
      margin: 10,
      float: true,
      animate: true,
      handle: '.widget-drag-handle',
      columnOpts: { breakpoints: [{ w: 768, c: 1, layout: 'list' }] },
    },
    gridEl
  );

  function persist() {
    const nodes = grid.save(false);
    layout.widgets = applyGridNodes(layout.widgets, nodes);
    saveLayout(layout);
  }

  function activeTypes() {
    return new Set(layout.widgets.map((w) => w.type));
  }

  const onLibraryToggle = options.onLibraryToggle;
  const librarySearch = document.getElementById('widget-library-search');

  function refreshLibrary() {
    const active = activeTypes();
    const q = (librarySearch?.value || '').trim().toLowerCase();
    libraryList.innerHTML = '';
    for (const cat of WIDGET_CATEGORIES) {
      const types = allWidgetTypes().filter((type) => {
        if (active.has(type)) return false;
        if (WIDGET_CATALOG[type].category !== cat.id) return false;
        if (!q) return true;
        const meta = WIDGET_CATALOG[type];
        return `${meta.title} ${meta.description}`.toLowerCase().includes(q);
      });
      if (!types.length) continue;
      const section = document.createElement('li');
      section.className = 'library-category';
      section.innerHTML = `<h3 class="library-cat-title">${cat.title}</h3>`;
      const ul = document.createElement('ul');
      ul.className = 'library-category-list';
      for (const type of types) {
        const def = WIDGET_CATALOG[type];
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'library-add';
        btn.textContent = def.title;
        btn.title = def.description;
        btn.addEventListener('click', () => {
          addWidget(type);
          refreshLibrary();
          libraryEl.hidden = true;
          document.getElementById('add-widget-btn').setAttribute('aria-expanded', 'false');
          onLibraryToggle?.(false);
        });
        li.appendChild(btn);
        li.appendChild(document.createTextNode(` — ${def.description}`));
        ul.appendChild(li);
      }
      section.appendChild(ul);
      libraryList.appendChild(section);
    }
  }

  async function mountInstance(type, body, settings) {
    const onSettings = (next) => {
      const entry = layout.widgets.find((w) => w.type === type);
      if (entry) entry.settings = next;
      persist();
      mountInstance(type, body, next);
    };
    instances.get(type)?.destroy?.();
    const api = await mountWidget(type, body, ctx, settings, onSettings);
    instances.set(type, api);
  }

  function buildWidgetElement(entry) {
    const def = WIDGET_CATALOG[entry.type];
    const item = document.createElement('div');
    item.className = 'grid-stack-item';
    item.setAttribute('gs-id', entry.id);
    item.setAttribute('gs-x', String(entry.x));
    item.setAttribute('gs-y', String(entry.y));
    item.setAttribute('gs-w', String(entry.w));
    item.setAttribute('gs-h', String(entry.h));
    item.setAttribute('gs-min-w', String(def.minW));
    item.setAttribute('gs-min-h', String(def.minH));

    const content = document.createElement('div');
    content.className = 'grid-stack-item-content widget';
    const settingsBtn =
      getSettingsFields(entry.type).length > 0
        ? `<button type="button" class="widget-settings" aria-label="Settings for ${def.title}">⚙</button>`
        : '';
    content.innerHTML = `
      <header class="widget-head">
        <button type="button" class="widget-drag-handle" aria-label="Move ${def.title} widget">
          <span class="handle-grip" aria-hidden="true">⋮⋮</span>
          <span class="widget-title">${def.title}</span>
        </button>
        <div class="widget-actions">
          ${settingsBtn}
          <button type="button" class="widget-remove" aria-label="Remove ${def.title} widget">×</button>
        </div>
      </header>
      <div class="widget-body"></div>`;

    content.querySelector('.widget-remove').addEventListener('click', () => {
      removeWidget(entry.type);
      refreshLibrary();
    });

    const handle = content.querySelector('.widget-drag-handle');
    handle.addEventListener('keydown', (ev) => {
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        removeWidget(entry.type);
        refreshLibrary();
      }
    });

    item.appendChild(content);
    return item;
  }

  function addWidget(type, entryOverride) {
    if (activeTypes().has(type)) return;
    const nextY = layout.widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
    const entry = entryOverride || createLayoutEntry(type, 0, nextY);
    layout.widgets.push(entry);
    const def = WIDGET_CATALOG[type];
    const el = buildWidgetElement(entry);
    grid.addWidget({
      el,
      x: entry.x,
      y: entry.y,
      w: entry.w,
      h: entry.h,
      id: entry.id,
      minW: def.minW,
      minH: def.minH,
    });
    void mountInstance(type, el.querySelector('.widget-body'), entry.settings || {});
    persist();
  }

  function removeWidget(type) {
    const el = gridEl.querySelector(`[gs-id="${type}"]`);
    instances.get(type)?.destroy?.();
    instances.delete(type);
    layout.widgets = layout.widgets.filter((w) => w.type !== type);
    if (el) grid.removeWidget(el, true);
    persist();
  }

  async function loadFromLayout() {
    grid.removeAll(true);
    instances.forEach((api) => api.destroy?.());
    instances.clear();
    gridEl.innerHTML = '';
    for (const entry of layout.widgets) {
      if (!WIDGET_CATALOG[entry.type]) continue;
      const def = WIDGET_CATALOG[entry.type];
      const el = buildWidgetElement(entry);
      grid.addWidget({
        el,
        x: entry.x,
        y: entry.y,
        w: entry.w,
        h: entry.h,
        id: entry.id,
        minW: def.minW,
        minH: def.minH,
      });
      await mountInstance(entry.type, el.querySelector('.widget-body'), entry.settings || {});
    }
  }

  function applyResponsive() {
    instances.forEach((api) => api.resize?.());
  }

  grid.on('resize', applyResponsive);

  grid.on('change', () => {
    persist();
    applyResponsive();
  });

  grid.on('resizestop', (_ev, el) => {
    const id = el.getAttribute('gs-id');
    if (id) instances.get(id)?.resize?.();
  });

  void loadFromLayout();
  refreshLibrary();
  applyResponsive();
  MOBILE_MQ.addEventListener('change', applyResponsive);
  librarySearch?.addEventListener('input', refreshLibrary);

  document.getElementById('add-widget-btn').addEventListener('click', () => {
    const btn = document.getElementById('add-widget-btn');
    const open = libraryEl.hidden;
    libraryEl.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    onLibraryToggle?.(!open);
    if (!open) refreshLibrary();
  });

  document.getElementById('reset-layout-btn').addEventListener('click', () => {
    clearLayout();
    layout = defaultLayout();
    void loadFromLayout();
    refreshLibrary();
  });

  return {
    resetLayout: () => {
      clearLayout();
      layout = defaultLayout();
      loadFromLayout();
      refreshLibrary();
    },
  };
}
