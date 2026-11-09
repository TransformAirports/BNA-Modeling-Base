// Glowing point lights (aircraft nav/strobe/beacon lights, runway and taxiway lights).
//
// One draw call per collection. Each point has a colour, a world size in
// metres (clamped to a pixel range so lights stay visible from far away) and
// an optional blink pattern evaluated on the GPU:
//   blink = [rate Hz, phase 0–1, duty 0–1]   duty < 0 → double flash (strobe)

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float intensity;
  attribute vec3 blink;
  uniform vec2 viewport;
  uniform float pixelRatio;
  uniform float time;
  uniform float minPx;
  uniform float maxPx;
  uniform float gain;
  varying vec3 vColor;
  varying float vAlpha;

  float blinkOn(vec3 b) {
    if (b.x <= 0.0) return 1.0;
    float f = fract(time * b.x + b.y);
    if (b.z < 0.0) {
      // Double flash, like an airliner's wingtip strobes.
      return (f < 0.035 || (f > 0.11 && f < 0.145)) ? 1.0 : 0.0;
    }
    // Soft-edged pulse.
    return smoothstep(0.0, 0.02, f) * (1.0 - smoothstep(b.z, b.z + 0.04, f));
  }

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mv;
    gl_Position = clip;
    // Screen size of a world-space disc of diameter 'size'.
    vec4 cx = projectionMatrix * (modelViewMatrix * vec4(position + vec3(size, 0.0, 0.0), 1.0));
    vec4 cy = projectionMatrix * (modelViewMatrix * vec4(position + vec3(0.0, size, 0.0), 1.0));
    vec2 p0 = clip.xy / clip.w;
    vec2 dx = (cx.xy / cx.w - p0) * 0.5 * viewport;
    vec2 dy = (cy.xy / cy.w - p0) * 0.5 * viewport;
    float px = max(length(dx), length(dy));
    float on = blinkOn(blink) * intensity * gain;
    // Lights smaller than the minimum get dimmer instead of vanishing.
    float sized = clamp(px, minPx, maxPx);
    gl_PointSize = sized * pixelRatio * (on > 0.001 ? 1.0 : 0.0);
    vColor = color;
    vAlpha = on * clamp(0.35 + px / minPx, 0.35, 1.0);
    if (clip.w <= 0.0) gl_PointSize = 0.0;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float core = exp(-r * r * 18.0);
    float halo = exp(-r * r * 4.0) * 0.45;
    float a = (core + halo) * vAlpha;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.55) * a, a);
  }
`;

export function createGlowPoints({ capacity, minPx = 2, maxPx = 48, gain = 1 }) {
  const geometry = new THREE.BufferGeometry();
  const attr = (n) => new THREE.BufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attr(3));
  geometry.setAttribute('color', attr(3));
  geometry.setAttribute('size', attr(1));
  geometry.setAttribute('intensity', attr(1));
  geometry.setAttribute('blink', attr(3));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      viewport: { value: new THREE.Vector2(1, 1) },
      pixelRatio: { value: 1 },
      time: { value: 0 },
      minPx: { value: minPx },
      maxPx: { value: maxPx },
      gain: { value: gain },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 10;

  let count = 0;
  const a = geometry.attributes;
  return {
    object: points,
    material,
    get count() { return count; },
    reset() { count = 0; },
    push(x, y, z, [r, g, b], size, intensity = 1, blink = [0, 0, 0]) {
      if (count >= capacity) return;
      a.position.setXYZ(count, x, y, z);
      a.color.setXYZ(count, r, g, b);
      a.size.setX(count, size);
      a.intensity.setX(count, intensity);
      a.blink.setXYZ(count, blink[0], blink[1], blink[2]);
      count += 1;
    },
    commit() {
      geometry.setDrawRange(0, count);
      for (const name of ['position', 'color', 'size', 'intensity', 'blink']) {
        a[name].clearUpdateRanges();
        a[name].addUpdateRange(0, count * a[name].itemSize);
        a[name].needsUpdate = true;
      }
    },
    setFrame({ width, height, pixelRatio, time }) {
      material.uniforms.viewport.value.set(width, height);
      material.uniforms.pixelRatio.value = pixelRatio;
      material.uniforms.time.value = time;
    },
  };
}
