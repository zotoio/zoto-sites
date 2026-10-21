import axios from 'axios';
import { cached } from './cache.js';

// REST Countries v1–v4 were shut down (v5 needs an account/key), so country facts come from
// Wikidata's public SPARQL endpoint (keyless, CC0) — looked up by ISO 3166-1 alpha-2 (P297).

export function flagEmoji(cc) {
  if (!/^[a-z]{2}$/i.test(cc || '')) return '';
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function buildCountryQuery(cc) {
  return `SELECT ?cLabel ?capLabel ?pop
  (GROUP_CONCAT(DISTINCT ?langLabel; separator=", ") AS ?langs)
  (GROUP_CONCAT(DISTINCT ?cur; separator=", ") AS ?curs) WHERE {
  ?c wdt:P297 "${cc}" .
  OPTIONAL { ?c wdt:P36 ?cap }
  OPTIONAL { ?c wdt:P1082 ?pop }
  OPTIONAL { ?c wdt:P37 ?lang . ?lang rdfs:label ?langLabel FILTER(lang(?langLabel) = "en") }
  OPTIONAL { ?c wdt:P38 ?cu . ?cu wdt:P498 ?cur }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} GROUP BY ?cLabel ?capLabel ?pop`;
}

export function mapCountryBindings(cc, bindings = []) {
  if (!bindings.length || !bindings[0].cLabel?.value) return null;
  const val = (b, k) => b[k]?.value || '';
  const pops = bindings.map((b) => Number(val(b, 'pop'))).filter(Number.isFinite);
  const uniq = (k) => [...new Set(bindings.flatMap((b) => val(b, k).split(', ')).filter(Boolean))].join(', ');
  return {
    source: 'wikidata',
    name: val(bindings[0], 'cLabel'),
    capital: uniq('capLabel'),
    population: pops.length ? Math.max(...pops) : null,
    languages: uniq('langs'),
    currencies: uniq('curs'),
    flag: flagEmoji(cc),
    attribution: 'Wikidata (CC0)',
  };
}

export async function fetchCountryFacts(code) {
  const cc = (code || 'us').toString().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw new Error('bad country code');
  return cached(
    `country:${cc}`,
    async () => {
      const { data } = await axios.get('https://query.wikidata.org/sparql', {
        params: { query: buildCountryQuery(cc), format: 'json' },
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'today.zoto.io/1.0 (https://today.zoto.io)' },
        timeout: 15000,
      });
      const out = mapCountryBindings(cc, data?.results?.bindings);
      if (!out) throw new Error('not found');
      return out;
    },
    86400000,
    { maxStaleMs: 7 * 86400000 }
  );
}
