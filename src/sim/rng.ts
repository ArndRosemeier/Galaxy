/**
 * Deterministic randomness — the only source of chance in `src/sim`.
 *
 * There is no module-level mutable state and no `Math.random`: a caller constructs an
 * `Rng` from a seed and threads it through the work. The hash is FNV-1a with a 32-bit
 * avalanche finaliser, the generator is mulberry32 with `Math.imul` arithmetic, so the
 * sequence is bit-identical on every JavaScript engine and every process.
 */

const UINT32 = 4294967296;
const UINT32_MAX = 4294967295;

/** Final avalanche mix of a 32-bit word (xmur3-style). Deterministic and uint32. */
export function avalanche32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Hash any string to a uint32. The same string always yields the same number. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return avalanche32(h);
}

/** Mix two 32-bit seeds into one. Used to derive independent streams from a seed. */
export function mixSeeds(a: number, b: number): number {
  // Ordered: mixSeeds(1, 2) and mixSeeds(2, 1) are different draws.
  let h = a >>> 0;
  h = Math.imul(h ^ 0x9e3779b1, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (b >>> 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return avalanche32(h);
}

/** One weighted choice: `value` is returned with probability `weight / sum(weights)`. */
export interface Weighted<T> {
  readonly value: T;
  readonly weight: number;
}

/**
 * A seeded generator. Every method consumes the stream; there is no way to read the
 * stream without advancing it except by re-seeding a new instance.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    const base = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    // mulberry32 tolerates any 32-bit state, but a zero state makes the first draw
    // uninteresting; the constant is only a visible kind of "empty seed".
    this.state = base || 0x9e3779b9;
  }

  /** Uniform in [0, 1). The atom every other helper is built from. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  }

  /** Uniform float in [min, max). Throws on a non-finite or inverted range. */
  float(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error(`Rng.float: non-finite range [${min}, ${max}]`);
    }
    if (!(min <= max)) {
      throw new Error(`Rng.float: inverted range [${min}, ${max}]`);
    }
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max], both ends inclusive. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error(`Rng.int: non-integer bounds [${min}, ${max}]`);
    }
    if (max < min) {
      throw new Error(`Rng.int: inverted range [${min}, ${max}]`);
    }
    const span = max - min + 1;
    const draw = Math.floor(this.next() * span);
    // The floor can only reach `span` if next() is 1; it never is, but clamping costs
    // nothing and keeps a broken generator from returning an out-of-range number.
    return min + (draw >= span ? span - 1 : draw);
  }

  /** A uniform pick from a non-empty array. Throws rather than return `undefined`. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    const index = Math.floor(this.next() * items.length);
    const item = items[index >= items.length ? items.length - 1 : index];
    if (item === undefined) throw new Error('Rng.pick: selected undefined element');
    return item;
  }

  /** A weighted pick. Empty / non-positive tables are a bug, so they throw. */
  weighted<T>(entries: readonly Weighted<T>[]): T {
    if (entries.length === 0) throw new Error('Rng.weighted: empty table');
    let total = 0;
    for (const entry of entries) {
      if (!Number.isFinite(entry.weight) || entry.weight < 0) {
        throw new Error(`Rng.weighted: invalid weight ${entry.weight}`);
      }
      total += entry.weight;
    }
    if (!(total > 0)) throw new Error('Rng.weighted: weights sum to zero');
    let roll = this.next() * total;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll < 0) return entry.value;
    }
    // Floating-point slack: the last entry with a positive weight owns the remainder.
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry && entry.weight > 0) return entry.value;
    }
    throw new Error('Rng.weighted: no positive weight');
  }

  /** True with probability `p`. `p <= 0` is never, `p >= 1` is always. */
  chance(p: number): boolean {
    if (!Number.isFinite(p)) throw new Error(`Rng.chance: non-finite probability ${p}`);
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /**
   * Standard normal via Box–Muller. Two uniforms in, two normals out — the second is
   * cached for the next call, so there is no rejection loop that could run long or
   * take a different number of draws on a different engine.
   */
  gaussian(mean = 0, sd = 1): number {
    if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd < 0) {
      throw new Error(`Rng.gaussian: invalid mean/sd (${mean}, ${sd})`);
    }
    if (this.hasSpare) {
      this.hasSpare = false;
      return mean + sd * this.spare;
    }
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    const radius = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    this.spare = radius * Math.sin(theta);
    this.hasSpare = true;
    return mean + sd * radius * Math.cos(theta);
  }

  private hasSpare = false;
  private spare = 0;

  /** A shuffled copy (Fisher–Yates). The input array is not modified. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const a = out[i];
      const b = out[j];
      if (a === undefined || b === undefined) throw new Error('Rng.shuffle: hole in array');
      out[i] = b;
      out[j] = a;
    }
    return out;
  }

  /** An independent stream derived from this generator's current state and a label. */
  fork(label: string): Rng {
    return new Rng(mixSeeds(this.state, hashString(label)));
  }

  /** A copy of the current uint32 state (tests, debugging). */
  snapshot(): number {
    return this.state;
  }
}

/**
 * A Poisson sample with mean `lambda` (Knuth), bounded so a bad `lambda` cannot spin:
 * the loop stops after 64 draws, which is far beyond the counts generation asks for
 * (planet and moon counts, both single-digit means).
 */
export function poisson(rng: Rng, lambda: number): number {
  if (!Number.isFinite(lambda) || lambda < 0) {
    throw new Error(`poisson: invalid mean ${lambda}`);
  }
  if (lambda === 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng.next();
  } while (p > limit && k <= 64);
  return k - 1;
}

/** A random uint32, for seeds stored in the data contract. */
export function randomSeed(rng: Rng): number {
  return rng.int(0, UINT32_MAX);
}
