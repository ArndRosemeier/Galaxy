/**
 * Seeded background starfields.
 *
 * The galaxy has to sit inside a sky, not on black paper, and the planet view needs a
 * believable night sky (with a hint of the galaxy's own band). These points are
 * *decoration*, not generated content: they are seeded from the galaxy seed through
 * `rand.ts` so they are stable across frames and screenshots. They are drawn at
 * constant screen size, additive, with depth test off: they are infinitely far away.
 */

import * as THREE from 'three';
import type { Rgb } from '../sim/types';
import { mulberry32, TAU } from './rand';
import { GLSL_POINT } from './glsl';

export interface StarfieldOptions {
  readonly count: number;
  /** Radius of the shell the stars are placed on, in the current view's units. */
  readonly radius: number;
  readonly seed: number;
  /** 0..1 fraction gathered along a tilted great circle (the galaxy's own band). */
  readonly band?: number;
  /** Overall linear brightness multiplier. */
  readonly intensity?: number;
  /** CSS pixel size range. */
  readonly sizeRange?: readonly [number, number];
  /** Overall colour of the field (linear RGB). Defaults to white. */
  readonly tint?: Rgb;
  /** Camera near/far are per-view; the shell must be inside `far`. */
}

const VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aBrightness;
uniform float uDpr;
uniform float uIntensity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aBrightness;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uDpr;
}
`;

const FRAG = /* glsl */ `
${GLSL_POINT}
varying vec3 vColor;
varying float vAlpha;
uniform float uIntensity;
uniform vec3 uTint;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float a = pointProfile(d, 6.0);
  gl_FragColor = vec4(vColor * uTint * (a * vAlpha * uIntensity), 1.0);
}
`;

export interface SkyField {
  readonly points: THREE.Points;
  setDpr(dpr: number): void;
  dispose(): void;
}

/** Build one static starfield shell. */
export function createStarfield(opts: StarfieldOptions): SkyField {
  const rng = mulberry32(opts.seed >>> 0);
  const count = Math.max(1, Math.floor(opts.count));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);
  const band = opts.band ?? 0;
  const [minSize, maxSize] = opts.sizeRange ?? [0.7, 2.4];

  for (let i = 0; i < count; i += 1) {
    // Uniform direction on the sphere.
    const y = rng() * 2 - 1;
    const theta = rng() * TAU;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    let dx = Math.cos(theta) * r;
    let dy = y;
    let dz = Math.sin(theta) * r;

    if (rng() < band) {
      // Pull the star toward a tilted great circle: the Milky Way overhead.
      const a = rng() * TAU;
      const tilt = 0.42;
      dx = Math.cos(a);
      dz = Math.sin(a) * Math.cos(tilt);
      dy = Math.sin(a) * Math.sin(tilt) + (rng() - 0.5) * 0.11;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      // A band star is dimmer on average, which is how a resolved band reads.
      brightness[i] = 0.12 + rng() * 0.3;
    } else {
      brightness[i] = 0.28 + Math.pow(rng(), 2.2) * 1.25;
    }

    const radius = opts.radius * (0.92 + rng() * 0.16);
    positions[i * 3] = dx * radius;
    positions[i * 3 + 1] = dy * radius;
    positions[i * 3 + 2] = dz * radius;

    // Star colour temperature: most stars warm-white, some blue, some orange-red.
    const t = rng();
    let cr: number;
    let cg: number;
    let cb: number;
    if (t < 0.16) {
      cr = 0.62; cg = 0.76; cb = 1.0;
    } else if (t < 0.62) {
      cr = 1.0; cg = 0.94; cb = 0.86;
    } else if (t < 0.9) {
      cr = 1.0; cg = 0.82; cb = 0.62;
    } else {
      cr = 1.0; cg = 0.62; cb = 0.44;
    }
    colors[i * 3] = cr;
    colors[i * 3 + 1] = cg;
    colors[i * 3 + 2] = cb;

    sizes[i] = minSize + Math.pow(rng(), 3.1) * (maxSize - minSize);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), opts.radius * 1.2);

  const tintColor = new THREE.Color(1, 1, 1);
  if (opts.tint) tintColor.setRGB(opts.tint[0], opts.tint[1], opts.tint[2]);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uDpr: { value: 1 },
      uIntensity: { value: opts.intensity ?? 0.55 },
      uTint: { value: tintColor.clone() },
    },
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -100;
  points.name = 'starfield';

  return {
    points,
    setDpr(dpr: number) {
      material.uniforms.uDpr!.value = dpr;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
