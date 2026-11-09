// Airline liveries, painted onto canvases at runtime.
//
// Each carrier has a `body` painter (fuselage) and a `fin` painter (vertical
// tail), plus colours for engines and winglets. Painters work in friendly
// coordinates and the helpers below handle the texture mapping:
//
//   body: (s, θ) — s = metres back from the nose, θ = elevation angle around
//         the fuselage in degrees (−90 belly, 0 at the side, +90 crown).
//         Everything is painted on both sides; text reads correctly on each.
//   fin:  (c, h) — c = 0 trailing edge … 1 leading edge, h = 0 root … 1 tip.
//
// Colour layouts follow each airline's current scheme. Trademarked logo
// artwork is deliberately replaced with simple geometric motifs; titles are
// plain type. Swap in licensed artwork here if you have it.

const REGIONAL_TYPES = new Set(['E175', 'CRJ9']);

const FONTS = {
  sans: '"Helvetica Neue", Helvetica, "Inter Tight", Arial, sans-serif',
  geometric: '"Avenir Next", Avenir, Futura, "Helvetica Neue", Arial, sans-serif',
  rounded: '"Arial Rounded MT Bold", "Avenir Next", "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

export const FUSELAGE_TEXTURE = { around: 384, along: 1536 };
export const GLOW_TEXTURE = { around: 192, along: 768 };
export const FIN_TEXTURE = 512;

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ helpers

/** Fuselage painting surface. Canvas x = around the fuselage, y = along it (tail at top). */
function bodySurface(canvas, type) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const L = type.length;
  const D = type.diameter;
  const R = D / 2;
  const kL = H / L; // px per metre along
  const kA = W / (2 * Math.PI * R); // px per metre around
  const row = (s) => H * (1 - s / L);
  const col = (side, theta) => W * (side < 0 ? 0.25 + theta / 360 : 0.75 - theta / 360);

  const api = {
    ctx, W, H, L, D, R,
    fill(color) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
    },
    /** Polygon in (s, θ), painted on both sides. */
    region(points, color) {
      ctx.fillStyle = color;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        points.forEach(([s, theta], i) => (i ? ctx.lineTo(col(side, theta), row(s)) : ctx.moveTo(col(side, theta), row(s))));
        ctx.closePath();
        ctx.fill();
      }
    },
    outline(points, color, width = 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        points.forEach(([s, theta], i) => (i ? ctx.lineTo(col(side, theta), row(s)) : ctx.moveTo(col(side, theta), row(s))));
        ctx.closePath();
        ctx.stroke();
      }
    },
    rect(s0, s1, t0, t1, color) {
      api.region([[s0, t0], [s1, t0], [s1, t1], [s0, t1]], color);
    },
    /** Full-length band between two elevation angles. */
    band(t0, t1, color) {
      api.rect(-1, L + 1, t0, t1, color);
    },
    /** Everything between two boundary curves θ = lower(s) … upper(s). */
    between(lower, upper, color, s0 = -1, s1 = L + 1, step = 0.25) {
      const pts = [];
      for (let s = s0; s <= s1 + 1e-6; s += step) pts.push([s, upper(s)]);
      for (let s = s1; s >= s0 - 1e-6; s -= step) pts.push([s, lower(s)]);
      api.region(pts, color);
    },
    /** Text centred at (s, θ), `size` metres tall, reading nose-to-tail on the left and tail-to-nose on the right. */
    text(str, { s, theta, size, color, font = FONTS.sans, weight = 700, style = '', spacing = 0, maxWidth = L * 0.42 }) {
      for (const side of [-1, 1]) {
        ctx.save();
        const k = side < 0 ? -1 : 1;
        ctx.setTransform(0, (k * kL) / 100, (k * kA) / 100, 0, col(side, theta), row(s));
        ctx.font = `${style} ${weight} ${Math.round(size * 100)}px ${font}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(spacing * 100)}px`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(str, 0, 0, maxWidth * 100);
        ctx.restore();
      }
    },
  };
  return api;
}

/** Fin painting surface mapped onto the fin's real outline. */
function finSurface(canvas, shape) {
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  const { finTE, finRootLE, tipLE, tipTE, base, height, aMin, aMax, bMin, bMax } = shape;
  const toCanvas = (a, b) => [((a - aMin) / (aMax - aMin)) * S, (1 - (b - bMin) / (bMax - bMin)) * S];
  const point = (c, h) => {
    const te = finTE + (tipTE - finTE) * h;
    const le = finRootLE + (tipLE - finRootLE) * h;
    return [te + (le - te) * c, base + height * h];
  };
  const at = (c, h) => toCanvas(...point(c, h));
  const api = {
    ctx, S,
    fill(color) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, S, S);
    },
    poly(points, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      points.forEach(([c, h], i) => (i ? ctx.lineTo(...at(c, h)) : ctx.moveTo(...at(c, h))));
      ctx.closePath();
      ctx.fill();
    },
    /** A band from (c0, h0) to (c1, h1), `width` thick in h. Extends past the edges so it reaches the outline. */
    stripe(c0, h0, c1, h1, width, color) {
      api.poly([[c0, h0], [c1, h1], [c1, h1 + width], [c0, h0 + width]], color);
    },
    /** Ellipse of `radius` metres centred at (c, h), undistorted on the fin. */
    disc(c, h, radius, color) {
      const [x, y] = at(c, h);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, (radius / (aMax - aMin)) * S, (radius / (bMax - bMin)) * S, 0, 0, Math.PI * 2);
      ctx.fill();
    },
    /** Polygon in metres around (c, h), e.g. a symbol. */
    shapeAt(c, h, points, scale, color) {
      const [a0, b0] = point(c, h);
      ctx.fillStyle = color;
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(...toCanvas(a0 + x * scale, b0 + y * scale)) : ctx.moveTo(...toCanvas(a0 + x * scale, b0 + y * scale))));
      ctx.closePath();
      ctx.fill();
    },
    clipDisc(c, h, radius) {
      const [x, y] = at(c, h);
      ctx.beginPath();
      ctx.ellipse(x, y, (radius / (aMax - aMin)) * S, (radius / (bMax - bMin)) * S, 0, 0, Math.PI * 2);
      ctx.clip();
    },
    meanChord: ((finRootLE - finTE) + (tipLE - tipTE)) / 2,
  };
  return api;
}

// A simple 11-point maple leaf (as on the Canadian flag), unit height ≈ 2.
const MAPLE_LEAF = (() => {
  const half = [[0, 1], [0.12, 0.74], [0.3, 0.82], [0.22, 0.4], [0.44, 0.62], [0.5, 0.48], [0.74, 0.54], [0.62, 0.3], [0.8, 0.22], [0.42, -0.06], [0.5, -0.24], [0.06, -0.16], [0.05, -0.62]];
  return [...half, ...half.slice(1).reverse().map(([x, y]) => [-x, y])];
})();

// ------------------------------------------------------------------ liveries

/**
 * @typedef {object} Livery
 * @property {string} title          Fuselage title for mainline aircraft.
 * @property {string} [regional]     Title on regional jets (E175, CRJ900).
 * @property {string} engine         Nacelle colour.
 * @property {string} winglet        Winglet colour.
 * @property {boolean} [metal]       Polished/metallic finish.
 * @property {(p: object, ctx: object) => void} body
 * @property {(f: object) => void} fin
 */

/** @type {Record<string, Livery>} */
export const LIVERIES = {
  SWA: {
    title: 'Southwest',
    engine: '#304cb2',
    winglet: '#304cb2',
    body(p, { title }) {
      const BLUE = '#304cb2';
      p.fill(BLUE);
      // Red and yellow belly stripes that sweep up toward the tail.
      const rise = (s) => 64 * smooth(p.L * 0.55, p.L * 0.98, s);
      p.between((s) => -62 + rise(s), (s) => -52 + rise(s), '#c8102e', p.L * 0.12, p.L + 1);
      p.between((s) => -52 + rise(s), (s) => -44 + rise(s), '#ffbf27', p.L * 0.12, p.L + 1);
      p.text(title, { s: p.L * 0.34, theta: 30, size: 1.35, color: '#ffffff', weight: 800, font: FONTS.sans });
    },
    fin(f) {
      f.fill('#304cb2');
      f.stripe(1.3, -0.25, -0.2, 0.62, 0.14, '#c8102e');
      f.stripe(1.3, -0.11, -0.2, 0.76, 0.12, '#ffbf27');
    },
  },

  AAL: {
    title: 'American',
    regional: 'American Eagle',
    engine: '#d3d8dd',
    winglet: '#d3d8dd',
    metal: true,
    body(p, { title }) {
      p.fill('#d3d8dd');
      p.text(title, { s: p.L * 0.3, theta: 30, size: 1.05, color: '#36495a', weight: 600, font: FONTS.geometric, spacing: 0.02 });
    },
    fin(f) {
      f.fill('#0078d2');
      f.poly([[1.4, 0.55], [1.4, 1.4], [-0.4, 1.4], [-0.4, 0.55]], '#36495a');
      // Flag stripes across the rear half of the fin.
      const stripes = ['#c30019', '#f2f3f5', '#c30019', '#f2f3f5', '#c30019'];
      stripes.forEach((color, i) => {
        const c0 = -0.05 + i * 0.105;
        f.poly([[c0, -0.3], [c0 + 0.105, -0.3], [c0 + 0.105, 1.4], [c0, 1.4]], color);
      });
    },
  },

  DAL: {
    title: 'DELTA',
    regional: 'DELTA CONNECTION',
    engine: '#0b2a5b',
    winglet: '#0b2a5b',
    body(p, { title, regional }) {
      p.fill('#f5f6f8');
      const split = (s) => -16 + 18 * smooth(p.L * 0.62, p.L, s);
      p.between(() => -91, split, '#0b2a5b');
      p.text(title, { s: p.L * 0.3, theta: 30, size: regional ? 0.8 : 1.15, color: '#0b2a5b', weight: 800, font: FONTS.geometric, spacing: regional ? 0.1 : 0.32 });
    },
    fin(f) {
      f.fill('#c8102e');
      // Two-tone red, split on the diagonal.
      f.poly([[1.3, -0.2], [1.3, 1.3], [-0.3, 1.3]], '#98002e');
    },
  },

  UAL: {
    title: 'UNITED',
    regional: 'UNITED EXPRESS',
    engine: '#0b2f6b',
    winglet: '#0b2f6b',
    body(p, { title, regional }) {
      p.fill('#f6f7f9');
      p.band(-91, -14, '#0b2f6b');
      p.band(-14, -10.5, '#5e9fdf');
      p.text(title, { s: p.L * 0.31, theta: 30, size: regional ? 0.82 : 1.2, color: '#0b2f6b', weight: 800, font: FONTS.sans, spacing: regional ? 0.08 : 0.16 });
    },
    fin(f) {
      f.fill('#0b2f6b');
      // A simple striped globe motif.
      const r = f.meanChord * 0.34;
      f.disc(0.55, 0.52, r, '#5e9fdf');
      f.ctx.save();
      f.clipDisc(0.55, 0.52, r);
      for (let i = 0; i < 5; i += 1) f.stripe(-0.2, 0.3 + i * 0.09, 1.3, 0.26 + i * 0.09, 0.035, '#0b2f6b');
      f.ctx.restore();
    },
  },

  ASA: {
    title: 'Alaska',
    engine: '#01426a',
    winglet: '#01426a',
    body(p, { title }) {
      p.fill('#f6f7f9');
      // Teal and green swooshes rising into the tail.
      const rise = (s) => 75 * smooth(p.L * 0.7, p.L, s);
      p.between((s) => -40 + rise(s), (s) => -32 + rise(s), '#48b9c7', p.L * 0.7, p.L + 1);
      p.between((s) => -48 + rise(s), (s) => -40 + rise(s), '#8dc63f', p.L * 0.74, p.L + 1);
      p.text(title, { s: p.L * 0.3, theta: 30, size: 1.4, color: '#01426a', weight: 700, style: 'italic', font: FONTS.serif });
    },
    fin(f) {
      f.fill('#01426a');
      f.stripe(-0.3, -0.05, 1.3, 0.32, 0.1, '#48b9c7');
      f.stripe(-0.3, -0.16, 1.3, 0.21, 0.1, '#8dc63f');
      f.disc(0.52, 0.62, f.meanChord * 0.28, '#00385f');
    },
  },

  JBU: {
    title: 'jetBlue',
    engine: '#0c2a6e',
    winglet: '#0c2a6e',
    body(p, { title }) {
      p.fill('#f6f7f9');
      p.band(-91, -22, '#0c2a6e');
      p.text(title, { s: p.L * 0.3, theta: 28, size: 1.5, color: '#0c2a6e', weight: 800, font: FONTS.rounded });
    },
    fin(f) {
      f.fill('#0c2a6e');
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 6; col += 1) {
          if ((row + col) % 2) continue;
          const c = 0.12 + col * 0.14;
          const h = 0.12 + row * 0.11;
          f.poly([[c, h], [c + 0.14, h], [c + 0.14, h + 0.11], [c, h + 0.11]], '#2f6fd1');
        }
      }
    },
  },

  NKS: {
    title: 'spirit',
    engine: '#1d1d1b',
    winglet: '#ffe500',
    body(p, { title }) {
      p.fill('#ffe500');
      p.text(title, { s: p.L * 0.36, theta: 24, size: 1.9, color: '#1d1d1b', weight: 900, font: FONTS.sans });
    },
    fin(f) {
      f.fill('#ffe500');
      f.stripe(-0.3, -0.3, 1.3, 0.1, 0.26, '#1d1d1b');
    },
  },

  FFT: {
    title: 'FRONTIER',
    engine: '#006341',
    winglet: '#006341',
    body(p, { title }) {
      p.fill('#f6f7f9');
      const split = (s) => -34 + 30 * smooth(p.L * 0.68, p.L, s);
      p.between(() => -91, split, '#006341');
      p.text(title, { s: p.L * 0.31, theta: 29, size: 1.0, color: '#006341', weight: 700, font: FONTS.geometric, spacing: 0.22 });
    },
    fin(f) {
      f.fill('#006341');
      f.disc(0.5, 0.52, f.meanChord * 0.36, '#7dbb42');
      f.disc(0.5, 0.52, f.meanChord * 0.24, '#f6f7f9');
    },
  },

  ACA: {
    title: 'AIR CANADA',
    regional: 'AIR CANADA EXPRESS',
    engine: '#1d1d1b',
    winglet: '#1d1d1b',
    body(p, { title, regional }) {
      p.fill('#f6f7f9');
      p.band(-91, -16, '#1d1d1b');
      p.text(title, { s: p.L * 0.31, theta: 30, size: regional ? 0.75 : 0.95, color: '#1d1d1b', weight: 700, font: FONTS.geometric, spacing: 0.16 });
    },
    fin(f) {
      f.fill('#1d1d1b');
      f.shapeAt(0.5, 0.52, MAPLE_LEAF, f.meanChord * 0.3, '#d71920');
    },
  },
};

const FALLBACK = {
  title: '', engine: '#c9ced4', winglet: '#c9ced4',
  body(p) { p.fill('#f6f7f9'); },
  fin(f) { f.fill('#8a94a3'); },
};

export const liveryFor = (carrierKey) => LIVERIES[carrierKey] ?? FALLBACK;

// ------------------------------------------------------------------ painting

/** Details every airliner shares: windows, doors, cockpit glazing, radome, belly shading. */
function paintCommon(p, glow, type, livery) {
  const { L, D } = p;
  const dark = 'rgba(16,20,28,0.95)';

  // Subtle shading toward the belly (reads as ambient occlusion).
  p.between(() => -91, () => -60, 'rgba(0,0,0,0.10)');
  p.between(() => -91, () => -75, 'rgba(0,0,0,0.08)');

  // Cabin windows (glow canvas lights them at night).
  const first = D * 1.85 + 1.2;
  const last = L * 0.74;
  for (let s = first; s < last; s += 0.53) {
    if (Math.abs(s - L * 0.47) < 0.45) continue; // over-wing exits
    p.rect(s - 0.12, s + 0.12, 7, 15, dark);
    glow.rect(s - 0.12, s + 0.12, 7, 15, '#ffd28a');
  }

  // Doors: fore and aft.
  for (const s of [D * 1.85 + 0.2, L * 0.79]) p.outline([[s - 0.45, -14], [s + 0.45, -14], [s + 0.45, 28], [s - 0.45, 28]], 'rgba(0,0,0,0.35)', 1.2);
  // Over-wing exits.
  p.outline([[L * 0.47 - 0.3, 2], [L * 0.47 + 0.3, 2], [L * 0.47 + 0.3, 18], [L * 0.47 - 0.3, 18]], 'rgba(0,0,0,0.22)', 1);

  // Cockpit side windows and windscreen.
  const c0 = D * 0.6;
  const c1 = D * 1.0;
  p.region([[c0, 16], [c1, 16], [c1 + 0.1, 30], [c0 + 0.25, 38]], '#0e1219');
  glow.region([[c0, 16], [c1, 16], [c1 + 0.1, 30], [c0 + 0.25, 38]], '#23344e');
  p.region([[D * 0.42, 22], [c0, 18], [c0 + 0.25, 40], [D * 0.42, 50]], '#0e1219');

  // Radome.
  p.rect(-1, 0.55, -91, 91, livery.metal ? '#9aa1a8' : 'rgba(30,34,40,0.18)');
}

/** Fuselage colour + window-glow canvases for one type and carrier. */
export function paintFuselage(typeKey, type, carrierKey) {
  const livery = liveryFor(carrierKey);
  const make = ({ around, along }) => {
    const canvas = document.createElement('canvas');
    canvas.width = around;
    canvas.height = along;
    return canvas;
  };
  const canvas = make(FUSELAGE_TEXTURE);
  const glowCanvas = make(GLOW_TEXTURE);
  const p = bodySurface(canvas, type);
  const glow = bodySurface(glowCanvas, type);
  glow.fill('#000');
  const regional = REGIONAL_TYPES.has(typeKey);
  const title = (regional && livery.regional) || livery.title;
  livery.body(p, { title, regional, type });
  paintCommon(p, glow, type, livery);
  return { canvas, glowCanvas };
}

/** Fin canvas for one carrier, mapped onto `shape` (see finShape in aircraftModels.js). */
export function paintFin(carrierKey, shape) {
  const canvas = document.createElement('canvas');
  canvas.width = FIN_TEXTURE;
  canvas.height = FIN_TEXTURE;
  const f = finSurface(canvas, shape);
  liveryFor(carrierKey).fin(f);
  return canvas;
}
