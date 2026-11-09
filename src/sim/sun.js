// Sun position and local-time helpers (after the SunCalc formulas).

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;

/** Sun azimuth (compass degrees, 0 = north) and elevation (degrees) at a UTC instant. */
export function sunPosition(utcMs, [lng, lat]) {
  const d = toDays(utcMs);
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) - RAD * -lng - ra;
  const phi = RAD * lat;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azimuthFromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuth: ((azimuthFromSouth / RAD) + 180 + 360) % 360, elevation: elevation / RAD };
}

/** Offset of `timeZone` from UTC at an instant, in milliseconds (America/Chicago in winter → −6 h). */
export function timeZoneOffset(utcMs, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** UTC milliseconds for `seconds` after local midnight on `isoDate` (YYYY-MM-DD) in `timeZone`. */
export function localToUtc(isoDate, seconds, timeZone) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d) + seconds * 1000;
  let utc = naive - timeZoneOffset(naive, timeZone);
  utc = naive - timeZoneOffset(utc, timeZone);
  return utc;
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Lighting conditions for a sim time: sun position, a 0–1 night factor, a 0–1
 * daylight factor, and the matching Mapbox Standard light preset.
 */
export function lightingAt({ isoDate, seconds, timeZone, position }) {
  return conditionsFor(sunPosition(localToUtc(isoDate, seconds, timeZone), position), seconds);
}

/** Fast per-frame version for one day: resolves the UTC offset once (ignores mid-day DST shifts). */
export function createDayLighting({ isoDate, timeZone, position }) {
  const midnightUtc = localToUtc(isoDate, 0, timeZone);
  return (seconds) => conditionsFor(sunPosition(midnightUtc + seconds * 1000, position), seconds);
}

function conditionsFor({ azimuth, elevation }, seconds) {
  const morning = seconds < 12 * 3600;
  let preset = 'day';
  if (elevation < -5) preset = 'night';
  else if (elevation < 7) preset = morning ? 'dawn' : 'dusk';
  return {
    sunAzimuth: azimuth,
    sunElevation: elevation,
    night: 1 - smooth(-7, 3, elevation),
    day: smooth(-4, 18, elevation),
    preset,
  };
}
