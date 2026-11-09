// Motion primitives: speed profiles along paths and timed legs.
//
// A visit's trajectory is a list of legs laid end to end in time:
//   { kind: 'move', path, s0, s1, knots, phase, ... }  travel along part of a Path
//   { kind: 'hold', point, heading, phase, ... }       stay put
// Every leg has absolute start/end times t0/t1 in seconds after midnight, so
// the state at any time is a pure function: scrubbing is free.

import { clamp, headingDelta } from './geo.js';

/**
 * Speed profile along `path` between arc lengths s0 and s1. Returns knots
 * [{ s, v, t }] with constant acceleration between consecutive knots.
 *
 * options:
 *   vStart, vEnd   speeds at the ends (m/s)
 *   vMax           speed cap, number or (s) => number
 *   accel, decel   m/s², number or (s) => number
 *   latAccel       lateral acceleration limit for turns (m/s²); 0 disables
 *   step           sample spacing in metres
 */
export function speedProfile(path, s0, s1, {
  vStart = 0, vEnd = 0, vMax = 8, accel = 0.6, decel = 0.8, latAccel = 0.9, step = 8,
} = {}) {
  const fn = (x) => (typeof x === 'function' ? x : () => x);
  const vMaxAt = fn(vMax);
  const accelAt = fn(accel);
  const decelAt = fn(decel);
  const total = Math.max(0, s1 - s0);
  const count = Math.max(1, Math.ceil(total / step));
  const s = Array.from({ length: count + 1 }, (_, i) => s0 + (total * i) / count);

  // Speed limit from curvature: v = sqrt(a_lat · r).
  const limit = s.map((si) => {
    let v = vMaxAt(si);
    if (latAccel > 0) {
      const h0 = path.headingAt(si - 10, 4);
      const h1 = path.headingAt(si + 10, 4);
      const turn = Math.abs(headingDelta(h0, h1)) * (Math.PI / 180);
      if (turn > 1e-3) v = Math.min(v, Math.sqrt(latAccel * (20 / turn)));
    }
    return v;
  });

  const v = limit.slice();
  v[0] = Math.min(vStart, limit[0]);
  v[count] = Math.min(vEnd, limit[count]);
  if (vStart > limit[0]) v[0] = vStart; // allow entering faster (e.g. touchdown), decel handles it
  for (let i = 1; i <= count; i += 1) {
    const ds = s[i] - s[i - 1];
    v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * accelAt(s[i]) * ds));
  }
  v[count] = Math.min(v[count], vEnd);
  for (let i = count - 1; i >= 0; i -= 1) {
    const ds = s[i + 1] - s[i];
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * decelAt(s[i]) * ds));
  }
  // Interior knots must keep moving or the time integral blows up.
  for (let i = 1; i < count; i += 1) v[i] = Math.max(v[i], 0.4);
  if (count >= 1 && v[0] === 0 && v[1] === 0) v[1] = 0.4;

  const knots = [{ s: s[0], v: v[0], t: 0 }];
  for (let i = 1; i <= count; i += 1) {
    const ds = s[i] - s[i - 1];
    const vm = (v[i - 1] + v[i]) / 2;
    knots.push({ s: s[i], v: v[i], t: knots[i - 1].t + (vm > 1e-6 ? ds / vm : 0) });
  }
  return knots;
}

/** Profile from explicit speed knots [{ s, v }] (constant acceleration in between). */
export function knotProfile(points) {
  const knots = [{ ...points[0], t: 0 }];
  for (let i = 1; i < points.length; i += 1) {
    const ds = points[i].s - points[i - 1].s;
    const vm = Math.max(0.1, (points[i - 1].v + points[i].v) / 2);
    knots.push({ ...points[i], t: knots[i - 1].t + ds / vm });
  }
  return knots;
}

export const profileDuration = (knots) => knots.at(-1).t;

/** Arc length and speed `tau` seconds into a profile. */
export function sampleProfile(knots, tau) {
  if (tau <= 0) return { s: knots[0].s, v: knots[0].v };
  const last = knots.at(-1);
  if (tau >= last.t) return { s: last.s, v: last.v };
  let lo = 0;
  let hi = knots.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (knots[mid].t <= tau) lo = mid; else hi = mid;
  }
  const a = knots[lo];
  const b = knots[hi];
  const dt = b.t - a.t || 1e-6;
  const acc = (b.v - a.v) / dt;
  const x = tau - a.t;
  return { s: clamp(a.s + a.v * x + 0.5 * acc * x * x, a.s, b.s), v: a.v + acc * x };
}

/** Lay legs end to end starting at `t0`; returns the end time. */
export function scheduleLegs(legs, t0) {
  let t = t0;
  for (const leg of legs) {
    leg.t0 = t;
    leg.t1 = t + leg.duration;
    t = leg.t1;
  }
  return t;
}

export function moveLeg(path, knots, phase, extra = {}) {
  return { kind: 'move', path, knots, phase, duration: profileDuration(knots), ...extra };
}

export function holdLeg(point, heading, duration, phase, extra = {}) {
  return { kind: 'hold', point: [...point, 0].slice(0, 3), heading, duration: Math.max(0, duration), phase, ...extra };
}
