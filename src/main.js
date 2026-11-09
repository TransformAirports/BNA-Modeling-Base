// App entry: build the simulated day, open the map, run the render loop.

import airport from '../data/airport.json';
import gatesText from '../data/gates.geojson?raw';
import runwaysText from '../data/runways.geojson?raw';
import osmText from '../data/osm/bna-airfield.geojson?raw';
import { MAPBOX_DEMO_TOKEN, RUNWAY_FLOW, SCHEDULE, SIMULATION } from './config.js';
import { createMapView } from './map/mapView.js';
import { createAircraftLayer } from './render/aircraftLayer.js';
import { createClock } from './sim/clock.js';
import { createDayLighting, todayIn } from './sim/sun.js';
import { createWorld } from './sim/world.js';
import { createHud } from './ui/hud.js';
import { createTimeline } from './ui/timeline.js';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'bna-live:mapbox-token';
const STYLE_KEY = 'bna-live:style';
const splashStatus = $('splash-status');

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
};

/**
 * Resolve the Mapbox token, first match wins:
 *   1. VITE_MAPBOX_TOKEN in .env.local (your own token — recommended)
 *   2. a token pasted into the in-app prompt (saved in this browser)
 *   3. MAPBOX_DEMO_TOKEN in src/config.js (ships with the starter)
 *   4. otherwise, ask
 */
function getToken() {
  const fromEnv = import.meta.env.VITE_MAPBOX_TOKEN?.trim();
  if (fromEnv) return Promise.resolve(fromEnv);
  const saved = storage.get(TOKEN_KEY);
  if (saved) return Promise.resolve(saved);
  if (MAPBOX_DEMO_TOKEN?.startsWith('pk.')) return Promise.resolve(MAPBOX_DEMO_TOKEN);
  return askForToken();
}

function askForToken(message) {
  const form = $('token-form');
  form.hidden = false;
  splashStatus.textContent = message ?? 'One more thing: the map needs a Mapbox token.';
  $('token-input').focus();
  return new Promise((resolve) => {
    form.addEventListener('submit', function submit(event) {
      event.preventDefault();
      const value = $('token-input').value.trim();
      if (!value.startsWith('pk.')) {
        splashStatus.textContent = 'That doesn’t look like a public token — it should start with “pk.”.';
        return;
      }
      storage.set(TOKEN_KEY, value);
      form.hidden = true;
      form.removeEventListener('submit', submit);
      resolve(value);
    });
  });
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Mapbox can't build its camera inside a 0×0 container (e.g. a hidden tab), so wait for layout. */
const waitForSize = (element) => new Promise((resolve) => {
  if (element.clientWidth > 0 && element.clientHeight > 0) return resolve();
  const observer = new ResizeObserver(() => {
    if (element.clientWidth > 0 && element.clientHeight > 0) {
      observer.disconnect();
      resolve();
    }
  });
  observer.observe(element);
});

async function start() {
  await nextFrame();

  // 1. Simulated day.
  const world = createWorld(
    { airport, gates: JSON.parse(gatesText), runways: JSON.parse(runwaysText), osm: JSON.parse(osmText) },
    { seed: SIMULATION.seed, schedule: SCHEDULE, flow: RUNWAY_FLOW.flows[RUNWAY_FLOW.active], separation: RUNWAY_FLOW.separation },
  );
  const { simulation } = world;
  const isoDate = todayIn(airport.timezone);
  const lightingAt = createDayLighting({ isoDate, timeZone: airport.timezone, position: airport.referencePoint });
  const clock = createClock({ start: SIMULATION.startHour * 3600, speed: SIMULATION.defaultSpeed, loop: SIMULATION.loop, length: simulation.DAY });

  // 2. Map + aircraft layer.
  splashStatus.textContent = 'Opening the map…';
  const token = await getToken();
  splashStatus.textContent = 'Loading Nashville…';
  const aircraftLayer = createAircraftLayer({ world });
  await waitForSize($('map'));
  const savedStyle = storage.get(STYLE_KEY);
  const view = createMapView({ container: 'map', token, world, aircraftLayer, ...(savedStyle ? { styleKey: savedStyle } : {}) });
  const { map } = view;

  map.on('error', (event) => {
    const status = event?.error?.status;
    if (status === 401 || status === 403) {
      storage.remove(TOKEN_KEY);
      $('splash').classList.remove('done');
      askForToken('Mapbox rejected that token. Paste a valid public token (pk…).').then(() => window.location.reload());
    }
  });

  // 3. UI.
  let selectedId = null;
  let tagsOn = true;
  let states = [];
  let routeKey = '';

  const hud = createHud({ world, onSelect: select, onFollow: follow });
  const timeline = createTimeline({
    root: $('timeline'),
    histogram: simulation.histogram,
    elevationAt: (t) => lightingAt(t).sunElevation,
    onSeek: (t) => clock.seek(t),
  });

  function select(id) {
    selectedId = id;
    aircraftLayer.setSelected(id);
    hud.setSelected(id);
    routeKey = '';
    if (!id && view.mode === 'follow') view.stopFollow();
  }

  function follow(id) {
    let target = id;
    if (!target) {
      // Pick something interesting: an aircraft on approach or taxiing, else anything moving.
      const moving = states.filter((s) => s.phase !== 'parked' && s.opacity > 0.9);
      const preferred = moving.filter((s) => ['approach', 'taxi-out', 'taxi-in', 'takeoff', 'lineup-wait', 'holding'].includes(s.phase));
      const pool = preferred.length ? preferred : moving;
      target = pool[Math.floor(Math.random() * pool.length)]?.visit.id;
    }
    if (!target) return;
    if (view.mode === 'follow' && selectedId === target) {
      view.stopFollow();
      return;
    }
    select(target);
    view.startFollow(target);
  }

  // Playback controls.
  const playButton = $('play');
  const syncPlay = () => {
    playButton.classList.toggle('playing', clock.playing);
    playButton.setAttribute('aria-label', clock.playing ? 'Pause' : 'Play');
  };
  playButton.addEventListener('click', () => clock.toggle());
  const speedRoot = $('speed');
  for (const speed of SIMULATION.speeds) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.speed = speed;
    button.textContent = `${speed}×`;
    button.title = `${speed} simulated seconds per second`;
    button.addEventListener('click', () => clock.setSpeed(speed));
    speedRoot.append(button);
  }
  const syncSpeed = () => {
    for (const b of speedRoot.children) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === clock.speed));
  };
  clock.onChange(() => { syncPlay(); syncSpeed(); });
  syncPlay();
  syncSpeed();

  // Camera, style and tag controls.
  const cameraButtons = [...document.querySelectorAll('[data-camera]')];
  const syncCamera = (mode) => {
    for (const b of cameraButtons) {
      const on = (b.dataset.camera === 'orbit' && mode === 'orbit') || (b.dataset.camera === 'follow' && mode === 'follow');
      b.setAttribute('aria-pressed', String(on));
    }
  };
  view.onModeChange(syncCamera);
  for (const button of cameraButtons) {
    button.addEventListener('click', () => {
      const name = button.dataset.camera;
      if (name === 'orbit') view.orbit();
      else if (name === 'follow') follow(view.mode === 'follow' ? selectedId : selectedId ?? null);
      else view.preset(name);
    });
  }
  const styleButtons = [...document.querySelectorAll('[data-style]')];
  const syncStyle = () => styleButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.style === view.style)));
  for (const button of styleButtons) {
    button.addEventListener('click', () => {
      view.setStyle(button.dataset.style);
      storage.set(STYLE_KEY, button.dataset.style);
      syncStyle();
    });
  }
  syncStyle();
  const tagsToggle = $('tags-toggle');
  tagsToggle.addEventListener('click', () => {
    tagsOn = !tagsOn;
    tagsToggle.setAttribute('aria-pressed', String(tagsOn));
  });

  // Selecting aircraft on the map.
  map.on('click', (event) => {
    const id = aircraftLayer.pick(event.point.x, event.point.y);
    if (id) select(id);
    else if (view.mode !== 'follow') select(null);
  });
  map.on('mousemove', (event) => {
    map.getCanvas().style.cursor = aircraftLayer.pick(event.point.x, event.point.y) ? 'pointer' : '';
  });

  // Keyboard.
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const step = event.shiftKey ? 1800 : 300;
    const speeds = SIMULATION.speeds;
    const index = speeds.indexOf(clock.speed);
    switch (event.key) {
      case ' ': event.preventDefault(); clock.toggle(); break;
      case 'ArrowRight': clock.seek(clock.time + step); break;
      case 'ArrowLeft': clock.seek(clock.time - step); break;
      case ']': clock.setSpeed(speeds[Math.min(speeds.length - 1, index + 1)] ?? speeds[0]); break;
      case '[': clock.setSpeed(speeds[Math.max(0, index - 1)] ?? speeds[0]); break;
      case 'f': case 'F': follow(view.mode === 'follow' ? null : selectedId); break;
      case 'o': case 'O': view.orbit(); break;
      case 't': case 'T': tagsToggle.click(); break;
      case '1': view.preset('overview'); break;
      case '2': view.preset('terminal'); break;
      case '3': view.preset('runways'); break;
      case 'Escape': select(null); break;
      default: break;
    }
  });

  // 4. Render loop.
  let last = performance.now();
  let uiTick = 0;
  let boardTick = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock.tick(dt);
    const t = clock.time;
    states = simulation.activeAt(t);
    const lighting = lightingAt(t);

    aircraftLayer.setStates(states);
    aircraftLayer.setConditions(lighting);
    view.setLighting(lighting);
    view.frame(dt, states);
    map.triggerRepaint();

    timeline.setTime(t);
    hud.setTags(states, aircraftLayer.screen, tagsOn);
    hud.setClock(t, lighting, isoDate);

    uiTick += dt;
    boardTick += dt;
    if (uiTick > 0.1) {
      uiTick = 0;
      hud.setStats(simulation.summarize(states, t));
      const track = selectedId ? simulation.byId.get(selectedId) : null;
      const selectedState = states.find((s) => s.visit.id === selectedId) ?? null;
      hud.setCard(selectedState, track, view.mode === 'follow');
      view.setOccupiedGates(new Set(states.filter((s) => s.phase === 'parked' || s.phase === 'docking').map((s) => s.visit.gate)));
      updateRoute(track, selectedState);
    }
    if (boardTick > 0.5) {
      boardTick = 0;
      hud.setBoard(t);
    }
    requestAnimationFrame(loop);
  }

  /** Show the taxi route for the selected aircraft's current ground movement. */
  function updateRoute(track, state) {
    let paths = [];
    let key = 'none';
    if (track && state) {
      const arriving = ['approach', 'landing', 'arrival-hold', 'taxi-in', 'docking'].includes(state.phase);
      const leg = track.legs.find((l) => l.path && (arriving ? l.phase === 'landing' || l.phase === 'taxi-in' : l.phase === 'taxi-out'));
      if (leg && state.phase !== 'climb') {
        key = `${track.visit.id}:${arriving}`;
        paths = [leg.path.points];
      }
    }
    if (key === routeKey) return;
    routeKey = key;
    view.setRoute(paths);
  }

  map.once('load', () => {
    requestAnimationFrame(loop);
    setTimeout(() => {
      $('splash').classList.add('done');
      view.intro();
      // Start in motion — the whole point is watching the day unfold.
      clock.play();
    }, 400);
  });

  // Handy for poking at the sim from the console.
  window.bna = {
    world, clock, map, view, aircraftLayer,
    /**
     * Close-up of a parked aircraft, e.g. bna.inspect('DAL', 'A321') or bna.inspect('SWA', null, 270).
     * `side` is the viewing angle relative to the nose: 90 = right side, 270 = left, 0 = head-on.
     */
    inspect(carrier, type = null, side = 90) {
      const candidates = simulation.activeAt(clock.time).filter((s) => s.phase === 'parked' && (!carrier || s.visit.carrier === carrier));
      const state = candidates.find((s) => !type || s.visit.type === type) ?? candidates[0];
      if (!state) return 'No parked aircraft like that right now — try another time.';
      view.stopFollow();
      clock.pause();
      map.jumpTo({ center: world.frame.toLngLat(state.position), zoom: 20.4, pitch: 72, bearing: (state.heading + side) % 360 });
      return `${state.visit.id}: ${state.visit.carrier} ${state.visit.type} at ${state.visit.gate}`;
    },
  };
}

start().catch((error) => {
  console.error(error);
  splashStatus.textContent = `Something went wrong: ${error.message}`;
});
