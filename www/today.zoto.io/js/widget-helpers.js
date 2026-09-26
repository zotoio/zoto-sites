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
