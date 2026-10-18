/**
 * Stars — spectral distribution and physical model.
 *
 * One seam: the galaxy map needs only a stub's colour/brightness, while the system view
 * needs a full `Star`. Both are derived from `stellarProfile(seed, spectral)`, so the
 * map and the system can never disagree about a star.
 */

import type { Rgb, SpectralClass, Star } from './types';
import { Rng, hashString, mixSeeds, type Weighted } from './rng';
import { clamp, roundSig, roundTo } from './util';
import { luminositySun } from './physics';

/** Main-sequence classes, the ones with a mass/temperature/radius table. */
type MainSequenceClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';

interface MainSequenceRange {
  readonly massMin: number;
  readonly massMax: number;
  readonly radiusMin: number;
  readonly radiusMax: number;
  readonly tempMin: number;
  readonly tempMax: number;
}

const MAIN_SEQUENCE: { readonly [K in MainSequenceClass]: MainSequenceRange } = {
  // Ranges straddle the real class boundaries; a star is drawn inside its own class.
  O: { massMin: 16, massMax: 40, radiusMin: 6.6, radiusMax: 12, tempMin: 30_000, tempMax: 45_000 },
  B: { massMin: 2.1, massMax: 16, radiusMin: 1.8, radiusMax: 6.6, tempMin: 10_000, tempMax: 30_000 },
  A: { massMin: 1.4, massMax: 2.1, radiusMin: 1.4, radiusMax: 1.8, tempMin: 7_500, tempMax: 10_000 },
  F: { massMin: 1.04, massMax: 1.4, radiusMin: 1.15, radiusMax: 1.4, tempMin: 6_000, tempMax: 7_500 },
  G: { massMin: 0.8, massMax: 1.04, radiusMin: 0.96, radiusMax: 1.15, tempMin: 5_200, tempMax: 6_000 },
  K: { massMin: 0.45, massMax: 0.8, radiusMin: 0.7, radiusMax: 0.96, tempMin: 3_700, tempMax: 5_200 },
  M: { massMin: 0.08, massMax: 0.45, radiusMin: 0.11, radiusMax: 0.68, tempMin: 2_400, tempMax: 3_700 },
};

/** The physical and display fields a stub or a `Star` is built from. */
export interface StellarProfile {
  readonly temperatureK: number;
  readonly radiusSun: number;
  readonly massSun: number;
  readonly luminositySun: number;
  /** Linear RGB at the photosphere (chroma, max channel 1). */
  readonly color: Rgb;
  /** 0..1 map brightness, used for sprite size/alpha. */
  readonly brightness: number;
}

function isMainSequence(spectral: SpectralClass): spectral is MainSequenceClass {
  return spectral in MAIN_SEQUENCE;
}

function sRgbToLinear(channel: number): number {
  const c = clamp(channel, 0, 255) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Approximate blackbody colour: Tanner Helland's fit to the Planckian locus in sRGB,
 * converted to linear RGB. The fit is clamped to 1000..40000 K and the result is
 * normalised so its brightest channel is 1 — star *colour* is chroma; `brightness`
 * carries the intensity.
 */
export function blackbodyLinearRgb(temperatureK: number): Rgb {
  if (!Number.isFinite(temperatureK)) {
    throw new Error(`blackbodyLinearRgb: non-finite temperature ${String(temperatureK)}`);
  }
  const t = clamp(temperatureK, 1_000, 40_000) / 100;
  let red: number;
  let green: number;
  let blue: number;
  if (t <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(t) - 161.1195681661;
    blue = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * (t - 60) ** -0.1332047592;
    green = 288.1221695283 * (t - 60) ** -0.0755148492;
    blue = 255;
  }
  const linear: [number, number, number] = [
    sRgbToLinear(red),
    sRgbToLinear(green),
    sRgbToLinear(blue),
  ];
  const peak = Math.max(linear[0], linear[1], linear[2]);
  if (!(peak > 0)) return [1, 1, 1];
  return [
    roundTo(linear[0] / peak, 3),
    roundTo(linear[1] / peak, 3),
    roundTo(linear[2] / peak, 3),
  ];
}

/**
 * Relative chance of each spectral class. M and K dominate (as they do by number in a
 * real galaxy); O/B are rare and get rarer as a galaxy ages; old galaxies accumulate
 * white dwarfs, neutron stars and the odd black hole.
 */
export function spectralWeights(
  ageGyr: number,
  metallicity: number,
): readonly Weighted<SpectralClass>[] {
  if (!Number.isFinite(ageGyr) || !Number.isFinite(metallicity)) {
    throw new Error('spectralWeights: non-finite age or metallicity');
  }
  const youth = clamp((9 - ageGyr) / 8, 0, 1);
  const old = clamp((ageGyr - 8) / 5.5, 0, 1);
  const metal = clamp(metallicity, 0, 1);
  return [
    { value: 'O', weight: 0.002 + 0.014 * youth + 0.002 * (1 - metal) },
    { value: 'B', weight: 0.012 + 0.045 * youth + 0.006 * (1 - metal) },
    { value: 'A', weight: 0.035 + 0.06 * youth + 0.01 * (1 - metal) },
    { value: 'F', weight: 0.075 + 0.02 * youth },
    { value: 'G', weight: 0.12 + 0.01 * metal },
    { value: 'K', weight: 0.24 + 0.02 * metal },
    { value: 'M', weight: 0.5 - 0.16 * youth + 0.05 * metal },
    { value: 'WD', weight: 0.002 + 0.018 * old },
    { value: 'NS', weight: 0.0006 + 0.0018 * old },
    { value: 'BH', weight: 0.0004 + 0.0018 * old },
  ];
}

/** Pick a spectral class from the galaxy-wide distribution. */
export function pickSpectral(rng: Rng, ageGyr: number, metallicity: number): SpectralClass {
  return rng.weighted(spectralWeights(ageGyr, metallicity));
}

function mainSequenceProfile(rng: Rng, range: MainSequenceRange): {
  temperatureK: number;
  radiusSun: number;
  massSun: number;
} {
  // One latent "rank" inside the class drives mass; radius and temperature follow it
  // with enough independent jitter that the class never looks like a formula.
  const rank = rng.next();
  const massSun = range.massMin * (range.massMax / range.massMin) ** rank;
  const radiusRank = clamp(0.6 * rank + 0.4 * rng.next(), 0, 1);
  const tempRank = clamp(0.6 * rank + 0.4 * rng.next(), 0, 1);
  const radiusSun = (range.radiusMin + (range.radiusMax - range.radiusMin) * radiusRank ** 0.8) *
    rng.float(0.97, 1.03);
  const temperatureK =
    (range.tempMin + (range.tempMax - range.tempMin) * tempRank ** 0.55) * rng.float(0.97, 1.03);
  return {
    temperatureK: Math.round(temperatureK),
    radiusSun: roundTo(radiusSun, 4),
    massSun: roundTo(massSun, 4),
  };
}

/**
 * Derive a star's physical model from its stable seed and spectral class.
 *
 * The seed is the system's own seed, so the same system stub always yields the same
 * star, in the map pass and in the system pass.
 */
export function stellarProfile(seed: number, spectral: SpectralClass): StellarProfile {
  if (!Number.isFinite(seed)) {
    throw new Error(`stellarProfile: non-finite seed ${String(seed)}`);
  }
  const rng = new Rng(mixSeeds(seed >>> 0, hashString(`star:${spectral}`)));

  if (isMainSequence(spectral)) {
    const { temperatureK, radiusSun, massSun } = mainSequenceProfile(rng, MAIN_SEQUENCE[spectral]);
    const luminosity = roundSig(luminositySun(radiusSun, temperatureK), 6);
    const brightness = roundTo(
      clamp(0.2 + 0.17 * Math.log10(1 + luminosity), 0.2, 1),
      3,
    );
    return {
      temperatureK,
      radiusSun,
      massSun,
      luminositySun: luminosity,
      color: blackbodyLinearRgb(temperatureK),
      brightness,
    };
  }

  if (spectral === 'WD') {
    const massSun = roundTo(rng.float(0.35, 1.25), 4);
    const radiusSun = roundTo(rng.float(0.008, 0.02), 5);
    const temperatureK = Math.round(rng.float(5_000, 30_000));
    const luminosity = roundSig(luminositySun(radiusSun, temperatureK), 6);
    return {
      temperatureK,
      radiusSun,
      massSun,
      luminositySun: luminosity,
      color: blackbodyLinearRgb(temperatureK),
      // A white dwarf is a city-sized ember; it reads as hot but faint on the map.
      brightness: 0.42,
    };
  }

  if (spectral === 'NS') {
    const massSun = roundTo(rng.float(1.2, 2.2), 4);
    const radiusSun = roundTo(rng.float(1.5e-5, 2.2e-5), 8);
    const temperatureK = Math.round(rng.float(150_000, 900_000));
    const luminosity = roundSig(luminositySun(radiusSun, temperatureK), 6);
    return {
      temperatureK,
      radiusSun,
      massSun,
      luminositySun: luminosity,
      color: blackbodyLinearRgb(Math.min(temperatureK, 40_000)),
      brightness: 0.55,
    };
  }

  if (spectral === 'BH') {
    const massSun = roundTo(rng.float(3, 25), 4);
    // Schwarzschild radius: 2.95 km per solar mass, expressed in solar radii.
    const radiusSun = roundTo(4.237e-6 * massSun, 9);
    // The star field has no photosphere; the accretion glow is what the map draws, and
    // it is also the light source the system's worlds are lit by.
    const temperatureK = Math.round(rng.float(7_000, 16_000));
    const luminosity = roundSig(rng.float(0.01, 0.2), 3);
    return {
      temperatureK,
      radiusSun,
      massSun,
      luminositySun: luminosity,
      color: blackbodyLinearRgb(temperatureK),
      brightness: 0.5,
    };
  }

  throw new Error(`stellarProfile: unknown spectral class ${String(spectral)}`);
}

/** Fill in a `Star` from a profile and the system's name. */
export function starFromProfile(name: string, spectral: SpectralClass, profile: StellarProfile): Star {
  return {
    name,
    spectral,
    temperatureK: profile.temperatureK,
    radiusSun: profile.radiusSun,
    massSun: profile.massSun,
    luminositySun: profile.luminositySun,
    color: profile.color,
  };
}

/** A short human phrase for the star's class, used in planet descriptions. */
export function spectralLabel(spectral: SpectralClass): string {
  switch (spectral) {
    case 'O':
    case 'B':
      return 'blue giant';
    case 'A':
      return 'white star';
    case 'F':
      return 'yellow-white star';
    case 'G':
      return 'yellow dwarf';
    case 'K':
      return 'orange dwarf';
    case 'M':
      return 'red dwarf';
    case 'WD':
      return 'white dwarf';
    case 'NS':
      return 'neutron star';
    case 'BH':
      return 'black hole';
    default:
      throw new Error(`spectralLabel: unknown class ${String(spectral)}`);
  }
}
