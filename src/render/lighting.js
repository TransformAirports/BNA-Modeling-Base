// Aircraft lighting that matches the basemap.
//
// Mapbox Standard lights its own 3D buildings with an ambient + directional
// light per light preset. We reproduce those exact values for the aircraft so
// jets and buildings share the same light, colour cast and shadow direction,
// and ease between presets as the day plays.
//
// Values come from the Standard style's light definitions (default theme),
// as reported by map.getLights().

import * as THREE from 'three';

const PRESETS = {
  dawn: { ambient: ['hsl(28, 98%, 93%)', 0.75], sun: ['hsl(33, 98%, 77%)', 0.5], direction: [120, 50], shadow: 0.5, env: 0.7, fill: 0.15 },
  day: { ambient: ['hsl(0, 0%, 100%)', 0.8], sun: ['hsl(0, 0%, 100%)', 0.2], direction: [180, 20], shadow: 0.5, env: 0.8, fill: 0 },
  dusk: { ambient: ['hsl(228, 27%, 29%)', 0.8], sun: ['hsl(30, 98%, 76%)', 0.2], direction: [240, 80], shadow: 0.38, env: 0.45, fill: 0.7 },
  night: { ambient: ['hsl(217, 100%, 11%)', 0.5], sun: ['hsl(225, 15%, 29%)', 0.5], direction: [270, 20], shadow: 0.22, env: 0.3, fill: 1 },
};

// three.js lights are physically based: an intensity of π reproduces Mapbox's
// "unit" lighting. The directional share is boosted a little so curved
// fuselages still read as round under mostly-ambient light.
const AMBIENT_GAIN = Math.PI * 0.9;
const SUN_GAIN = Math.PI * 2.2;
// Warm apron floodlight fill after dark, so parked jets never go black.
const FILL_GAIN = 1.5;

const DEG = Math.PI / 180;

function target(name) {
  const p = PRESETS[name] ?? PRESETS.day;
  const [az, polar] = p.direction;
  const el = (90 - polar) * DEG;
  return {
    ambientColor: new THREE.Color(p.ambient[0]),
    ambientIntensity: p.ambient[1] * AMBIENT_GAIN,
    sunColor: new THREE.Color(p.sun[0]),
    sunIntensity: p.sun[1] * SUN_GAIN,
    direction: new THREE.Vector3(Math.sin(az * DEG) * Math.cos(el), Math.cos(az * DEG) * Math.cos(el), Math.sin(el)),
    shadow: p.shadow,
    env: p.env,
    fill: p.fill * FILL_GAIN,
  };
}

export function createLightRig(scene) {
  const ambient = new THREE.AmbientLight('#ffffff', AMBIENT_GAIN * 0.8);
  const sun = new THREE.DirectionalLight('#ffffff', SUN_GAIN * 0.2);
  const fill = new THREE.HemisphereLight('#ffd7a1', '#2a2018', 0);
  scene.add(ambient, sun, sun.target, fill);

  let current = target('day');
  let last = performance.now();

  return {
    /** Ease toward the given Mapbox light preset. Call once per frame. */
    update(preset) {
      const now = performance.now();
      const k = 1 - Math.exp(-((now - last) / 1000) * 1.4);
      last = now;
      const t = target(preset);
      current = {
        ambientColor: current.ambientColor.lerp(t.ambientColor, k),
        ambientIntensity: current.ambientIntensity + (t.ambientIntensity - current.ambientIntensity) * k,
        sunColor: current.sunColor.lerp(t.sunColor, k),
        sunIntensity: current.sunIntensity + (t.sunIntensity - current.sunIntensity) * k,
        direction: current.direction.lerp(t.direction, k).normalize(),
        shadow: current.shadow + (t.shadow - current.shadow) * k,
        env: current.env + (t.env - current.env) * k,
        fill: current.fill + (t.fill - current.fill) * k,
      };
      ambient.color.copy(current.ambientColor);
      ambient.intensity = current.ambientIntensity;
      sun.color.copy(current.sunColor);
      sun.intensity = current.sunIntensity;
      sun.position.copy(current.direction).multiplyScalar(1000);
      fill.intensity = current.fill;
      return current;
    },
  };
}
