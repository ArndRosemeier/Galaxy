/**
 * Keplerian orbit maths — the single place a body's position is derived from its
 * orbital elements. Both the generator (which must agree with what is drawn) and the
 * renderer (which draws it) use this module; nothing else re-implements the transform.
 *
 * Frame convention, matching three.js: **+Y is up**, the reference plane is XZ
 * (`inclinationDeg = 0` lies in XZ), and angles increase counter-clockwise looking
 * down the +Y axis. Every helper returns a plain object so results are
 * JSON-comparable in tests.
 */

import type { MoonOrbit, Orbit, Vec3 } from './types';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Wrap an angle into [0, 2π). */
export function wrapAngle(radians: number): number {
  const m = radians % TAU;
  return m < 0 ? m + TAU : m;
}

/** Kepler's third law: period in days for a semi-major axis in AU about `massSun`. */
export function orbitalPeriodDays(semiMajorAU: number, massSun: number): number {
  const years = Math.sqrt((semiMajorAU * semiMajorAU * semiMajorAU) / massSun);
  return years * 365.25;
}

/**
 * Solve Kepler's equation `M = E − e·sin E` for the eccentric anomaly.
 * Newton's method, seeded with `M + e·sin M`; converges in a handful of iterations
 * for e < 0.9, which is the range generation produces. The fixed iteration cap keeps
 * it deterministic (a while-loop on a tolerance could take a different path on a
 * different JIT — determinism is a contract here, not a nicety).
 */
export function eccentricAnomaly(meanAnomalyRad: number, eccentricity: number): number {
  const M = wrapAngle(meanAnomalyRad);
  let E = eccentricity < 0.8 ? M + eccentricity * Math.sin(M) : Math.PI;
  for (let i = 0; i < 12; i += 1) {
    const f = E - eccentricity * Math.sin(E) - M;
    const fp = 1 - eccentricity * Math.cos(E);
    const step = f / fp;
    E -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return E;
}

/** Position in the orbital plane (AU) for a body at `timeDays`. */
function planarPosition(
  semiMajorAU: number,
  eccentricity: number,
  meanAnomalyDeg: number,
  periodDays: number,
  timeDays: number,
): { x: number; z: number; radius: number } {
  const M = meanAnomalyDeg * DEG + (TAU * timeDays) / periodDays;
  const E = eccentricAnomaly(M, eccentricity);
  const cosE = Math.cos(E);
  const cosNu = (cosE - eccentricity) / (1 - eccentricity * cosE);
  const sinNu = (Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(E)) / (1 - eccentricity * cosE);
  const radius = semiMajorAU * (1 - eccentricity * cosE);
  return { x: radius * cosNu, z: radius * sinNu, radius };
}

/** Rotate about +Y by `angle` (radians). */
function rotateY(x: number, z: number, angle: number): { x: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/**
 * Position of a planet in AU relative to its star, at `timeDays` since epoch.
 * The transform is: argument of periapsis (about Y), then inclination (about X),
 * then longitude of ascending node (about Y).
 */
export function positionAtAU(orbit: Orbit, timeDays: number): Vec3 {
  const p = planarPosition(
    orbit.semiMajorAU,
    orbit.eccentricity,
    orbit.meanAnomalyDeg,
    orbit.periodDays,
    timeDays,
  );

  const peri = rotateY(p.x, p.z, orbit.argPeriapsisDeg * DEG);
  const incl = orbit.inclinationDeg * DEG;
  const y = -peri.z * Math.sin(incl);
  const zTilted = peri.z * Math.cos(incl);
  const node = rotateY(peri.x, zTilted, orbit.nodeDeg * DEG);
  return { x: node.x, y, z: node.z };
}

/** Distance from the star in AU at `timeDays` (avoids building a Vec3 when only the length is needed). */
export function distanceAtAU(orbit: Orbit, timeDays: number): number {
  const M = orbit.meanAnomalyDeg * DEG + (TAU * timeDays) / orbit.periodDays;
  const E = eccentricAnomaly(M, orbit.eccentricity);
  return orbit.semiMajorAU * (1 - orbit.eccentricity * Math.cos(E));
}

/**
 * Position of a moon relative to its planet's centre, in kilometres. Moons use a
 * circularised treatment of the same maths (their `eccentricity` is small) so the
 * same determinism and frame conventions hold.
 */
export function moonPositionKm(orbit: MoonOrbit, timeDays: number): Vec3 {
  const M = orbit.phaseDeg * DEG + (TAU * timeDays) / orbit.periodDays;
  const E = eccentricAnomaly(M, orbit.eccentricity);
  const radius = orbit.radiusKm * (1 - orbit.eccentricity * Math.cos(E));

  const x = radius * Math.cos(E);
  const z = radius * Math.sin(E);
  const incl = orbit.inclinationDeg * DEG;
  return { x, y: -z * Math.sin(incl), z: z * Math.cos(incl) };
}
