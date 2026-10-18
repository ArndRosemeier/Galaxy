import { describe, expect, it } from 'vitest';

import {
  distanceAtAU,
  eccentricAnomaly,
  moonPositionKm,
  orbitalPeriodDays,
  positionAtAU,
  wrapAngle,
} from '../src/sim/orbit';
import type { MoonOrbit, Orbit } from '../src/sim/types';

const circular: Orbit = {
  semiMajorAU: 1,
  eccentricity: 0,
  inclinationDeg: 0,
  nodeDeg: 0,
  argPeriapsisDeg: 0,
  meanAnomalyDeg: 0,
  periodDays: 365.25,
};

const eccentric: Orbit = {
  semiMajorAU: 2,
  eccentricity: 0.5,
  inclinationDeg: 30,
  nodeDeg: 40,
  argPeriapsisDeg: 70,
  meanAnomalyDeg: 0,
  periodDays: 365.25 * Math.sqrt(8),
};

describe('orbit maths', () => {
  it('wraps angles into [0, 2π)', () => {
    expect(wrapAngle(-0.5)).toBeCloseTo(Math.PI * 2 - 0.5, 12);
    expect(wrapAngle(Math.PI * 4 + 0.25)).toBeCloseTo(0.25, 12);
  });

  it('follows Kepler III for an Earth-mass star', () => {
    expect(orbitalPeriodDays(1, 1)).toBeCloseTo(365.25, 6);
    expect(orbitalPeriodDays(4, 1)).toBeCloseTo(365.25 * 8, 6);
  });

  it('solves Kepler’s equation exactly', () => {
    for (const e of [0, 0.1, 0.5, 0.8]) {
      for (const M of [0, 0.7, 2.5, 5.9]) {
        const E = eccentricAnomaly(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 9);
      }
    }
  });

  it('puts a circular orbit at its semi-major axis, always', () => {
    for (const t of [0, 10, 365.25, 1000]) {
      const p = positionAtAU(circular, t);
      const r = Math.hypot(p.x, p.y, p.z);
      expect(r).toBeCloseTo(1, 9);
      expect(distanceAtAU(circular, t)).toBeCloseTo(1, 9);
    }
  });

  it('is periodic in the orbital period', () => {
    const a = positionAtAU(eccentric, 0);
    const b = positionAtAU(eccentric, eccentric.periodDays);
    expect(b.x).toBeCloseTo(a.x, 8);
    expect(b.y).toBeCloseTo(a.y, 8);
    expect(b.z).toBeCloseTo(a.z, 8);
  });

  it('is closest to the star at periapsis and furthest at apoapsis', () => {
    const peri = distanceAtAU(eccentric, 0);
    const apo = distanceAtAU(eccentric, eccentric.periodDays / 2);
    expect(peri).toBeCloseTo(eccentric.semiMajorAU * (1 - eccentric.eccentricity), 6);
    expect(apo).toBeCloseTo(eccentric.semiMajorAU * (1 + eccentric.eccentricity), 6);
  });

  it('keeps a moon at its orbital radius when circular', () => {
    const moon: MoonOrbit = {
      radiusKm: 384_400,
      eccentricity: 0,
      inclinationDeg: 5.1,
      phaseDeg: 0,
      periodDays: 27.32,
    };
    for (const t of [0, 7, 27.32]) {
      const p = moonPositionKm(moon, t);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(384_400, 6);
    }
  });
});
