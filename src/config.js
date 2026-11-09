// Everything a person is likely to tweak lives here.

/**
 * Mapbox access token.
 *
 * This starter ships with a DEMO token so it works the moment you clone it.
 * Swap in your own before building on it (README → "Use your own Mapbox token"):
 *   - Recommended: put VITE_MAPBOX_TOKEN=pk... in .env.local (gitignored). It always wins.
 *   - Or replace the string below with your own public (pk.) token.
 * The demo token may be rotated or rate-limited at any time.
 */
export const MAPBOX_DEMO_TOKEN = 'pk.eyJ1IjoiY2draXYiLCJhIjoiY21qaGpzZnIxMG9icjNlcHY0ZXZ0ZHlybyJ9.CTRt44j2xNCjJfRR9gB3TA';

export const MAP = {
  /**
   * Basemap styles. `standard` is Mapbox's 3D vector map: extruded buildings
   * (including BNA's terminal), landmarks and trees, with real-time lighting.
   */
  styles: {
    standard: 'mapbox://styles/mapbox/standard',
    satellite: 'mapbox://styles/mapbox/standard-satellite',
  },
  defaultStyle: 'standard',
  /**
   * Mapbox Standard options (ignored where a style doesn't support them).
   * theme: 'default' | 'faded' | 'monochrome' — try 'monochrome' for a white
   * architectural-model look that makes the liveries pop.
   */
  basemap: {
    theme: 'default',
    show3dBuildings: true,
    show3dFacades: true,
    show3dLandmarks: true,
    show3dTrees: true,
    showPointOfInterestLabels: false,
    showTransitLabels: false,
    showRoadLabels: false,
  },
  /** Camera when the page opens; it then flies to `CAMERA_PRESETS.overview`. */
  intro: { center: [-86.6745, 36.1262], zoom: 12.4, pitch: 35, bearing: -95 },
};

/** Named camera shots. `follow` and `orbit` are handled in code. */
export const CAMERA_PRESETS = {
  overview: { label: 'Airfield', center: [-86.6745, 36.1262], zoom: 14.35, pitch: 62, bearing: -28 },
  terminal: { label: 'Terminal', center: [-86.668, 36.129], zoom: 16.25, pitch: 72, bearing: 62 },
  runways: { label: 'Runways', center: [-86.6655, 36.1185], zoom: 15.4, pitch: 74, bearing: 18 },
};

export const SIMULATION = {
  /** Seed for the synthetic day. Change it to get a different (but repeatable) schedule. */
  seed: 'BNA-2026',
  /** Local time the page opens at, in hours. */
  startHour: 6.25,
  /** Playback speeds offered in the UI (sim seconds per real second). */
  speeds: [1, 10, 30, 60, 120, 300, 600],
  defaultSpeed: 60,
  /** Wrap from midnight back to midnight. The schedule parks the same aircraft overnight, so the loop is seamless. */
  loop: true,
};

/**
 * Runway operating configuration. BNA mostly operates in south flow (landing
 * and departing toward 200°). Each aircraft picks the listed runway that gives
 * the shortest taxi to or from its gate.
 */
export const RUNWAY_FLOW = {
  active: 'south',
  flows: {
    south: { arrivals: ['20L', '20R'], departures: ['20C', '20L'] },
    north: { arrivals: ['2L', '2R'], departures: ['2C', '2R'] },
  },
  /** Minimum seconds between operations on the same runway. */
  separation: { arrival: 105, departure: 80, mixed: 70 },
};

/**
 * Synthetic schedule knobs. Carriers per concourse are weights, not shares of
 * the real BNA schedule — replace the whole generator with real data when you
 * have it (see AGENTS.md).
 */
export const SCHEDULE = {
  concourseCarriers: {
    B: [['AAL', 8], ['UAL', 2]],
    C: [['SWA', 1]],
    D: [['DAL', 4], ['UAL', 3], ['ASA', 1], ['JBU', 1], ['ACA', 1]],
    'T Gates': [['NKS', 2], ['FFT', 2], ['SWA', 2]],
  },
  /** Share of gates with an aircraft parked overnight. */
  overnightShare: 0.82,
  /** Window for the first departure of an overnight aircraft (hours). */
  firstWave: [5.4, 7.2],
  /** Idle time between a departure and the next arrival at the same gate (minutes). */
  gateGap: [25, 110],
  /** No new turn may push back after this hour. */
  lastDeparture: 22.4,
  /** Overnight aircraft arrive in this window (hours). */
  lastArrival: [21.0, 23.75],
};
