import axios from 'axios';

/** Identify ourselves to public APIs (Wikimedia/Overpass reject anonymous clients with 403/406). */
export const USER_AGENT = 'today.zoto.io/1.0 (https://today.zoto.io; zoto-sites)';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export function installDefaultHeaders(instance = axios) {
  instance.defaults.headers.common['User-Agent'] = USER_AGENT;
}
