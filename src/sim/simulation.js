// Turns a schedule of gate visits into continuous, time-addressable motion.
//
// For each visit we plan, against the real airfield graph:
//   arrival:   approach → landing roll → taxi in → dock at the stand
//   parked:    at the stand
//   departure: pushback → engine start → taxi out → hold short → line up → takeoff → climb
//
// Then runway slots are de-conflicted: arrivals that would land too close
// together land a little earlier and wait on a taxiway; departures wait at the
// hold-short line. `stateAt(visit, t)` samples any visit at any time.

import { AIRCRAFT_TYPES } from './fleet.js';
import { AIRPORTS } from './airports.js';
import {
  Path, add, catmullRom, clamp, cubicBezier, dist2, filletPolyline, greatCircleBearing,
  headingDelta, headingVector, norm2, scale, smoothstep, sub,
} from './geo.js';
import { holdLeg, knotProfile, moveLeg, profileDuration, sampleProfile, scheduleLegs, speedProfile } from './motion.js';
import { createRandom } from './random.js';

export const DAY = 86400;
const DEG = Math.PI / 180;
const GLIDE = Math.tan(3 * DEG);
const TOUCHDOWN = 380; // metres past the threshold
const ROTATE_SPEED = 72; // m/s (~140 kt)
const TOUCHDOWN_SPEED = 69;
const EXIT_SPEED = 13;
const TAXI_SPEED = 9.5; // ~18 kt

/** Human-readable phase labels for the UI. */
export const PHASE_LABELS = {
  approach: 'On approach',
  landing: 'Landing',
  'arrival-hold': 'Holding for gate',
  'taxi-in': 'Taxiing in',
  docking: 'Docking',
  parked: 'At gate',
  pushback: 'Pushback',
  'engine-start': 'Starting engines',
  'taxi-out': 'Taxiing out',
  holding: 'Holding short',
  lineup: 'Lining up',
  'lineup-wait': 'Line up & wait',
  takeoff: 'Takeoff roll',
  climb: 'Departed',
};

const AIRBORNE = new Set(['approach', 'climb']);
const TAXIING = new Set(['landing', 'arrival-hold', 'taxi-in', 'taxi-out', 'holding', 'lineup', 'lineup-wait', 'takeoff', 'engine-start', 'pushback', 'docking']);
const RUNWAY_PHASES = new Set(['landing', 'lineup-wait', 'takeoff']);

/** Points along `ids` (graph node ids) in local coordinates. */
const nodePoints = (airfield, ids) => ids.map((id) => airfield.pointOf(id));

/** Lead-in from the taxilane end to where the aircraft's centre stops. */
function leadInPoints(stand, centreOffset) {
  const stopCentre = sub(stand.stop, scale(stand.nose, centreOffset));
  const behind = stand.leadIn.filter((p) => (p[0] - stopCentre[0]) * stand.nose[0] + (p[1] - stopCentre[1]) * stand.nose[1] < -3);
  const points = behind.length ? [...behind, stopCentre] : [sub(stopCentre, scale(stand.nose, 30)), stopCentre];
  return { points, stopCentre };
}

/**
 * Speed limits after touchdown: brake at ~2 m/s² down to exit speed, roll to
 * the exit, taxi at normal speed, creep along the lead-in.
 */
const arrivalLimits = (sExit, sDock) => ({
  vMax: (s) => (s < sExit
    ? Math.sqrt(Math.max(EXIT_SPEED ** 2, TOUCHDOWN_SPEED ** 2 - 2 * 2.0 * s))
    : s > sDock ? 2.6 : TAXI_SPEED),
  accel: 0.55,
  decel: (s) => (s < sExit + 30 ? 2.4 : 0.9),
  latAccel: 1.1,
});

/** Altitude on a 3° glide path with a flare that levels off at touchdown. */
const glideAltitude = (toGo) => Math.min(3000, GLIDE * toGo * (1 - Math.exp(-toGo / 110)));
/** Climb profile from liftoff: a gentle rotation, then ~5° up to a cap. */
const climbAltitude = (s) => Math.min(3600, s < 300 ? (0.085 * s * s) / 600 : 0.085 * (s - 150));

export function createSimulation({ airfield, visits, flow, separation, seed = 'bna' }) {
  const random = createRandom(`${seed}:ops`);
  const homeLngLat = airfield.frame.origin;
  const directionTo = (code) => {
    const airport = AIRPORTS[code];
    return airport ? headingVector(greatCircleBearing(homeLngLat, airport.position)) : [0, 1];
  };
  const runwayLoad = new Map(); // runway id → [times] used for load balancing

  const loadPenalty = (runwayId, t) => (runwayLoad.get(runwayId) ?? [])
    .filter((x) => Math.abs(x - t) < 15 * 60).length * 320;
  const noteLoad = (runwayId, t) => {
    if (!runwayLoad.has(runwayId)) runwayLoad.set(runwayId, []);
    runwayLoad.get(runwayId).push(t);
  };

  // ---------------------------------------------------------------- arrivals
  function planArrival(visit, type, stand) {
    const { points: lead, stopCentre } = leadInPoints(stand, type.length * 0.4);
    let best = null;
    for (const runwayId of flow.arrivals) {
      const end = airfield.runwayEnds.get(runwayId);
      if (!end) continue;
      for (const exit of end.access) {
        if (exit.s < 1250 || exit.s > end.length - 100) continue;
        const route = airfield.routeFromStand(visit.gate, exit.nodeId);
        if (!route) continue;
        const cost = airfield.taxiDistance(visit.gate, exit.nodeId) + 0.35 * (exit.s - 1250)
          + loadPenalty(runwayId, visit.arrival.inBlock);
        if (!best || cost < best.cost) best = { cost, end, exit, route };
      }
    }
    if (!best) return null;
    const { end, exit, route } = best;
    noteLoad(end.id, visit.arrival.inBlock);

    // Ground: touchdown → rollout → exit → taxiways → lead-in → stop.
    const touchdown = add(end.threshold, scale(end.dir, TOUCHDOWN));
    const exitPoint = airfield.pointOf(exit.nodeId);
    const taxi = nodePoints(airfield, [...route].reverse()); // exit → … → stand join
    const ground = new Path(filletPolyline([touchdown, ...taxi, ...lead], 38));
    const sExit = Math.max(0, dist2(touchdown, exitPoint) - 45);
    const leadLength = new Path(lead).length;
    const sDock = ground.length - leadLength;
    const knots = speedProfile(ground, 0, ground.length, { ...arrivalLimits(sExit, sDock), vStart: TOUCHDOWN_SPEED, vEnd: 0 });

    // Approach: from the origin's direction, swinging onto a long final if needed.
    const toOrigin = directionTo(visit.arrival.origin);
    const approachSide = scale(end.dir, -1); // from the airport toward where final approach comes from
    const finalFar = add(touchdown, scale(approachSide, 17000));
    const finalNear = add(touchdown, scale(approachSide, 8500));
    const entry = scale(toOrigin, 34000);
    const waypoints = [entry];
    const turn = Math.acos(clamp(toOrigin[0] * approachSide[0] + toOrigin[1] * approachSide[1], -1, 1)) / DEG;
    if (turn > 95) {
      // Origin is on the far side: fly a wide downwind on the origin's side.
      const perp = [approachSide[1], -approachSide[0]];
      const side = Math.sign(perp[0] * toOrigin[0] + perp[1] * toOrigin[1]) || 1;
      waypoints.push(add(scale(perp, side * 9000), scale(approachSide, -6000)));
      waypoints.push(add(add(touchdown, scale(perp, side * 8000)), scale(approachSide, 9000)));
    }
    waypoints.push(finalFar, finalNear, touchdown);
    const flat = catmullRom(waypoints.map(([x, y]) => [x, y, 0]), 28);
    const flatPath = new Path(flat);
    const air = new Path(flat.map((p, i) => [p[0], p[1], glideAltitude(flatPath.length - flatPath.cumulative[i])]));
    const toGo = (d) => Math.max(0, air.length - d);
    const approachKnots = knotProfile([
      { s: 0, v: 118 },
      ...(air.length > 17000 ? [{ s: toGo(17000), v: 86 }] : []),
      ...(air.length > 3000 ? [{ s: toGo(3000), v: 72 }] : []),
      { s: air.length, v: TOUCHDOWN_SPEED },
    ]);

    return {
      runway: end.id,
      exitS: exit.s,
      ground,
      groundKnots: knots,
      sExit,
      sDock,
      air,
      approachKnots,
      stopCentre,
      groundDuration: profileDuration(knots),
      approachDuration: profileDuration(approachKnots),
    };
  }

  // -------------------------------------------------------------- departures
  function planDeparture(visit, type, stand) {
    const { stopCentre } = leadInPoints(stand, type.length * 0.4);
    let best = null;
    for (const runwayId of flow.departures) {
      const end = airfield.runwayEnds.get(runwayId);
      if (!end) continue;
      for (const entry of end.access) {
        if (entry.s < -80 || entry.s > 650) continue;
        const route = airfield.routeFromStand(visit.gate, entry.nodeId);
        if (!route || route.length < 2) continue;
        const cost = airfield.taxiDistance(visit.gate, entry.nodeId) + 1.5 * Math.max(0, entry.s - 60)
          + loadPenalty(runwayId, visit.departure.offBlock + 600);
        if (!best || cost < best.cost) best = { cost, end, entry, route };
      }
    }
    if (!best) return null;
    const { end, entry, route } = best;
    noteLoad(end.id, visit.departure.offBlock + 600);

    const taxiPoints = nodePoints(airfield, route); // join → … → runway entry
    const join = taxiPoints[0];
    const outbound = norm2(sub(taxiPoints[Math.min(2, taxiPoints.length - 1)], join));

    // Pushback: tail-first from the stand, ending on the taxilane pointing the way out.
    const reach = dist2(stopCentre, join);
    const push = new Path(cubicBezier(
      stopCentre,
      sub(stopCentre, scale(stand.nose, reach * 0.5)),
      add(join, scale(outbound, reach * 0.4)),
      join,
      24,
    ));
    const pushKnots = speedProfile(push, 0, push.length, { vStart: 0, vEnd: 0, vMax: 1.15, accel: 0.18, decel: 0.25, latAccel: 0 });

    // Taxi out, stopping at the hold-short line, then line up on the centreline.
    const lineupS = Math.max(entry.s, -10) + 50;
    const lineupPoint = add(end.threshold, scale(end.dir, lineupS));
    const taxi = new Path(filletPolyline([...taxiPoints, lineupPoint], 34));
    const sHold = Math.max(5, taxi.length - 50 - 70);
    const taxiKnots = speedProfile(taxi, 0, sHold, { vStart: 0, vEnd: 0, vMax: TAXI_SPEED, accel: 0.5, decel: 0.8, latAccel: 1.0 });
    const lineupKnots = speedProfile(taxi, sHold, taxi.length, { vStart: 0, vEnd: 0, vMax: 5.5, accel: 0.5, decel: 0.7, latAccel: 0.8 });

    // Takeoff roll, sized to lift off with runway to spare.
    const available = end.length - lineupS - 350;
    const accel = Math.max(1.9, (ROTATE_SPEED ** 2) / (2 * Math.max(600, available)));
    const rollLength = (ROTATE_SPEED ** 2) / (2 * accel);
    const liftoff = add(lineupPoint, scale(end.dir, rollLength));
    const roll = new Path([lineupPoint, liftoff]);
    const rollKnots = knotProfile([{ s: 0, v: 0 }, { s: rollLength, v: ROTATE_SPEED }]);

    // Climb straight out, then turn toward the destination.
    const toDest = directionTo(visit.departure.destination);
    const blend = norm2(add(end.dir, toDest));
    const p2 = add(liftoff, scale(end.dir, 4500));
    const p3 = add(p2, scale(Math.abs(blend[0]) + Math.abs(blend[1]) > 0.2 ? blend : [end.dir[1], -end.dir[0]], 6000));
    const flat = catmullRom([liftoff, add(liftoff, scale(end.dir, 1800)), p2, p3, scale(toDest, 34000)].map(([x, y]) => [x, y, 0]), 28);
    const flatPath = new Path(flat);
    const climb = new Path(flat.map((p, i) => [p[0], p[1], climbAltitude(flatPath.cumulative[i])]));
    const climbKnots = knotProfile([{ s: 0, v: ROTATE_SPEED }, { s: Math.min(3000, climb.length / 2), v: 92 }, { s: climb.length, v: 135 }]);

    return {
      runway: end.id,
      push, pushKnots, taxi, taxiKnots, sHold, lineupKnots, roll, rollKnots, climb, climbKnots,
      engineStart: 60 + random.range(0, 60),
      holdBase: 15 + random.range(0, 35),
      lineupWait: 12 + random.range(0, 25),
      heading: { join: (Math.atan2(outbound[0], outbound[1]) / DEG + 360) % 360, runway: end.heading },
    };
  }

  // ------------------------------------------------------------- planning
  const planned = [];
  const sorted = [...visits].sort((a, b) => (a.arrival?.inBlock ?? a.departure.offBlock) - (b.arrival?.inBlock ?? b.departure.offBlock));
  for (const visit of sorted) {
    const type = AIRCRAFT_TYPES[visit.type];
    const stand = airfield.stands.get(visit.gate);
    if (!type || !stand) continue;
    const arrival = visit.arrival ? planArrival(visit, type, stand) : null;
    const departure = visit.departure ? planDeparture(visit, type, stand) : null;
    const plan = { visit, type, stand, arrival, departure };
    if (arrival) plan.landingTime = visit.arrival.inBlock - arrival.groundDuration;
    if (departure) {
      plan.takeoffTime = visit.departure.offBlock + profileDuration(departure.pushKnots) + departure.engineStart
        + profileDuration(departure.taxiKnots) + departure.holdBase + profileDuration(departure.lineupKnots) + departure.lineupWait;
    }
    plan.arrivalShift = 0;
    plan.departureDelay = 0;
    planned.push(plan);
  }

  // ------------------------------------------------- runway de-confliction
  const byPair = new Map();
  for (const plan of planned) {
    for (const [kind, leg] of [['arrival', plan.arrival], ['departure', plan.departure]]) {
      if (!leg) continue;
      const pair = airfield.runwayEnds.get(leg.runway).pair;
      if (!byPair.has(pair)) byPair.set(pair, { arrivals: [], departures: [] });
      byPair.get(pair)[`${kind}s`].push(plan);
    }
  }
  for (const { arrivals, departures } of byPair.values()) {
    // Arrivals only move earlier (the slack becomes a taxiway hold), latest first.
    arrivals.sort((a, b) => b.landingTime - a.landingTime);
    let next = Infinity;
    for (const plan of arrivals) {
      const t = Math.min(plan.landingTime, next - separation.arrival);
      plan.arrivalShift = plan.landingTime - t;
      plan.landingTime = t;
      next = t;
    }
    // Departures only move later, earliest first, fitting between arrivals.
    const busy = arrivals.map((p) => ({ t: p.landingTime, gap: separation.mixed }));
    departures.sort((a, b) => a.takeoffTime - b.takeoffTime);
    for (const plan of departures) {
      let t = plan.takeoffTime;
      for (let guard = 0; guard < 200; guard += 1) {
        const clash = busy.find((op) => Math.abs(op.t - t) < op.gap);
        if (!clash) break;
        t = clash.t + clash.gap;
      }
      plan.departureDelay = t - plan.takeoffTime;
      plan.takeoffTime = t;
      busy.push({ t, gap: separation.departure });
    }
  }

  // ------------------------------------------------------- build legs
  const tracks = planned.map((plan) => {
    const { visit, arrival, departure, stand } = plan;
    const legs = [];
    let start;

    if (arrival) {
      legs.push(moveLeg(arrival.air, arrival.approachKnots, 'approach', { air: true }));
      if (plan.arrivalShift > 1) {
        // Land earlier than needed, then wait on the taxiway clear of the runway.
        const sWait = Math.min(arrival.sDock - 20, arrival.sExit + 160);
        const limits = arrivalLimits(arrival.sExit, arrival.sDock);
        const firstHalf = speedProfile(arrival.ground, 0, sWait, { ...limits, vStart: TOUCHDOWN_SPEED, vEnd: 0 });
        const secondHalf = speedProfile(arrival.ground, sWait, arrival.ground.length, { ...limits, vStart: 0, vEnd: 0 });
        const waitPoint = arrival.ground.pointAt(sWait);
        const shiftGround = profileDuration(firstHalf) + profileDuration(secondHalf);
        const hold = Math.max(0, visit.arrival.inBlock - plan.landingTime - shiftGround);
        legs.push(moveLeg(arrival.ground, firstHalf, 'landing', { sExit: arrival.sExit, sDock: arrival.sDock }));
        legs.push(holdLeg(waitPoint, arrival.ground.headingAt(sWait), hold, 'arrival-hold'));
        legs.push(moveLeg(arrival.ground, secondHalf, 'taxi-in', { sExit: arrival.sExit, sDock: arrival.sDock }));
      } else {
        legs.push(moveLeg(arrival.ground, arrival.groundKnots, 'landing', { sExit: arrival.sExit, sDock: arrival.sDock }));
      }
      const groundTime = legs.slice(1).reduce((sum, leg) => sum + leg.duration, 0);
      start = visit.arrival.inBlock - groundTime - legs[0].duration;
    } else {
      start = 0;
    }

    const parkedFrom = arrival ? visit.arrival.inBlock : 0;
    const parkedUntil = departure ? visit.departure.offBlock : DAY;
    const stopCentre = arrival?.stopCentre ?? sub(stand.stop, scale(stand.nose, plan.type.length * 0.4));
    legs.push(holdLeg(stopCentre, stand.heading, parkedUntil - parkedFrom, 'parked'));

    if (departure) {
      legs.push(moveLeg(departure.push, departure.pushKnots, 'pushback', { reverse: true }));
      legs.push(holdLeg(departure.taxi.pointAt(0), departure.taxi.headingAt(0), departure.engineStart, 'engine-start'));
      legs.push(moveLeg(departure.taxi, departure.taxiKnots, 'taxi-out'));
      legs.push(holdLeg(departure.taxi.pointAt(departure.sHold), departure.taxi.headingAt(departure.sHold), departure.holdBase + plan.departureDelay, 'holding'));
      legs.push(moveLeg(departure.taxi, departure.lineupKnots, 'lineup'));
      legs.push(holdLeg(departure.roll.pointAt(0), departure.heading.runway, departure.lineupWait, 'lineup-wait'));
      legs.push(moveLeg(departure.roll, departure.rollKnots, 'takeoff'));
      legs.push(moveLeg(departure.climb, departure.climbKnots, 'climb', { air: true }));
    }

    const end = scheduleLegs(legs, start);
    return {
      visit,
      legs,
      tStart: legs[0].t0,
      tEnd: end,
      runwayIn: arrival?.runway ?? null,
      runwayOut: departure?.runway ?? null,
      landingTime: arrival ? plan.landingTime : null,
      takeoffTime: departure ? plan.takeoffTime : null,
      groundPaths: [arrival?.ground, departure?.push, departure?.taxi].filter(Boolean),
    };
  });

  const byId = new Map(tracks.map((track) => [track.visit.id, track]));

  // ------------------------------------------------------------ sampling
  function legAt(track, t) {
    const legs = track.legs;
    if (t < track.tStart || t >= track.tEnd) return null;
    let lo = 0;
    let hi = legs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (legs[mid].t0 <= t) lo = mid; else hi = mid - 1;
    }
    return legs[lo];
  }

  /** Full kinematic + lighting state of a visit at time t, or null when not visible. */
  function stateAt(track, t) {
    const leg = legAt(track, t);
    if (!leg) return null;
    const { visit } = track;
    let position;
    let heading;
    let speed = 0;
    let pitch = 0;
    let roll = 0;
    let phase = leg.phase;
    let opacity = 1;

    if (leg.kind === 'hold') {
      position = leg.point;
      heading = leg.heading;
    } else {
      const tau = t - leg.t0;
      const { s, v } = sampleProfile(leg.knots, tau);
      speed = v;
      position = leg.path.pointAt(s);
      heading = leg.path.headingAt(s, leg.air ? 40 : 5);
      if (leg.reverse) heading = (heading + 180) % 360;

      if (leg.phase === 'landing' || leg.phase === 'taxi-in') {
        phase = s < leg.sExit ? 'landing' : s > leg.sDock ? 'docking' : 'taxi-in';
        if (leg.phase === 'landing' && s < 140) pitch = 5.5 * (1 - smoothstep(0, 140, s));
      }
      if (leg.phase === 'takeoff') pitch = 8 * smoothstep(ROTATE_SPEED - 7, ROTATE_SPEED, v);
      if (leg.air) {
        const gradient = leg.path.gradientAt(s);
        pitch = leg.phase === 'approach' ? gradient + 5.5 : gradient + clamp(8 - ((v - ROTATE_SPEED) / 60) * 3, 4, 8);
        const span = 90;
        const h0 = leg.path.headingAt(s - span, 30);
        const h1 = leg.path.headingAt(s + span, 30);
        const turnRate = (headingDelta(h0, h1) * DEG) / ((2 * span) / Math.max(v, 30));
        roll = clamp(Math.atan((v * turnRate) / 9.81) / DEG, -28, 28);
        if (leg.phase === 'approach') opacity = smoothstep(0, 20, tau);
        if (leg.phase === 'climb') opacity = 1 - smoothstep(leg.duration - 25, leg.duration, tau);
      }
    }

    const altitude = position[2] ?? 0;
    const airborne = AIRBORNE.has(phase);
    const moving = phase !== 'parked';
    const sinceIn = visit.arrival ? t - visit.arrival.inBlock : Infinity;
    const untilOut = visit.departure ? visit.departure.offBlock - t : Infinity;
    const boarding = phase === 'parked' && ((untilOut >= 0 && untilOut < 45 * 60) || (sinceIn >= 0 && sinceIn < 15 * 60));

    return {
      track,
      visit,
      phase,
      position,
      heading,
      pitch,
      roll,
      speed,
      altitude,
      opacity,
      airborne,
      onGround: !airborne,
      gearDown: !airborne || (phase === 'approach' ? altitude < 650 : altitude < 140),
      lights: {
        beacon: moving,
        nav: moving || boarding,
        strobe: airborne || RUNWAY_PHASES.has(phase),
        landing: (airborne && altitude < 3000) || phase === 'takeoff' || phase === 'lineup-wait' || (phase === 'landing' && speed > 20),
        taxi: phase === 'taxi-in' || phase === 'taxi-out' || phase === 'lineup' || phase === 'holding' || phase === 'arrival-hold',
        cabin: moving || boarding,
      },
    };
  }

  // -------------------------------------------------------------- queries
  function activeAt(t) {
    const out = [];
    for (const track of tracks) {
      if (t < track.tStart || t >= track.tEnd) continue;
      const state = stateAt(track, t);
      if (state) out.push(state);
    }
    return out;
  }

  function summarize(states, t) {
    let airborne = 0;
    let taxiing = 0;
    let parked = 0;
    for (const s of states) {
      if (s.airborne) airborne += 1;
      else if (s.phase === 'parked') parked += 1;
      else if (TAXIING.has(s.phase)) taxiing += 1;
    }
    let landed = 0;
    let departed = 0;
    for (const track of tracks) {
      if (track.landingTime !== null && track.landingTime <= t) landed += 1;
      if (track.takeoffTime !== null && track.takeoffTime <= t) departed += 1;
    }
    return { airborne, taxiing, parked, landed, departed };
  }

  const BIN = 15 * 60;
  const histogram = Array.from({ length: DAY / BIN }, () => ({ arrivals: 0, departures: 0 }));
  for (const track of tracks) {
    if (track.landingTime !== null && track.landingTime >= 0) histogram[Math.floor(track.landingTime / BIN) % histogram.length].arrivals += 1;
    if (track.takeoffTime !== null && track.takeoffTime < DAY) histogram[Math.floor(track.takeoffTime / BIN) % histogram.length].departures += 1;
  }

  /** Upcoming/recent rows for a flight board. kind: 'departures' | 'arrivals'. */
  function board(t, kind, count = 8) {
    const rows = tracks
      .filter((track) => (kind === 'departures' ? track.visit.departure : track.visit.arrival))
      .map((track) => {
        const isDep = kind === 'departures';
        const leg = isDep ? track.visit.departure : track.visit.arrival;
        const scheduled = isDep ? leg.offBlock : leg.inBlock;
        const state = stateAt(track, t);
        let status;
        if (isDep) {
          if (track.takeoffTime <= t) status = 'Departed';
          else if (state && state.phase !== 'parked') status = PHASE_LABELS[state.phase];
          else if (scheduled - t < 40 * 60) status = 'Boarding';
          else status = 'Scheduled';
        } else if (scheduled <= t) status = 'At gate';
        else if (track.landingTime <= t) status = 'Landed';
        else if (state) status = 'Approach';
        else status = 'En route';
        return { track, scheduled, status, flight: leg.flight, airport: isDep ? leg.destination : leg.origin, gate: track.visit.gate, carrier: track.visit.carrier };
      })
      .filter((row) => (kind === 'departures' ? row.track.takeoffTime > t - 5 * 60 : row.scheduled > t - 8 * 60))
      .sort((a, b) => a.scheduled - b.scheduled);
    return rows.slice(0, count);
  }

  return {
    DAY,
    tracks,
    byId,
    stateAt,
    activeAt,
    summarize,
    histogram,
    histogramBin: BIN,
    board,
    totals: {
      arrivals: tracks.filter((t) => t.landingTime !== null).length,
      departures: tracks.filter((t) => t.takeoffTime !== null).length,
    },
  };
}
