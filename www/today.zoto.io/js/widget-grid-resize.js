/**
 * @param {HTMLElement} body widget body inside a grid-stack item
 * @param {number} h grid rows
 */
export function setWidgetGridHeight(body, h) {
  const item = body.closest('.grid-stack-item');
  const gridEl = document.getElementById('widget-grid');
  const grid = gridEl?.gridstack;
  if (!item || !grid || !Number.isFinite(h)) return;
  grid.update(item, { h });
  item.setAttribute('gs-h', String(h));
}
