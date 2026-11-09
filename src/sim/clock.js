// Simulation clock: play/pause, speed and scrubbing over a 24-hour day.

export function createClock({ start = 0, speed = 60, loop = true, length = 86400 } = {}) {
  let time = start;
  let playing = false;
  let rate = speed;
  const listeners = new Set();
  const emit = (reason) => listeners.forEach((fn) => fn({ time, playing, speed: rate, reason }));

  const wrap = (t) => (loop ? ((t % length) + length) % length : Math.min(Math.max(t, 0), length - 1));

  return {
    get time() { return time; },
    get playing() { return playing; },
    get speed() { return rate; },
    /** Advance by `dtSeconds` of real time. */
    tick(dtSeconds) {
      if (!playing) return;
      const next = time + dtSeconds * rate;
      if (!loop && next >= length - 1) {
        time = length - 1;
        playing = false;
        emit('end');
        return;
      }
      time = wrap(next);
    },
    play() { playing = true; emit('play'); },
    pause() { playing = false; emit('pause'); },
    toggle() { playing = !playing; emit(playing ? 'play' : 'pause'); },
    setSpeed(value) { rate = value; emit('speed'); },
    seek(t) { time = wrap(t); emit('seek'); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/** "06:42" style label for seconds after midnight. */
export function formatClock(seconds, { withSeconds = false } = {}) {
  const s = ((Math.floor(seconds) % 86400) + 86400) % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}
