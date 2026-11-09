// Procedural airliner models.
//
// Every aircraft is generated from the dimensions in src/sim/fleet.js, so no
// model files are needed. Model frame: x = right wing, y = nose, z = up,
// origin on the ground under the middle of the fuselage.
//
// Geometry is cached per type and merged by material, so each aircraft is
// about nine draw calls. Liveries come from ./liveries.js, painted onto
// canvases once per type+carrier.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRCRAFT_TYPES } from '../sim/fleet.js';
import { liveryFor, paintFin, paintFuselage } from './liveries.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- helpers

/** Non-indexed copy (mergeGeometries needs every part in the same form). */
const flat = (g) => (g.index ? g.toNonIndexed() : g);

/** Extrude a 2D outline (a = along y, b = along z) into a thin vertical surface. */
function verticalSurface(outline, thickness, bevel = 0.08) {
  const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
  });
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const as = outline.map((p) => p[0]);
  const bs = outline.map((p) => p[1]);
  const [aMin, aMax, bMin, bMax] = [Math.min(...as), Math.max(...as), Math.min(...bs), Math.max(...bs)];
  for (let i = 0; i < pos.count; i += 1) {
    const a = pos.getX(i);
    const b = pos.getY(i);
    const c = pos.getZ(i) - thickness / 2;
    pos.setXYZ(i, c, a, b);
    uv.setXY(i, (a - aMin) / (aMax - aMin), (b - bMin) / (bMax - bMin));
  }
  geometry.computeVertexNormals();
  return flat(geometry);
}

/**
 * Swept, tapered lifting surface (wing or stabiliser) for one side.
 * side: +1 right, −1 left. Returns geometry in model space.
 */
function liftingSurface({ rootX, tipX, rootLE, rootChord, tipChord, sweep, dihedral, z, thickness, kink = 0 }, side) {
  const tipLE = rootLE - (tipX - rootX) * Math.tan(sweep * DEG);
  const outline = [[rootX, rootLE], [tipX, tipLE], [tipX, tipLE - tipChord]];
  if (kink > 0) {
    // Inboard trailing-edge extension ("Yehudi"), as on most airliner wings.
    const kx = rootX + kink * (tipX - rootX);
    const kLE = rootLE - (kx - rootX) * Math.tan(sweep * DEG);
    const outerTE = (tipLE - tipChord) + ((kx - tipX) / (rootX - tipX)) * ((rootLE - rootChord * 0.78) - (tipLE - tipChord));
    outline.push([kx, Math.min(outerTE, kLE - 1)], [rootX, rootLE - rootChord]);
  } else {
    outline.push([rootX, rootLE - rootChord]);
  }
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x * side, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.35, bevelSize: Math.min(0.12, thickness * 0.4), bevelSegments: 2,
  });
  const pos = geometry.attributes.position;
  const span = tipX - rootX;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const f = Math.max(0, (Math.abs(x) - rootX) / span);
    const t = (pos.getZ(i) - thickness / 2) * (1 - 0.65 * f);
    pos.setZ(i, z + t + f * span * Math.tan(dihedral * DEG));
  }
  geometry.computeVertexNormals();
  return flat(geometry);
}

function lathe(profile, segments = 24, phiStart = 0) {
  return flat(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments, phiStart));
}

function cylinderZ(radius, height, x, y, z0) {
  const g = new THREE.CylinderGeometry(radius, radius, height, 10);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z0 + height / 2);
  return flat(g);
}

function wheel(radius, width, x, y) {
  const g = new THREE.CylinderGeometry(radius, radius, width, 16);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, radius);
  return flat(g);
}

const merge = (parts) => (parts.length ? mergeGeometries(parts.filter(Boolean), false) : null);

// ------------------------------------------------------------ geometry

/** Fuselage centreline offset (upsweep at the tail, droop at the nose) as a function of y. */
function fuselageShape(type) {
  const L = type.length;
  const R = type.diameter / 2;
  const noseLength = (type.nose ?? 1.7) * type.diameter;
  const tailLength = 0.27 * L;
  return (y) => {
    const fromNose = L / 2 - y;
    const fromTail = y + L / 2;
    let r = R;
    let dz = 0;
    if (fromNose < noseLength) {
      const u = 1 - fromNose / noseLength;
      r = R * Math.pow(Math.max(0, 1 - Math.pow(u, 2.3)), 0.5);
      dz = -R * 0.2 * u * u;
    } else if (fromTail < tailLength) {
      const v = 1 - fromTail / tailLength;
      r = R * (1 - 0.86 * Math.pow(v, 1.6));
      dz = R * 0.62 * Math.pow(v, 1.5);
    }
    return { r, dz };
  };
}

/** Vertical fin outline (in the y–z plane) shared by the geometry and the livery painter. */
export function finShape(type) {
  const L = type.length;
  const R = type.diameter / 2;
  const zc = type.gearHeight + R;
  const f = type.fin;
  const finTE = -L / 2 + 0.9;
  const finRootLE = finTE + f.rootChord;
  const base = zc + R * 0.55;
  const tipLE = finRootLE - f.height * Math.tan(f.sweep * DEG);
  const tipTE = tipLE - f.tipChord;
  const outline = [
    [finTE, base - 0.4], [finRootLE + 2.2, base - 0.4], [finRootLE, base + 0.9],
    [tipLE, base + f.height], [tipTE, base + f.height], [finTE - 0.4, base + 0.6],
  ];
  const as = outline.map((p) => p[0]);
  const bs = outline.map((p) => p[1]);
  return {
    outline, finTE, finRootLE, tipLE, tipTE, base, height: f.height,
    aMin: Math.min(...as), aMax: Math.max(...as), bMin: Math.min(...bs), bMax: Math.max(...bs),
  };
}

function buildGeometry(type) {
  const L = type.length;
  const R = type.diameter / 2;
  const zc = type.gearHeight + R; // fuselage centre height
  const semi = type.span / 2;
  const shape = fuselageShape(type);

  // Fuselage: lathe from tail (y = −L/2) to nose (y = +L/2), seam on the belly.
  const N = 90;
  const profile = [];
  for (let i = 0; i <= N; i += 1) {
    const y = -L / 2 + (L * i) / N;
    profile.push([shape(y).r, y]);
  }
  const fuselage = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 40, Math.PI);
  {
    const pos = fuselage.attributes.position;
    for (let i = 0; i < pos.count; i += 1) pos.setZ(i, pos.getZ(i) + zc + shape(pos.getY(i)).dz);
    fuselage.computeVertexNormals();
  }

  // Wings.
  const w = type.wing;
  const rootLE = L / 2 - w.apex * L;
  const wingZ = zc - R * 0.55;
  const rootX = R * 0.75;
  const wingTipX = semi - (type.winglet === 'none' ? 0 : 0.15);
  const wingSpec = {
    rootX, tipX: wingTipX, rootLE, rootChord: w.rootChord, tipChord: w.tipChord,
    sweep: w.sweep + 2, dihedral: w.dihedral, z: wingZ, thickness: Math.max(0.28, w.rootChord * 0.075), kink: 0.32,
  };
  const wings = [liftingSurface(wingSpec, 1), liftingSurface(wingSpec, -1)];
  const tipLE = rootLE - (wingTipX - rootX) * Math.tan(wingSpec.sweep * DEG);
  const tipZ = wingZ + (wingTipX - rootX) * Math.tan(w.dihedral * DEG);

  // Wing-to-body fairing: a flattened pod under the wing root.
  const fairing = lathe([
    [0, rootLE + 1.2], [R * 0.55, rootLE], [R * 0.72, rootLE - w.rootChord * 0.5], [R * 0.6, rootLE - w.rootChord], [0, rootLE - w.rootChord - 1.6],
  ].map(([r, y]) => [r, y]), 20);
  fairing.scale(1, 1, 0.55);
  fairing.translate(0, 0, zc - R * 0.62);

  // Flap-track fairings ("canoes") under the trailing edge.
  const canoes = [];
  for (const frac of [0.2, 0.42, 0.6, 0.78]) {
    const x = rootX + frac * (wingTipX - rootX);
    const chord = w.rootChord + (w.tipChord - w.rootChord) * frac;
    const te = rootLE - (x - rootX) * Math.tan(wingSpec.sweep * DEG) - chord;
    const len = chord * 0.45 + 1.4;
    const z = wingZ + (x - rootX) * Math.tan(w.dihedral * DEG) - 0.12;
    for (const side of [1, -1]) {
      const canoe = lathe([[0, te + len * 0.5], [0.2, te + len * 0.28], [0.2, te - len * 0.1], [0, te - len * 0.5]], 10);
      canoe.scale(1, 1, 0.85);
      canoe.translate(side * x, 0, z);
      canoes.push(canoe);
    }
  }

  // Winglets.
  const winglets = [];
  const wl = { blended: [2.4, 40, 12], scimitar: [2.6, 45, 10], sharklet: [2.3, 38, 8], small: [1.1, 40, 10] }[type.winglet];
  if (wl) {
    const [h, sweep, cant] = wl;
    for (const side of [1, -1]) {
      const c0 = w.tipChord;
      const g = verticalSurface([[0, 0], [-c0, 0], [-c0 - h * Math.tan(sweep * DEG) - 0.3, h], [-h * Math.tan(sweep * DEG) - 0.3 + 0.55, h]], 0.12, 0.03);
      g.rotateY(side * cant * DEG);
      g.translate(side * wingTipX, tipLE, tipZ + 0.05);
      winglets.push(g);
      if (type.winglet === 'scimitar') {
        const lower = verticalSurface([[0, 0], [-c0 * 0.7, 0], [-c0 * 0.7 - 0.7, -0.9], [-0.5, -0.9]], 0.1, 0.02);
        lower.translate(side * wingTipX, tipLE, tipZ);
        winglets.push(lower);
      }
    }
  }

  // Vertical fin with a small dorsal fillet.
  const f = type.fin;
  const finOutline = finShape(type);
  const { finRootLE, base: finBase, tipLE: finTipLE } = finOutline;
  const fin = verticalSurface(finOutline.outline, 0.34, 0.1);

  // Horizontal stabilisers (on the tail cone, or on top of the fin for T-tails).
  const st = type.stab;
  const stabZ = st.tTail ? finBase + f.height - 0.1 : zc + R * 0.3;
  const stabLE = st.tTail ? finTipLE + 0.3 : finRootLE - 0.6;
  const stabSpec = {
    rootX: st.tTail ? 0.1 : R * 0.3, tipX: st.span / 2, rootLE: stabLE, rootChord: st.rootChord, tipChord: st.tipChord,
    sweep: st.sweep, dihedral: st.tTail ? -2 : 6, z: stabZ, thickness: 0.18,
  };
  const stabs = [liftingSurface(stabSpec, 1), liftingSurface(stabSpec, -1)];

  // Engines.
  const e = type.engine;
  const cowls = [];
  const lips = [];
  const fans = [];
  const cores = [];
  const pylons = [];
  const enginePositions = [];
  if (e.mount === 'wing') {
    for (const side of [1, -1]) {
      const x = side * Math.max(R + e.radius + 0.6, e.spanFraction * semi);
      const leY = rootLE - (Math.abs(x) - rootX) * Math.tan(wingSpec.sweep * DEG);
      const wingAt = wingZ + (Math.abs(x) - rootX) * Math.tan(w.dihedral * DEG);
      const zE = Math.max(e.radius + 0.45, wingAt - e.radius - 0.15);
      const front = leY + e.length * 0.55;
      enginePositions.push([x, front - e.length / 2, zE]);
      pylons.push(verticalSurface([[front - e.length * 0.45, zE + e.radius * 0.6], [front - e.length * 0.25, zE + e.radius * 0.95], [leY - 1.5, wingAt], [front - e.length - 0.4, wingAt], [front - e.length, zE + e.radius * 0.6]], 0.36, 0.06));
      pylons.at(-1).translate(x, 0, 0);
    }
  } else {
    for (const side of [1, -1]) {
      const x = side * (R + e.radius * 1.15);
      const y = -L / 2 + 0.3 * L;
      const zE = zc + R * 0.35;
      enginePositions.push([x, y, zE]);
      const stub = flat(new THREE.BoxGeometry(Math.abs(x) - R * 0.6, e.length * 0.45, 0.3));
      stub.translate(side * (R * 0.6 + (Math.abs(x) - R * 0.6) / 2), y, zE);
      pylons.push(stub);
    }
  }
  for (const [x, y, z] of enginePositions) {
    const r = e.radius;
    const len = e.length;
    const cowl = lathe([[r * 0.7, -len / 2], [r * 0.86, -len * 0.3], [r, len * 0.05], [r * 0.99, len * 0.3], [r * 0.9, len / 2]], 28);
    cowl.translate(x, y, z);
    cowls.push(cowl);
    const lip = flat(new THREE.TorusGeometry(r * 0.9, r * 0.07, 8, 28));
    lip.rotateX(Math.PI / 2);
    lip.translate(x, y + len / 2, z);
    lips.push(lip);
    const fan = flat(new THREE.CircleGeometry(r * 0.86, 28));
    fan.rotateX(-Math.PI / 2);
    fan.translate(x, y + len / 2 - 0.35, z);
    fans.push(fan);
    const spinner = flat(new THREE.ConeGeometry(r * 0.26, r * 0.5, 16));
    spinner.translate(x, y + len / 2 - 0.35 + r * 0.25, z);
    lips.push(spinner);
    const core = lathe([[r * 0.62, -len / 2 + 0.05], [r * 0.5, -len / 2 - r * 0.35], [r * 0.18, -len / 2 - r * 0.8], [0, -len / 2 - r * 0.85]], 20);
    core.translate(x, y, z);
    cores.push(core);
  }

  // Landing gear.
  const noseGearY = L / 2 - 0.11 * L;
  const mainGearY = rootLE - w.rootChord * 0.72;
  const track = Math.max(R * 1.25, type.span * 0.085);
  const mainWheel = Math.min(0.62, 0.3 + type.gearHeight * 0.22);
  const struts = [
    cylinderZ(0.12, zc - R * 0.75 - 0.3, 0, noseGearY, 0.3),
    cylinderZ(0.17, wingZ - mainWheel, track, mainGearY, mainWheel),
    cylinderZ(0.17, wingZ - mainWheel, -track, mainGearY, mainWheel),
  ];
  const tires = [
    wheel(0.36, 0.24, 0.2, noseGearY), wheel(0.36, 0.24, -0.2, noseGearY),
    wheel(mainWheel, 0.34, track + 0.3, mainGearY), wheel(mainWheel, 0.34, track - 0.3, mainGearY),
    wheel(mainWheel, 0.34, -track + 0.3, mainGearY), wheel(mainWheel, 0.34, -track - 0.3, mainGearY),
  ];

  return {
    body: flat(fuselage),
    tail: fin,
    metal: merge([...wings, ...stabs, ...pylons, fairing, ...canoes]),
    accent: merge(winglets),
    cowl: merge(cowls),
    chrome: merge(lips),
    dark: merge([...fans, ...cores]),
    gearMetal: merge(struts),
    gearDark: merge(tires),
    // Reference points for lights and effects.
    points: {
      zc, R, semi, wingZ, tipZ, rootLE, tipLE, wingTipX, finTipLE, finBase, noseGearY, mainGearY,
      finTop: finBase + f.height,
    },
    finShape: finOutline,
  };
}

// --------------------------------------------------------------- library

export function createAircraftLibrary(renderer) {
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const geometries = new Map();
  const materials = new Map();
  const shared = {
    metal: new THREE.MeshStandardMaterial({ color: '#c9ced4', metalness: 0.55, roughness: 0.36 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#eef1f4', metalness: 1, roughness: 0.16 }),
    dark: new THREE.MeshStandardMaterial({ color: '#202329', metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide }),
    gearMetal: new THREE.MeshStandardMaterial({ color: '#a4abb3', metalness: 0.7, roughness: 0.3 }),
    gearDark: new THREE.MeshStandardMaterial({ color: '#111214', metalness: 0, roughness: 0.85 }),
  };
  const allMaterials = new Set(Object.values(shared));

  const texture = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  };

  function geometryFor(typeKey) {
    if (!geometries.has(typeKey)) geometries.set(typeKey, buildGeometry(AIRCRAFT_TYPES[typeKey]));
    return geometries.get(typeKey);
  }

  function materialsFor(typeKey, carrierKey) {
    const key = `${typeKey}:${carrierKey}`;
    if (materials.has(key)) return materials.get(key);
    const livery = liveryFor(carrierKey);
    const type = AIRCRAFT_TYPES[typeKey];
    const { canvas, glowCanvas } = paintFuselage(typeKey, type, carrierKey);
    const map = texture(canvas);
    map.flipY = false;
    const emissiveMap = texture(glowCanvas);
    emissiveMap.flipY = false;
    // Glossy clear-coated paint; "metal" liveries are metallic-flake silver paint.
    const paint = (extra) => new THREE.MeshPhysicalMaterial({
      metalness: livery.metal ? 0.38 : 0.08,
      roughness: livery.metal ? 0.3 : 0.42,
      clearcoat: 0.85,
      clearcoatRoughness: 0.14,
      ...extra,
    });
    const set = {
      body: paint({ map, emissiveMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 }),
      tail: paint({ map: texture(paintFin(carrierKey, geometryFor(typeKey).finShape)) }),
      accent: paint({ color: livery.winglet }),
      cowl: paint({ color: livery.engine, side: THREE.DoubleSide }),
      ...shared,
    };
    for (const m of Object.values(set)) allMaterials.add(m);
    materials.set(key, set);
    return set;
  }

  /** Build a new aircraft group. Returns { group, gear, body, points }. */
  function create(typeKey, carrierKey) {
    const g = geometryFor(typeKey);
    const m = materialsFor(typeKey, carrierKey);
    const group = new THREE.Group();
    const parts = {};
    for (const name of ['body', 'tail', 'metal', 'accent', 'cowl', 'chrome', 'dark', 'gearMetal', 'gearDark']) {
      if (!g[name]) continue;
      const mesh = new THREE.Mesh(g[name], m[name]);
      mesh.matrixAutoUpdate = false;
      parts[name] = mesh;
      group.add(mesh);
    }
    return { group, parts, points: g.points, type: AIRCRAFT_TYPES[typeKey] };
  }

  /** Scale reflections with daylight. */
  function setEnvironmentIntensity(value) {
    for (const m of allMaterials) m.envMapIntensity = value;
  }

  function setEnvironment(envMap) {
    for (const m of allMaterials) {
      m.envMap = envMap;
      m.needsUpdate = true;
    }
  }

  return { create, geometryFor, materialsFor, setEnvironmentIntensity, setEnvironment, allMaterials };
}

/** Top-down silhouette used for soft ground shadows. `g` is the type's reference points. */
export function paintShadow(typeKey, g) {
  const type = AIRCRAFT_TYPES[typeKey];
  const S = 256;
  const pad = 3;
  const W = type.span + pad * 2;
  const H = type.length + pad * 2;
  const k = S / Math.max(W, H);
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const toPx = (x, y) => [S / 2 + x * k, S / 2 - y * k];
  ctx.filter = `blur(${Math.max(2, k * 0.9)}px)`;
  // Used as an alphaMap, which reads the green channel: paint the silhouette white.
  ctx.fillStyle = '#ffffff';
  const poly = (points) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(...toPx(x, y)) : ctx.moveTo(...toPx(x, y))));
    ctx.closePath();
    ctx.fill();
  };
  const R = type.diameter / 2;
  poly([[-R * 0.9, type.length / 2 - 1], [R * 0.9, type.length / 2 - 1], [R * 0.9, -type.length / 2 + 4], [0, -type.length / 2], [-R * 0.9, -type.length / 2 + 4]]);
  for (const s of [1, -1]) {
    poly([[s * R, g.rootLE], [s * g.wingTipX, g.tipLE], [s * g.wingTipX, g.tipLE - type.wing.tipChord], [s * R, g.rootLE - type.wing.rootChord]]);
    const stLE = g.finTipLE + 4;
    poly([[s * 0.3, stLE], [s * type.stab.span / 2, stLE - 2.4], [s * type.stab.span / 2, stLE - 3.4], [s * 0.3, stLE - type.stab.rootChord]]);
  }
  return { canvas, width: (S / k), height: (S / k) };
}
