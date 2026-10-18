/**
 * Shared fixtures for the simulation tests.
 *
 * The physical formulas here are deliberately written out by hand (not imported from
 * `src/sim/physics`) so a test can catch a bug in the module it is checking. The one
 * exception is the orbital period: tests use `src/sim/orbit.ts` because that module is
 * the frozen seam the renderer also uses.
 */

import {
  DEFAULT_PARAMS,
  PRESETS,
  generateGalaxy,
  generateSystem,
  type Galaxy,
  type GalaxyParams,
  type StarSystem,
} from '../../src/sim';

export const EARTH_RADIUS_KM = 6371;
export const AU_KM = 149_597_870.7;
export const EARTH_MASS_PER_SUN = 3.0034896e-6;
export const EARTH_DENSITY_GCM3 = 5.5136;

/** The parameter sets every structural pin runs over: the default galaxy and all presets. */
export const PIN_PARAMS: readonly GalaxyParams[] = [
  DEFAULT_PARAMS,
  ...PRESETS.map((preset) => preset.params),
];

/** The default plus two deliberately extreme parameter sets, for response tests. */
export const EXTREME_PARAMS: readonly GalaxyParams[] = [
  DEFAULT_PARAMS,
  {
    ...DEFAULT_PARAMS,
    seed: 'pin-fertile',
    lifeChance: 1,
    hazard: 1,
    metallicity: 1,
    ageGyr: 13.5,
  },
  {
    ...DEFAULT_PARAMS,
    seed: 'pin-sterile',
    lifeChance: 0,
    hazard: 0,
    metallicity: 0,
    ageGyr: 1,
  },
];

export interface GalaxySample {
  readonly params: GalaxyParams;
  readonly galaxy: Galaxy;
  readonly systems: readonly StarSystem[];
}

/** Generate every system of the given galaxies. Deterministic; call it from a test body. */
export function collectSystems(
  paramsSets: readonly GalaxyParams[] = EXTREME_PARAMS,
): GalaxySample[] {
  return paramsSets.map((params) => {
    const galaxy = generateGalaxy(params);
    return {
      params,
      galaxy,
      systems: galaxy.systems.map((stub) => generateSystem(stub)),
    };
  });
}

/** `g = 9.81 · M / (r/6371)²` — the definition the deterministic pin uses, written out. */
export function gravityFromContract(massEarth: number, radiusKm: number): number {
  return (9.81 * massEarth) / (radiusKm / EARTH_RADIUS_KM) ** 2;
}

/** Bulk density in g/cm³ implied by the stored mass and radius. */
export function densityFromContract(massEarth: number, radiusKm: number): number {
  const radiusEarth = radiusKm / EARTH_RADIUS_KM;
  return (massEarth / radiusEarth ** 3) * EARTH_DENSITY_GCM3;
}

/** Fluid Roche limit in km; the satellite density the generator uses is 2.5 g/cm³. */
export function rocheLimitKm(
  planetRadiusKm: number,
  planetDensityGcm3: number,
  moonDensityGcm3 = 2.5,
): number {
  return 2.44 * planetRadiusKm * Math.cbrt(planetDensityGcm3 / moonDensityGcm3);
}

/** Hill-sphere radius in km, written out independently of `src/sim/physics`. */
export function hillRadiusKm(
  semiMajorAU: number,
  planetMassEarth: number,
  starMassSun: number,
): number {
  const ratio = (planetMassEarth * EARTH_MASS_PER_SUN) / (3 * starMassSun);
  return semiMajorAU * Math.cbrt(ratio) * AU_KM;
}

export function allPlanets(samples: readonly GalaxySample[]): {
  readonly system: StarSystem;
  readonly planet: StarSystem['planets'][number];
}[] {
  const out: { system: StarSystem; planet: StarSystem['planets'][number] }[] = [];
  for (const sample of samples) {
    for (const system of sample.systems) {
      for (const planet of system.planets) out.push({ system, planet });
    }
  }
  return out;
}
