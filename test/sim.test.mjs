// Simulation checks. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { RUNWAY_FLOW, SCHEDULE, SIMULATION } from '../src/config.js';
import { createWorld } from '../src/sim/world.js';
import { generateSchedule } from '../src/sim/schedule.js';
import { createFrame } from '../src/sim/geo.js';
import { lightingAt } from '../src/sim/sun.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const data = {
  airport: load('data/airport.json'),
  gates: load('data/gates.geojson'),
  runways: load('data/runways.geojson'),
  osm: load('data/osm/bna-airfield.geojson'),
};
const config = {
  seed: SIMULATION.seed,
  schedule: SCHEDULE,
  flow: RUNWAY_FLOW.flows[RUNWAY_FLOW.active],
  separation: RUNWAY_FLOW.separation,
};
const world = createWorld(data, config);
const { simulation, airfield } = world;

test('the local frame round-trips coordinates', () => {
  const frame = createFrame(data.airport.referencePoint);
  for (const gate of data.gates.features) {
    const [lng, lat] = frame.toLngLat(frame.toLocal(gate.geometry.coordinates));
    assert.ok(Math.abs(lng - gate.geometry.coordinates[0]) < 1e-9);
    assert.ok(Math.abs(lat - gate.geometry.coordinates[1]) < 1e-9);
  }
});

test('every gate becomes a stand joined to the taxiway network', () => {
  assert.equal(airfield.stands.size, data.gates.features.length);
  for (const stand of airfield.stands.values()) {
    assert.ok(stand.joinNodeId !== null, `${stand.code} has no taxiway connection`);
  }
});

test('the schedule is deterministic for a seed', () => {
  const a = generateSchedule({ gates: data.gates, seed: 'fixture', config: SCHEDULE });
  const b = generateSchedule({ gates: data.gates, seed: 'fixture', config: SCHEDULE });
  assert.deepEqual(a, b);
  const c = generateSchedule({ gates: data.gates, seed: 'other', config: SCHEDULE });
  assert.notDeepEqual(a, c);
});

test('a gate never holds two aircraft at once', () => {
  const byGate = new Map();
  for (const track of simulation.tracks) {
    const parked = track.legs.find((leg) => leg.phase === 'parked');
    if (!byGate.has(track.visit.gate)) byGate.set(track.visit.gate, []);
    byGate.get(track.visit.gate).push([parked.t0, parked.t1]);
  }
  for (const [gate, spans] of byGate) {
    spans.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i += 1) {
      assert.ok(spans[i][0] >= spans[i - 1][1], `${gate} overlaps at ${spans[i][0]}`);
    }
  }
});

test('every scheduled flight is routed and lands or departs within the day', () => {
  for (const track of simulation.tracks) {
    if (track.visit.arrival) {
      assert.ok(track.runwayIn, `${track.visit.id} has no arrival runway`);
      assert.ok(track.landingTime < track.visit.arrival.inBlock);
    }
    if (track.visit.departure) {
      assert.ok(track.runwayOut, `${track.visit.id} has no departure runway`);
      assert.ok(track.takeoffTime > track.visit.departure.offBlock);
    }
  }
});

test('runway operations respect minimum separation', () => {
  const ops = new Map();
  for (const track of simulation.tracks) {
    for (const [runway, t] of [[track.runwayIn, track.landingTime], [track.runwayOut, track.takeoffTime]]) {
      if (!runway) continue;
      const pair = airfield.runwayEnds.get(runway).pair;
      if (!ops.has(pair)) ops.set(pair, []);
      ops.get(pair).push(t);
    }
  }
  const minimum = Math.min(...Object.values(RUNWAY_FLOW.separation));
  for (const [pair, times] of ops) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) {
      assert.ok(times[i] - times[i - 1] >= minimum - 0.5, `${pair}: ${times[i] - times[i - 1]}s apart`);
    }
  }
});

test('motion is continuous: no aircraft jumps further than its speed allows', () => {
  for (const track of simulation.tracks) {
    let previous = null;
    for (let t = Math.ceil(track.tStart); t < track.tEnd; t += 2) {
      const state = simulation.stateAt(track, t);
      if (previous) {
        const d = Math.hypot(...state.position.map((v, i) => v - previous.position[i]));
        assert.ok(d < 2 * 150, `${track.visit.id} jumped ${d.toFixed(0)} m at ${t}`);
      }
      previous = state;
    }
  }
});

test('the day loops: aircraft parked at midnight are parked at both ends', () => {
  const atStart = simulation.activeAt(0).filter((s) => s.phase === 'parked').map((s) => s.visit.gate).sort();
  const atEnd = simulation.activeAt(simulation.DAY - 1).filter((s) => s.phase === 'parked').map((s) => s.visit.gate).sort();
  assert.ok(atStart.length > 0);
  const shared = atStart.filter((gate) => atEnd.includes(gate));
  assert.ok(shared.length >= atStart.length * 0.9, 'overnight gates should match across midnight');
});

test('lighting follows the sun over Nashville', () => {
  const at = (hours) => lightingAt({ isoDate: '2026-06-21', seconds: hours * 3600, timeZone: 'America/Chicago', position: data.airport.referencePoint });
  assert.equal(at(1).preset, 'night');
  assert.equal(at(13).preset, 'day');
  assert.ok(at(13).sunElevation > 60, 'midsummer noon sun is high');
  assert.ok(at(1).night > 0.99);
});
