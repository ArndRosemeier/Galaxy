import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PARAMS,
  PARAM_SPECS,
  PRESETS,
  clampParams,
  generateGalaxy,
  paramSpec,
} from '../../src/sim';
import type { NumericParamKey } from '../../src/sim';

const NUMERIC_KEYS: readonly NumericParamKey[] = [
  'systemCount',
  'arms',
  'armTwist',
  'armSpread',
  'coreDensity',
  'galaxyRadius',
  'ageGyr',
  'metallicity',
  'lifeChance',
  'hazard',
];

describe('parameter specs', () => {
  it('describes every numeric knob exactly once', () => {
    expect(PARAM_SPECS).toHaveLength(NUMERIC_KEYS.length);
    expect(PARAM_SPECS.map((spec) => spec.key).sort()).toEqual([...NUMERIC_KEYS].sort());
    for (const key of NUMERIC_KEYS) {
      expect(paramSpec(key).key).toBe(key);
    }
  });

  it('has legal bounds, honest labels and a working formatter', () => {
    for (const spec of PARAM_SPECS) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.hint.length).toBeGreaterThan(20);
      expect(spec.bounds.step).toBeGreaterThan(0);
      expect(spec.bounds.min).toBeLessThan(spec.bounds.max);
      for (const value of [spec.bounds.min, DEFAULT_PARAMS[spec.key], spec.bounds.max]) {
        const text = spec.format(value);
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/NaN|undefined/);
      }
      expect(spec.lowLabel?.length).toBeGreaterThan(0);
      expect(spec.highLabel?.length).toBeGreaterThan(0);
    }
  });

  it('defaults live inside their own bounds', () => {
    for (const spec of PARAM_SPECS) {
      const value = DEFAULT_PARAMS[spec.key];
      expect(value).toBeGreaterThanOrEqual(spec.bounds.min);
      expect(value).toBeLessThanOrEqual(spec.bounds.max);
    }
  });
});

describe('clampParams', () => {
  it('round-trips the defaults', () => {
    expect(clampParams(DEFAULT_PARAMS)).toEqual(DEFAULT_PARAMS);
  });

  it('merges a partial set onto the defaults', () => {
    const result = clampParams({ seed: 'partial', arms: 3 });
    expect(result.seed).toBe('partial');
    expect(result.arms).toBe(3);
    expect(result.systemCount).toBe(DEFAULT_PARAMS.systemCount);
    expect(result.lifeChance).toBe(DEFAULT_PARAMS.lifeChance);
  });

  it('clamps every knob to its bounds', () => {
    const low = clampParams({
      systemCount: -50,
      arms: -1,
      armTwist: -2,
      armSpread: -1,
      coreDensity: -2,
      galaxyRadius: 10,
      ageGyr: 0,
      metallicity: -1,
      lifeChance: -1,
      hazard: -1,
    });
    const high = clampParams({
      systemCount: 10_000,
      arms: 99,
      armTwist: 9,
      armSpread: 9,
      coreDensity: 9,
      galaxyRadius: 99_999,
      ageGyr: 99,
      metallicity: 9,
      lifeChance: 9,
      hazard: 9,
    });
    for (const spec of PARAM_SPECS) {
      expect(low[spec.key]).toBe(spec.bounds.min);
      expect(high[spec.key]).toBe(spec.bounds.max);
    }
  });

  it('snaps values to the slider step', () => {
    const result = clampParams({ ageGyr: 3.14159, armTwist: 0.123, systemCount: 100.4 });
    expect(result.ageGyr).toBe(3.1);
    expect(result.armTwist).toBe(0.1);
    expect(result.systemCount).toBe(100);
  });

  it('keeps a seed as user text, including an empty one', () => {
    expect(clampParams({ seed: '' }).seed).toBe('');
    expect(clampParams({ seed: '  spaces and punctuation! ' }).seed).toBe(
      '  spaces and punctuation! ',
    );
  });

  it('fails loudly on a non-finite number', () => {
    expect(() => clampParams({ systemCount: Number.NaN })).toThrow();
    expect(() => clampParams({ ageGyr: Number.POSITIVE_INFINITY })).toThrow();
  });
});

describe('presets', () => {
  it('offers six distinct, fully specified galaxies', () => {
    expect(PRESETS).toHaveLength(6);
    const ids = new Set<string>();
    const seeds = new Set<string>();
    for (const preset of PRESETS) {
      expect(preset.id.length).toBeGreaterThan(0);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.blurb.length).toBeGreaterThan(20);
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
      expect(seeds.has(preset.params.seed)).toBe(false);
      seeds.add(preset.params.seed);
      for (const spec of PARAM_SPECS) {
        expect(preset.params[spec.key]).toBeGreaterThanOrEqual(spec.bounds.min);
        expect(preset.params[spec.key]).toBeLessThanOrEqual(spec.bounds.max);
      }
    }
  });

  it('generates a different galaxy for every preset', () => {
    const hashes = PRESETS.map((preset) => JSON.stringify(generateGalaxy(preset.params)));
    expect(new Set(hashes).size).toBe(PRESETS.length);
  });
});
