/**
 * The eight statements the dispatcher holds this layer to — one test each, named with
 * the statement it proves. An injected fault in generation must turn at least one of
 * these red, and the test's name says which promise broke.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_PARAMS,
  generateGalaxy,
  generateSystem,
  type Galaxy,
} from '../../src/sim';
import { orbitalPeriodDays } from '../../src/sim/orbit';
import {
  PIN_PARAMS,
  allPlanets,
  collectSystems,
  densityFromContract,
  gravityFromContract,
  hillRadiusKm,
  rocheLimitKm,
  type GalaxySample,
} from './support';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHILD = fileURLToPath(new URL('./fixtures/child-hash.mjs', import.meta.url));
const NODE = (globalThis as unknown as { process: { execPath: string } }).process.execPath;

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function payloadFor(galaxy: Galaxy): unknown {
  const first = galaxy.systems[0];
  if (!first) throw new Error('pins: galaxy has no systems');
  return { galaxy, firstSystem: generateSystem(first) };
}

let samples: GalaxySample[];

beforeAll(() => {
  samples = collectSystems(PIN_PARAMS);
});

describe('the pinned statements', () => {
  it('the same seed and params produce byte-identical JSON in two separate processes', () => {
    const params = DEFAULT_PARAMS;
    const parentHash = sha(payloadFor(generateGalaxy(params)));
    const output = execFileSync(NODE, [CHILD, JSON.stringify(params)], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15_000,
    }).trim();
    expect(output).toMatch(/^[0-9a-f]{64}$/);
    expect(output).toBe(parentHash);
  });

  it('changing only the seed changes the galaxy', () => {
    const a = generateGalaxy({ ...DEFAULT_PARAMS, seed: 'pin-seed-a' });
    const b = generateGalaxy({ ...DEFAULT_PARAMS, seed: 'pin-seed-b' });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    // Only the seed differs, so the parameters themselves must agree.
    expect({ ...a.params, seed: 'x' }).toEqual({ ...b.params, seed: 'x' });
  });

  it('every planet: radius>0, mass>0, gravity within 1% of 9.81·massEarth/(radiusKm/6371)², temperature>0, albedo∈[0,1], eccentricity∈[0,0.35], and period matches Kepler III within 1%', () => {
    const planets = allPlanets(samples);
    expect(planets.length).toBeGreaterThan(500);
    for (const { system, planet } of planets) {
      const label = `${system.name} / ${planet.name}`;
      expect(planet.radiusKm, `${label} radius`).toBeGreaterThan(0);
      expect(planet.massEarth, `${label} mass`).toBeGreaterThan(0);
      const expectedGravity = gravityFromContract(planet.massEarth, planet.radiusKm);
      expect(
        Math.abs(planet.gravityG - expectedGravity) / expectedGravity,
        `${label} gravity`,
      ).toBeLessThanOrEqual(0.01);
      expect(planet.temperatureK, `${label} temperature`).toBeGreaterThan(0);
      expect(planet.albedo, `${label} albedo`).toBeGreaterThanOrEqual(0);
      expect(planet.albedo, `${label} albedo`).toBeLessThanOrEqual(1);
      expect(planet.orbit.eccentricity, `${label} eccentricity`).toBeGreaterThanOrEqual(0);
      expect(planet.orbit.eccentricity, `${label} eccentricity`).toBeLessThanOrEqual(0.35);
      const kepler = orbitalPeriodDays(planet.orbit.semiMajorAU, system.star.massSun);
      expect(
        Math.abs(planet.orbit.periodDays - kepler) / kepler,
        `${label} period`,
      ).toBeLessThanOrEqual(0.01);
      expect(planet.yearDays, `${label} yearDays mirrors orbit.periodDays`).toBe(
        planet.orbit.periodDays,
      );
    }
  });

  it('planet semi-major axes strictly increase and no two orbits cross', () => {
    let pairs = 0;
    for (const sample of samples) {
      for (const system of sample.systems) {
        for (let i = 0; i < system.planets.length; i += 1) {
          const planet = system.planets[i];
          if (!planet) continue;
          const next = system.planets[i + 1];
          if (!next) continue;
          pairs += 1;
          expect(
            planet.orbit.semiMajorAU,
            `${system.name}: ${planet.name} < ${next.name}`,
          ).toBeLessThan(next.orbit.semiMajorAU);
          const apoapsis = planet.orbit.semiMajorAU * (1 + planet.orbit.eccentricity);
          const nextPeriapsis = next.orbit.semiMajorAU * (1 - next.orbit.eccentricity);
          expect(apoapsis, `${system.name}: ${planet.name} clears ${next.name}`).toBeLessThan(
            nextPeriapsis,
          );
        }
      }
    }
    expect(pairs).toBeGreaterThan(500);
  });

  it('a gas giant has no solid surface (no hydrosphere), and a lava world is hotter than 700 K', () => {
    const planets = allPlanets(samples);
    const giants = planets.filter(
      ({ planet }) => planet.kind === 'gas' || planet.kind === 'icegiant',
    );
    const lava = planets.filter(({ planet }) => planet.kind === 'lava');
    expect(giants.length).toBeGreaterThan(50);
    expect(lava.length).toBeGreaterThan(0);
    for (const { system, planet } of giants) {
      expect(planet.hydrosphere, `${system.name} / ${planet.name} hydrosphere`).toBeNull();
    }
    for (const { system, planet } of lava) {
      expect(planet.temperatureK, `${system.name} / ${planet.name} lava temperature`).toBeGreaterThan(
        700,
      );
    }
  });

  it('moons lie inside the Hill radius and outside the fluid Roche limit; rings lie outside the Roche limit', () => {
    let moons = 0;
    let rings = 0;
    for (const sample of samples) {
      for (const system of sample.systems) {
        for (const planet of system.planets) {
          const density = densityFromContract(planet.massEarth, planet.radiusKm);
          const roche = rocheLimitKm(planet.radiusKm, density);
          const hill = hillRadiusKm(
            planet.orbit.semiMajorAU,
            planet.massEarth,
            system.star.massSun,
          );
          for (const moon of planet.moons) {
            moons += 1;
            expect(
              moon.orbit.radiusKm,
              `${moon.name} outside Roche (${moon.orbit.radiusKm} <= ${roche})`,
            ).toBeGreaterThan(roche);
            expect(
              moon.orbit.radiusKm,
              `${moon.name} inside Hill (${moon.orbit.radiusKm} >= ${hill})`,
            ).toBeLessThan(hill);
          }
          if (planet.rings) {
            rings += 1;
            expect(
              planet.rings.innerRadiusKm,
              `${planet.name} rings outside Roche (${planet.rings.innerRadiusKm} <= ${roche})`,
            ).toBeGreaterThan(roche);
            expect(planet.rings.outerRadiusKm).toBeGreaterThan(planet.rings.innerRadiusKm);
          }
        }
      }
    }
    expect(moons).toBeGreaterThan(500);
    expect(rings).toBeGreaterThan(50);
  });

  it('no duplicate system names; no duplicate planet names within a system', () => {
    for (const sample of samples) {
      const systemNames = new Set<string>();
      for (const system of sample.systems) {
        expect(systemNames.has(system.name), `duplicate system name ${system.name}`).toBe(false);
        systemNames.add(system.name);
        const planetNames = new Set<string>();
        for (const planet of system.planets) {
          expect(
            planetNames.has(planet.name),
            `${system.name}: duplicate planet name ${planet.name}`,
          ).toBe(false);
          planetNames.add(planet.name);
          const moonNames = new Set<string>();
          for (const moon of planet.moons) {
            expect(moonNames.has(moon.name), `duplicate moon name ${moon.name}`).toBe(false);
            moonNames.add(moon.name);
          }
        }
      }
      expect(systemNames.size).toBe(sample.galaxy.systems.length);
    }
  });

  it('600 systems generate in under 150 ms on this host', () => {
    // Warm the JIT with a smaller galaxy so the measurement is generation, not startup.
    generateGalaxy({ ...DEFAULT_PARAMS, systemCount: 60 });
    const params = { ...DEFAULT_PARAMS, systemCount: 600 };
    const started = performance.now();
    const galaxy = generateGalaxy(params);
    const elapsed = performance.now() - started;
    expect(galaxy.systems.length).toBe(600);
    console.info(`[perf] generateGalaxy(600) = ${elapsed.toFixed(2)} ms`);
    expect(elapsed).toBeLessThan(150);
  });
});
