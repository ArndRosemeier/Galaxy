/**
 * Deterministic decoration randomness for the renderer.
 *
 * `src/sim` owns generated content and its PRNG (`src/sim/rng.ts`); the renderer
 * must never draw content from a source the generator does not control. But the
 * renderer still decorates what it is given — the seeded background starfield, the
 * scatter inside an asteroid belt, the splat shape of the galaxy density map — and
 * those look must be byte-stable too, or two screenshots of the same galaxy differ.
 *
 * This is the ONE randomness seam below `src/render/**`. It is a local hash/PRNG,
 * deliberately not imported from `src/sim` (the renderer may not depend on a
 * generator module) and deliberately not `Math.random` (which is not seedable).
 * Everything here is a pure function of an integer seed.
 */

/** 32-bit integer hash of a text seed (FNV-1a). Used to turn a galaxy seed into a number. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small, fast, seedable PRNG (mulberry32). Returns a function yielding [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic [0, 1) hash of a 2D lattice point. No state, no allocation. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Clamp helper shared by the renderer. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export const TAU = Math.PI * 2;
