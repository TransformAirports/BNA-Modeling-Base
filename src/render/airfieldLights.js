// Static airfield lighting: runway edge/centreline/threshold/touchdown-zone
// lights, approach light systems with sequenced flashers, taxiway centreline
// and edge lights, and apron floodlight masts. Fades in at dusk.

import { createGlowPoints } from './glowPoints.js';
import { Path, add, scale } from '../sim/geo.js';

const WHITE = [1, 0.95, 0.85];
const RED = [1, 0.16, 0.1];
const GREEN = [0.25, 1, 0.45];
const TAXI_GREEN = [0.2, 1, 0.5];
const BLUE = [0.25, 0.45, 1];
const AMBER = [1, 0.72, 0.3];
const FLOOD = [1, 0.84, 0.62];

const RUNWAY_HALF_WIDTH = 23;

export function createAirfieldLights(airfield) {
  const lights = createGlowPoints({ capacity: 20000, minPx: 2.8, maxPx: 34 });

  for (const runway of airfield.runwayPairs) {
    const { A, length, dir } = runway;
    const right = [dir[1], -dir[0]];
    const at = (s, lateral) => add(add(A, scale(dir, s)), scale(right, lateral));

    // Edge lights every 60 m, centreline lights every 15 m (red toward each end).
    for (let s = 0; s <= length; s += 60) {
      for (const side of [-1, 1]) {
        const [x, y] = at(s, side * RUNWAY_HALF_WIDTH);
        lights.push(x, y, 0.4, s < 600 || s > length - 600 ? AMBER : WHITE, 3.2, 0.9);
      }
    }
    for (let s = 15; s < length; s += 15) {
      const [x, y] = at(s, 0);
      const fromEnd = Math.min(s, length - s);
      const color = fromEnd < 300 ? RED : fromEnd < 900 && Math.round(s / 15) % 2 ? RED : WHITE;
      lights.push(x, y, 0.2, color, 2.2, 0.75);
    }
    // Threshold / end bars.
    for (const [s, color] of [[0, GREEN], [length, GREEN], [-3, RED], [length + 3, RED]]) {
      for (let l = -RUNWAY_HALF_WIDTH; l <= RUNWAY_HALF_WIDTH; l += 3.5) {
        const [x, y] = at(s, l);
        lights.push(x, y, 0.3, color, 2.8, 1);
      }
    }
  }

  // Approach lights + touchdown zone for the primary instrument runways.
  for (const end of airfield.runwayEnds.values()) {
    if (end.id === '13' || end.id === '31') continue;
    const back = scale(end.dir, -1);
    const right = [end.dir[1], -end.dir[0]];
    const at = (s, lateral) => add(add(end.threshold, scale(back, s)), scale(right, lateral));
    const flashers = [];
    for (let s = 30; s <= 900; s += 30) {
      for (let l = -4; l <= 4; l += 2) {
        const [x, y] = at(s, l);
        lights.push(x, y, 0.6 + s * 0.005, WHITE, 2.6, 0.85);
      }
      if (s === 300) {
        for (let l = -15; l <= 15; l += 1.5) {
          const [x, y] = at(s, l);
          lights.push(x, y, 2, WHITE, 2.6, 0.9);
        }
      }
      if (s >= 330) flashers.push(s);
    }
    // Sequenced flashers ("the rabbit"): run toward the runway twice a second.
    flashers.sort((a, b) => b - a).forEach((s, i) => {
      const [x, y] = at(s, 0);
      lights.push(x, y, 2.5 + s * 0.005, [0.85, 0.92, 1], 9, 1.4, [2, -(i / flashers.length) * 0.8, 0.05]);
    });
    // Touchdown zone barrettes.
    for (let s = 60; s <= 900; s += 30) {
      for (const side of [-1, 1]) {
        for (let l = 0; l < 3; l += 1) {
          const [x, y] = add(add(end.threshold, scale(end.dir, s)), scale(right, side * (11 + l * 1.5)));
          lights.push(x, y, 0.2, WHITE, 1.8, 0.55);
        }
      }
    }
  }

  // Taxiway centreline (green) and edge (blue) lights.
  for (const line of airfield.taxiways) {
    if (line.length < 2) continue;
    const path = new Path(line);
    for (let s = 0; s <= path.length; s += 30) {
      const [x, y] = path.pointAt(s);
      lights.push(x, y, 0.15, TAXI_GREEN, 1.9, 0.75);
    }
    for (let s = 15; s <= path.length; s += 60) {
      const [x, y] = path.pointAt(s);
      const h = path.headingAt(s) * (Math.PI / 180);
      const right = [Math.cos(h), -Math.sin(h)];
      for (const side of [-1, 1]) lights.push(x + right[0] * side * 12, y + right[1] * side * 12, 0.4, BLUE, 2.1, 0.7);
    }
  }

  // Apron floodlight masts beside the stands.
  for (const stand of airfield.stands.values()) {
    const [x, y] = add(stand.leadStart, scale([stand.nose[1], -stand.nose[0]], 24));
    lights.push(x, y, 26, FLOOD, 7, 0.9);
  }

  lights.commit();
  return lights;
}
