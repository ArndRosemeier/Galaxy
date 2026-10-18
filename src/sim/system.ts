/**
 * System generation — the star plus its worlds, moons, rings and belts.
 *
 * `generateSystem(stub)` is a pure function of the stub. The star comes back out of the
 * same `stellarProfile` the galaxy used, so a stub and its system can never disagree
 * about the star's colour or brightness.
 *
 * Everything is derived from the stub's seed through independent sub-streams (layout,
 * one per planet, one for surface, rings, moons, belts). That has two consequences worth
 * naming: determinism is automatic, and changing one user knob (say `lifeChance`) cannot
 * reshuffle an unrelated planet's mountains.
 *
 * The physics is plausible, not simulated — standard bulk-density, equilibrium
 * temperature, Hill-sphere and fluid-Roche relations, with the orbital period always
 * coming from `src/sim/orbit.ts`.
 */

import type {
  Atmosphere,
  AsteroidBelt,
  Biosphere,
  Hydrosphere,
  LifeLevel,
  Moon,
  Orbit,
  Planet,
  PlanetKind,
  RingSystem,
  Rgb,
  Star,
  StarSystem,
  SurfaceSpec,
  SystemContext,
  SystemStub,
} from './types';
import { orbitalPeriodDays } from './orbit';
import { Rng, mixSeeds, poisson, randomSeed, type Weighted } from './rng';
import {
  CMB_TEMPERATURE_K,
  EARTH_RADIUS_KM,
  starRadiusAU,
  bulkMassEarth,
  equilibriumTemperatureK,
  gravityG,
  hillRadiusKm,
  moonPeriodDays,
  rocheLimitKm,
} from './physics';
import { spectralLabel, starFromProfile, stellarProfile } from './stars';
import { beltName, moonName, planetName } from './naming';
import { clamp, percent, roundSig, roundTo } from './util';

const LAYOUT_STREAM = 0x1a2b3c4d;
const PLANET_STREAM = 0x6d5e4f3a;
const BODY_STREAM = 0x2f8e7d61;
const SURFACE_STREAM = 0x53c9b8a7;
const RING_STREAM = 0x79a6b5c4;
const MOON_STREAM = 0x4b1d2e3f;
const BELT_STREAM = 0x8c7d6e5f;

const MAX_PLANETS = 9;
const MAX_MOONS = 6;

/** Documented defaults for a stub authored without a context (tests, debug tools). */
const DEFAULT_CONTEXT: SystemContext = {
  metallicity: 0.5,
  ageGyr: 8.6,
  lifeChance: 0.25,
  hazard: 0.35,
};

type SizeClass = 'rocky' | 'neptune' | 'giant';

interface DensityRange {
  readonly min: number;
  readonly max: number;
}

/** Bulk density ranges, g/cm³, per world kind. Giants are the low-density end. */
const DENSITY_BY_KIND: { readonly [K in PlanetKind]: DensityRange } = {
  terrestrial: { min: 4.1, max: 6.3 },
  ocean: { min: 2.9, max: 4.8 },
  desert: { min: 3.7, max: 5.8 },
  ice: { min: 1.15, max: 2.9 },
  lava: { min: 4.4, max: 6.6 },
  toxic: { min: 2.7, max: 5.2 },
  barren: { min: 2.6, max: 5.2 },
  gas: { min: 0.62, max: 1.55 },
  icegiant: { min: 0.95, max: 1.95 },
};

/** Bond albedo per kind; jittered per world, clamped well inside [0, 1]. */
const ALBEDO_BY_KIND: { readonly [K in PlanetKind]: number } = {
  terrestrial: 0.3,
  ocean: 0.22,
  desert: 0.34,
  ice: 0.62,
  lava: 0.12,
  toxic: 0.28,
  barren: 0.14,
  gas: 0.48,
  icegiant: 0.42,
};

const KIND_NOUN: { readonly [K in PlanetKind]: string } = {
  terrestrial: 'terrestrial world',
  ocean: 'ocean world',
  desert: 'desert world',
  ice: 'icy world',
  lava: 'lava world',
  toxic: 'toxic world',
  barren: 'barren world',
  gas: 'gas giant',
  icegiant: 'ice giant',
};

const GAS_NAMES: { readonly [gas: string]: string } = {
  H2: 'hydrogen',
  He: 'helium',
  CH4: 'methane',
  NH3: 'ammonia',
  H2O: 'water vapour',
  CO2: 'carbon dioxide',
  N2: 'nitrogen',
  O2: 'oxygen',
  Ar: 'argon',
  Ne: 'neon',
  SO2: 'sulfur dioxide',
  CO: 'carbon monoxide',
  Na: 'sodium',
};

/** Approximate infrared authority of each gas, relative to water vapour. */
const GREENHOUSE_POTENTIAL: { readonly [gas: string]: number } = {
  H2O: 1,
  CO2: 0.42,
  CH4: 1.6,
  SO2: 1,
  H2: 0.12,
  CO: 0.1,
  NH3: 0.7,
  N2: 0,
  O2: 0,
  Ar: 0,
  He: 0,
  Ne: 0,
  Na: 0,
};

interface Palette {
  readonly deep: Rgb;
  readonly low: Rgb;
  readonly mid: Rgb;
  readonly high: Rgb;
  readonly ice: Rgb;
  readonly water: Rgb | null;
}

const PALETTES: { readonly [K in PlanetKind]: Palette } = {
  terrestrial: {
    deep: [0.04, 0.09, 0.05],
    low: [0.11, 0.22, 0.1],
    mid: [0.3, 0.33, 0.18],
    high: [0.47, 0.43, 0.33],
    ice: [0.82, 0.87, 0.93],
    water: [0.04, 0.2, 0.45],
  },
  ocean: {
    deep: [0.01, 0.05, 0.16],
    low: [0.02, 0.16, 0.32],
    mid: [0.04, 0.3, 0.42],
    high: [0.55, 0.65, 0.62],
    ice: [0.85, 0.92, 0.98],
    water: [0.03, 0.32, 0.6],
  },
  desert: {
    deep: [0.18, 0.09, 0.05],
    low: [0.42, 0.22, 0.1],
    mid: [0.62, 0.4, 0.2],
    high: [0.78, 0.62, 0.42],
    ice: [0.82, 0.82, 0.86],
    water: [0.1, 0.28, 0.4],
  },
  ice: {
    deep: [0.06, 0.1, 0.16],
    low: [0.2, 0.3, 0.4],
    mid: [0.48, 0.6, 0.7],
    high: [0.82, 0.9, 0.96],
    ice: [0.92, 0.97, 1],
    water: null,
  },
  lava: {
    deep: [0.04, 0.02, 0.02],
    low: [0.18, 0.04, 0.01],
    mid: [0.55, 0.12, 0.02],
    high: [1, 0.55, 0.1],
    ice: [0.15, 0.12, 0.12],
    water: null,
  },
  toxic: {
    deep: [0.1, 0.1, 0.03],
    low: [0.28, 0.26, 0.05],
    mid: [0.55, 0.48, 0.12],
    high: [0.78, 0.72, 0.3],
    ice: [0.75, 0.78, 0.6],
    water: [0.4, 0.6, 0.1],
  },
  barren: {
    deep: [0.06, 0.06, 0.06],
    low: [0.18, 0.17, 0.16],
    mid: [0.34, 0.32, 0.3],
    high: [0.55, 0.52, 0.48],
    ice: [0.7, 0.72, 0.74],
    water: null,
  },
  gas: {
    deep: [0.16, 0.1, 0.06],
    low: [0.38, 0.24, 0.13],
    mid: [0.62, 0.48, 0.3],
    high: [0.86, 0.78, 0.62],
    ice: [0.75, 0.82, 0.9],
    water: null,
  },
  icegiant: {
    deep: [0.02, 0.1, 0.22],
    low: [0.05, 0.25, 0.45],
    mid: [0.18, 0.45, 0.66],
    high: [0.55, 0.8, 0.9],
    ice: [0.8, 0.92, 1],
    water: null,
  },
};

/** A colder Jovian palette: methane blues instead of warm tans. */
const COLD_GAS_PALETTE: Palette = {
  deep: [0.06, 0.1, 0.2],
  low: [0.14, 0.22, 0.36],
  mid: [0.3, 0.45, 0.6],
  high: [0.62, 0.78, 0.9],
  ice: [0.82, 0.9, 0.98],
  water: null,
};

function rgb(red: number, green: number, blue: number): Rgb {
  return [roundTo(clamp(red, 0, 1), 3), roundTo(clamp(green, 0, 1), 3), roundTo(clamp(blue, 0, 1), 3)];
}

function jitterColor(rng: Rng, base: Rgb, amount: number): Rgb {
  return rgb(
    base[0] + rng.gaussian(0, amount),
    base[1] + rng.gaussian(0, amount),
    base[2] + rng.gaussian(0, amount),
  );
}

/** A rounded angle in [0, 360), safe at the top of the circle. */
function angleDeg(rng: Rng): number {
  const value = roundTo(rng.float(0, 360), 1);
  return value >= 360 ? 0 : value;
}

function assertStub(stub: SystemStub): void {
  if (typeof stub.id !== 'string' || stub.id.length === 0) {
    throw new Error('generateSystem: stub.id must be a non-empty string');
  }
  if (typeof stub.name !== 'string' || stub.name.length === 0) {
    throw new Error(`generateSystem(${stub.id}): stub.name must be a non-empty string`);
  }
  const { x, y, z } = stub.position;
  if (![x, y, z].every(Number.isFinite)) {
    throw new Error(`generateSystem(${stub.id}): non-finite position`);
  }
  if (!Number.isInteger(stub.seed) || stub.seed < 0 || stub.seed > 0xffff_ffff) {
    throw new Error(`generateSystem(${stub.id}): stub.seed must be a uint32`);
  }
  if (!Number.isFinite(stub.brightness) || stub.brightness < 0 || stub.brightness > 1) {
    throw new Error(`generateSystem(${stub.id}): stub.brightness outside [0, 1]`);
  }
  for (const channel of stub.color) {
    if (!Number.isFinite(channel) || channel < 0 || channel > 1) {
      throw new Error(`generateSystem(${stub.id}): stub.color outside [0, 1]`);
    }
  }
  if (!['O', 'B', 'A', 'F', 'G', 'K', 'M', 'WD', 'NS', 'BH'].includes(stub.spectral)) {
    throw new Error(`generateSystem(${stub.id}): unknown spectral class ${String(stub.spectral)}`);
  }
}

function resolveContext(raw: SystemContext | undefined): SystemContext {
  if (!raw) return DEFAULT_CONTEXT;
  const fields = [raw.metallicity, raw.ageGyr, raw.lifeChance, raw.hazard];
  if (!fields.every(Number.isFinite)) {
    throw new Error('generateSystem: stub.context contains a non-finite value');
  }
  return {
    metallicity: clamp(raw.metallicity, 0, 1),
    ageGyr: clamp(raw.ageGyr, 1, 13.5),
    lifeChance: clamp(raw.lifeChance, 0, 1),
    hazard: clamp(raw.hazard, 0, 1),
  };
}

// ---------------------------------------------------------------------------
// Orbits
// ---------------------------------------------------------------------------

/** Number of planets from stellar mass and metallicity, 0..9. */
function planetCount(rng: Rng, starMassSun: number, metallicity: number): number {
  const massFactor =
    starMassSun < 2
      ? starMassSun ** 0.4
      : starMassSun ** 0.4 * (2 / starMassSun) ** 0.45;
  const expected = clamp(0.8 + 3.6 * massFactor * (0.45 + 1.05 * metallicity), 0.15, 9);
  return clamp(poisson(rng, expected), 0, MAX_PLANETS);
}

interface OrbitPlacement {
  readonly semiMajorAU: number;
  readonly eccentricity: number;
}

/**
 * Log-spaced semi-major axes from the star's inner limit to beyond the ice line, with
 * strictly non-crossing gaps. Eccentricities are sampled, then capped per planet by the
 * tighter of its two adjacent gaps: with both members of a pair below the common bound
 * `0.8·(r−1)/(r+1)`, `a_i(1+e_i) < a_{i+1}(1−e_{i+1})` holds by construction.
 */
function layoutOrbits(
  rng: Rng,
  luminositySun: number,
  starRadiusRot: number,
  count: number,
): { placements: readonly OrbitPlacement[]; iceLineAU: number } {
  const iceLineAU = 2.7 * Math.sqrt(luminositySun);
  if (count === 0) return { placements: [], iceLineAU };

  const innerEdge = Math.max(6 * starRadiusRot, 0.045 * Math.sqrt(luminositySun));
  const outerEdge = Math.max(innerEdge * 2.5, iceLineAU * rng.float(2.2, 4.6));
  const start = innerEdge * rng.float(0.85, 1.6);
  const end = Math.max(start * 1.5 ** (count - 1), outerEdge * rng.float(0.9, 1.1));

  const axes: number[] = [];
  if (count === 1) {
    axes.push(roundSig(start * Math.sqrt(end / start), 6));
  } else {
    const ratio = (end / start) ** (1 / (count - 1));
    for (let i = 0; i < count; i += 1) {
      const raw = start * ratio ** i * Math.exp(rng.gaussian(0, 0.06));
      const previous = axes[i - 1];
      axes.push(roundSig(previous === undefined ? raw : Math.max(raw, previous * 1.32), 6));
    }
  }

  const ratios: number[] = [];
  for (let i = 0; i < axes.length; i += 1) {
    const current = axes[i];
    const next = axes[i + 1];
    if (current === undefined) throw new Error('layoutOrbits: missing axis');
    if (next !== undefined) ratios.push(next / current);
  }

  const placements: OrbitPlacement[] = axes.map((axis, index) => {
    const desired = rng.chance(0.12) ? rng.float(0.08, 0.3) : rng.float(0, 0.07);
    const left = index === 0 ? undefined : ratios[index - 1];
    const right = index === axes.length - 1 ? undefined : ratios[index];
    const caps: number[] = [];
    if (left !== undefined) caps.push((0.8 * (left - 1)) / (left + 1));
    if (right !== undefined) caps.push((0.8 * (right - 1)) / (right + 1));
    const cap = Math.min(0.35, ...caps.map((value) => clamp(value, 0, 0.35)));
    return { semiMajorAU: axis, eccentricity: roundTo(clamp(desired, 0, cap), 4) };
  });

  return { placements, iceLineAU };
}

// ---------------------------------------------------------------------------
// Atmosphere
// ---------------------------------------------------------------------------

interface CompositionEntry {
  readonly gas: string;
  readonly fraction: number;
}

interface GasMix {
  readonly gas: string;
  readonly base: number;
}

function normalizeComposition(entries: readonly GasMix[]): CompositionEntry[] {
  const sorted = entries
    .slice()
    .sort((a, b) => (b.base === a.base ? (a.gas < b.gas ? -1 : 1) : b.base - a.base));
  let total = 0;
  for (const entry of sorted) total += entry.base;
  if (!(total > 0)) throw new Error('normalizeComposition: empty mixture');
  const rounded: { gas: string; fraction: number }[] = sorted.map((entry) => ({
    gas: entry.gas,
    fraction: 0,
  }));
  let used = 0;
  for (let i = 0; i < rounded.length - 1; i += 1) {
    const source = sorted[i];
    const target = rounded[i];
    if (!source || !target) throw new Error('normalizeComposition: index error');
    target.fraction = roundTo(source.base / total, 4);
    used += target.fraction;
  }
  const last = rounded[rounded.length - 1];
  if (!last) throw new Error('normalizeComposition: empty result');
  let remainder = roundTo(1 - used, 4);
  if (remainder < 0) {
    // Rounding the others up can overshoot by a few 1e-5; take it from the largest.
    let largest = 0;
    for (let i = 1; i < rounded.length - 1; i += 1) {
      const candidate = rounded[i];
      const best = rounded[largest];
      if (candidate && best && candidate.fraction > best.fraction) largest = i;
    }
    const best = rounded[largest];
    if (!best) throw new Error('normalizeComposition: index error');
    best.fraction = roundTo(best.fraction + remainder, 4);
    remainder = 0;
  }
  last.fraction = remainder;
  return rounded;
}

function atmospherePressure(rng: Rng, kind: PlanetKind, gravity: number): number | null {
  if (kind === 'gas' || kind === 'icegiant') return 1;
  const bias: { readonly [K in PlanetKind]: number } = {
    terrestrial: 0,
    ocean: 0.15,
    desert: -0.7,
    ice: -1.1,
    lava: 0.4,
    toxic: 1.2,
    barren: -3.2,
    gas: 0,
    icegiant: 0,
  };
  const ceiling: { readonly [K in PlanetKind]: number } = {
    terrestrial: 1.3,
    ocean: 1.4,
    desert: 0.6,
    ice: 0.5,
    lava: 1.8,
    toxic: 2.2,
    barren: -1,
    gas: 1,
    icegiant: 1,
  };
  let log10P = rng.gaussian(bias[kind], 0.8);
  // Escape stripping: low gravity bleeds an envelope away.
  if (gravity < 0.35) log10P -= 1.6;
  else if (gravity < 0.6) log10P -= 0.5;
  const pressure = roundSig(10 ** clamp(log10P, -6, ceiling[kind]), 3);
  return pressure < 1e-5 ? null : pressure;
}

function atmosphereComposition(
  rng: Rng,
  kind: PlanetKind,
  temperatureK: number,
  oxygenated: boolean,
): CompositionEntry[] {
  const mixes: GasMix[] = [];
  const add = (gas: string, base: number): void => {
    mixes.push({ gas, base: base * rng.float(0.82, 1.18) });
  };
  switch (kind) {
    case 'gas':
    case 'icegiant': {
      const cold = temperatureK < 400;
      add('H2', kind === 'gas' ? 0.87 : 0.79);
      add('He', kind === 'gas' ? 0.12 : 0.16);
      add('CH4', kind === 'gas' ? (cold ? 0.012 : 0.004) : 0.035);
      add('NH3', cold ? 0.008 : 0.002);
      add('H2O', 0.004);
      break;
    }
    case 'lava':
      add('SO2', 0.34);
      add('CO2', 0.32);
      add('CO', 0.12);
      add('N2', 0.1);
      add('H2O', 0.07);
      add('Ar', 0.02);
      break;
    case 'toxic':
      add('CO2', 0.92);
      add('SO2', 0.04);
      add('N2', 0.025);
      add('H2O', 0.01);
      add('Ar', 0.005);
      break;
    case 'desert':
      add('CO2', 0.58);
      add('N2', 0.32);
      add('Ar', 0.05);
      add('CO', 0.04);
      add('H2O', 0.01);
      break;
    case 'ice':
      add('N2', temperatureK < 90 ? 0.55 : 0.78);
      add('CH4', temperatureK < 90 ? 0.3 : 0.12);
      add('CO', 0.05);
      add('Ar', 0.02);
      add('H2', 0.01);
      break;
    case 'ocean':
      if (oxygenated) {
        add('N2', 0.72);
        add('O2', 0.22);
        add('H2O', 0.04);
        add('Ar', 0.015);
        add('CO2', 0.005);
      } else {
        add('N2', 0.7);
        add('CO2', 0.15);
        add('H2O', 0.11);
        add('Ar', 0.03);
        add('O2', 0.01);
      }
      break;
    case 'terrestrial':
      if (oxygenated) {
        add('N2', 0.75);
        add('O2', 0.2);
        add('Ar', 0.03);
        add('H2O', 0.018);
        add('CO2', 0.002);
      } else {
        add('N2', 0.72);
        add('CO2', 0.2);
        add('Ar', 0.05);
        add('H2O', 0.025);
        add('O2', 0.005);
      }
      break;
    case 'barren':
      add('CO2', 0.62);
      add('He', 0.18);
      add('Ar', 0.15);
      add('N2', 0.05);
      break;
    default:
      throw new Error(`atmosphereComposition: unsupported kind ${String(kind)}`);
  }
  return normalizeComposition(mixes);
}

function gasIndex(composition: readonly CompositionEntry[]): number {
  let index = 0;
  for (const entry of composition) index += entry.fraction * (GREENHOUSE_POTENTIAL[entry.gas] ?? 0);
  return index;
}

/** Greenhouse shift in K from pressure, mixture, liquid-water feedback and kind. */
function greenhouseShift(
  kind: PlanetKind,
  pressureAtm: number,
  composition: readonly CompositionEntry[],
  waterCoverage: number,
): number {
  if (kind === 'gas' || kind === 'icegiant') {
    throw new Error('greenhouseShift: giants use internal heat instead');
  }
  const index = gasIndex(composition);
  let delta = 20 * pressureAtm ** 0.55 * (0.6 + 2.6 * index);
  if (waterCoverage > 0.08) {
    delta += 18 * pressureAtm ** 0.3 * Math.min(1, waterCoverage * 2);
  }
  return roundTo(clamp(delta, 0, 900), 1);
}

function atmosphereLook(
  kind: PlanetKind,
  composition: readonly CompositionEntry[],
  pressureAtm: number,
): { color: Rgb; opacity: number } {
  const top = composition[0]?.gas ?? 'N2';
  let color: Rgb;
  switch (kind) {
    case 'gas':
    case 'icegiant':
      color = kind === 'icegiant' ? [0.45, 0.72, 0.9] : [0.9, 0.82, 0.66];
      break;
    case 'toxic':
      color = [0.86, 0.8, 0.42];
      break;
    case 'lava':
      color = [0.9, 0.5, 0.26];
      break;
    case 'ice':
      color = top === 'CH4' ? [0.5, 0.82, 0.84] : [0.6, 0.72, 0.9];
      break;
    case 'desert':
      color = [0.86, 0.7, 0.5];
      break;
    case 'ocean':
    case 'terrestrial':
      color = top === 'O2' || top === 'N2' ? [0.55, 0.7, 1] : [0.78, 0.82, 0.9];
      break;
    default:
      color = [0.7, 0.72, 0.75];
      break;
  }
  const thickness = clamp(Math.log10(pressureAtm + 1e-6) / 2.5 + 0.5, 0, 1);
  const opacity = roundTo(clamp(0.16 + 0.5 * thickness, 0.12, 0.72), 3);
  return { color, opacity };
}

// ---------------------------------------------------------------------------
// Water and life
// ---------------------------------------------------------------------------

/** Boiling point of water at a given pressure, K, good enough for a plausibility gate. */
function boilingPointK(pressureAtm: number): number {
  return 373.15 * Math.max(pressureAtm, 1e-6) ** 0.045;
}

function liquidWaterCoverage(
  kind: PlanetKind,
  temperatureK: number,
  pressureAtm: number | null,
  waterIndex: number,
): number {
  if (pressureAtm === null) return 0;
  if (kind !== 'terrestrial' && kind !== 'ocean' && kind !== 'desert' && kind !== 'toxic') {
    return 0;
  }
  if (temperatureK < 245 || temperatureK > boilingPointK(pressureAtm)) return 0;
  if (waterIndex < 0.35) return 0;
  if (pressureAtm < 0.02) return 0;
  switch (kind) {
    case 'ocean':
      return clamp(0.55 + 0.45 * waterIndex, 0.5, 1);
    case 'terrestrial':
      return clamp(waterIndex * 0.9 - 0.08, 0, 0.92);
    case 'desert':
      return clamp(waterIndex * 0.16 - 0.04, 0, 0.18);
    case 'toxic':
      return clamp(waterIndex * 0.08 - 0.02, 0, 0.08);
    default:
      return 0;
  }
}

function makeHydrosphere(
  rng: Rng,
  kind: PlanetKind,
  temperatureK: number,
  pressureAtm: number | null,
  waterIndex: number,
): Hydrosphere | null {
  const coverage = liquidWaterCoverage(kind, temperatureK, pressureAtm, waterIndex);
  if (coverage < 0.02) return null;
  const palette = PALETTES[kind];
  const base = kind === 'toxic' ? (palette.water ?? [0.4, 0.6, 0.1]) : (palette.water ?? [0.03, 0.2, 0.45]);
  const depthKm =
    kind === 'ocean'
      ? roundTo(1.5 + 18 * waterIndex, 2)
      : roundTo(0.1 + 5 * waterIndex * coverage, 2);
  const color = jitterColor(rng, base, 0.02);
  return {
    coverage: roundTo(coverage, 3),
    color,
    depthKm: Math.max(0.02, depthKm),
  };
}

function lifeBandQuality(temperatureK: number): number {
  return Math.exp(-(((temperatureK - 288) / 38) ** 2));
}

function lifeScore(
  kind: PlanetKind,
  temperatureK: number,
  pressureAtm: number | null,
  coverage: number,
  ctx: SystemContext,
): number {
  if (kind !== 'terrestrial' && kind !== 'ocean' && kind !== 'desert') return 0;
  if (pressureAtm === null || pressureAtm < 0.1 || pressureAtm > 25) return 0;
  if (coverage < 0.05) return 0;
  const time = clamp((ctx.ageGyr - 1.5) / 8, 0, 1);
  const water = clamp(coverage * 1.6, 0, 1);
  return clamp(
    1.6 *
      ctx.lifeChance *
      lifeBandQuality(temperatureK) *
      (0.35 + 0.65 * time) *
      (0.5 + 0.7 * water) *
      (0.6 + 0.5 * ctx.metallicity),
    0,
    0.95,
  );
}

function makeBiosphere(
  rng: Rng,
  kind: PlanetKind,
  temperatureK: number,
  pressureAtm: number | null,
  hydrosphere: Hydrosphere | null,
  ctx: SystemContext,
  name: string,
): Biosphere | null {
  if (hydrosphere === null) return null;
  const score = lifeScore(kind, temperatureK, pressureAtm, hydrosphere.coverage, ctx);
  if (score <= 0 || !rng.chance(score)) return null;
  const complexity = clamp((ctx.ageGyr - 2) / 10, 0, 1) * clamp(0.45 + 0.55 * ctx.metallicity, 0, 1);
  const pressure = pressureAtm ?? 0;
  const levels: Weighted<LifeLevel>[] = [
    { value: 'microbial', weight: 0.6 - 0.22 * complexity },
    { value: 'flora', weight: pressure >= 0.2 ? 0.24 : 0 },
    { value: 'fauna', weight: pressure >= 0.35 ? 0.13 + 0.12 * complexity : 0 },
    {
      value: 'civilization',
      weight:
        pressure >= 0.5 && ctx.ageGyr > 3 && ctx.metallicity > 0.35
          ? 0.04 + 0.1 * complexity
          : 0,
    },
  ];
  const level = rng.weighted(levels);
  const pressureText = pressurePhrase(pressureAtm ?? 0);
  const temperatureText = `${Math.round(temperatureK)} K`;
  const templates: { readonly [K in LifeLevel]: readonly string[] } = {
    none: [''],
    microbial: [
      `Microbial mats thrive in ${name}'s shallow seas, ${temperatureText} water under a ${pressureText} atmosphere.`,
      `Life on ${name} has not got past single cells; microbes stain its seas and shorelines.`,
    ],
    flora: [
      `Mossy flora carpets the shores of ${name}, sustained by ${temperatureText} seas and a ${pressureText} atmosphere.`,
      `Plant-like life has greened ${name}'s lowlands, though nothing yet moves on land.`,
    ],
    fauna: [
      `A rich fauna roams ${name}, from grazers on its plains to predators in its ${temperatureText} seas.`,
      `Animal life flourishes on ${name}, nesting along coasts beneath a ${pressureText} sky.`,
    ],
    civilization: [
      `A spacefaring civilization has raised city lights across ${name}, visible from orbit on its night side.`,
      `An industrial civilization on ${name} has begun to alter its atmosphere and light its nights.`,
    ],
  };
  const summary = rng.pick(templates[level]);
  return { level, summary };
}

// ---------------------------------------------------------------------------
// Rings, moons, belts
// ---------------------------------------------------------------------------

function makeRings(
  rng: Rng,
  kind: PlanetKind,
  temperatureK: number,
  hillKm: number,
  rocheKm: number,
  hazard: number,
): RingSystem | null {
  if (hazard <= 0) return null;
  const base =
    kind === 'gas'
      ? 1.4
      : kind === 'icegiant'
        ? 1
        : kind === 'terrestrial' || kind === 'ocean' || kind === 'desert' || kind === 'ice'
          ? 0.06
          : 0;
  if (base <= 0) return null;
  if (!rng.chance(clamp(base * hazard * rng.float(0.75, 1.25), 0, 0.95))) return null;
  const inner = rocheKm * rng.float(1.06, 1.4);
  const wanted = inner * rng.float(1.5, 2.6);
  const outer = Math.min(wanted, hillKm * 0.85);
  if (outer < inner * 1.2) return null;
  const thickness = roundTo(
    kind === 'gas' || kind === 'icegiant' ? rng.float(50, 2500) : rng.float(10, 400),
    1,
  );
  const icy = temperatureK < 250;
  const color = jitterColor(rng, icy ? [0.82, 0.88, 0.95] : [0.72, 0.66, 0.55], 0.04);
  return {
    innerRadiusKm: Math.round(inner),
    outerRadiusKm: Math.round(outer),
    thicknessKm: Math.max(1, thickness),
    opacity: roundTo(clamp(0.25 + 0.5 * rng.next() + 0.2 * hazard, 0.1, 0.95), 3),
    color,
    composition: icy ? 'ice and dust' : 'rocky debris',
  };
}

function makeMoons(
  rng: Rng,
  planetId: string,
  planetNameValue: string,
  kind: PlanetKind,
  radiusKm: number,
  massEarth: number,
  density: number,
  semiMajorAU: number,
  starMassSun: number,
  temperatureK: number,
  planetSeedValue: number,
): Moon[] {
  const hillKm = hillRadiusKm(semiMajorAU, massEarth, starMassSun);
  const rocheKm = rocheLimitKm(radiusKm, density);
  const inner = rocheKm * 1.35;
  const outer = hillKm * 0.55;
  if (outer <= inner * 1.6) return [];

  let maxBySpace = 1;
  let probe = inner;
  while (probe * 1.28 < outer && maxBySpace < MAX_MOONS) {
    probe *= 1.28;
    maxBySpace += 1;
  }
  const mean = kind === 'gas' ? 3.4 : kind === 'icegiant' ? 2.2 : 0.55;
  const wanted = poisson(rng, mean);
  const count = clamp(wanted, 0, Math.min(maxBySpace, MAX_MOONS));
  if (count === 0) return [];

  const spacing = (outer / inner) ** (1 / Math.max(1, count - 1));
  const moons: Moon[] = [];
  let previousRadius = 0;
  for (let index = 0; index < count; index += 1) {
    const moonRng = new Rng(mixSeeds(planetSeedValue, mixSeeds(index + 1, MOON_STREAM)));
    let orbitRadius = inner * spacing ** index * Math.exp(moonRng.gaussian(0, 0.05));
    orbitRadius = Math.max(orbitRadius, previousRadius * 1.18, inner);
    if (orbitRadius > outer) orbitRadius = outer;
    previousRadius = orbitRadius;

    const fraction = kind === 'gas' || kind === 'icegiant' ? moonRng.float(0.006, 0.055) : moonRng.float(0.012, 0.09);
    const moonRadius = roundTo(
      Math.max(40, Math.min(radiusKm * fraction, radiusKm * 0.45, 4200)),
      1,
    );
    const moonKind: PlanetKind =
      temperatureK < 270 || kind === 'ice' ? 'ice' : 'barren';
    const surfaceRng = new Rng(mixSeeds(planetSeedValue, mixSeeds(0x900 + index, SURFACE_STREAM)));
    const surface = makeSurface(surfaceRng, moonKind, Math.min(temperatureK, 200), null, 0);
    const eccentricity = roundTo(moonRng.float(0, 0.03), 4);
    const inclination =
      moonRng.chance(0.08) ? roundTo(moonRng.float(100, 170), 1) : roundTo(Math.abs(moonRng.gaussian(0, 6)), 1);
    const orbitRadiusKm = Math.max(1, Math.round(orbitRadius));
    const periodDays = roundSig(
      moonPeriodDays(orbitRadiusKm, massEarth),
      6,
    );
    const hasAir = moonRng.chance(moonRadius > 1500 ? 0.22 : 0.05);
    const atmosphere: Atmosphere | null = hasAir
      ? {
          pressureAtm: roundSig(moonRng.float(1e-4, 0.08), 2),
          composition: normalizeComposition([
            { gas: 'N2', base: 0.78 },
            { gas: 'CH4', base: 0.14 },
            { gas: 'CO', base: 0.05 },
            { gas: 'Ar', base: 0.03 },
          ]),
          greenhouseK: roundTo(moonRng.float(0.5, 8), 1),
          color: [0.58, 0.74, 0.92],
          opacity: roundTo(moonRng.float(0.12, 0.3), 3),
        }
      : null;
    const notePool = [
      'heavily cratered',
      'tidally locked',
      'ice-covered',
      'volcanically active',
      'a captured body',
      'dust-covered',
      'brightly reflective',
      'dark and ancient',
    ];
    const noteCount = moonRng.int(0, 2);
    const notes = moonRng.shuffle(notePool).slice(0, noteCount);
    moons.push({
      id: `${planetId}-m${index + 1}`,
      name: moonName(planetNameValue, index),
      radiusKm: moonRadius,
      orbit: {
        radiusKm: orbitRadiusKm,
        eccentricity,
        inclinationDeg: inclination,
        phaseDeg: angleDeg(moonRng),
        periodDays,
      },
      surface,
      atmosphere,
      notes,
    });
  }
  return moons;
}

interface OrbitSpan {
  readonly semiMajorAU: number;
  readonly eccentricity: number;
}

function makeBelts(
  rng: Rng,
  stub: SystemStub,
  iceLineAU: number,
  planets: readonly OrbitSpan[],
  hazard: number,
): AsteroidBelt[] {
  if (hazard <= 0) return [];
  const belts: AsteroidBelt[] = [];
  const last = planets[planets.length - 1];

  let asteroidSpan: { inner: number; outer: number } | null = null;
  if (rng.chance(clamp(0.18 + 0.55 * hazard, 0, 0.9))) {
    let best: { inner: number; outer: number; score: number } | null = null;
    for (let i = 0; i < planets.length - 1; i += 1) {
      const a = planets[i];
      const b = planets[i + 1];
      if (!a || !b) continue;
      const inner = a.semiMajorAU * (1 + a.eccentricity) * 1.12 + 0.005;
      const outer = b.semiMajorAU * (1 - b.eccentricity) * 0.88;
      if (outer <= inner * 1.25) continue;
      const score = Math.log(outer / inner);
      if (!best || score > best.score) best = { inner, outer, score };
    }
    if (!best) {
      if (last) {
        const inner = last.semiMajorAU * (1 + last.eccentricity) * 1.25 + 0.01;
        best = { inner, outer: Math.max(inner * 1.4, iceLineAU * 0.9), score: 0 };
      } else {
        best = { inner: iceLineAU * 0.55, outer: iceLineAU * 0.95, score: 0 };
      }
    }
    asteroidSpan = { inner: best.inner, outer: best.outer };
  }

  let kuiperSpan: { inner: number; outer: number } | null = null;
  if (rng.chance(clamp(0.12 + 0.5 * hazard, 0, 0.85))) {
    const inner = last
      ? Math.max(last.semiMajorAU * (1 + last.eccentricity) * 1.3, iceLineAU * 1.05)
      : iceLineAU * 1.2;
    const outer = inner * rng.float(1.7, 3.4);
    kuiperSpan = { inner, outer };
  }

  if (asteroidSpan && kuiperSpan && kuiperSpan.inner < asteroidSpan.outer * 1.25) {
    kuiperSpan = {
      inner: asteroidSpan.outer * 1.4,
      outer: asteroidSpan.outer * 1.4 * rng.float(1.7, 2.6),
    };
  }

  const build = (
    kind: 'asteroid' | 'kuiper',
    span: { inner: number; outer: number },
    idSuffix: string,
    inclinationBase: number,
  ): AsteroidBelt => ({
    id: `${stub.id}-b${idSuffix}`,
    name: beltName(stub.name, kind),
    innerAU: roundSig(Math.max(span.inner, 1e-4), 6),
    outerAU: roundSig(Math.max(span.outer, span.inner * 1.05), 6),
    count: Math.round(clamp(4000 + 8000 * hazard * rng.float(0.7, 1), 4000, 12000)),
    density: roundTo(clamp(0.25 + 0.75 * hazard * rng.float(0.8, 1.15), 0.15, 1), 3),
    inclinationDeg: roundTo(inclinationBase + rng.float(0, 6), 1),
    seed: randomSeed(rng),
  });

  if (asteroidSpan) belts.push(build('asteroid', asteroidSpan, '1', 1.2));
  if (kuiperSpan) belts.push(build('kuiper', kuiperSpan, '2', 3.5));
  belts.sort((a, b) => a.innerAU - b.innerAU);
  return belts;
}

// ---------------------------------------------------------------------------
// Surface, tags, description
// ---------------------------------------------------------------------------

function makeSurface(
  rng: Rng,
  kind: PlanetKind,
  temperatureK: number,
  hydrosphere: Hydrosphere | null,
  nightLights: number,
): SurfaceSpec {
  const palette = kind === 'gas' && temperatureK < 420 ? COLD_GAS_PALETTE : PALETTES[kind];
  const warmth = clamp((temperatureK - 500) / 1500, 0, 1);
  const chill = clamp((240 - temperatureK) / 180, 0, 1);
  const adjust = (base: Rgb): Rgb =>
    rgb(
      base[0] + 0.14 * warmth - 0.04 * chill,
      base[1] + 0.02 * warmth - 0.01 * chill,
      base[2] - 0.06 * warmth + 0.1 * chill,
    );
  const tone = (base: Rgb): Rgb => jitterColor(rng, adjust(base), 0.045);

  const cloudByKind: { readonly [K in PlanetKind]: [number, number] } = {
    terrestrial: [0.2, 0.6],
    ocean: [0.3, 0.75],
    desert: [0.02, 0.22],
    ice: [0.05, 0.35],
    lava: [0.05, 0.25],
    toxic: [0.7, 1],
    barren: [0, 0.04],
    gas: [0.5, 0.95],
    icegiant: [0.5, 0.9],
  };
  const cloudRange = cloudByKind[kind];
  const cloudiness = roundTo(rng.float(cloudRange[0], cloudRange[1]), 3);
  let cloudColor: Rgb;
  switch (kind) {
    case 'toxic':
      cloudColor = jitterColor(rng, [0.85, 0.78, 0.38], 0.04);
      break;
    case 'lava':
      cloudColor = jitterColor(rng, [0.24, 0.2, 0.18], 0.03);
      break;
    case 'barren':
      cloudColor = jitterColor(rng, [0.55, 0.55, 0.55], 0.03);
      break;
    case 'gas':
    case 'icegiant':
      cloudColor = jitterColor(rng, kind === 'gas' ? [0.9, 0.85, 0.74] : [0.75, 0.9, 0.96], 0.04);
      break;
    default:
      cloudColor = jitterColor(rng, [0.9, 0.93, 0.97], 0.03);
      break;
  }
  const turbulenceByKind: { readonly [K in PlanetKind]: [number, number] } = {
    terrestrial: [0.35, 0.7],
    ocean: [0.25, 0.6],
    desert: [0.3, 0.65],
    ice: [0.3, 0.6],
    lava: [0.5, 0.9],
    toxic: [0.25, 0.55],
    barren: [0.25, 0.6],
    gas: [0.3, 0.85],
    icegiant: [0.3, 0.7],
  };
  const bandinessByKind: { readonly [K in PlanetKind]: [number, number] } = {
    terrestrial: [0.02, 0.15],
    ocean: [0.03, 0.12],
    desert: [0, 0.1],
    ice: [0, 0.15],
    lava: [0.02, 0.1],
    toxic: [0, 0.12],
    barren: [0.02, 0.12],
    gas: [0.55, 1],
    icegiant: [0.4, 0.85],
  };
  const roughnessByKind: { readonly [K in PlanetKind]: [number, number] } = {
    terrestrial: [0.4, 0.75],
    ocean: [0.15, 0.4],
    desert: [0.5, 0.8],
    ice: [0.3, 0.6],
    lava: [0.7, 0.95],
    toxic: [0.2, 0.4],
    barren: [0.6, 0.9],
    gas: [0.05, 0.18],
    icegiant: [0.06, 0.22],
  };
  const draw = (table: { readonly [K in PlanetKind]: [number, number] }): number => {
    const range = table[kind];
    return roundTo(rng.float(range[0], range[1]), 3);
  };

  return {
    seed: randomSeed(rng),
    kind,
    colors: {
      deep: tone(palette.deep),
      low: tone(palette.low),
      mid: tone(palette.mid),
      high: tone(palette.high),
      ice: tone(palette.ice),
      water: hydrosphere ? jitterColor(rng, hydrosphere.color, 0.015) : null,
    },
    cloudiness,
    cloudColor,
    turbulence: draw(turbulenceByKind),
    bandiness: draw(bandinessByKind),
    roughness: draw(roughnessByKind),
    nightLights: roundTo(clamp(nightLights, 0, 1), 3),
  };
}

function pressurePhrase(pressureAtm: number): string {
  if (pressureAtm >= 10) return `${Math.round(pressureAtm)} atm`;
  if (pressureAtm >= 0.01) return `${roundTo(pressureAtm, 2)} atm`;
  return `${roundSig(pressureAtm, 2)} atm`;
}

function gasPhrase(composition: readonly CompositionEntry[]): string {
  const names = composition
    .slice(0, 2)
    .map((entry) => GAS_NAMES[entry.gas] ?? entry.gas);
  return names.join('–');
}

type DraftPlanet = Omit<Planet, 'description' | 'tags'>;

function isTidallyLocked(planet: DraftPlanet): boolean {
  return Math.abs(Math.abs(planet.dayHours) - planet.yearDays * 24) < 0.05;
}

function buildTags(planet: DraftPlanet): string[] {
  const tags: string[] = [];
  const radiusEarth = planet.radiusKm / EARTH_RADIUS_KM;
  const rocky = planet.kind !== 'gas' && planet.kind !== 'icegiant';
  if (planet.kind === 'gas') {
    tags.push(planet.radiusKm / EARTH_RADIUS_KM < 5 ? 'gas dwarf' : 'gas giant');
  }
  else if (planet.kind === 'icegiant') tags.push('ice giant');
  else if (planet.kind === 'ocean') tags.push('ocean world');
  else if (planet.kind === 'ice') tags.push('ice world');
  else if (planet.kind === 'lava') tags.push('lava world');
  else if (planet.kind === 'toxic') tags.push('toxic');
  else if (planet.kind === 'barren') tags.push('barren');
  else tags.push('rocky');
  if (rocky && radiusEarth >= 1.5) tags.push('super-earth');
  if (!rocky && planet.temperatureK > 800) tags.push('hot jupiter');
  if (planet.atmosphere === null) tags.push('airless');
  else if (planet.atmosphere.pressureAtm > 10) tags.push('thick atmosphere');
  else if (planet.atmosphere.pressureAtm < 0.01) tags.push('thin atmosphere');
  if (planet.atmosphere !== null && planet.atmosphere.greenhouseK > 200) {
    tags.push('runaway greenhouse');
  }
  if (planet.hydrosphere !== null) tags.push('liquid water');
  if (planet.temperatureK >= 250 && planet.temperatureK <= 335) tags.push('temperate');
  if (planet.biosphere !== null) {
    if (planet.biosphere.level === 'microbial') tags.push('microbial life');
    if (planet.biosphere.level === 'flora' || planet.biosphere.level === 'fauna') tags.push('habitable');
    if (planet.biosphere.level === 'fauna') tags.push('animal life');
    if (planet.biosphere.level === 'civilization') {
      tags.push('habitable');
      tags.push('civilization');
    }
  }
  if (planet.rings !== null) tags.push('ring system');
  if (planet.moons.length > 0) tags.push('moon system');
  if (isTidallyLocked(planet)) tags.push('tidally locked');
  if (planet.dayHours < 0) tags.push('retrograde rotation');
  if (planet.orbit.eccentricity > 0.18) tags.push('eccentric orbit');
  return tags;
}

function numberWord(value: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  return words[value] ?? String(value);
}

function articleFor(text: string): string {
  return /^[aeiou]/i.test(text) ? 'an' : 'a';
}

function massPhrase(massEarth: number): string {
  if (massEarth >= 1000) return `${Math.round(massEarth)} Earth masses`;
  const rounded = massEarth >= 10 ? roundTo(massEarth, 1) : roundTo(massEarth, 2);
  return `${rounded} Earth mass${rounded === 1 ? '' : 'es'}`;
}

function planetNoun(kind: PlanetKind, radiusEarth: number): string {
  if (kind === 'gas' && radiusEarth < 5) return 'gas dwarf';
  return KIND_NOUN[kind];
}

function describePlanet(planet: DraftPlanet, star: Star): string {
  const radiusEarth = planet.radiusKm / EARTH_RADIUS_KM;
  const sizeWord =
    planet.kind === 'gas' || planet.kind === 'icegiant'
      ? radiusEarth > 10
        ? 'Jupiter-sized'
        : radiusEarth > 6.5
          ? 'Saturn-sized'
          : radiusEarth > 4
            ? 'Neptune-sized'
            : 'mini-Neptune-sized'
      : radiusEarth < 0.45
        ? 'Mercury-sized'
        : radiusEarth < 0.9
          ? 'Mars-sized'
          : radiusEarth < 1.25
            ? 'Earth-sized'
            : radiusEarth < 2
              ? 'super-Earth-sized'
              : 'mini-Neptune-sized';
  const noun = planetNoun(planet.kind, radiusEarth);
  const label = spectralLabel(star.spectral);
  const yearText =
    planet.yearDays < 700
      ? `${roundTo(planet.yearDays, 2)} days`
      : `${roundTo(planet.yearDays / 365.25, 1)} years`;
  let dayText: string;
  if (isTidallyLocked(planet)) {
    dayText = 'a day equal to its year';
  } else {
    const hours = Math.abs(planet.dayHours);
    const spin = hours >= 48 ? `${roundTo(hours / 24, 1)} days` : `${roundTo(hours, 1)} hours`;
    dayText = planet.dayHours < 0 ? `a retrograde day of ${spin}` : `a day of ${spin}`;
  }
  const first =
    `${planet.name} is ${articleFor(sizeWord)} ${sizeWord} ${noun} at ` +
    `${roundSig(planet.orbit.semiMajorAU, 4)} AU from ${star.name}, ${articleFor(label)} ${label}; ` +
    `it has a radius of ${Math.round(planet.radiusKm)} km, a mass of ${massPhrase(planet.massEarth)} ` +
    `and a surface gravity of ${roundTo(planet.gravityG, 2)} g, and a year lasts ${yearText} ` +
    `with ${dayText}.`;

  const clauses: string[] = [];
  const giant = planet.kind === 'gas' || planet.kind === 'icegiant';
  if (planet.atmosphere === null) {
    clauses.push(`no appreciable atmosphere survives, and its surface sits at ${planet.temperatureK} K`);
  } else if (giant) {
    clauses.push(
      `an atmosphere of ${gasPhrase(planet.atmosphere.composition)} wraps it, with cloud tops near ${planet.temperatureK} K`,
    );
  } else {
    clauses.push(
      `a ${pressurePhrase(planet.atmosphere.pressureAtm)} ${gasPhrase(planet.atmosphere.composition)} atmosphere holds the surface at ${planet.temperatureK} K`,
    );
  }
  if (planet.hydrosphere !== null) {
    clauses.push(
      `liquid water covers ${percent(planet.hydrosphere.coverage)}% of the surface to a mean depth of ${roundTo(planet.hydrosphere.depthKm, 1)} km`,
    );
  } else if (planet.kind === 'ice') {
    clauses.push('its surface is frozen solid');
  } else if (!giant) {
    clauses.push('its surface is dry');
  }
  if (planet.biosphere !== null) {
    switch (planet.biosphere.level) {
      case 'microbial':
        clauses.push('microbial life stains its shores');
        break;
      case 'flora':
        clauses.push('plant-like life carpets its lowlands');
        break;
      case 'fauna':
        clauses.push('animal life roams its surface');
        break;
      case 'civilization':
        clauses.push('a technological civilization lights its night side');
        break;
      default:
        break;
    }
  }
  if (planet.moons.length > 0) {
    clauses.push(
      planet.moons.length === 1
        ? 'one moon circles it'
        : `${numberWord(planet.moons.length)} moons circle it`,
    );
  }
  if (planet.rings !== null) clauses.push('a ring system girdles it');
  const capitalised = clauses[0] ? clauses[0].charAt(0).toUpperCase() + clauses[0].slice(1) : '';
  const second = `${[capitalised, ...clauses.slice(1)].join('; ')}.`;
  return `${first} ${second}`;
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------

/**
 * Generate a full system from its stub. Deterministic: same stub (including optional
 * context), same worlds. When `stub.context` is absent, the documented default context
 * is used (metallicity 0.5, age 8.6 Gyr, life 0.25, hazard 0.35).
 */
export function generateSystem(stub: SystemStub): StarSystem {
  assertStub(stub);
  const ctx = resolveContext(stub.context);
  const profile = stellarProfile(stub.seed, stub.spectral);
  const star: Star = starFromProfile(stub.name, stub.spectral, profile);

  const layoutRng = new Rng(mixSeeds(stub.seed, LAYOUT_STREAM));
  const count = planetCount(layoutRng, star.massSun, ctx.metallicity);
  const starRadiusRot = starRadiusAU(star.radiusSun);
  const { placements, iceLineAU } = layoutOrbits(
    layoutRng,
    Math.max(star.luminositySun, 1e-12),
    starRadiusRot,
    count,
  );

  const planets: Planet[] = [];
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    if (!placement) throw new Error('generateSystem: missing orbit placement');
    planets.push(buildPlanet(stub, star, ctx, placement, index, iceLineAU));
  }

  const beltRng = new Rng(mixSeeds(stub.seed, BELT_STREAM));
  const belts = makeBelts(
    beltRng,
    stub,
    iceLineAU,
    planets.map((planet) => ({
      semiMajorAU: planet.orbit.semiMajorAU,
      eccentricity: planet.orbit.eccentricity,
    })),
    ctx.hazard,
  );

  return {
    id: stub.id,
    name: stub.name,
    position: stub.position,
    seed: stub.seed,
    star,
    planets,
    belts,
  };
}

function buildPlanet(
  stub: SystemStub,
  star: Star,
  ctx: SystemContext,
  placement: OrbitPlacement,
  index: number,
  iceLineAU: number,
): Planet {
  const semiMajorAU = placement.semiMajorAU;
  const planetSeedValue = mixSeeds(stub.seed, mixSeeds(index + 1, PLANET_STREAM));
  const bodyRng = new Rng(mixSeeds(planetSeedValue, BODY_STREAM));
  const name = planetName(stub.name, index);
  const id = `${stub.id}-p${index + 1}`;

  // --- size class and radius ------------------------------------------------
  const innerBias = clamp(1 - semiMajorAU / (iceLineAU * 1.6), 0, 1);
  const giantWeight = clamp(
    0.12 + 0.22 * (1 - innerBias) + 0.08 * (0.5 - ctx.metallicity),
    0.06,
    0.5,
  );
  const neptuneWeight = clamp(
    0.14 + 0.08 * (1 - innerBias) + 0.06 * (0.5 - ctx.metallicity),
    0.08,
    0.35,
  );
  const rockyWeight = Math.max(0.05, 1 - giantWeight - neptuneWeight);
  const sizeClass = bodyRng.weighted<SizeClass>([
    { value: 'rocky', weight: rockyWeight },
    { value: 'neptune', weight: neptuneWeight },
    { value: 'giant', weight: giantWeight },
  ]);
  const radiusEarth =
    sizeClass === 'rocky'
      ? 0.3 + 1.6 * bodyRng.next() ** 1.25
      : sizeClass === 'neptune'
        ? 2.6 + 2.8 * bodyRng.next()
        : 7.5 + 6 * bodyRng.next();
  const radiusKm = roundTo(radiusEarth * EARTH_RADIUS_KM, 1);

  // Water and volatile indices are drawn once per planet; they decide ocean/desert and
  // the toxic-vs-desert split at the hot end.
  const waterIndex = clamp(
    0.06 +
      0.86 *
        Math.exp(-((semiMajorAU / (iceLineAU * 0.6)) ** 2)) *
        (0.35 + 0.8 * bodyRng.next()),
    0,
    1,
  );
  const volatileIndex = bodyRng.next();

  const referenceAlbedo =
    sizeClass === 'rocky' ? 0.3 : sizeClass === 'neptune' ? 0.45 : 0.5;
  const referenceTemperature = equilibriumTemperatureK(
    star.luminositySun,
    semiMajorAU,
    referenceAlbedo,
  );
  const kind = classifyKind(sizeClass, radiusEarth, referenceTemperature, waterIndex, volatileIndex);

  const densityRange = DENSITY_BY_KIND[kind];
  const density = bodyRng.float(densityRange.min, densityRange.max);
  const massEarth = roundSig(bulkMassEarth(radiusKm, density), 6);
  const gravity = roundTo(gravityG(massEarth, radiusKm), 3);

  const albedo = roundTo(clamp(ALBEDO_BY_KIND[kind] + bodyRng.gaussian(0, 0.05), 0.03, 0.9), 3);
  const equilibriumK = equilibriumTemperatureK(star.luminositySun, semiMajorAU, albedo);

  // --- atmosphere, temperature, water, life ---------------------------------
  const pressureAtm = atmospherePressure(bodyRng, kind, gravity);
  const isGiant = kind === 'gas' || kind === 'icegiant';
  let composition: CompositionEntry[] = [];
  let atmosphere: Atmosphere | null = null;
  let greenhouse: number;
  let temperature: number;

  if (pressureAtm === null) {
    greenhouse = 0;
    temperature = Math.max(CMB_TEMPERATURE_K, equilibriumK);
  } else {
    composition = atmosphereComposition(bodyRng, kind, equilibriumK, false);
    const dryGreenhouse = isGiant
      ? roundTo(bodyRng.float(30, 90), 1)
      : greenhouseShift(kind, pressureAtm, composition, 0);
    const dryTemperature = Math.max(CMB_TEMPERATURE_K, equilibriumK + dryGreenhouse);
    const preliminaryCoverage = liquidWaterCoverage(kind, dryTemperature, pressureAtm, waterIndex);
    greenhouse = isGiant
      ? dryGreenhouse
      : greenhouseShift(kind, pressureAtm, composition, preliminaryCoverage);
    temperature = Math.max(CMB_TEMPERATURE_K, equilibriumK + greenhouse);
    const match = atmosphereLook(kind, composition, pressureAtm);
    atmosphere = {
      pressureAtm,
      composition,
      greenhouseK: roundTo(greenhouse, 1),
      color: match.color,
      opacity: match.opacity,
    };
  }

  const hydrosphere = makeHydrosphere(
    new Rng(mixSeeds(planetSeedValue, 0xa11ce)),
    kind,
    temperature,
    pressureAtm,
    waterIndex,
  );
  const biosphere = makeBiosphere(
    new Rng(mixSeeds(planetSeedValue, 0x1f2e3d4c)),
    kind,
    temperature,
    pressureAtm,
    hydrosphere,
    ctx,
    name,
  );

  // Photosynthesis rewrites the air. This uses a forked stream so the presence of life
  // cannot shift any other value in this planet.
  if (
    atmosphere !== null &&
    !isGiant &&
    biosphere !== null &&
    (biosphere.level === 'flora' ||
      biosphere.level === 'fauna' ||
      biosphere.level === 'civilization')
  ) {
    composition = atmosphereComposition(
      bodyRng.fork('oxygenated'),
      kind,
      equilibriumK,
      true,
    );
    const coverage = hydrosphere === null ? 0 : hydrosphere.coverage;
    greenhouse = greenhouseShift(kind, atmosphere.pressureAtm, composition, coverage);
    temperature = Math.max(CMB_TEMPERATURE_K, equilibriumK + greenhouse);
    atmosphere = {
      ...atmosphere,
      composition,
      greenhouseK: roundTo(greenhouse, 1),
    };
  }
  const temperatureK = Math.round(temperature);

  // --- rotation -------------------------------------------------------------
  const periodDays = roundSig(orbitalPeriodDays(semiMajorAU, star.massSun), 6);
  const rotationRng = bodyRng.fork('rotation');
  const lockChance = periodDays < 12 ? 0.8 : periodDays < 30 ? 0.35 : 0.04;
  const locked = !isGiant || periodDays < 12 ? rotationRng.chance(lockChance) : false;
  let dayHours: number;
  if (locked) {
    dayHours = roundTo(periodDays * 24, 2);
  } else {
    const base = isGiant ? rotationRng.float(8, 18) : Math.exp(rotationRng.gaussian(Math.log(22), 0.5));
    const sign = rotationRng.chance(0.08) ? -1 : 1;
    dayHours = roundTo(sign * clamp(base, 3, 160), 2);
  }

  // --- rings, moons, surface ------------------------------------------------
  const hillKm = hillRadiusKm(semiMajorAU, massEarth, star.massSun);
  const rocheKm = rocheLimitKm(radiusKm, density);
  const rings = makeRings(
    new Rng(mixSeeds(planetSeedValue, RING_STREAM)),
    kind,
    temperatureK,
    hillKm,
    rocheKm,
    ctx.hazard,
  );
  const moons = makeMoons(
    new Rng(mixSeeds(planetSeedValue, MOON_STREAM)),
    id,
    name,
    kind,
    radiusKm,
    massEarth,
    density,
    semiMajorAU,
    star.massSun,
    temperatureK,
    planetSeedValue,
  );
  const nightLights = biosphere?.level === 'civilization' ? 0.4 + 0.5 * ctx.metallicity : 0;
  const surface = makeSurface(
    new Rng(mixSeeds(planetSeedValue, SURFACE_STREAM)),
    kind,
    temperatureK,
    hydrosphere,
    nightLights,
  );

  const orbit: Orbit = {
    semiMajorAU,
    eccentricity: placement.eccentricity,
    inclinationDeg: roundTo(Math.abs(bodyRng.gaussian(0, 0.8 + 1.2 / (index + 1))), 1),
    nodeDeg: angleDeg(bodyRng),
    argPeriapsisDeg: angleDeg(bodyRng),
    meanAnomalyDeg: angleDeg(bodyRng),
    periodDays,
  };

  const draft: DraftPlanet = {
    id,
    name,
    kind,
    orbit,
    radiusKm,
    massEarth,
    gravityG: gravity,
    dayHours,
    yearDays: periodDays,
    temperatureK,
    albedo,
    atmosphere,
    hydrosphere,
    biosphere,
    rings,
    moons,
    surface,
  };
  return {
    ...draft,
    description: describePlanet(draft, star),
    tags: buildTags(draft),
  };
}

function classifyKind(
  sizeClass: SizeClass,
  radiusEarth: number,
  equilibriumK: number,
  waterIndex: number,
  volatileIndex: number,
): PlanetKind {
  if (sizeClass === 'giant') return 'gas';
  if (sizeClass === 'neptune') return equilibriumK < 240 ? 'icegiant' : 'gas';
  if (radiusEarth < 0.55 && equilibriumK < 800) return 'barren';
  if (equilibriumK > 1200) return 'lava';
  if (equilibriumK > 700) return volatileIndex > 0.42 ? 'toxic' : 'desert';
  if (equilibriumK < 200) return 'ice';
  if (equilibriumK < 250) return waterIndex > 0.6 ? 'ice' : 'desert';
  if (equilibriumK <= 335) return waterIndex > 0.52 ? 'ocean' : 'terrestrial';
  return 'desert';
}

