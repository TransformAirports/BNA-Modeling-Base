// Mapbox custom layer that renders the aircraft with three.js.
//
// three.js shares Mapbox's WebGL context and depth buffer, so aircraft are
// occluded by 3D buildings. The scene is authored in the local metric frame
// (x east, y north, z up, metres) and mapped to Mercator with one matrix.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createAircraftLibrary, paintShadow } from './aircraftModels.js';
import { createAirfieldLights } from './airfieldLights.js';
import { createGlowPoints } from './glowPoints.js';
import { createLightRig } from './lighting.js';
import { clamp, headingVector, smoothstep } from '../sim/geo.js';

const DEG = Math.PI / 180;
const RED = [1, 0.12, 0.08];
const GREEN = [0.15, 1, 0.35];
const WHITE = [1, 0.97, 0.92];
const LANDING = [1, 0.96, 0.86];

function radialTexture(stops) {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createAircraftLayer({ world }) {
  const { frame, airfield } = world;
  const [ox, oy] = frame.mercatorOrigin;
  const s = frame.scale;
  const localToMercator = new THREE.Matrix4().makeTranslation(ox, oy, 0).scale(new THREE.Vector3(s, -s, s));

  let map;
  let renderer;
  let library;
  let envReady = false;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const mvp = new THREE.Matrix4();
  const tmpMatrix = new THREE.Matrix4();
  const tmpVec4 = new THREE.Vector4();
  const tmpVec3 = new THREE.Vector3();

  // Lights matched to the basemap's light preset (see lighting.js).
  const rig = createLightRig(scene);

  const glow = createGlowPoints({ capacity: 4096, minPx: 4.5, maxPx: 90, gain: 1.25 });
  scene.add(glow.object);
  let fieldLights = null;

  const shadowTextures = new Map();
  const shadowMaterialBase = { color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 };
  const poolTexture = radialTexture([[0, 'rgba(255,240,215,0.9)'], [0.35, 'rgba(255,230,190,0.35)'], [1, 'rgba(255,220,170,0)']]);
  const poolGeometry = new THREE.PlaneGeometry(1, 1);

  // Glowing ring under the selected aircraft.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 64),
    new THREE.MeshBasicMaterial({ color: '#5be0ff', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  ring.renderOrder = 3;
  ring.visible = false;
  scene.add(ring);

  const instances = new Map(); // visit id → instance
  const free = new Map(); // type:carrier → [instance]
  const screen = new Map(); // visit id → { x, y, visible }
  let viewport = { width: 1, height: 1, pixelRatio: 1 };

  let states = [];
  let conditions = { night: 0, preset: 'day' };
  let selectedId = null;

  function shadowFor(typeKey) {
    if (!shadowTextures.has(typeKey)) {
      const { canvas, width, height } = paintShadow(typeKey, library.geometryFor(typeKey).points);
      const texture = new THREE.CanvasTexture(canvas);
      shadowTextures.set(typeKey, { texture, width, height });
    }
    return shadowTextures.get(typeKey);
  }

  function createInstance(visit) {
    const model = library.create(visit.type, visit.carrier);
    // Per-aircraft body material so cabin windows can light up individually.
    const body = model.parts.body;
    body.material = body.material.clone();
    library.allMaterials.add(body.material);
    const shadowInfo = shadowFor(visit.type);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(shadowInfo.width, shadowInfo.height),
      new THREE.MeshBasicMaterial({ ...shadowMaterialBase, alphaMap: shadowInfo.texture, opacity: 0.5 }),
    );
    shadow.renderOrder = 1;
    const pool = new THREE.Mesh(poolGeometry, new THREE.MeshBasicMaterial({
      map: poolTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    }));
    pool.renderOrder = 2;
    scene.add(model.group, shadow, pool);
    return { key: `${visit.type}:${visit.carrier}`, model, shadow, pool };
  }

  function acquire(visit) {
    const key = `${visit.type}:${visit.carrier}`;
    const inst = free.get(key)?.pop() ?? createInstance(visit);
    instances.set(visit.id, inst);
    return inst;
  }

  function release(id) {
    const inst = instances.get(id);
    if (!inst) return;
    inst.model.group.visible = false;
    inst.shadow.visible = false;
    inst.pool.visible = false;
    instances.delete(id);
    if (!free.has(inst.key)) free.set(inst.key, []);
    free.get(inst.key).push(inst);
  }

  /** Push this aircraft's lights into the glow buffer. */
  function emitLights(inst, state, night) {
    const { points: p, type } = inst.model;
    const m = inst.model.group.matrixWorld;
    const L = type.length;
    const add = (x, y, z, color, size, intensity, blink) => {
      tmpVec3.set(x, y, z).applyMatrix4(m);
      glow.push(tmpVec3.x, tmpVec3.y, tmpVec3.z, color, size, intensity * state.opacity, blink);
    };
    const { lights } = state;
    const navGain = 0.55 + 0.45 * night;
    if (lights.nav) {
      add(-p.wingTipX, p.tipLE - type.wing.tipChord * 0.5, p.tipZ + 0.2, RED, 4.3, navGain);
      add(p.wingTipX, p.tipLE - type.wing.tipChord * 0.5, p.tipZ + 0.2, GREEN, 4.3, navGain);
      add(0, -L / 2 - 0.2, p.zc + p.R * 0.6, WHITE, 3.6, navGain);
    }
    if (lights.beacon) {
      add(0, 0, p.zc + p.R + 0.15, RED, 5.8, 1.2, [1, 0, 0.12]);
      add(0, -2, p.zc - p.R - 0.1, RED, 5.8, 1.2, [1, 0.5, 0.12]);
    }
    if (lights.strobe) {
      add(-p.wingTipX, p.tipLE - type.wing.tipChord * 0.7, p.tipZ + 0.2, WHITE, 9.0, 1.6, [0.9, 0, -1]);
      add(p.wingTipX, p.tipLE - type.wing.tipChord * 0.7, p.tipZ + 0.2, WHITE, 9.0, 1.6, [0.9, 0, -1]);
      add(0, -L / 2 - 0.3, p.zc + p.R * 0.4, WHITE, 6.5, 1.2, [0.9, 0.02, -1]);
    }
    if (lights.landing) {
      const g = 0.7 + 0.8 * night;
      add(-p.R - 1.6, p.rootLE - 0.4, p.wingZ, LANDING, 16.2, g);
      add(p.R + 1.6, p.rootLE - 0.4, p.wingZ, LANDING, 16.2, g);
      if (state.gearDown) add(0, p.noseGearY + 0.3, 1.3, LANDING, 10.8, g * 0.8);
    }
    if (lights.taxi) add(0, p.noseGearY + 0.4, 1.4, LANDING, 8.1, 0.6 + 0.6 * night);
  }

  function updateScene() {
    const { night } = conditions;
    const seen = new Set();
    glow.reset();

    // Same light as the basemap, so aircraft shadows line up with building shadows.
    const light = rig.update(conditions.preset);
    library?.setEnvironmentIntensity(light.env);
    const sunDir = light.direction;
    const horizontal = Math.hypot(sunDir.x, sunDir.y) || 1;
    const [awayX, awayY] = [-sunDir.x / horizontal, -sunDir.y / horizontal];
    // Shadows fall away from the light; length per metre of height = 1 / tan(elevation).
    const elevation = Math.asin(clamp(sunDir.z, -1, 1));
    const shadowStretch = 1 / Math.tan(Math.max(8 * DEG, elevation));

    for (const state of states) {
      const { visit } = state;
      seen.add(visit.id);
      const inst = instances.get(visit.id) ?? acquire(visit);
      const { group, parts, type } = inst.model;
      const [x, y, z] = state.position;
      group.position.set(x, y, z);
      group.rotation.set(state.pitch * DEG, state.roll * DEG, -state.heading * DEG, 'ZXY');
      group.updateMatrixWorld(true);
      if (parts.gearMetal) parts.gearMetal.visible = state.gearDown;
      if (parts.gearDark) parts.gearDark.visible = state.gearDown;
      parts.body.material.emissiveIntensity = state.lights.cabin ? night * 1.5 : 0;
      // Materials are shared between aircraft, so fade (30+ km out) only affects lights and shadow.
      group.visible = state.opacity > 0.02;

      // Soft shadow: offset away from the sun by altitude, fading with height.
      const heading = headingVector(state.heading);
      const altitudeFade = 1 - smoothstep(20, 700, z);
      // Use the fuselage height so parked aircraft cast a slightly offset shadow too.
      const offset = Math.min((z + inst.model.points.zc * 0.7) * shadowStretch, 4000);
      inst.shadow.visible = altitudeFade > 0.01;
      inst.shadow.position.set(x + awayX * offset, y + awayY * offset, 0.15);
      inst.shadow.rotation.set(0, 0, -state.heading * DEG);
      inst.shadow.material.opacity = light.shadow * altitudeFade * state.opacity;

      // Landing/taxi light pool on the ground at night.
      const poolOn = (state.lights.taxi || state.lights.landing) && z < 80 ? night * (1 - z / 80) : 0;
      inst.pool.visible = poolOn > 0.01;
      if (inst.pool.visible) {
        const reach = type.length * 0.5 + (state.lights.landing ? 70 : 32);
        inst.pool.position.set(x + heading[0] * reach, y + heading[1] * reach, 0.2);
        inst.pool.rotation.set(0, 0, -state.heading * DEG);
        inst.pool.scale.set(state.lights.landing ? 44 : 26, state.lights.landing ? 120 : 58, 1);
        inst.pool.material.opacity = poolOn * (state.lights.landing ? 0.55 : 0.4);
      }

      emitLights(inst, state, night);
    }
    for (const id of [...instances.keys()]) if (!seen.has(id)) release(id);
    glow.commit();

    const selected = selectedId && states.find((st) => st.visit.id === selectedId);
    ring.visible = Boolean(selected);
    if (selected) {
      const size = instances.get(selectedId).model.type.span * 0.75;
      const pulse = 1 + 0.06 * Math.sin(performance.now() / 260);
      ring.position.set(selected.position[0], selected.position[1], 0.3);
      ring.scale.setScalar(size * pulse);
      ring.material.opacity = 0.85 * (1 - smoothstep(30, 400, selected.position[2]));
    }

    if (fieldLights) fieldLights.material.uniforms.gain.value = clamp(night * 1.15, 0, 1.15);
  }

  function updateScreenPositions() {
    screen.clear();
    for (const state of states) {
      const inst = instances.get(state.visit.id);
      const zc = inst ? inst.model.points.zc : 2;
      tmpVec4.set(state.position[0], state.position[1], state.position[2] + zc, 1).applyMatrix4(mvp);
      if (tmpVec4.w <= 0) continue;
      const nx = tmpVec4.x / tmpVec4.w;
      const ny = tmpVec4.y / tmpVec4.w;
      screen.set(state.visit.id, {
        x: (nx * 0.5 + 0.5) * viewport.width,
        y: (1 - (ny * 0.5 + 0.5)) * viewport.height,
        depth: tmpVec4.w,
        visible: Math.abs(nx) < 1.1 && Math.abs(ny) < 1.1,
      });
    }
  }

  const layer = {
    id: 'bna-aircraft',
    type: 'custom',
    renderingMode: '3d',
    slot: 'top',

    onAdd(m, gl) {
      map = m;
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      // Neutral tone mapping keeps paint colours true (ACES darkens and shifts them).
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      library = createAircraftLibrary(renderer);
      fieldLights = createAirfieldLights(airfield);
      scene.add(fieldLights.object);
      envReady = false;
    },

    onRemove() {
      for (const id of [...instances.keys()]) release(id);
      for (const list of free.values()) for (const inst of list) scene.remove(inst.model.group, inst.shadow, inst.pool);
      free.clear();
      if (fieldLights) scene.remove(fieldLights.object);
      renderer?.dispose();
      renderer = null;
    },

    render(gl, matrix) {
      if (!renderer) return;
      if (!envReady) {
        // Build the reflection environment once, inside Mapbox's render pass.
        const pmrem = new THREE.PMREMGenerator(renderer);
        const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        library.setEnvironment(env);
        pmrem.dispose();
        envReady = true;
        renderer.resetState();
      }

      const canvas = map.getCanvas();
      viewport = { width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: window.devicePixelRatio || 1 };
      mvp.fromArray(matrix).multiply(localToMercator);

      // Recover the eye position so lighting/reflections use the true view direction.
      tmpMatrix.copy(mvp).invert();
      tmpVec4.set(0, 0, 1, 0).applyMatrix4(tmpMatrix);
      if (Math.abs(tmpVec4.w) > 1e-12) camera.position.set(tmpVec4.x / tmpVec4.w, tmpVec4.y / tmpVec4.w, tmpVec4.z / tmpVec4.w);
      camera.updateMatrixWorld(true);
      camera.projectionMatrix.copy(mvp).multiply(tmpMatrix.makeTranslation(camera.position.x, camera.position.y, camera.position.z));
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      updateScene();
      updateScreenPositions();
      const time = performance.now() / 1000;
      glow.setFrame({ ...viewport, time });
      fieldLights?.setFrame({ ...viewport, time });

      renderer.resetState();
      renderer.render(scene, camera);
    },

    // ---------------------------------------------------------- public API
    setStates(next) { states = next; },
    setConditions(next) { conditions = next; },
    setSelected(id) { selectedId = id; },
    get selected() { return selectedId; },
    /** Last projected screen positions, keyed by visit id. */
    screen,
    /** Nearest aircraft to a screen point, within `radius` px. */
    pick(x, y, radius = 28) {
      let best = null;
      for (const [id, p] of screen) {
        if (!p.visible) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < radius && (!best || d < best.d)) best = { id, d };
      }
      return best?.id ?? null;
    },
  };
  return layer;
}
