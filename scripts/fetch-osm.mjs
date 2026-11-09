// Refresh the OpenStreetMap airfield snapshot in data/osm/bna-airfield.geojson.
//
//   npm run fetch:osm
//
// Pulls taxiways, taxilanes, runways, aprons, terminals, gates and parking
// positions around BNA from the Overpass API and writes them as GeoJSON. Each
// line feature keeps its OSM node ids in `properties.nodes` so the browser can
// rebuild an exact taxi routing graph (ways that share a node are connected).
//
// Data © OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BBOX = [36.088, -86.705, 36.152, -86.645]; // south, west, north, east
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const KINDS = ['taxiway', 'taxilane', 'runway', 'apron', 'terminal', 'gate', 'parking_position', 'holding_position', 'hangar', 'stopway'];
const OUT = fileURLToPath(new URL('../data/osm/bna-airfield.geojson', import.meta.url));

const bbox = BBOX.join(',');
const query = `[out:json][timeout:90];
(
  way["aeroway"~"^(${KINDS.join('|')})$"](${bbox});
  node["aeroway"~"^(${KINDS.join('|')})$"](${bbox});
  way["building"="terminal"](${bbox});
);
out body;
>;
out skel qt;`;

async function fetchWithRetry() {
  let wait = 4000;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 100_000);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'bna-modeling-base/0.2' },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await response.text();
      if (response.ok && text.trimStart().startsWith('{')) {
        console.error(`Fetched from ${endpoint}`);
        return JSON.parse(text);
      }
      console.error(`${endpoint} → HTTP ${response.status}; retrying in ${wait / 1000}s`);
    } catch (error) {
      console.error(`${endpoint} → ${error.name === 'AbortError' ? 'timed out' : error.message}; retrying in ${wait / 1000}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    wait = Math.min(wait * 2, 60_000);
  }
  throw new Error('All Overpass endpoints failed. Try again later.');
}

function toGeoJSON(osm) {
  const nodes = new Map();
  for (const element of osm.elements) {
    if (element.type === 'node') nodes.set(element.id, [element.lon, element.lat]);
  }
  const round = (n) => Math.round(n * 1e7) / 1e7;
  const features = [];
  for (const element of osm.elements) {
    const tags = element.tags ?? {};
    const kind = tags.aeroway ?? (tags.building === 'terminal' ? 'terminal' : undefined);
    if (!kind) continue;
    const properties = { aeroway: kind, osm: `${element.type}/${element.id}` };
    for (const key of ['ref', 'name', 'width', 'surface', 'building:levels', 'height']) {
      if (tags[key] !== undefined) properties[key.replace(':', '_')] = tags[key];
    }

    if (element.type === 'node') {
      features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [round(element.lon), round(element.lat)] } });
      continue;
    }
    if (element.type !== 'way' || !element.nodes) continue;
    // Keep node ids and coordinates index-aligned so the routing graph can join ways by node id.
    const ids = element.nodes.filter((id) => nodes.has(id));
    const coordinates = ids.map((id) => nodes.get(id)).map(([x, y]) => [round(x), round(y)]);
    if (coordinates.length < 2) continue;
    const closed = element.nodes[0] === element.nodes.at(-1);
    const isArea = closed && (['apron', 'terminal', 'hangar'].includes(kind) || tags.area === 'yes');
    if (isArea) {
      features.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [coordinates] } });
    } else {
      properties.nodes = ids;
      features.push({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } });
    }
  }
  return {
    type: 'FeatureCollection',
    attribution: '© OpenStreetMap contributors, ODbL 1.0',
    generated: new Date().toISOString(),
    bbox: [BBOX[1], BBOX[0], BBOX[3], BBOX[2]],
    features,
  };
}

const collection = toGeoJSON(await fetchWithRetry());
await mkdir(new URL('../data/osm/', import.meta.url), { recursive: true });
await writeFile(OUT, `${JSON.stringify(collection)}\n`);
const counts = {};
for (const feature of collection.features) counts[feature.properties.aeroway] = (counts[feature.properties.aeroway] ?? 0) + 1;
console.error(`Wrote ${collection.features.length} features to data/osm/bna-airfield.geojson`, counts);
