// Geometry helpers shared by the simulation and the renderer.
//
// The simulation works in a local, right-handed frame measured in metres:
//   x = east, y = north, z = up, origin = BNA airport reference point.
// The conversion goes through Web Mercator (the same maths Mapbox uses for
// MercatorCoordinate), so anything placed in this frame lines up exactly with
// the basemap and with three.js objects rendered in the custom layer.

const EARTH_RADIUS = 6371008.8;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS;
const DEG = Math.PI / 180;

export const mercatorX = (lng) => (180 + lng) / 360;
export const mercatorY = (lat) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2))) / 360;
export const lngFromMercatorX = (x) => x * 360 - 180;
export const latFromMercatorY = (y) => (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;
/** Mercator units per metre at a latitude (Mapbox: meterInMercatorCoordinateUnits). */
export const mercatorUnitsPerMeter = (lat) => 1 / (EARTH_CIRCUMFERENCE * Math.cos(lat * DEG));

/** Create the local metric frame centred on `[lng, lat]`. */
export function createFrame([lng0, lat0]) {
  const ox = mercatorX(lng0);
  const oy = mercatorY(lat0);
  const s = mercatorUnitsPerMeter(lat0);
  return {
    origin: [lng0, lat0],
    mercatorOrigin: [ox, oy],
    /** Mercator units per local metre. */
    scale: s,
    toLocal: ([lng, lat]) => [(mercatorX(lng) - ox) / s, -(mercatorY(lat) - oy) / s],
    toLngLat: ([x, y]) => [lngFromMercatorX(ox + x * s), latFromMercatorY(oy - y * s)],
  };
}

// ---------------------------------------------------------------------------
// Small vector helpers. Points are plain arrays: [x, y] or [x, y, z].

export const add = (a, b) => a.map((v, i) => v + (b[i] ?? 0));
export const sub = (a, b) => a.map((v, i) => v - (b[i] ?? 0));
export const scale = (a, k) => a.map((v) => v * k);
export const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
export const len2 = (a) => Math.hypot(a[0], a[1]);
export const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0));
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpPoint = (a, b, t) => a.map((v, i) => v + ((b[i] ?? 0) - v) * t);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function norm2(a) {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
}

/** Unit vector for a compass heading in degrees (0 = north, 90 = east). */
export const headingVector = (deg) => [Math.sin(deg * DEG), Math.cos(deg * DEG)];
/** Compass heading in degrees [0, 360) of a 2D direction. */
export const vectorHeading = ([dx, dy]) => ((Math.atan2(dx, dy) / DEG) + 360) % 360;
/** Smallest signed difference b − a between two headings, in degrees. */
export const headingDelta = (a, b) => ((b - a + 540) % 360) - 180;

/** Closest point on segment ab to p, with its parameter t ∈ [0, 1] and distance. */
export function projectOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
  const point = [a[0] + dx * t, a[1] + dy * t];
  return { t, point, distance: dist2(p, point) };
}

/** Initial great-circle bearing from one [lng, lat] to another, in degrees. */
export function greatCircleBearing([lng1, lat1], [lng2, lat2]) {
  const φ1 = lat1 * DEG;
  const φ2 = lat2 * DEG;
  const Δλ = (lng2 - lng1) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Curves

/** Cubic Bézier through control points, sampled into `n` + 1 points (3D aware). */
export function cubicBezier(p0, p1, p2, p3, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push(p0.map((_, k) => a * p0[k] + b * (p1[k] ?? 0) + c * (p2[k] ?? 0) + d * (p3[k] ?? 0)));
  }
  return out;
}

/** Centripetal Catmull–Rom spline through `points` (2D or 3D), `steps` samples per span. */
export function catmullRom(points, steps = 24) {
  if (points.length < 3) return points.map((p) => [...p]);
  const pts = [
    points[0].map((v, i) => 2 * v - points[1][i]),
    ...points,
    points.at(-1).map((v, i) => 2 * v - points.at(-2)[i]),
  ];
  const out = [points[0].map((v) => v)];
  const tj = (ti, a, b) => ti + Math.max(1e-6, Math.sqrt(dist3(a, b)));
  for (let i = 1; i < pts.length - 2; i += 1) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    const t0 = 0;
    const t1 = tj(t0, p0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, p3);
    for (let s = 1; s <= steps; s += 1) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const point = p1.map((_, k) => {
        const a1 = ((t1 - t) / (t1 - t0)) * p0[k] + ((t - t0) / (t1 - t0)) * p1[k];
        const a2 = ((t2 - t) / (t2 - t1)) * p1[k] + ((t - t1) / (t2 - t1)) * p2[k];
        const a3 = ((t3 - t) / (t3 - t2)) * p2[k] + ((t - t2) / (t3 - t2)) * p3[k];
        const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
        return ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
      });
      out.push(point);
    }
  }
  return out;
}

/** Remove consecutive points closer than `epsilon` metres. */
export function dedupe(points, epsilon = 0.05) {
  const out = [];
  for (const p of points) {
    if (!out.length || dist3(out.at(-1), p) > epsilon) out.push(p);
  }
  return out;
}

/**
 * Round the corners of a polyline with circular-ish fillets so vehicles follow
 * smooth curves instead of snapping heading at every node.
 */
export function filletPolyline(points, radius = 30, minTurnDeg = 4) {
  const pts = dedupe(points.map(([x, y, z = 0]) => [x, y, z]));
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const ab = dist2(a, b);
    const bc = dist2(b, c);
    if (ab < 0.5 || bc < 0.5) {
      out.push(b);
      continue;
    }
    const u = norm2(sub(a, b));
    const v = norm2(sub(c, b));
    const turn = Math.PI - Math.acos(clamp(dot2(u, v), -1, 1));
    if (turn < minTurnDeg * DEG) {
      out.push(b);
      continue;
    }
    // Tangent length for the requested radius, limited so neighbouring fillets never overlap.
    const d = Math.min(radius * Math.tan(turn / 2), ab * 0.5, bc * 0.5);
    const p1 = [b[0] + u[0] * d, b[1] + u[1] * d, lerp(b[2], a[2], d / ab)];
    const p2 = [b[0] + v[0] * d, b[1] + v[1] * d, lerp(b[2], c[2], d / bc)];
    const steps = Math.max(3, Math.ceil(turn / (8 * DEG)));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const q = (1 - t) * (1 - t);
      const r = 2 * (1 - t) * t;
      const w = t * t;
      out.push([0, 1, 2].map((k) => q * p1[k] + r * b[k] + w * p2[k]));
    }
  }
  out.push(pts.at(-1));
  return dedupe(out);
}

// ---------------------------------------------------------------------------
// Path: a polyline with arc-length parameterisation.

export class Path {
  constructor(points) {
    this.points = dedupe(points.map((p) => (p.length === 2 ? [p[0], p[1], 0] : [...p])), 0.01);
    if (this.points.length === 1) this.points.push([...this.points[0]]);
    this.cumulative = [0];
    for (let i = 1; i < this.points.length; i += 1) {
      this.cumulative.push(this.cumulative[i - 1] + dist3(this.points[i - 1], this.points[i]));
    }
    this.length = this.cumulative.at(-1);
  }

  /** Index of the segment containing arc length `s`. */
  segmentAt(s) {
    const c = this.cumulative;
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Position [x, y, z] at arc length `s` (clamped to the path). */
  pointAt(s) {
    if (s <= 0) return [...this.points[0]];
    if (s >= this.length) return [...this.points.at(-1)];
    const i = this.segmentAt(s);
    const span = this.cumulative[i + 1] - this.cumulative[i] || 1;
    return lerpPoint(this.points[i], this.points[i + 1], (s - this.cumulative[i]) / span);
  }

  /** Smoothed horizontal direction of travel at `s`, as a compass heading. */
  headingAt(s, window = 6) {
    const a = this.pointAt(Math.max(0, s - window));
    const b = this.pointAt(Math.min(this.length, s + window));
    if (dist2(a, b) < 1e-3) {
      const n = this.points.length;
      return vectorHeading(sub(this.points[n - 1], this.points[Math.max(0, n - 2)]));
    }
    return vectorHeading(sub(b, a));
  }

  /** Flight-path angle in degrees at `s` (positive = climbing). */
  gradientAt(s, window = 30) {
    const a = this.pointAt(Math.max(0, s - window));
    const b = this.pointAt(Math.min(this.length, s + window));
    const h = dist2(a, b);
    return h < 1e-3 ? 0 : Math.atan2(b[2] - a[2], h) / DEG;
  }
}
