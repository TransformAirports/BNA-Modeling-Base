// Mapbox map: basemap style, airfield overlay layers, light presets and cameras.

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { CAMERA_PRESETS, MAP } from '../config.js';
import { headingVector, clamp } from '../sim/geo.js';

const CONCOURSE_COLORS = { B: '#7aa7ff', C: '#4fd6c4', D: '#ffb35c', 'T Gates': '#c69bff' };
const METERS_PER_PIXEL_Z0 = (lat) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 512;

/** Circle radius in pixels that keeps a constant size in metres across zooms. */
const metresRadius = (metres, lat) => [
  'interpolate', ['exponential', 2], ['zoom'],
  10, metres / (METERS_PER_PIXEL_Z0(lat) / 2 ** 10),
  22, metres / (METERS_PER_PIXEL_Z0(lat) / 2 ** 22),
];

/** Line width in pixels for a constant width in metres. */
const metresWidth = (metres, lat) => metresRadius(metres, lat);

/** Airfield pavement for the vector style (the satellite style already shows it). */
function pavementData(world) {
  const { airfield, frame } = world;
  const ring = (points) => [...points, points[0]].map(frame.toLngLat);
  const runways = airfield.runwayPairs.map(({ A, B, dir }) => {
    const right = [dir[1] * 23, -dir[0] * 23];
    const a = [A[0] - dir[0] * 60, A[1] - dir[1] * 60];
    const b = [B[0] + dir[0] * 60, B[1] + dir[1] * 60];
    return {
      type: 'Feature', properties: { kind: 'runway' },
      geometry: { type: 'Polygon', coordinates: [ring([[a[0] + right[0], a[1] + right[1]], [b[0] + right[0], b[1] + right[1]], [b[0] - right[0], b[1] - right[1]], [a[0] - right[0], a[1] - right[1]]])] },
    };
  });
  const centrelines = airfield.runwayPairs.map(({ A, B, dir }) => ({
    type: 'Feature', properties: { kind: 'centreline' },
    geometry: { type: 'LineString', coordinates: [[A[0] + dir[0] * 300, A[1] + dir[1] * 300], [B[0] - dir[0] * 300, B[1] - dir[1] * 300]].map(frame.toLngLat) },
  }));
  const taxiways = airfield.taxiways.map((line) => ({ type: 'Feature', properties: { kind: 'taxiway' }, geometry: { type: 'LineString', coordinates: line.map(frame.toLngLat) } }));
  const aprons = airfield.aprons.map((points) => ({ type: 'Feature', properties: { kind: 'apron' }, geometry: { type: 'Polygon', coordinates: [points.map(frame.toLngLat)] } }));
  const leadIns = [...airfield.stands.values()].map((stand) => ({
    type: 'Feature', properties: { kind: 'leadin' }, geometry: { type: 'LineString', coordinates: stand.leadIn.map(frame.toLngLat) },
  }));
  return { type: 'FeatureCollection', features: [...aprons, ...runways, ...taxiways, ...centrelines, ...runwayMarkings(airfield, ring), ...leadIns] };
}

/**
 * Painted runway markings (white polygons): edge stripes, threshold "piano
 * keys", touchdown-zone bars and aiming points at both ends of every runway.
 */
function runwayMarkings(airfield, ring) {
  const features = [];
  const box = (origin, dir, s0, s1, l0, l1) => {
    const right = [dir[1], -dir[0]];
    const at = (s, l) => [origin[0] + dir[0] * s + right[0] * l, origin[1] + dir[1] * s + right[1] * l];
    features.push({ type: 'Feature', properties: { kind: 'marking' }, geometry: { type: 'Polygon', coordinates: [ring([at(s0, l0), at(s1, l0), at(s1, l1), at(s0, l1)])] } });
  };
  const bothSides = (origin, dir, s0, s1, l0, l1) => {
    box(origin, dir, s0, s1, l0, l1);
    box(origin, dir, s0, s1, -l1, -l0);
  };
  for (const { A, B, dir, length } of airfield.runwayPairs) {
    bothSides(A, dir, 0, length, 21.6, 22.5); // edge stripes
    for (const [threshold, d] of [[A, dir], [B, [-dir[0], -dir[1]]]]) {
      for (let i = 0; i < 6; i += 1) bothSides(threshold, d, 6, 51, 3 + i * 3.4, 4.8 + i * 3.4); // piano keys
      if (length < 1500) continue;
      bothSides(threshold, d, 305, 365, 9, 19); // aiming point
      for (const [s, bars] of [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]]) {
        for (let k = 0; k < bars; k += 1) bothSides(threshold, d, s, s + 22.5, 9 + k * 3.3, 10.8 + k * 3.3); // touchdown zone
      }
    }
  }
  return features;
}

function overlayData(world) {
  const { airfield, frame } = world;
  const toLngLat = frame.toLngLat;
  const gates = [];
  const pools = [];
  const concourses = new Map();
  for (const stand of airfield.stands.values()) {
    const position = toLngLat(stand.stop);
    gates.push({
      type: 'Feature', id: gates.length + 1,
      properties: { code: stand.code, concourse: stand.concourse, color: CONCOURSE_COLORS[stand.concourse] ?? '#ffffff' },
      geometry: { type: 'Point', coordinates: position },
    });
    pools.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: toLngLat(stand.leadStart) } });
    if (!concourses.has(stand.concourse)) concourses.set(stand.concourse, []);
    concourses.get(stand.concourse).push(stand.stop);
  }
  const concourseLabels = [...concourses].map(([name, points]) => {
    const x = points.reduce((s, p) => s + p[0], 0) / points.length;
    const y = points.reduce((s, p) => s + p[1], 0) / points.length;
    return {
      type: 'Feature',
      properties: { label: name.length === 1 ? `CONCOURSE ${name}` : name.toUpperCase(), color: CONCOURSE_COLORS[name] ?? '#fff' },
      geometry: { type: 'Point', coordinates: toLngLat([x, y]) },
    };
  });
  const runwayLabels = [...airfield.runwayEnds.values()].map((end) => ({
    type: 'Feature',
    properties: { label: end.id, rotate: end.heading },
    geometry: { type: 'Point', coordinates: toLngLat([end.threshold[0] + end.dir[0] * 110, end.threshold[1] + end.dir[1] * 110]) },
  }));
  return {
    gates: { type: 'FeatureCollection', features: gates },
    pools: { type: 'FeatureCollection', features: pools },
    concourses: { type: 'FeatureCollection', features: concourseLabels },
    runways: { type: 'FeatureCollection', features: runwayLabels },
    pavement: pavementData(world),
  };
}

export function createMapView({ container, token, world, aircraftLayer, styleKey = MAP.defaultStyle }) {
  mapboxgl.accessToken = token;
  if (!MAP.styles[styleKey]) styleKey = MAP.defaultStyle;
  const lat = world.airport.referencePoint[1];
  const data = overlayData(world);
  const gateIds = new Map(data.gates.features.map((f) => [f.properties.code, f.id]));

  const map = new mapboxgl.Map({
    container,
    style: MAP.styles[styleKey],
    center: MAP.intro.center,
    zoom: MAP.intro.zoom,
    pitch: MAP.intro.pitch,
    bearing: MAP.intro.bearing,
    projection: 'mercator',
    maxPitch: 85,
    antialias: true,
    attributionControl: false,
    config: { basemap: { ...MAP.basemap, lightPreset: 'day' } },
  });
  map.addControl(new mapboxgl.AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors (airfield)' }), 'bottom-right');

  let currentStyle = styleKey;
  let lightPreset = 'day';
  let nightLevel = -1;
  let occupied = new Set();

  function addOverlays() {
    map.setConfigProperty('basemap', 'lightPreset', lightPreset);
    for (const [key, value] of Object.entries(MAP.basemap)) {
      try { map.setConfigProperty('basemap', key, value); } catch { /* not every style has every option */ }
    }

    map.addSource('bna-gates', { type: 'geojson', data: data.gates });
    map.addSource('bna-pools', { type: 'geojson', data: data.pools });
    map.addSource('bna-concourses', { type: 'geojson', data: data.concourses });
    map.addSource('bna-runway-labels', { type: 'geojson', data: data.runways });
    map.addSource('bna-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('bna-pavement', { type: 'geojson', data: data.pavement });

    // Pavement drawn under the vector style only — satellite imagery already has the real thing.
    const pavement = (id, type, filter, paint, layout = {}) => map.addLayer({
      id, type, source: 'bna-pavement', slot: 'bottom', filter: ['==', ['get', 'kind'], filter],
      layout: { visibility: currentStyle === 'standard' ? 'visible' : 'none', ...layout }, paint,
    });
    pavement('bna-apron', 'fill', 'apron', { 'fill-color': '#d5d8dc', 'fill-opacity': 0.95 });
    pavement('bna-taxiway', 'line', 'taxiway', { 'line-color': '#aeb3ba', 'line-width': metresWidth(23, lat) }, { 'line-cap': 'round', 'line-join': 'round' });
    pavement('bna-taxiway-centre', 'line', 'taxiway', { 'line-color': '#e9b83a', 'line-width': metresWidth(0.9, lat), 'line-opacity': 0.9 });
    pavement('bna-runway', 'fill', 'runway', { 'fill-color': '#4a4e56' });
    pavement('bna-runway-centre', 'line', 'centreline', { 'line-color': '#f4f6f8', 'line-width': metresWidth(0.9, lat), 'line-dasharray': [30, 20] });
    pavement('bna-runway-markings', 'fill', 'marking', { 'fill-color': '#f4f6f8', 'fill-opacity': 0.92 });
    pavement('bna-lead-ins', 'line', 'leadin', {
      'line-color': '#e9b83a', 'line-opacity': 0.85,
      'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, 0.5, 18, 1.6, 22, 12],
    }, { 'line-cap': 'round' });

    // Warm floodlight pools on the aprons after dark.
    map.addLayer({
      id: 'bna-pools', type: 'circle', source: 'bna-pools', slot: 'middle',
      paint: {
        'circle-radius': metresRadius(70, lat), 'circle-color': '#ffc77a', 'circle-blur': 1,
        'circle-opacity': 0, 'circle-pitch-alignment': 'map', 'circle-emissive-strength': 1,
      },
    });

    // Selected aircraft route.
    map.addLayer({
      id: 'bna-route-glow', type: 'line', source: 'bna-route', slot: 'middle',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#5be0ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 6, 18, 22], 'line-blur': 8, 'line-opacity': 0.45, 'line-emissive-strength': 1 },
    });
    map.addLayer({
      id: 'bna-route', type: 'line', source: 'bna-route', slot: 'middle',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#c9f6ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, 4], 'line-dasharray': [1.5, 1.5], 'line-emissive-strength': 1 },
    });

    // Gate stand markers: hollow when free, filled when an aircraft is on stand.
    map.addLayer({
      id: 'bna-gates', type: 'circle', source: 'bna-gates', slot: 'middle', minzoom: 14.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 14.5, 2.5, 18, 7],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['case', ['boolean', ['feature-state', 'occupied'], false], 0.95, 0.15],
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 1.4,
        'circle-stroke-opacity': 0.9,
        'circle-pitch-alignment': 'map',
        'circle-emissive-strength': 1,
      },
    });
    map.addLayer({
      id: 'bna-gate-labels', type: 'symbol', source: 'bna-gates', slot: 'top', minzoom: 15.6,
      layout: {
        'text-field': ['get', 'code'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15.6, 10, 18, 14], 'text-offset': [0, -1.3], 'text-allow-overlap': false,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(6,10,20,0.85)', 'text-halo-width': 1.4, 'text-emissive-strength': 1 },
    });
    map.addLayer({
      id: 'bna-concourse-labels', type: 'symbol', source: 'bna-concourses', slot: 'top', minzoom: 13.8,
      layout: {
        'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-letter-spacing': 0.25,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 15],
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(6,10,20,0.9)', 'text-halo-width': 1.6, 'text-emissive-strength': 1 },
    });
    map.addLayer({
      id: 'bna-runway-labels', type: 'symbol', source: 'bna-runway-labels', slot: 'top', minzoom: 13.2,
      layout: {
        'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['exponential', 2], ['zoom'], 13, 9, 18, 120],
        'text-rotate': ['get', 'rotate'], 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'map', 'text-allow-overlap': true,
      },
      paint: { 'text-color': 'rgba(255,255,255,0.88)', 'text-emissive-strength': 1 },
    });

    if (!map.getLayer(aircraftLayer.id)) map.addLayer(aircraftLayer);
    for (const code of occupied) map.setFeatureState({ source: 'bna-gates', id: gateIds.get(code) }, { occupied: true });
    nightLevel = -1;
  }

  map.on('style.load', addOverlays);

  // ----------------------------------------------------------- cameras
  let mode = 'free';
  let orbitSpeed = 2.2; // degrees per second
  let follow = null; // { id, pos, bearing }
  const listeners = new Set();
  const setMode = (next) => {
    mode = next;
    listeners.forEach((fn) => fn(mode));
  };
  const interrupt = (event) => {
    if (!event.originalEvent) return;
    if (mode === 'orbit' || mode === 'follow') setMode('free');
  };
  for (const name of ['dragstart', 'rotatestart', 'pitchstart']) map.on(name, interrupt);
  map.on('wheel', (e) => { if (mode === 'orbit') interrupt(e); });

  function preset(name) {
    const shot = CAMERA_PRESETS[name];
    if (!shot) return;
    setMode('free');
    map.flyTo({ center: shot.center, zoom: shot.zoom, pitch: shot.pitch, bearing: shot.bearing, duration: 2600, essential: true, curve: 1.2 });
  }

  /** Opening shot: swoop from the city down onto the airfield. */
  function intro() {
    const shot = CAMERA_PRESETS.overview;
    map.flyTo({ center: shot.center, zoom: shot.zoom, pitch: shot.pitch, bearing: shot.bearing, duration: 5200, curve: 1.1, essential: true });
  }

  function orbit() {
    setMode(mode === 'orbit' ? 'free' : 'orbit');
  }

  function startFollow(id) {
    follow = { id, pos: null, bearing: null };
    setMode('follow');
  }

  /** Called every animation frame with the current aircraft states. */
  function frame(dt, states) {
    if (mode === 'orbit') {
      map.setBearing(map.getBearing() + orbitSpeed * dt);
    } else if (mode === 'follow' && follow) {
      const state = states.find((s) => s.visit.id === follow.id);
      if (!state) {
        setMode('free');
        return;
      }
      const [x, y, z] = state.position;
      const fwd = headingVector(state.heading);
      const airborne = state.airborne;
      const back = airborne ? 260 : 115;
      const up = airborne ? 70 : 34;
      const target = [x - fwd[0] * back, y - fwd[1] * back, z + up];
      const k = 1 - Math.exp(-dt * 2.4);
      const jumped = follow.pos && Math.hypot(target[0] - follow.pos[0], target[1] - follow.pos[1]) > 600;
      if (!follow.pos || jumped) {
        follow.pos = target;
        follow.bearing = state.heading;
      } else {
        follow.pos = follow.pos.map((v, i) => v + (target[i] - v) * k);
        const delta = ((state.heading - follow.bearing + 540) % 360) - 180;
        follow.bearing = (follow.bearing + delta * k + 360) % 360;
      }
      const look = [x, y, z + 6];
      const horizontal = Math.hypot(look[0] - follow.pos[0], look[1] - follow.pos[1]);
      const depression = Math.atan2(follow.pos[2] - look[2], horizontal) * (180 / Math.PI);
      const camera = map.getFreeCameraOptions();
      const camAlt = Math.max(8, follow.pos[2]);
      camera.position = mapboxgl.MercatorCoordinate.fromLngLat(world.frame.toLngLat(follow.pos), camAlt);
      camera.setPitchBearing(clamp(90 - depression, 20, 84), follow.bearing);
      map.setFreeCameraOptions(camera);
    }
  }

  // ------------------------------------------------------------ updates
  function setLighting({ preset: next, night }) {
    if (!map.isStyleLoaded()) return;
    if (next !== lightPreset) {
      lightPreset = next;
      map.setConfigProperty('basemap', 'lightPreset', next);
    }
    const level = Math.round(night * 20) / 20;
    if (level !== nightLevel && map.getLayer('bna-pools')) {
      nightLevel = level;
      map.setPaintProperty('bna-pools', 'circle-opacity', 0.18 * level);
    }
  }

  function setOccupiedGates(codes) {
    if (!map.getSource('bna-gates')) return;
    for (const code of codes) {
      if (!occupied.has(code)) map.setFeatureState({ source: 'bna-gates', id: gateIds.get(code) }, { occupied: true });
    }
    for (const code of occupied) {
      if (!codes.has(code)) map.setFeatureState({ source: 'bna-gates', id: gateIds.get(code) }, { occupied: false });
    }
    occupied = codes;
  }

  function setRoute(paths) {
    const source = map.getSource('bna-route');
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: paths.map((points) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map((p) => world.frame.toLngLat(p)) } })),
    });
  }

  function setStyle(key) {
    if (key === currentStyle || !MAP.styles[key]) return;
    currentStyle = key;
    map.setStyle(MAP.styles[key], { config: { basemap: { ...MAP.basemap, lightPreset } } });
  }

  return {
    map,
    preset,
    intro,
    orbit,
    startFollow,
    stopFollow: () => setMode('free'),
    get mode() { return mode; },
    get style() { return currentStyle; },
    onModeChange: (fn) => listeners.add(fn),
    frame,
    setLighting,
    setOccupiedGates,
    setRoute,
    setStyle,
  };
}
