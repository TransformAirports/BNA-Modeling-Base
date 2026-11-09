// 24-hour timeline: sky-colour background, movement histogram, scrubbing.

import { formatClock } from '../sim/clock.js';

const DAY = 86400;

/** Sky colour for a sun elevation (degrees). */
function skyColor(elevation) {
  const stops = [
    [-90, [8, 12, 26]],
    [-14, [10, 15, 34]],
    [-7, [40, 32, 84]],
    [-2, [146, 78, 92]],
    [2, [214, 128, 78]],
    [8, [96, 140, 186]],
    [25, [52, 108, 168]],
    [90, [44, 98, 160]],
  ];
  for (let i = 1; i < stops.length; i += 1) {
    if (elevation <= stops[i][0]) {
      const [e0, c0] = stops[i - 1];
      const [e1, c1] = stops[i];
      const t = (elevation - e0) / (e1 - e0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
    }
  }
  return stops.at(-1)[1];
}

export function createTimeline({ root, histogram, elevationAt, onSeek }) {
  const canvas = root.querySelector('canvas');
  const playhead = root.querySelector('#playhead');
  const playheadLabel = root.querySelector('#playhead-label');
  const hover = root.querySelector('#hover-time');
  const ctx = canvas.getContext('2d');
  const sky = Array.from({ length: 145 }, (_, i) => skyColor(elevationAt((i / 144) * DAY)));
  const peak = Math.max(1, ...histogram.map((b) => Math.max(b.arrivals, b.departures)));
  let width = 0;
  let height = 0;

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    width = root.clientWidth;
    height = root.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const top = 18;
    const bottom = height - 16;
    const mid = (top + bottom) / 2;

    // Sky band.
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    sky.forEach(([r, g, b], i) => gradient.addColorStop(i / (sky.length - 1), `rgba(${r},${g},${b},0.85)`));
    ctx.fillStyle = gradient;
    roundRect(ctx, 0, top - 4, width, bottom - top + 8, 9);
    ctx.fill();
    const shade = ctx.createLinearGradient(0, top, 0, bottom);
    shade.addColorStop(0, 'rgba(6,10,20,0.15)');
    shade.addColorStop(0.5, 'rgba(6,10,20,0.45)');
    shade.addColorStop(1, 'rgba(6,10,20,0.15)');
    ctx.fillStyle = shade;
    ctx.fill();

    // Movement histogram: arrivals up, departures down.
    const n = histogram.length;
    const bw = width / n;
    const scale = (bottom - top) / 2 - 3;
    histogram.forEach((b, i) => {
      const x = i * bw + bw * 0.18;
      const w = Math.max(1, bw * 0.64);
      const ha = (b.arrivals / peak) * scale;
      const hd = (b.departures / peak) * scale;
      ctx.fillStyle = 'rgba(255,181,71,0.92)';
      roundRect(ctx, x, mid - ha - 1, w, ha, Math.min(2, w / 2));
      ctx.fill();
      ctx.fillStyle = 'rgba(91,224,255,0.92)';
      roundRect(ctx, x, mid + 1, w, hd, Math.min(2, w / 2));
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, mid - 0.5, width, 1);

    // Hour ticks and labels.
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h += 1) {
      const x = (h / 24) * width;
      ctx.fillStyle = h % 3 === 0 ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.12)';
      ctx.fillRect(Math.round(x), bottom + 3, 1, h % 3 === 0 ? 5 : 3);
      if (h % 3 === 0 && h < 24 && h > 0) {
        ctx.fillStyle = 'rgba(200,212,230,0.7)';
        ctx.fillText(String(h).padStart(2, '0'), x, height - 1);
      }
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    if (h <= 0) return;
    c.roundRect(x, y, w, h, Math.min(r, h / 2));
  }

  const timeFromEvent = (event) => {
    const rect = root.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return Math.round(f * (DAY - 1));
  };

  let dragging = false;
  root.addEventListener('pointerdown', (event) => {
    dragging = true;
    root.setPointerCapture(event.pointerId);
    onSeek(timeFromEvent(event));
  });
  root.addEventListener('pointermove', (event) => {
    const t = timeFromEvent(event);
    hover.hidden = false;
    hover.textContent = formatClock(t);
    hover.style.left = `${(t / DAY) * 100}%`;
    if (dragging) onSeek(t);
  });
  root.addEventListener('pointerup', () => { dragging = false; });
  root.addEventListener('pointerleave', () => { hover.hidden = true; });

  new ResizeObserver(draw).observe(root);
  draw();

  return {
    setTime(t) {
      playhead.style.left = `${(t / DAY) * 100}%`;
      playheadLabel.textContent = formatClock(t);
    },
    redraw: draw,
  };
}
