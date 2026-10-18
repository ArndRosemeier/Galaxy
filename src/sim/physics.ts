/**
 * The physical model — one place for the conversions generation needs.
 *
 * Orbital periods are NOT re-derived here: `moonPeriodDays` converts a moon's km and its
 * planet's Earth masses into the units of the frozen `orbitalPeriodDays` and calls it, so
 * Kepler III has exactly one implementation in the project (`src/sim/orbit.ts`).
 *
 * These are deliberately simple, standard relations (bulk density, equilibrium
 * temperature, Hill sphere, fluid Roche limit, Kepler III around a planet). They are
 * plausible, not a simulation: `docs/ARCHITECTURE.md` explicitly scopes real
 * astrophysics out where it would cost the look.
 */

import { orbitalPeriodDays } from './orbit';

/** Earth's mean radius, km. The contract fixes this conversion: gravity is defined from 6371 km. */
export const EARTH_RADIUS_KM = 6371;
/** Earth's mean density, g/cm³. */
export const EARTH_DENSITY_GCM3 = 5.5136;
/** Earth masses per solar mass. */
export const EARTH_MASS_PER_SUN = 3.0034896e-6;
/** Astronomical unit, km. */
export const AU_KM = 149_597_870.7;
/** Solar radius, km. */
export const SUN_RADIUS_KM = 695_700;
/** Mean solar surface temperature, K (for the R²T⁴ luminosity relation). */
export const SUN_TEMPERATURE_K = 5772;
/** Solar radius in AU. */
export const SUN_RADIUS_AU = SUN_RADIUS_KM / AU_KM;
/** The floor no surface can sit below: the cosmic microwave background. */
export const CMB_TEMPERATURE_K = 2.7;
/** Standard gravity at Earth's surface, m/s². The contract defines `gravityG` against it. */
export const STANDARD_GRAVITY = 9.81;

function positive(value: number, what: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${what}: expected a positive finite number, got ${String(value)}`);
  }
  return value;
}

/** Stellar radius in AU. */
export function starRadiusAU(radiusSun: number): number {
  return positive(radiusSun, 'starRadiusAU') * SUN_RADIUS_AU;
}

/**
 * Surface gravity in Earth gravities from mass and radius — the *definition* the
 * deterministic tests hold generation to:
 * `g = 9.81 · massEarth / (radiusKm / 6371)²`.
 */
export function gravityG(massEarth: number, radiusKm: number): number {
  positive(massEarth, 'gravityG.massEarth');
  positive(radiusKm, 'gravityG.radiusKm');
  const radiusEarth = radiusKm / EARTH_RADIUS_KM;
  return (STANDARD_GRAVITY * massEarth) / (radiusEarth * radiusEarth);
}

/**
 * Mass in Earth masses for a sphere of `radiusKm` and bulk `densityGcm3`:
 * `M = (r/r⊕)³ · ρ/ρ⊕`.
 */
export function bulkMassEarth(radiusKm: number, densityGcm3: number): number {
  positive(radiusKm, 'bulkMassEarth.radiusKm');
  positive(densityGcm3, 'bulkMassEarth.densityGcm3');
  const radiusEarth = radiusKm / EARTH_RADIUS_KM;
  return radiusEarth * radiusEarth * radiusEarth * (densityGcm3 / EARTH_DENSITY_GCM3);
}

/** Luminosity in solar units from radius (solar) and effective temperature (K). */
export function luminositySun(radiusSun: number, temperatureK: number): number {
  positive(radiusSun, 'luminositySun.radiusSun');
  positive(temperatureK, 'luminositySun.temperatureK');
  return radiusSun * radiusSun * (temperatureK / SUN_TEMPERATURE_K) ** 4;
}

/**
 * Equilibrium temperature in K: `278.6 · L^¼ · (1−A)^¼ / √a`.
 * The constant is the blackbody temperature of a zero-albedo body at 1 AU from the Sun.
 */
export function equilibriumTemperatureK(
  luminositySunValue: number,
  semiMajorAU: number,
  albedo: number,
): number {
  if (!Number.isFinite(luminositySunValue) || luminositySunValue < 0) {
    throw new Error(`equilibriumTemperatureK: invalid luminosity ${luminositySunValue}`);
  }
  positive(semiMajorAU, 'equilibriumTemperatureK.semiMajorAU');
  if (!Number.isFinite(albedo) || albedo < 0 || albedo > 1) {
    throw new Error(`equilibriumTemperatureK: invalid albedo ${albedo}`);
  }
  if (luminositySunValue === 0) return 0;
  return (
    (278.6 * luminositySunValue ** 0.25 * (1 - albedo) ** 0.25) / Math.sqrt(semiMajorAU)
  );
}

/**
 * Hill-sphere radius in km: `a · (m_planet / (3·M_star))^⅓`.
 * Moon systems are generated inside this sphere.
 */
export function hillRadiusKm(
  semiMajorAU: number,
  planetMassEarth: number,
  starMassSun: number,
): number {
  positive(semiMajorAU, 'hillRadiusKm.semiMajorAU');
  positive(planetMassEarth, 'hillRadiusKm.planetMassEarth');
  positive(starMassSun, 'hillRadiusKm.starMassSun');
  const ratio = (planetMassEarth * EARTH_MASS_PER_SUN) / (3 * starMassSun);
  return semiMajorAU * Math.cbrt(ratio) * AU_KM;
}

/**
 * Fluid Roche limit in km: `2.44 · R_planet · (ρ_planet / ρ_moon)^⅓`.
 * Moons orbit outside it; ring systems start outside it.
 */
export function rocheLimitKm(
  planetRadiusKm: number,
  planetDensityGcm3: number,
  moonDensityGcm3 = 2.5,
): number {
  positive(planetRadiusKm, 'rocheLimitKm.planetRadiusKm');
  positive(planetDensityGcm3, 'rocheLimitKm.planetDensityGcm3');
  positive(moonDensityGcm3, 'rocheLimitKm.moonDensityGcm3');
  return 2.44 * planetRadiusKm * Math.cbrt(planetDensityGcm3 / moonDensityGcm3);
}

/**
 * A moon's sidereal period in days, via the frozen Kepler helper. km and Earth masses are
 * converted to AU and solar masses, then `orbitalPeriodDays` supplies the one Kepler III
 * implementation in the project. The planet's mass dominates; a moon's own mass is not
 * part of the contract.
 */
export function moonPeriodDays(orbitRadiusKm: number, planetMassEarth: number): number {
  positive(orbitRadiusKm, 'moonPeriodDays.orbitRadiusKm');
  positive(planetMassEarth, 'moonPeriodDays.planetMassEarth');
  return orbitalPeriodDays(orbitRadiusKm / AU_KM, planetMassEarth * EARTH_MASS_PER_SUN);
}
