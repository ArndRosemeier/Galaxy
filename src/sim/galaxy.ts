/**
 * Galaxy generation — positions, spectra, names and per-system seeds.
 *
 * A logarithmic spiral places the arms: `r = r0 · e^(bθ)`, with `b = 1 / (1.4 · armTwist)`,
 * so the twist slider straightens the arms at 0 and winds them tight at 2.2. Populations
 * are a Plummer-ish bulge, arm stars, inter-arm disc stars and a thin halo; the disc's
 * scale height falls with radius, which is what makes the map read as a disc rather than
 * a cloud.
 *
 * Randomness is streamed in two independent ways:
 *  - placement uses one stream, so moving the shape sliders moves stars without re-rolling
 *    their identities;
 *  - each system's star class, name and per-system seed come from `galaxySeed + index`,
 *    so a given index has the same star across shape edits and a new seed changes all of
 *    them.
 */

import type {
  Galaxy,
  GalaxyParams,
  SpectralClass,
  SystemContext,
  SystemStub,
  Vec3,
} from './types';
import { Rng, hashString, mixSeeds } from './rng';
import { ValueNoise } from './noise';
import { uniqueStarName } from './naming';
import { pickSpectral, stellarProfile } from './stars';
import { clampParams } from './params';
import { clamp, roundTo } from './util';

const TAU = Math.PI * 2;
const GALAXY_STREAM = 0x2c1b3c6d;
const PLACEMENT_STREAM = 0x9e3779b1;
const SYSTEM_STREAM = 0x85ebca6b;
const HALO_STREAM = 0x51ed2701;
const POSITION_DECIMALS = 2;
const MIN_SEPARATION_FRACTION = 0.008;
const MAX_SEPARATION_ATTEMPTS = 6;

interface PlacementGrid {
  readonly cell: number;
  readonly buckets: Map<string, Vec3[]>;
}

function keyFor(x: number, y: number, z: number, cell: number): string {
  return `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
}

function hasRoom(grid: PlacementGrid, point: Vec3, separation: number): boolean {
  const { cell, buckets } = grid;
  const cx = Math.floor(point.x / cell);
  const cy = Math.floor(point.y / cell);
  const cz = Math.floor(point.z / cell);
  const limit = separation * separation;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (!bucket) continue;
        for (const other of bucket) {
          const ddx = other.x - point.x;
          const ddy = other.y - point.y;
          const ddz = other.z - point.z;
          if (ddx * ddx + ddy * ddy + ddz * ddz < limit) return false;
        }
      }
    }
  }
  return true;
}

function place(grid: PlacementGrid, point: Vec3): void {
  const key = keyFor(point.x, point.y, point.z, grid.cell);
  const bucket = grid.buckets.get(key);
  if (bucket) bucket.push(point);
  else grid.buckets.set(key, [point]);
}

function roundedPosition(x: number, y: number, z: number): Vec3 {
  return {
    x: roundTo(x, POSITION_DECIMALS),
    y: roundTo(y, POSITION_DECIMALS),
    z: roundTo(z, POSITION_DECIMALS),
  };
}

/**
 * Generate a galaxy from parameters. The same params produce the same JSON in any
 * process; that is the app's determinism contract and it starts here.
 */
export function generateGalaxy(input: GalaxyParams): Galaxy {
  const params = clampParams(input);
  const galaxySeed = mixSeeds(hashString(params.seed), GALAXY_STREAM);
  const placement = new Rng(mixSeeds(galaxySeed, PLACEMENT_STREAM));
  const noise = new ValueNoise(mixSeeds(galaxySeed, HALO_STREAM));
  const radius = params.galaxyRadius;
  const count = params.systemCount;

  // --- populations -----------------------------------------------------------
  const bulgeCount = Math.round(count * clamp(0.05 + 0.32 * params.coreDensity, 0.05, 0.36));
  const haloCount = Math.round(count * 0.015);
  const discCount = Math.max(0, count - bulgeCount - haloCount);
  const armShare = clamp(0.55 + 0.4 * (1 - params.armSpread), 0.45, 0.95);
  const armCount = Math.round(discCount * armShare);
  const interarmCount = Math.max(0, discCount - armCount);

  // --- arm geometry ----------------------------------------------------------
  const rIn = radius * 0.1;
  const twist = 1.4 * params.armTwist;
  const armPhase: number[] = [];
  const armWeights: { value: number; weight: number }[] = [];
  for (let arm = 0; arm < params.arms; arm += 1) {
    armPhase.push((TAU * arm) / params.arms + placement.gaussian(0, 0.1 * params.armSpread));
    armWeights.push({ value: arm, weight: placement.float(0.6, 1.25) });
  }

  // --- radius / height profiles ---------------------------------------------
  const discScale = radius * 0.3;
  const discMin = radius * 0.07;
  const heightCap = radius * 0.1;

  const sampleDiscRadius = (): number => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const draw =
        -discScale *
        Math.log(Math.max(placement.next(), 1e-9) * Math.max(placement.next(), 1e-9));
      if (draw >= discMin && draw <= radius) return draw;
    }
    const fallback =
      -discScale * Math.log(Math.max(placement.next(), 1e-9) * Math.max(placement.next(), 1e-9));
    return clamp(fallback, discMin, radius);
  };

  const discHeight = (r: number): number => radius * (0.006 + 0.026 * Math.exp(-r / (0.45 * radius)));

  const bulbPosition = (): Vec3 => {
    const r = radius * (0.012 + 0.17 * Math.pow(placement.next(), 0.62));
    const cosTheta = placement.float(-1, 1);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = placement.float(0, TAU);
    return {
      x: r * sinTheta * Math.cos(phi),
      y: r * cosTheta * 0.72,
      z: r * sinTheta * Math.sin(phi),
    };
  };

  const armPosition = (): Vec3 => {
    const r = sampleDiscRadius();
    const arm = placement.weighted(armWeights);
    const phase = armPhase[arm];
    if (phase === undefined) throw new Error('generateGalaxy: missing arm phase');
    // Log-spiral angle; `noise` warps the arm so it is not a perfect mathematical curve.
    const warp =
      noise.fbm2((r / radius) * 3.1, arm * 1.7, 3, 2, 0.5) * 0.16 * params.armSpread;
    const theta =
      phase +
      twist * Math.log(r / rIn) +
      placement.gaussian(0, 0.05 + 0.6 * params.armSpread) +
      warp;
    const jittered = clamp(
      r * (1 + placement.gaussian(0, 0.03 + 0.06 * params.armSpread)),
      discMin * 0.8,
      radius,
    );
    return {
      x: jittered * Math.cos(theta),
      y: clamp(placement.gaussian(0, discHeight(jittered)), -heightCap, heightCap),
      z: jittered * Math.sin(theta),
    };
  };

  const discPosition = (): Vec3 => {
    const r = sampleDiscRadius();
    const theta = placement.float(0, TAU);
    return {
      x: r * Math.cos(theta),
      y: clamp(placement.gaussian(0, discHeight(r)), -heightCap, heightCap),
      z: r * Math.sin(theta),
    };
  };

  const haloPosition = (): Vec3 => {
    const r = radius * placement.float(0.45, 0.98);
    const theta = placement.float(0, TAU);
    return {
      x: r * Math.cos(theta),
      y: clamp(
        placement.gaussian(0, radius * 0.07),
        -radius * 0.18,
        radius * 0.18,
      ),
      z: r * Math.sin(theta),
    };
  };

  // --- systems ---------------------------------------------------------------
  const systems: SystemStub[] = [];
  const usedNames = new Set<string>();
  const usedSeeds = new Set<number>();
  const grid: PlacementGrid = {
    cell: Math.max(radius * 0.02, 1),
    buckets: new Map<string, Vec3[]>(),
  };
  const minimumSeparation = radius * MIN_SEPARATION_FRACTION;

  for (let index = 0; index < count; index += 1) {
    const isBulge = index < bulgeCount;
    const isArm = !isBulge && index < bulgeCount + armCount;
    const isInterarm = !isBulge && !isArm && index < bulgeCount + armCount + interarmCount;
    let position: Vec3 = roundedPosition(0, 0, 0);
    for (let attempt = 0; attempt < MAX_SEPARATION_ATTEMPTS; attempt += 1) {
      const raw = isBulge
        ? bulbPosition()
        : isArm
          ? armPosition()
          : isInterarm
            ? discPosition()
            : haloPosition();
      position = roundedPosition(raw.x, raw.y, raw.z);
      if (hasRoom(grid, position, minimumSeparation)) break;
    }
    place(grid, position);

    let seed = mixSeeds(galaxySeed, mixSeeds(index + 1, SYSTEM_STREAM));
    let collision = 0;
    while (usedSeeds.has(seed)) {
      collision += 1;
      seed = mixSeeds(seed, SYSTEM_STREAM + collision);
      if (collision > 8) {
        throw new Error(`generateGalaxy: could not derive a unique seed for system ${index}`);
      }
    }
    usedSeeds.add(seed);

    const systemRng = new Rng(mixSeeds(seed, 0x5eed1e55));
    const spectral: SpectralClass = pickSpectral(systemRng, params.ageGyr, params.metallicity);
    const name = uniqueStarName(systemRng, usedNames);
    const profile = stellarProfile(seed, spectral);

    // Per-system spread around the galaxy-level knobs. Life and hazard are strictly
    // gated at zero: a sterile galaxy has no life anywhere, a clean one has no debris.
    const spread = 0.1 + 0.1 * (1 - params.ageGyr / 13.5);
    const metallicity = clamp(params.metallicity + systemRng.gaussian(0, spread), 0, 1);
    const hazard =
      params.hazard <= 0
        ? 0
        : clamp(params.hazard * systemRng.float(0.55, 1.45), 0, 1);
    const lifeChance =
      params.lifeChance <= 0
        ? 0
        : clamp(params.lifeChance * systemRng.float(0.45, 1.55), 0, 1);
    const context: SystemContext = {
      metallicity: roundTo(metallicity, 3),
      ageGyr: roundTo(params.ageGyr, 1),
      lifeChance: roundTo(lifeChance, 3),
      hazard: roundTo(hazard, 3),
    };

    systems.push({
      id: `sys-${String(index + 1).padStart(3, '0')}`,
      name,
      position,
      spectral,
      color: profile.color,
      brightness: profile.brightness,
      seed,
      context,
    });
  }

  return { params, systems };
}
