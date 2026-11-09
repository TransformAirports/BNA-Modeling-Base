// One call to go from raw data files to a ready-to-play simulated day.
// Pure JavaScript: runs in the browser and in Node (see test/sim.test.mjs).

import { buildAirfield } from './airfield.js';
import { createFrame } from './geo.js';
import { generateSchedule } from './schedule.js';
import { createSimulation } from './simulation.js';

/**
 * @param {object} data     { airport, gates, runways, osm } parsed JSON/GeoJSON
 * @param {object} config   { seed, schedule, flow, separation }
 */
export function createWorld(data, config) {
  const frame = createFrame(data.airport.referencePoint);
  const airfield = buildAirfield({ frame, osm: data.osm, gates: data.gates, runways: data.runways });
  const visits = config.visits ?? generateSchedule({ gates: data.gates, seed: config.seed, config: config.schedule });
  const simulation = createSimulation({
    airfield,
    visits,
    flow: config.flow,
    separation: config.separation,
    seed: config.seed,
  });
  return { frame, airfield, visits, simulation, airport: data.airport };
}
