/** Haversine distance in kilometres. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function inBoundingBox(lat, lon, { minLat, maxLat, minLon, maxLon }) {
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

export const NSW_BBOX = { minLat: -37.6, maxLat: -28.0, minLon: 140.9, maxLon: 153.7 };
export const QLD_BBOX = { minLat: -29.5, maxLat: -9.9, minLon: 138.0, maxLon: 154.1 };
