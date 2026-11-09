// Synthetic 24-hour gate schedule.
//
// The output is a list of *visits*: one aircraft's stay at one gate. A visit
// may start before midnight (parked overnight, departs in the morning) or end
// after it (arrives late, parks overnight). Times are seconds after local
// midnight in America/Chicago.
//
// This is deliberately simple and deterministic. To drive the view from a
// real schedule, produce the same visit objects from your data instead.

import { CARRIERS, AIRCRAFT_TYPES } from './fleet.js';
import { createRandom } from './random.js';

const HOUR = 3600;
const MIN = 60;

/**
 * @typedef {object} Visit
 * @property {string} id
 * @property {string} gate          Gate code, e.g. "C14".
 * @property {string} concourse
 * @property {string} carrier       Key into CARRIERS.
 * @property {string} type          Key into AIRCRAFT_TYPES.
 * @property {string} registration  Tail number.
 * @property {{flight: string, callsign: string, origin: string, inBlock: number} | null} arrival
 * @property {{flight: string, callsign: string, destination: string, offBlock: number} | null} departure
 */

function flightNumber(random, carrier, type, used) {
  const regional = type === 'E175' || type === 'CRJ9';
  const [lo, hi] = carrier === 'SWA' ? [100, 4999] : regional ? [3100, 5999] : [100, 2999];
  for (;;) {
    const n = random.int(lo, hi);
    const key = `${carrier}${n}`;
    if (!used.has(key)) {
      used.add(key);
      return n;
    }
  }
}

function registration(random, carrier) {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  if (carrier === 'ACA') return `C-F${letters[random.int(0, 22)]}${letters[random.int(0, 22)]}${letters[random.int(0, 22)]}`;
  const suffix = carrier === 'SWA' ? 'W' : letters[random.int(0, 22)];
  return `N${random.int(201, 989)}${random.int(0, 9)}${suffix}`;
}

function flightFields(random, carrierKey, type, used) {
  const carrier = CARRIERS[carrierKey];
  const n = flightNumber(random, carrierKey, type, used);
  return { flight: `${carrier.iata} ${n}`, callsign: `${carrier.icao}${n}` };
}

/**
 * Build the day's visits.
 * @param {{ gates: object, seed: string, config: object }} options
 *   gates: GeoJSON FeatureCollection with properties.code and properties.concourse.
 * @returns {Visit[]}
 */
export function generateSchedule({ gates, seed, config }) {
  const visits = [];
  const usedFlights = new Set();
  const codes = gates.features
    .map((f) => f.properties)
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

  for (const { code, concourse } of codes) {
    const random = createRandom(`${seed}:${code}`);
    const mix = config.concourseCarriers[concourse] ?? [['SWA', 1]];
    const pickAircraft = () => {
      const carrier = random.weighted(mix);
      const type = random.weighted(CARRIERS[carrier].fleet);
      return { carrier, type, registration: registration(random, carrier) };
    };
    const pickAirport = (carrier) => random.weighted(CARRIERS[carrier].destinations);
    let seq = 0;
    const push = (aircraft, arrival, departure) => {
      seq += 1;
      visits.push({ id: `${code}-${seq}`, gate: code, concourse, ...aircraft, arrival, departure });
    };

    const overnight = random.chance(config.overnightShare);
    const overnightAircraft = pickAircraft();
    let cursor;

    if (overnight) {
      // Parked since last night; leaves in the morning wave.
      const offBlock = Math.round(random.range(config.firstWave[0], config.firstWave[1]) * HOUR);
      push(overnightAircraft, null, {
        ...flightFields(random, overnightAircraft.carrier, overnightAircraft.type, usedFlights),
        destination: pickAirport(overnightAircraft.carrier),
        offBlock,
      });
      cursor = offBlock;
    } else {
      cursor = Math.round(random.range(5.6, 7.6) * HOUR);
    }

    // Daytime turns: arrive, turn, depart.
    for (;;) {
      const hour = cursor / HOUR;
      // Slightly longer idle gaps through the midday lull.
      const lull = hour > 10.5 && hour < 14.5 ? 1.35 : 1;
      const gap = random.range(config.gateGap[0], config.gateGap[1]) * lull * MIN;
      const aircraft = pickAircraft();
      const [tMin, tMax] = AIRCRAFT_TYPES[aircraft.type].turnMinutes;
      const inBlock = Math.round(cursor + gap);
      const offBlock = Math.round(inBlock + random.range(tMin, tMax) * MIN);
      if (offBlock > config.lastDeparture * HOUR) break;
      push(
        aircraft,
        { ...flightFields(random, aircraft.carrier, aircraft.type, usedFlights), origin: pickAirport(aircraft.carrier), inBlock },
        { ...flightFields(random, aircraft.carrier, aircraft.type, usedFlights), destination: pickAirport(aircraft.carrier), offBlock },
      );
      cursor = offBlock;
    }

    // Overnight arrival. Re-use the morning aircraft so midnight loops cleanly.
    if (overnight) {
      const earliest = Math.max(cursor + 20 * MIN, config.lastArrival[0] * HOUR);
      const latest = config.lastArrival[1] * HOUR;
      if (earliest < latest) {
        push(overnightAircraft, {
          ...flightFields(random, overnightAircraft.carrier, overnightAircraft.type, usedFlights),
          origin: pickAirport(overnightAircraft.carrier),
          inBlock: Math.round(random.range(earliest, latest)),
        }, null);
      }
    }
  }
  return visits;
}
