import { describe, expect, it } from 'vitest';

import { ValueNoise, valueNoise2, valueNoise3 } from '../../src/sim/noise';

describe('value noise', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = new ValueNoise('atlas');
    const b = new ValueNoise('atlas');
    const c = new ValueNoise('other');
    const samples = Array.from({ length: 100 }, (_, i) => a.noise2(i * 0.37, i * 0.11));
    expect(samples).toEqual(Array.from({ length: 100 }, (_, i) => b.noise2(i * 0.37, i * 0.11)));
    expect(samples).not.toEqual(Array.from({ length: 100 }, (_, i) => c.noise2(i * 0.37, i * 0.11)));
  });

  it('stays inside [-1, 1] for 2D and 3D value noise', () => {
    const noise = new ValueNoise(1234);
    let min2 = Infinity;
    let max2 = -Infinity;
    let min3 = Infinity;
    let max3 = -Infinity;
    for (let i = 0; i < 4_000; i += 1) {
      const x = (i % 61) * 0.31 - 8;
      const y = Math.floor(i / 61) * 0.27 - 4;
      const z = i * 0.013 - 3;
      const v2 = noise.noise2(x, y);
      const v3 = noise.noise3(x, y, z);
      min2 = Math.min(min2, v2);
      max2 = Math.max(max2, v2);
      min3 = Math.min(min3, v3);
      max3 = Math.max(max3, v3);
    }
    expect(min2).toBeGreaterThanOrEqual(-1);
    expect(max2).toBeLessThanOrEqual(1);
    expect(min3).toBeGreaterThanOrEqual(-1);
    expect(max3).toBeLessThanOrEqual(1);
  });

  it('is continuous: a small step changes the value only a little', () => {
    const noise = new ValueNoise('smooth');
    let maxStep = 0;
    let previous = noise.noise2(-7.3, 2.9);
    for (let i = 1; i < 2_000; i += 1) {
      const value = noise.noise2(-7.3 + i * 0.004, 2.9 + i * 0.001);
      maxStep = Math.max(maxStep, Math.abs(value - previous));
      previous = value;
    }
    expect(maxStep).toBeLessThan(0.1);
  });

  it('agrees with the free-function form', () => {
    const noise = new ValueNoise(0xdead_beef);
    for (let i = 0; i < 50; i += 1) {
      const x = i * 0.53 - 3;
      const y = i * 0.21;
      const z = i * 0.07;
      expect(noise.noise2(x, y)).toBe(valueNoise2(noise.seed, x, y));
      expect(noise.noise3(x, y, z)).toBe(valueNoise3(noise.seed, x, y, z));
    }
  });

  it('normalises fBm to [-1, 1] and adds detail with each octave', () => {
    const noise = new ValueNoise('fbm');
    const values: number[] = [];
    for (let i = 0; i < 2_000; i += 1) {
      const value = noise.fbm2(i * 0.07, i * 0.031, 5, 2, 0.5);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
      values.push(value);
    }
    expect(new Set(values).size).toBeGreaterThan(1_000);
    expect(noise.fbm3(0.1, 0.2, 0.3, 3, 2, 0.5)).toBeCloseTo(
      new ValueNoise('fbm').fbm3(0.1, 0.2, 0.3, 3, 2, 0.5),
      15,
    );
  });

  it('rejects invalid parameters loudly', () => {
    const noise = new ValueNoise('validate');
    expect(() => noise.fbm2(0, 0, 0)).toThrow();
    expect(() => noise.fbm2(0, 0, 13)).toThrow();
    expect(() => noise.fbm2(0, 0, 4, 0)).toThrow();
    expect(() => noise.fbm2(0, 0, 4, 2, 1.5)).toThrow();
    expect(() => noise.noise2(Number.NaN, 0)).toThrow();
    expect(() => valueNoise3(1, 0, 0, Number.POSITIVE_INFINITY)).toThrow();
  });
});
