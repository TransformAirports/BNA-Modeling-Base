// Aircraft types and carriers used by the synthetic schedule and the 3D models.
//
// Dimensions are in metres and approximate the real airframes closely enough
// for a convincing silhouette. The renderer builds every model procedurally
// from these numbers, so adding a type here is enough to get a new 3D model.

/**
 * @typedef {object} AircraftType
 * @property {string} name        Display name.
 * @property {number} length      Overall length.
 * @property {number} span        Wingspan including winglets.
 * @property {number} diameter    Fuselage diameter.
 * @property {number} gearHeight  Ground to fuselage bottom.
 * @property {number} [nose]      Nose-cone length in fuselage diameters (Boeing ≈ 1.95, Airbus ≈ 1.55).
 * @property {object} wing        rootChord, tipChord, sweep (deg), dihedral (deg), apex (fraction of length from nose to wing-root leading edge).
 * @property {object} fin         height (above fuselage top), rootChord, tipChord, sweep.
 * @property {object} stab        span, rootChord, tipChord, sweep, tTail.
 * @property {object} engine      mount ('wing' | 'tail'), radius, length, spanFraction.
 * @property {string} winglet     'blended' | 'scimitar' | 'sharklet' | 'raked' | 'none'.
 * @property {[number, number]} turnMinutes  Typical gate turn range.
 */

/** @type {Record<string, AircraftType>} */
export const AIRCRAFT_TYPES = {
  B737: {
    name: 'Boeing 737-700', length: 33.6, span: 35.8, diameter: 3.76, gearHeight: 1.25, nose: 1.95,
    wing: { rootChord: 7.2, tipChord: 1.6, sweep: 27, dihedral: 6, apex: 0.36 },
    fin: { height: 6.6, rootChord: 6.4, tipChord: 2.0, sweep: 38 },
    stab: { span: 14.4, rootChord: 3.6, tipChord: 1.2, sweep: 32, tTail: false },
    engine: { mount: 'wing', radius: 1.02, length: 4.4, spanFraction: 0.28 },
    winglet: 'blended', turnMinutes: [40, 60],
  },
  B738: {
    name: 'Boeing 737-800', length: 39.5, span: 35.8, diameter: 3.76, gearHeight: 1.25, nose: 1.95,
    wing: { rootChord: 7.3, tipChord: 1.6, sweep: 27, dihedral: 6, apex: 0.37 },
    fin: { height: 6.8, rootChord: 6.6, tipChord: 2.0, sweep: 38 },
    stab: { span: 14.4, rootChord: 3.7, tipChord: 1.2, sweep: 32, tTail: false },
    engine: { mount: 'wing', radius: 1.02, length: 4.4, spanFraction: 0.28 },
    winglet: 'blended', turnMinutes: [45, 65],
  },
  B38M: {
    name: 'Boeing 737 MAX 8', length: 39.5, span: 35.9, diameter: 3.76, gearHeight: 1.3, nose: 1.95,
    wing: { rootChord: 7.3, tipChord: 1.6, sweep: 27, dihedral: 6, apex: 0.37 },
    fin: { height: 7.0, rootChord: 6.6, tipChord: 2.0, sweep: 38 },
    stab: { span: 14.4, rootChord: 3.7, tipChord: 1.2, sweep: 32, tTail: false },
    engine: { mount: 'wing', radius: 1.1, length: 4.9, spanFraction: 0.28 },
    winglet: 'scimitar', turnMinutes: [45, 65],
  },
  B739: {
    name: 'Boeing 737-900ER', length: 42.1, span: 35.8, diameter: 3.76, gearHeight: 1.25, nose: 1.95,
    wing: { rootChord: 7.3, tipChord: 1.6, sweep: 27, dihedral: 6, apex: 0.38 },
    fin: { height: 6.8, rootChord: 6.6, tipChord: 2.0, sweep: 38 },
    stab: { span: 14.4, rootChord: 3.7, tipChord: 1.2, sweep: 32, tTail: false },
    engine: { mount: 'wing', radius: 1.02, length: 4.4, spanFraction: 0.28 },
    winglet: 'blended', turnMinutes: [55, 80],
  },
  A319: {
    name: 'Airbus A319', length: 33.8, span: 35.8, diameter: 3.95, gearHeight: 1.75, nose: 1.55,
    wing: { rootChord: 7.0, tipChord: 1.5, sweep: 25, dihedral: 5, apex: 0.36 },
    fin: { height: 6.0, rootChord: 6.2, tipChord: 2.3, sweep: 34 },
    stab: { span: 12.5, rootChord: 3.4, tipChord: 1.3, sweep: 29, tTail: false },
    engine: { mount: 'wing', radius: 1.1, length: 4.6, spanFraction: 0.32 },
    winglet: 'sharklet', turnMinutes: [45, 65],
  },
  A320: {
    name: 'Airbus A320', length: 37.6, span: 35.8, diameter: 3.95, gearHeight: 1.75, nose: 1.55,
    wing: { rootChord: 7.0, tipChord: 1.5, sweep: 25, dihedral: 5, apex: 0.37 },
    fin: { height: 6.0, rootChord: 6.2, tipChord: 2.3, sweep: 34 },
    stab: { span: 12.5, rootChord: 3.4, tipChord: 1.3, sweep: 29, tTail: false },
    engine: { mount: 'wing', radius: 1.1, length: 4.6, spanFraction: 0.32 },
    winglet: 'sharklet', turnMinutes: [50, 70],
  },
  A321: {
    name: 'Airbus A321neo', length: 44.5, span: 35.8, diameter: 3.95, gearHeight: 1.8, nose: 1.55,
    wing: { rootChord: 7.2, tipChord: 1.5, sweep: 25, dihedral: 5, apex: 0.39 },
    fin: { height: 6.0, rootChord: 6.2, tipChord: 2.3, sweep: 34 },
    stab: { span: 12.5, rootChord: 3.4, tipChord: 1.3, sweep: 29, tTail: false },
    engine: { mount: 'wing', radius: 1.2, length: 5.0, spanFraction: 0.32 },
    winglet: 'sharklet', turnMinutes: [55, 80],
  },
  BCS3: {
    name: 'Airbus A220-300', length: 38.7, span: 35.1, diameter: 3.5, gearHeight: 1.55, nose: 1.7,
    wing: { rootChord: 6.6, tipChord: 1.4, sweep: 26, dihedral: 5, apex: 0.38 },
    fin: { height: 6.4, rootChord: 6.0, tipChord: 2.4, sweep: 36 },
    stab: { span: 12.0, rootChord: 3.2, tipChord: 1.2, sweep: 30, tTail: false },
    engine: { mount: 'wing', radius: 1.08, length: 4.6, spanFraction: 0.31 },
    winglet: 'raked', turnMinutes: [45, 65],
  },
  E175: {
    name: 'Embraer 175', length: 31.7, span: 26.0, diameter: 3.0, gearHeight: 1.2, nose: 1.75,
    wing: { rootChord: 5.6, tipChord: 1.3, sweep: 25, dihedral: 5, apex: 0.38 },
    fin: { height: 5.0, rootChord: 5.2, tipChord: 2.1, sweep: 38 },
    stab: { span: 10.0, rootChord: 2.8, tipChord: 1.0, sweep: 30, tTail: false },
    engine: { mount: 'wing', radius: 0.8, length: 3.4, spanFraction: 0.3 },
    winglet: 'sharklet', turnMinutes: [40, 55],
  },
  CRJ9: {
    name: 'Bombardier CRJ900', length: 36.2, span: 24.9, diameter: 2.7, gearHeight: 1.05, nose: 2.1,
    wing: { rootChord: 5.0, tipChord: 1.2, sweep: 27, dihedral: 4, apex: 0.44 },
    fin: { height: 4.6, rootChord: 5.4, tipChord: 2.6, sweep: 40 },
    stab: { span: 8.5, rootChord: 2.4, tipChord: 1.0, sweep: 32, tTail: true },
    engine: { mount: 'tail', radius: 0.68, length: 3.6, spanFraction: 0 },
    winglet: 'small', turnMinutes: [40, 55],
  },
};

/**
 * Carriers: identity, fleet mix and route network. `ui` is a bright swatch
 * that reads on the dark interface. Paint schemes live in
 * src/render/liveries.js (keyed by the same carrier code).
 */
export const CARRIERS = {
  SWA: {
    name: 'Southwest', iata: 'WN', icao: 'SWA', callsign: 'SOUTHWEST', ui: '#ffbf27',
    fleet: [['B737', 3], ['B738', 3], ['B38M', 4]],
    destinations: [['MDW', 4], ['DEN', 4], ['BWI', 4], ['DAL', 3], ['HOU', 3], ['LAS', 3], ['PHX', 3], ['MCO', 4], ['TPA', 3], ['FLL', 2], ['ATL', 2], ['AUS', 2], ['MSY', 2], ['STL', 2], ['LAX', 2], ['SAN', 1], ['OAK', 1], ['PNS', 1], ['ECP', 1], ['RSW', 2], ['MKE', 1], ['CMH', 1], ['IND', 1], ['SAT', 1], ['CHS', 1]],
  },
  AAL: {
    name: 'American', iata: 'AA', icao: 'AAL', callsign: 'AMERICAN', ui: '#ff5468',
    fleet: [['A321', 3], ['A319', 2], ['B738', 3], ['E175', 3], ['CRJ9', 2]],
    destinations: [['DFW', 6], ['CLT', 5], ['ORD', 3], ['PHL', 3], ['MIA', 3], ['DCA', 3], ['LGA', 2], ['PHX', 1]],
  },
  DAL: {
    name: 'Delta', iata: 'DL', icao: 'DAL', callsign: 'DELTA', ui: '#ff4057',
    fleet: [['A321', 2], ['B739', 2], ['BCS3', 2], ['CRJ9', 2], ['E175', 2], ['A320', 1]],
    destinations: [['ATL', 8], ['DTW', 3], ['MSP', 3], ['JFK', 2], ['LGA', 2], ['BOS', 1], ['SLC', 1]],
  },
  UAL: {
    name: 'United', iata: 'UA', icao: 'UAL', callsign: 'UNITED', ui: '#5fb4ff',
    fleet: [['B38M', 2], ['A320', 2], ['B739', 1], ['E175', 3], ['CRJ9', 1]],
    destinations: [['ORD', 5], ['DEN', 4], ['IAH', 4], ['EWR', 3], ['IAD', 2], ['SFO', 1]],
  },
  ASA: {
    name: 'Alaska', iata: 'AS', icao: 'ASA', callsign: 'ALASKA', ui: '#4fd3e0',
    fleet: [['B739', 2], ['B38M', 2]],
    destinations: [['SEA', 3], ['SFO', 1], ['LAX', 1], ['SAN', 1]],
  },
  JBU: {
    name: 'JetBlue', iata: 'B6', icao: 'JBU', callsign: 'JETBLUE', ui: '#6c9dff',
    fleet: [['A320', 2], ['BCS3', 2]],
    destinations: [['BOS', 3], ['JFK', 2], ['FLL', 1]],
  },
  NKS: {
    name: 'Spirit', iata: 'NK', icao: 'NKS', callsign: 'SPIRIT WINGS', ui: '#ffe94d',
    fleet: [['A321', 2], ['A320', 2]],
    destinations: [['FLL', 3], ['MCO', 2], ['LAS', 1], ['DTW', 1], ['CUN', 1]],
  },
  FFT: {
    name: 'Frontier', iata: 'F9', icao: 'FFT', callsign: 'FRONTIER FLIGHT', ui: '#8fd65a',
    fleet: [['A321', 2], ['A320', 2]],
    destinations: [['DEN', 3], ['MCO', 2], ['PHL', 1], ['LAS', 1], ['SJU', 1]],
  },
  ACA: {
    name: 'Air Canada', iata: 'AC', icao: 'ACA', callsign: 'AIR CANADA', ui: '#ff6b6b',
    fleet: [['BCS3', 2], ['E175', 2]],
    destinations: [['YYZ', 1]],
  },
};
