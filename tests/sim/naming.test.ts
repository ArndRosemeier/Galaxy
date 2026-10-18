import { describe, expect, it } from 'vitest';

import { Rng } from '../../src/sim/rng';
import {
  beltName,
  moonName,
  planetName,
  romanNumeral,
  starName,
  uniqueStarName,
} from '../../src/sim/naming';

/** An Rng whose stream is stuck, so name generators always see the same first candidate. */
class StuckRng extends Rng {
  override next(): number {
    return 0;
  }
}

describe('Roman numerals', () => {
  it('formats the planet range and the classical cases', () => {
    expect(romanNumeral(1)).toBe('I');
    expect(romanNumeral(4)).toBe('IV');
    expect(romanNumeral(9)).toBe('IX');
    expect(romanNumeral(14)).toBe('XIV');
    expect(romanNumeral(40)).toBe('XL');
    expect(romanNumeral(1994)).toBe('MCMXCIV');
    expect(romanNumeral(3999)).toBe('MMMCMXCIX');
  });

  it('rejects values outside 1..3999', () => {
    expect(() => romanNumeral(0)).toThrow();
    expect(() => romanNumeral(4_000)).toThrow();
    expect(() => romanNumeral(1.5)).toThrow();
  });
});

describe('star names', () => {
  it('produces every style in its documented shape', () => {
    expect(starName(new Rng(1), 'catalogue')).toMatch(/^[A-Z]{2}-\d{3,4}$/);
    expect(starName(new Rng(1), 'named')).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(starName(new Rng(1), 'possessive')).toMatch(/^[A-Z][a-z]+'s [A-Z][a-z]+$/);
    expect(starName(new Rng(1), 'greek')).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(starName(new Rng(1), 'hyphenated')).toMatch(/^[A-Z][a-z]+-\d{1,2}$/);
  });

  it('gives one galaxy no duplicate star names', () => {
    const rng = new Rng('atlas');
    const used = new Set<string>();
    for (let i = 0; i < 5_000; i += 1) {
      const name = uniqueStarName(rng, used);
      expect(used.has(name)).toBe(true);
    }
    expect(used.size).toBe(5_000);
  });

  it('resolves a forced collision deterministically instead of looping', () => {
    const base = starName(new StuckRng(3), 'catalogue');
    const used = new Set<string>([base]);
    const name = uniqueStarName(new StuckRng(3), used);
    expect(name).not.toBe(base);
    expect(name).toBe(`${base} II`);
    expect(uniqueStarName(new StuckRng(3), new Set([base, name]))).toBe(`${base} III`);
  });

  it('is reproducible for a given stream', () => {
    const a = new Rng('repeat');
    const b = new Rng('repeat');
    for (let i = 0; i < 100; i += 1) expect(starName(a)).toBe(starName(b));
  });
});

describe('derived names', () => {
  it('numbers planets with Roman numerals and moons with letters', () => {
    expect(planetName('Vega Reach', 0)).toBe('Vega Reach I');
    expect(planetName('Vega Reach', 8)).toBe('Vega Reach IX');
    expect(moonName('Vega Reach III', 0)).toBe('Vega Reach III a');
    expect(moonName('Vega Reach III', 5)).toBe('Vega Reach III f');
    expect(() => moonName('Vega Reach III', 26)).toThrow();
    expect(() => planetName('', 0)).toThrow();
  });

  it('names the two belt kinds unambiguously', () => {
    expect(beltName('Tycho’s Lantern', 'asteroid')).toBe('Tycho’s Lantern Asteroid Belt');
    expect(beltName('Tycho’s Lantern', 'kuiper')).toBe('Tycho’s Lantern Kuiper Belt');
  });
});
