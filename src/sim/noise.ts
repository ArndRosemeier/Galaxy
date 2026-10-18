/**
 * Seeded value noise and fBm — composition, not rendering.
 *
 * The renderer gets a `SurfaceSpec` and draws it on the GPU; nothing here runs at
 * 60 fps. Noise is used while generating: arm spurs, disc warp, surface variation.
 * Value noise with quintic interpolation is enough for those, is cheap, and is
 * trivially deterministic (integer lattice hash + clamped lerps).
 */

import { hashString, mixSeeds } from './rng';

const UINT32_MAX = 4294967295;

function latticeHash(seed: number, x: number, y: number, z: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h = Math.imul(h ^ (z | 0), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / UINT32_MAX) * 2 - 1;
}

/** Quintic smoothstep: zero first and second derivative at the ends, C². */
function quintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function validateFbm(octaves: number, lacunarity: number, gain: number): void {
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > 12) {
    throw new Error(`fbm: invalid octave count ${String(octaves)}`);
  }
  if (!Number.isFinite(lacunarity) || lacunarity <= 0) {
    throw new Error(`fbm: invalid lacunarity ${String(lacunarity)}`);
  }
  if (!Number.isFinite(gain) || gain < 0 || gain > 1) {
    throw new Error(`fbm: invalid gain ${String(gain)}`);
  }
}

/** A seeded noise field. All methods are pure functions of the seed and the point. */
export class ValueNoise {
  readonly seed: number;

  constructor(seed: number | string) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  }

  /** 2D value noise in [-1, 1]. */
  noise2(x: number, y: number): number {
    return valueNoise2(this.seed, x, y);
  }

  /** 3D value noise in [-1, 1]. */
  noise3(x: number, y: number, z: number): number {
    return valueNoise3(this.seed, x, y, z);
  }

  /** Fractal Brownian motion over `noise2`, normalised to [-1, 1]. */
  fbm2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    validateFbm(octaves, lacunarity, gain);
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      const seed = mixSeeds(this.seed, octave * 0x9e3779b1 + 1);
      sum += amplitude * valueNoise2(seed, x * frequency, y * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  /** Fractal Brownian motion over `noise3`, normalised to [-1, 1]. */
  fbm3(x: number, y: number, z: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    validateFbm(octaves, lacunarity, gain);
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      const seed = mixSeeds(this.seed, octave * 0x9e3779b1 + 1);
      sum += amplitude * valueNoise3(seed, x * frequency, y * frequency, z * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }
}

/** Free-function form of `ValueNoise#noise2` for a raw 32-bit seed. */
export function valueNoise2(seed: number, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`valueNoise2: non-finite point (${x}, ${y})`);
  }
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = quintic(x - xi);
  const ty = quintic(y - yi);
  const v00 = latticeHash(seed, xi, yi, 0);
  const v10 = latticeHash(seed, xi + 1, yi, 0);
  const v01 = latticeHash(seed, xi, yi + 1, 0);
  const v11 = latticeHash(seed, xi + 1, yi + 1, 0);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

/** Free-function form of `ValueNoise#noise3` for a raw 32-bit seed. */
export function valueNoise3(seed: number, x: number, y: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`valueNoise3: non-finite point (${x}, ${y}, ${z})`);
  }
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = quintic(x - xi);
  const ty = quintic(y - yi);
  const tz = quintic(z - zi);
  const c000 = latticeHash(seed, xi, yi, zi);
  const c100 = latticeHash(seed, xi + 1, yi, zi);
  const c010 = latticeHash(seed, xi, yi + 1, zi);
  const c110 = latticeHash(seed, xi + 1, yi + 1, zi);
  const c001 = latticeHash(seed, xi, yi, zi + 1);
  const c101 = latticeHash(seed, xi + 1, yi, zi + 1);
  const c011 = latticeHash(seed, xi, yi + 1, zi + 1);
  const c111 = latticeHash(seed, xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}
