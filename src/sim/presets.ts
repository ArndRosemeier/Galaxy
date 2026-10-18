/**
 * Presets — named galaxies the UI can apply with one click.
 *
 * Presets are data, not code: each one is a seed plus the same parameter set the sliders
 * edit. They are clamped through `clampParams` at construction so a typo in a preset can
 * never become an illegal galaxy.
 */

import type { GalaxyParams, GalaxyPreset } from './types';
import { DEFAULT_PARAMS, clampParams } from './params';

function preset(
  id: string,
  label: string,
  blurb: string,
  overrides: Partial<GalaxyParams>,
): GalaxyPreset {
  return {
    id,
    label,
    blurb,
    params: clampParams({ ...DEFAULT_PARAMS, ...overrides }),
  };
}

/** Six galaxies with genuinely different characters. */
export const PRESETS: readonly GalaxyPreset[] = [
  preset(
    'milky-way',
    'Milky Way-like',
    'A mature four-armed spiral with a bright bulge, a wide disc and a long history of worlds.',
    {
      seed: 'milky-way',
      systemCount: 280,
      arms: 4,
      armTwist: 1.05,
      armSpread: 0.5,
      coreDensity: 0.62,
      galaxyRadius: 1200,
      ageGyr: 9.2,
      metallicity: 0.62,
      lifeChance: 0.34,
      hazard: 0.36,
    },
  ),
  preset(
    'grand-design',
    'Grand Design',
    'Two clean, sweeping arms and a small core: the textbook pinwheel, seen from just above the plane.',
    {
      seed: 'whirlpool',
      systemCount: 220,
      arms: 2,
      armTwist: 1.55,
      armSpread: 0.28,
      coreDensity: 0.42,
      galaxyRadius: 1400,
      ageGyr: 7.4,
      metallicity: 0.55,
      lifeChance: 0.3,
      hazard: 0.42,
    },
  ),
  preset(
    'flocculent',
    'Flocculent',
    'Many short, ragged arm fragments instead of grand sweeps — a patchy disc full of busy systems.',
    {
      seed: 'ngc-7793',
      systemCount: 250,
      arms: 6,
      armTwist: 0.75,
      armSpread: 0.88,
      coreDensity: 0.28,
      galaxyRadius: 1000,
      ageGyr: 6.1,
      metallicity: 0.7,
      lifeChance: 0.4,
      hazard: 0.62,
    },
  ),
  preset(
    'ancient',
    'Ancient & Quiet',
    'Old, metal-rich and slow: a settled spiral where white dwarfs outnumber hot young stars.',
    {
      seed: 'sculptor-deep',
      systemCount: 170,
      arms: 4,
      armTwist: 1.25,
      armSpread: 0.66,
      coreDensity: 0.7,
      galaxyRadius: 950,
      ageGyr: 12.6,
      metallicity: 0.85,
      lifeChance: 0.5,
      hazard: 0.18,
    },
  ),
  preset(
    'young-violent',
    'Young & Violent',
    'A hot, metal-poor disc still ringing from mergers: rare stars, violent weather, little life.',
    {
      seed: 'ngc-4038',
      systemCount: 200,
      arms: 2,
      armTwist: 1.85,
      armSpread: 0.74,
      coreDensity: 0.34,
      galaxyRadius: 1500,
      ageGyr: 1.8,
      metallicity: 0.2,
      lifeChance: 0.07,
      hazard: 0.85,
    },
  ),
  preset(
    'sparse-outpost',
    'Sparse Outpost',
    'A small, lonely disc at the edge of the catalogue: few stars, long silences, one bright core.',
    {
      seed: 'outpost-7',
      systemCount: 58,
      arms: 3,
      armTwist: 1,
      armSpread: 0.8,
      coreDensity: 0.24,
      galaxyRadius: 800,
      ageGyr: 10.1,
      metallicity: 0.36,
      lifeChance: 0.2,
      hazard: 0.28,
    },
  ),
];
