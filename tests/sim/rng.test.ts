import { describe, expect, it } from 'vitest';

import {
  Rng,
  avalanche32,
  hashString,
  mixSeeds,
  poisson,
  randomSeed,
} from '../../src/sim/rng';

describe('hashing', () => {
  it('is stable and spreads similar strings to different words', () => {
    expect(hashString('galaxy')).toBe(hashString('galaxy'));
    expect(hashString('galaxy')).not.toBe(hashString('galaxz'));
    for (const value of [0, 1, 0xffff_ffff, 0x8000_0000, 123_456]) {
      expect(Number.isInteger(avalanche32(value))).toBe(true);
      expect(avalanche32(value)).toBeGreaterThanOrEqual(0);
      expect(avalanche32(value)).toBeLessThanOrEqual(0xffff_ffff);
    }
    expect(mixSeeds(1, 2)).toBe(mixSeeds(1, 2));
    expect(mixSeeds(1, 2)).not.toBe(mixSeeds(2, 1));
  });
});

describe('Rng', () => {
  it('replays the same stream from the same seed, and differs from another seed', () => {
    const a = new Rng('atlas');
    const b = new Rng('atlas');
    const c = new Rng('atlas!');
    const streamA = Array.from({ length: 32 }, () => a.next());
    const streamB = Array.from({ length: 32 }, () => b.next());
    const streamC = Array.from({ length: 32 }, () => c.next());
    expect(streamA).toEqual(streamB);
    expect(streamA).not.toEqual(streamC);
    for (const value of streamA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('returns integers inside [min, max], both ends reachable', () => {
    const rng = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i += 1) {
      const value = rng.int(-3, 4);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThanOrEqual(4);
      seen.add(value);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-3, -2, -1, 0, 1, 2, 3, 4]);
  });

  it('returns floats inside [min, max)', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 1_000; i += 1) {
      const value = rng.float(-2.5, 8.25);
      expect(value).toBeGreaterThanOrEqual(-2.5);
      expect(value).toBeLessThan(8.25);
    }
  });

  it('picks elements and rejects an empty array', () => {
    const rng = new Rng(11);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(rng.pick(items));
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
    expect(() => rng.pick([])).toThrow();
  });

  it('respects weighted probabilities', () => {
    const rng = new Rng('weights');
    const counts = { common: 0, rare: 0 };
    const draws = 20_000;
    for (let i = 0; i < draws; i += 1) {
      counts[rng.weighted([
        { value: 'common' as const, weight: 3 },
        { value: 'rare' as const, weight: 1 },
      ])] += 1;
    }
    expect(counts.common / draws).toBeGreaterThan(0.72);
    expect(counts.common / draws).toBeLessThan(0.78);
    expect(counts.rare).toBeGreaterThan(0);
    expect(() => rng.weighted([])).toThrow();
    expect(() => rng.weighted([{ value: 'x', weight: 0 }])).toThrow();
  });

  it('treats chance(0) and chance(1) as certainties and chance(0.5) as balanced', () => {
    const rng = new Rng('chance');
    let hits = 0;
    for (let i = 0; i < 20_000; i += 1) {
      if (rng.chance(0.5)) hits += 1;
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
    expect(hits / 20_000).toBeGreaterThan(0.48);
    expect(hits / 20_000).toBeLessThan(0.52);
  });

  it('produces a gaussian with the requested mean and deviation, and no NaN', () => {
    const rng = new Rng('normal');
    let sum = 0;
    let sumSquares = 0;
    const n = 20_000;
    for (let i = 0; i < n; i += 1) {
      const value = rng.gaussian(5, 2);
      expect(Number.isFinite(value)).toBe(true);
      sum += value;
      sumSquares += (value - 5) ** 2;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSquares / n);
    expect(mean).toBeGreaterThan(4.93);
    expect(mean).toBeLessThan(5.07);
    expect(sd).toBeGreaterThan(1.9);
    expect(sd).toBeLessThan(2.1);
  });

  it('shuffles a copy, deterministically, without losing elements', () => {
    const rng = new Rng('shuffle');
    const source = Array.from({ length: 40 }, (_, index) => index);
    const first = rng.shuffle(source);
    const second = new Rng('shuffle').shuffle(source);
    expect(first).toEqual(second);
    expect(first).not.toEqual(source);
    expect([...first].sort((a, b) => a - b)).toEqual(source);
    expect(source).toEqual(Array.from({ length: 40 }, (_, index) => index));
  });

  it('forks independent, reproducible streams', () => {
    const parent = new Rng('fork');
    const left = parent.fork('left');
    const right = parent.fork('right');
    const leftAgain = parent.fork('left');
    expect(left.next()).toBe(leftAgain.next());
    expect(left.next()).not.toBe(right.next());
  });

  it('samples a bounded Poisson count and a uint32 seed', () => {
    const rng = new Rng('poisson');
    let total = 0;
    for (let i = 0; i < 5_000; i += 1) {
      const value = poisson(rng, 4);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      total += value;
    }
    expect(total / 5_000).toBeGreaterThan(3.7);
    expect(total / 5_000).toBeLessThan(4.3);
    for (let i = 0; i < 100; i += 1) {
      const seed = randomSeed(rng);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffff_ffff);
    }
  });

  it('exposes its state without advancing it', () => {
    const rng = new Rng('snapshot');
    const before = rng.snapshot();
    expect(rng.snapshot()).toBe(before);
    rng.next();
    expect(rng.snapshot()).not.toBe(before);
  });
});
