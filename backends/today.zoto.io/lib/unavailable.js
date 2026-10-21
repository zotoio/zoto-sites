/** Explicit "live source failed" payload — never substitute demo numbers for live data. */
export function unavailable(widget, extra = {}) {
  return {
    source: 'unavailable',
    widget,
    message: 'Live data temporarily unavailable',
    checkedAt: new Date().toISOString(),
    ...extra,
  };
}
