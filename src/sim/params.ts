/**
 * Parameters — the user's knobs and the app's defaults.
 *
 * This is the single source of truth for each knob's bounds, display metadata and the
 * default galaxy. The UI renders sliders from `PARAM_SPECS`; `clampParams` is the one
 * place a value from the URL, a preset or a slider becomes a legal `GalaxyParams`.
 */

import type { GalaxyParams, NumericParamKey, ParamBounds, ParamSpec } from './types';
import { clamp, roundTo } from './util';

/**
 * The galaxy the app opens with: a four-armed spiral, varied, neither crowded nor
 * sparse. The seed is content, not a hash: it was chosen so the default 180-system
 * galaxy contains a real spread of worlds (including a civilization) on first load.
 */
export const DEFAULT_PARAMS: GalaxyParams = {
  seed: 'pleiades',
  systemCount: 180,
  arms: 4,
  armTwist: 1.15,
  armSpread: 0.55,
  coreDensity: 0.5,
  galaxyRadius: 1100,
  ageGyr: 8.6,
  metallicity: 0.5,
  lifeChance: 0.25,
  hazard: 0.35,
};

const integerFormat = (value: number): string => String(Math.round(value));
const fixed2 = (value: number): string => value.toFixed(2);
const fixed1 = (value: number): string => value.toFixed(1);
const wholePercent = (value: number): string => `${Math.round(value * 100)}%`;

/**
 * Display metadata for every numeric knob. Bounds here are the UI's practical bounds and
 * `clampParams` clamps to exactly these — one table, so a slider can never offer a value
 * generation would reject.
 */
export const PARAM_SPECS: readonly ParamSpec[] = [
  {
    key: 'systemCount',
    label: 'Systems',
    hint: 'How many stars the map contains. More systems make the arms denser and the atlas larger.',
    bounds: { min: 24, max: 600, step: 1 },
    format: integerFormat,
    lowLabel: 'intimate',
    highLabel: 'vast',
  },
  {
    key: 'arms',
    label: 'Spiral arms',
    hint: 'The number of dominant arms. Two reads as a grand design; five or six as a flocculent disc.',
    bounds: { min: 2, max: 6, step: 1 },
    format: integerFormat,
    lowLabel: 'grand design',
    highLabel: 'flocculent',
  },
  {
    key: 'armTwist',
    label: 'Arm twist',
    hint: 'How far the arms wrap around the disc. Low values leave open spiral streaks; high values wind them tight.',
    bounds: { min: 0, max: 2.2, step: 0.05 },
    format: fixed2,
    lowLabel: 'open',
    highLabel: 'wound',
  },
  {
    key: 'armSpread',
    label: 'Arm scatter',
    hint: 'How far stars drift off the arm centreline. Raise it until the arms dissolve into an even disc.',
    bounds: { min: 0, max: 1, step: 0.01 },
    format: fixed2,
    lowLabel: 'crisp',
    highLabel: 'diffuse',
  },
  {
    key: 'coreDensity',
    label: 'Core density',
    hint: 'Weight of the central bulge. A dense core reads as a bright nucleus; a low one as a ring galaxy.',
    bounds: { min: 0, max: 1, step: 0.01 },
    format: fixed2,
    lowLabel: 'open centre',
    highLabel: 'bright nucleus',
  },
  {
    key: 'galaxyRadius',
    label: 'Radius',
    hint: 'Map radius in galaxy units, core to rim. It changes the scale of the map, not the physics of its worlds.',
    bounds: { min: 400, max: 2000, step: 25 },
    format: integerFormat,
    lowLabel: 'compact',
    highLabel: 'wide',
  },
  {
    key: 'ageGyr',
    label: 'Age',
    hint: 'Galaxy age in gigayears. Young galaxies are blue and violent; ancient ones are quiet and accumulate stellar remnants.',
    bounds: { min: 1, max: 13.5, step: 0.1 },
    format: fixed1,
    lowLabel: 'young',
    highLabel: 'ancient',
  },
  {
    key: 'metallicity',
    label: 'Metallicity',
    hint: 'Heavy-element richness. Low metallicity means fewer rocky worlds and thinner discs of debris.',
    bounds: { min: 0, max: 1, step: 0.01 },
    format: wholePercent,
    lowLabel: 'primitive',
    highLabel: 'metal-rich',
  },
  {
    key: 'lifeChance',
    label: 'Life chance',
    hint: 'How readily biology takes hold on a temperate, watery world. Zero is a sterile galaxy.',
    bounds: { min: 0, max: 1, step: 0.01 },
    format: wholePercent,
    lowLabel: 'sterile',
    highLabel: 'teeming',
  },
  {
    key: 'hazard',
    label: 'Hazards',
    hint: 'Abundance of rings, asteroid belts and debris. Zero leaves clean, empty orbits.',
    bounds: { min: 0, max: 1, step: 0.01 },
    format: wholePercent,
    lowLabel: 'clean',
    highLabel: 'chaotic',
  },
];

const BOUNDS_BY_KEY: ReadonlyMap<NumericParamKey, ParamBounds> = new Map(
  PARAM_SPECS.map((spec) => [spec.key, spec.bounds] as const),
);

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

function decimalsForStep(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

function clampNumeric(key: NumericParamKey, raw: number): number {
  if (!Number.isFinite(raw)) {
    throw new Error(`clampParams: ${key} is not a finite number (${String(raw)})`);
  }
  const bounds = BOUNDS_BY_KEY.get(key);
  if (!bounds) throw new Error(`clampParams: no bounds for ${key}`);
  const decimals = decimalsForStep(bounds.step);
  const snapped = bounds.min + Math.round((raw - bounds.min) / bounds.step) * bounds.step;
  return roundTo(clamp(snapped, bounds.min, bounds.max), decimals);
}

/**
 * Merge a partial parameter set onto the defaults and clamp every numeric knob to the
 * bounds in `PARAM_SPECS`. This is the boundary the URL, presets and slider edits cross;
 * generation itself may assume legal values.
 */
export function clampParams(input: Partial<GalaxyParams>): GalaxyParams {
  const seed = input.seed ?? DEFAULT_PARAMS.seed;
  if (typeof seed !== 'string') {
    throw new Error(`clampParams: seed must be a string (got ${typeof seed})`);
  }
  const values = {} as Record<NumericParamKey, number>;
  for (const key of NUMERIC_KEYS) {
    const raw = input[key] ?? DEFAULT_PARAMS[key];
    values[key] = clampNumeric(key, raw);
  }
  return {
    seed,
    systemCount: values.systemCount,
    arms: values.arms,
    armTwist: values.armTwist,
    armSpread: values.armSpread,
    coreDensity: values.coreDensity,
    galaxyRadius: values.galaxyRadius,
    ageGyr: values.ageGyr,
    metallicity: values.metallicity,
    lifeChance: values.lifeChance,
    hazard: values.hazard,
  };
}

/** The spec for one knob (throws if the key is unknown — it is a closed type). */
export function paramSpec(key: NumericParamKey): ParamSpec {
  const spec = PARAM_SPECS.find((candidate) => candidate.key === key);
  if (!spec) throw new Error(`paramSpec: unknown key ${String(key)}`);
  return spec;
}
