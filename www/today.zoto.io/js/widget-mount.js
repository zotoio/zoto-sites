import { WIDGET_CATALOG } from './widget-registry.js';

let coreMod;
let extraMod;

export async function mountWidget(type, body, ctx, settings = {}, onSettings) {
  const mod = WIDGET_CATALOG[type]?.module || 'extra';
  if (mod === 'core') {
    coreMod ??= await import('./widgets/core.js');
    const api = await coreMod.mount(type, body, ctx, settings, onSettings);
    if (api) return api;
  }
  if (mod === 'cameras') {
    const camerasMod = await import('./widgets/cameras.js');
    return camerasMod.mount(type, body, ctx, settings, onSettings);
  }
  extraMod ??= await import('./widgets/extra.js');
  return extraMod.mount(type, body, ctx, settings, onSettings);
}
