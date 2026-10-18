import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../../src/sim/params';
import {
  galaxySummary,
  interactionHint,
  kindLabel,
  lifeLabel,
  plural,
  spectralNote,
} from '../../src/ui/labels';

describe('ui vocabulary', () => {
  it('names every planet kind and life level the sim can produce', () => {
    expect(kindLabel('gas')).toBe('Gas giant');
    expect(kindLabel('icegiant')).toBe('Ice giant');
    expect(kindLabel('ocean')).toBe('Ocean world');
    expect(kindLabel('barren')).toBe('Barren world');
    expect(lifeLabel('microbial')).toBe('Microbial life');
    expect(lifeLabel('civilization')).toBe('Civilization');
    expect(lifeLabel('none')).toBe('No detected life');
    expect(spectralNote('G')).toBe('yellow star');
    expect(spectralNote('BH')).toBe('black hole');
  });

  it('summarises the galaxy in one human sentence', () => {
    expect(galaxySummary(DEFAULT_PARAMS)).toBe(
      'A four-armed spiral of 180 star systems, 8.6 billion years old.',
    );
    expect(
      galaxySummary({ ...DEFAULT_PARAMS, arms: 2, systemCount: 58, ageGyr: 12.6 }),
    ).toBe('A two-armed spiral of 58 star systems, 12.6 billion years old.');
  });

  it('pluralises counts', () => {
    expect(plural(1, 'moon')).toBe('1 moon');
    expect(plural(3, 'moon')).toBe('3 moons');
    expect(plural(0, 'world')).toBe('0 worlds');
    expect(plural(1200, 'star system')).toBe('1,200 star systems');
  });

  it('adapts the gesture hint to touch', () => {
    expect(interactionHint(false)).toBe(
      'drag to orbit · scroll to zoom · click to select · Esc to go back',
    );
    expect(interactionHint(true)).not.toMatch(/scroll|click/);
  });
});
