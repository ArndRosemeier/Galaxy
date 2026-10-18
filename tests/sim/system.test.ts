import { beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_PARAMS,
  generateGalaxy,
  generateSystem,
  type Planet,
  type PlanetKind,
  type StarSystem,
  type SystemStub,
} from '../../src/sim';
import { EXTREME_PARAMS, collectSystems, type GalaxySample } from './support';

let samples: GalaxySample[];

beforeAll(() => {
  samples = collectSystems(EXTREME_PARAMS);
});

function allPlanets(): { system: StarSystem; planet: Planet }[] {
  const out: { system: StarSystem; planet: Planet }[] = [];
  for (const sample of samples) {
    for (const system of sample.systems) {
      for (const planet of system.planets) out.push({ system, planet });
    }
  }
  return out;
}

function expectFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} is ${String(value)}`).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => expectFiniteNumbers(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      expectFiniteNumbers(entry, `${path}.${key}`);
    }
  }
}

const ROCKY_KINDS: readonly PlanetKind[] = [
  'terrestrial',
  'ocean',
  'desert',
  'ice',
  'lava',
  'toxic',
  'barren',
];

describe('stars', () => {
  it('agrees with the stub the galaxy drew, field for field', () => {
    for (const sample of samples) {
      for (const stub of sample.galaxy.systems) {
        const system = sample.systems.find((candidate) => candidate.id === stub.id);
        expect(system).toBeDefined();
        if (!system) continue;
        expect(system.star.name).toBe(stub.name);
        expect(system.star.spectral).toBe(stub.spectral);
        expect(system.star.color).toEqual(stub.color);
        expect(system.star.massSun).toBeGreaterThan(0);
        expect(system.star.radiusSun).toBeGreaterThan(0);
        expect(system.star.temperatureK).toBeGreaterThan(0);
        expect(system.star.luminositySun).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(system.star.luminositySun)).toBe(true);
        for (const channel of system.star.color) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('generates white dwarfs, neutron stars and black holes without breaking', () => {
    const galaxy = generateGalaxy({ ...DEFAULT_PARAMS, seed: 'remnants', ageGyr: 13.5, systemCount: 600 });
    const remnants = galaxy.systems.filter((stub) =>
      stub.spectral === 'WD' || stub.spectral === 'NS' || stub.spectral === 'BH',
    );
    expect(remnants.length).toBeGreaterThan(0);
    for (const stub of remnants) {
      const system = generateSystem(stub);
      expect(system.star.spectral).toBe(stub.spectral);
      expectFiniteNumbers(system.star, system.name);
      expect(system.planets.length).toBeLessThanOrEqual(9);
      for (const planet of system.planets) {
        expect(planet.temperatureK).toBeGreaterThan(0);
        expect(planet.radiusKm).toBeGreaterThan(0);
      }
    }
  });
});

describe('planet records', () => {
  it('contain finite, physically ordered numbers everywhere', () => {
    for (const { system, planet } of allPlanets()) {
      expectFiniteNumbers(planet, `${system.name}/${planet.name}`);
      expect(planet.radiusKm).toBeGreaterThan(0);
      expect(planet.massEarth).toBeGreaterThan(0);
      expect(planet.gravityG).toBeGreaterThan(0);
      expect(planet.temperatureK).toBeGreaterThan(0);
      expect(Number.isInteger(planet.temperatureK)).toBe(true);
      expect(planet.albedo).toBeGreaterThanOrEqual(0);
      expect(planet.albedo).toBeLessThanOrEqual(1);
      expect(planet.dayHours).not.toBe(0);
      expect(planet.orbit.semiMajorAU).toBeGreaterThan(0);
      expect(planet.orbit.periodDays).toBeGreaterThan(0);
      expect(planet.yearDays).toBe(planet.orbit.periodDays);
      expect(planet.orbit.eccentricity).toBeGreaterThanOrEqual(0);
      expect(planet.orbit.eccentricity).toBeLessThanOrEqual(0.35);
      expect(planet.orbit.inclinationDeg).toBeGreaterThanOrEqual(0);
      expect(planet.orbit.inclinationDeg).toBeLessThanOrEqual(180);
      expect(planet.orbit.meanAnomalyDeg).toBeGreaterThanOrEqual(0);
      expect(planet.orbit.meanAnomalyDeg).toBeLessThan(360);
      expect(planet.surface.kind).toBe(planet.kind);
      expect(planet.id).toMatch(new RegExp(`^${system.id}-p[1-9]$`));
    }
  });

  it('carry a one-or-two-sentence description with real numbers and readable tags', () => {
    for (const { system, planet } of allPlanets()) {
      expect(planet.description.length).toBeGreaterThan(80);
      expect(planet.description).not.toMatch(/NaN|undefined|Infinity/);
      expect(planet.description).toContain(planet.name);
      expect(planet.description).toContain(system.name);
      expect(planet.description.endsWith('.')).toBe(true);
      expect(planet.description.split('. ').length).toBeLessThanOrEqual(2);
      expect(planet.description).toContain(String(planet.temperatureK));
      expect(planet.tags.length).toBeGreaterThan(0);
      expect(new Set(planet.tags).size).toBe(planet.tags.length);
      for (const tag of planet.tags) {
        expect(tag.length).toBeGreaterThan(1);
        expect(tag).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('describes a world with a plausible day, either locked, free or retrograde', () => {
    const planets = allPlanets().map((entry) => entry.planet);
    const locked = planets.filter(
      (planet) => Math.abs(Math.abs(planet.dayHours) - planet.yearDays * 24) < 0.05,
    );
    const retrograde = planets.filter((planet) => planet.dayHours < 0);
    const free = planets.filter((planet) => !locked.includes(planet) && planet.dayHours > 0);
    expect(locked.length).toBeGreaterThan(0);
    expect(retrograde.length).toBeGreaterThan(0);
    expect(free.length).toBeGreaterThan(100);
    for (const planet of locked) {
      expect(planet.tags).toContain('tidally locked');
      expect(planet.dayHours).toBeGreaterThan(0);
    }
    for (const planet of retrograde) {
      expect(planet.tags).not.toContain('tidally locked');
    }
  });
});

describe('atmosphere, water and life', () => {
  it('keeps compositions normalised and pressure positive', () => {
    for (const { planet } of allPlanets()) {
      if (planet.atmosphere === null) continue;
      const { composition, pressureAtm, greenhouseK, color, opacity } = planet.atmosphere;
      expect(pressureAtm).toBeGreaterThan(0);
      expect(greenhouseK).toBeGreaterThanOrEqual(0);
      expect(composition.length).toBeGreaterThan(0);
      let sum = 0;
      for (const entry of composition) {
        expect(entry.gas.length).toBeGreaterThan(0);
        expect(entry.fraction).toBeGreaterThanOrEqual(0);
        expect(entry.fraction).toBeLessThanOrEqual(1);
        sum += entry.fraction;
      }
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.001);
      for (const channel of color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThanOrEqual(1);
    }
  });

  it('uses the documented composition families for the world kind', () => {
    for (const { planet } of allPlanets()) {
      const atmosphere = planet.atmosphere;
      if (!atmosphere) continue;
      const gases = atmosphere.composition.map((entry) => entry.gas);
      if (planet.kind === 'gas' || planet.kind === 'icegiant') {
        expect(gases).toContain('H2');
        expect(gases).toContain('He');
      } else if (planet.kind === 'toxic') {
        expect(gases[0]).toBe('CO2');
      } else if (planet.kind === 'ice') {
        expect(gases).toContain('CH4');
      } else if (planet.kind === 'lava') {
        expect(gases).toContain('SO2');
      }
    }
  });

  it('gives giants no hydrosphere and no biosphere, and keeps water out of lava and barren worlds', () => {
    for (const { planet } of allPlanets()) {
      if (planet.kind === 'gas' || planet.kind === 'icegiant') {
        expect(planet.hydrosphere).toBeNull();
        expect(planet.biosphere).toBeNull();
        expect(planet.rings === null || planet.rings.innerRadiusKm > 0).toBe(true);
      }
      if (planet.kind === 'lava' || planet.kind === 'barren' || planet.kind === 'ice') {
        expect(planet.hydrosphere).toBeNull();
      }
      if (planet.hydrosphere) {
        expect(planet.hydrosphere.coverage).toBeGreaterThan(0);
        expect(planet.hydrosphere.coverage).toBeLessThanOrEqual(1);
        expect(planet.hydrosphere.depthKm).toBeGreaterThan(0);
        expect(planet.kind).not.toBe('gas');
      }
    }
  });

  it('ties liquid water and settlement lights to the biosphere', () => {
    for (const { planet } of allPlanets()) {
      if (planet.hydrosphere) {
        expect(planet.surface.colors.water).not.toBeNull();
      } else {
        expect(planet.surface.colors.water).toBeNull();
      }
      if (planet.biosphere?.level === 'civilization') {
        expect(planet.surface.nightLights).toBeGreaterThan(0);
      } else {
        expect(planet.surface.nightLights).toBe(0);
      }
      if (planet.biosphere) {
        expect(planet.hydrosphere).not.toBeNull();
        expect(planet.biosphere.summary.length).toBeGreaterThan(40);
        expect(planet.biosphere.summary.endsWith('.')).toBe(true);
        expect(planet.biosphere.summary).toContain(planet.name);
        expect(planet.temperatureK).toBeGreaterThanOrEqual(240);
        expect(planet.temperatureK).toBeLessThanOrEqual(360);
      }
    }
  });

  it('responds to lifeChance and hazard through the optional context', () => {
    const galaxy = generateGalaxy({ ...DEFAULT_PARAMS, lifeChance: 0.6, hazard: 0.8 });
    const rich = galaxy.systems
      .map((stub) => generateSystem(stub))
      .find((system) => system.planets.some((planet) => planet.biosphere !== null));
    expect(rich).toBeDefined();
    if (!rich) return;
    const stub = galaxy.systems.find((candidate) => candidate.id === rich.id);
    expect(stub).toBeDefined();
    if (!stub || !stub.context) return;

    const sterile = generateSystem({ ...stub, context: { ...stub.context, lifeChance: 0 } });
    expect(sterile.planets.every((planet) => planet.biosphere === null)).toBe(true);
    expect(JSON.stringify(sterile)).not.toBe(JSON.stringify(rich));

    const ringed = galaxy.systems
      .map((candidate) => generateSystem(candidate))
      .find((system) =>
        system.planets.some((planet) => planet.rings !== null) ||
        system.belts.length > 0,
      );
    expect(ringed).toBeDefined();
    if (!ringed) return;
    const ringedStub = galaxy.systems.find((candidate) => candidate.id === ringed.id);
    if (!ringedStub || !ringedStub.context) return;
    const clean = generateSystem({ ...ringedStub, context: { ...ringedStub.context, hazard: 0 } });
    expect(clean.planets.every((planet) => planet.rings === null)).toBe(true);
    expect(clean.belts).toHaveLength(0);
  });

  it('uses the documented defaults when a stub carries no context', () => {
    const galaxy = generateGalaxy(DEFAULT_PARAMS);
    const stub = galaxy.systems[3];
    expect(stub).toBeDefined();
    if (!stub) return;
    const bare: SystemStub = {
      id: stub.id,
      name: stub.name,
      position: stub.position,
      spectral: stub.spectral,
      color: stub.color,
      brightness: stub.brightness,
      seed: stub.seed,
    };
    const withDefaults = generateSystem({
      ...bare,
      context: { metallicity: 0.5, ageGyr: 8.6, lifeChance: 0.25, hazard: 0.35 },
    });
    expect(JSON.stringify(generateSystem(bare))).toBe(JSON.stringify(withDefaults));
  });

  it('fails loudly on a malformed stub', () => {
    const stub = generateGalaxy(DEFAULT_PARAMS).systems[0];
    expect(stub).toBeDefined();
    if (!stub) return;
    expect(() => generateSystem({ ...stub, name: '' })).toThrow();
    expect(() => generateSystem({ ...stub, seed: 1.5 })).toThrow();
    expect(() => generateSystem({ ...stub, seed: 0x1_0000_0000 })).toThrow();
    expect(() => generateSystem({ ...stub, position: { x: Number.NaN, y: 0, z: 0 } })).toThrow();
    expect(() => generateSystem({ ...stub, brightness: 2 })).toThrow();
    expect(() =>
      generateSystem({ ...stub, spectral: 'Q' as unknown as SystemStub['spectral'] }),
    ).toThrow();
  });
});

describe('moons, rings and belts', () => {
  it('keeps moon systems ordered, named and bounded', () => {
    let moonCount = 0;
    for (const sample of samples) {
      for (const system of sample.systems) {
        const moonNames = new Set<string>();
        const moonIds = new Set<string>();
        for (const planet of system.planets) {
          expect(planet.moons.length).toBeLessThanOrEqual(6);
          let previousRadius = 0;
          for (const moon of planet.moons) {
            moonCount += 1;
            expect(moon.radiusKm).toBeGreaterThan(0);
            expect(moon.orbit.radiusKm).toBeGreaterThan(planet.radiusKm);
            expect(moon.orbit.radiusKm).toBeGreaterThan(previousRadius);
            previousRadius = moon.orbit.radiusKm;
            expect(moon.orbit.periodDays).toBeGreaterThan(0);
            expect(moon.orbit.eccentricity).toBeGreaterThanOrEqual(0);
            expect(moon.orbit.inclinationDeg).toBeGreaterThanOrEqual(0);
            expect(moon.orbit.inclinationDeg).toBeLessThanOrEqual(180);
            expect(moon.orbit.phaseDeg).toBeGreaterThanOrEqual(0);
            expect(moon.orbit.phaseDeg).toBeLessThan(360);
            expect(moonNames.has(moon.name)).toBe(false);
            moonNames.add(moon.name);
            expect(moonIds.has(moon.id)).toBe(false);
            moonIds.add(moon.id);
            expect(moon.id.startsWith(planet.id)).toBe(true);
            expect(moon.notes.length).toBeLessThanOrEqual(2);
            for (const note of moon.notes) expect(note.length).toBeGreaterThan(3);
            expectFiniteNumbers(moon, moon.name);
            for (const channel of [
              ...moon.surface.colors.deep,
              ...moon.surface.colors.low,
              ...moon.surface.colors.mid,
              ...moon.surface.colors.high,
              ...moon.surface.colors.ice,
            ]) {
              expect(channel).toBeGreaterThanOrEqual(0);
              expect(channel).toBeLessThanOrEqual(1);
            }
            if (moon.atmosphere) {
              let sum = 0;
              for (const entry of moon.atmosphere.composition) sum += entry.fraction;
              expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.001);
              expect(moon.atmosphere.pressureAtm).toBeGreaterThan(0);
            }
          }
        }
      }
    }
    expect(moonCount).toBeGreaterThan(500);
  });

  it('keeps ring systems outside the planet and inside the physical band', () => {
    let ringCount = 0;
    for (const sample of samples) {
      for (const system of sample.systems) {
        for (const planet of system.planets) {
          if (!planet.rings) continue;
          ringCount += 1;
          expect(planet.rings.innerRadiusKm).toBeGreaterThan(planet.radiusKm);
          expect(planet.rings.outerRadiusKm).toBeGreaterThan(planet.rings.innerRadiusKm);
          expect(planet.rings.thicknessKm).toBeGreaterThan(0);
          expect(planet.rings.opacity).toBeGreaterThan(0);
          expect(planet.rings.opacity).toBeLessThanOrEqual(1);
          expect(planet.rings.composition.length).toBeGreaterThan(3);
          for (const channel of planet.rings.color) {
            expect(channel).toBeGreaterThanOrEqual(0);
            expect(channel).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    expect(ringCount).toBeGreaterThan(50);
  });

  it('keeps belts ordered, counted inside 4k–12k and named per system', () => {
    let beltCount = 0;
    for (const sample of samples) {
      for (const system of sample.systems) {
        expect(system.belts.length).toBeLessThanOrEqual(2);
        const names = new Set<string>();
        const ids = new Set<string>();
        for (const belt of system.belts) {
          beltCount += 1;
          expect(belt.innerAU).toBeGreaterThan(0);
          expect(belt.outerAU).toBeGreaterThan(belt.innerAU);
          expect(Number.isInteger(belt.count)).toBe(true);
          expect(belt.count).toBeGreaterThanOrEqual(4000);
          expect(belt.count).toBeLessThanOrEqual(12_000);
          expect(belt.density).toBeGreaterThan(0);
          expect(belt.density).toBeLessThanOrEqual(1);
          expect(belt.inclinationDeg).toBeGreaterThanOrEqual(0);
          expect(belt.inclinationDeg).toBeLessThanOrEqual(90);
          expect(Number.isInteger(belt.seed)).toBe(true);
          expect(names.has(belt.name)).toBe(false);
          names.add(belt.name);
          expect(ids.has(belt.id)).toBe(false);
          ids.add(belt.id);
          for (const planet of system.planets) {
            const inside =
              planet.orbit.semiMajorAU > belt.innerAU && planet.orbit.semiMajorAU < belt.outerAU;
            expect(inside, `${belt.name} overlaps ${planet.name}`).toBe(false);
          }
        }
      }
    }
    expect(beltCount).toBeGreaterThan(100);
  });
});

describe('surface recipes', () => {
  it('give every kind a distinct, in-gamut palette', () => {
    const byKind = new Map<PlanetKind, Set<string>>();
    for (const { planet } of allPlanets()) {
      const colors = planet.surface.colors;
      for (const color of [
        colors.deep,
        colors.low,
        colors.mid,
        colors.high,
        colors.ice,
        ...(colors.water ? [colors.water] : []),
      ]) {
        for (const channel of color) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
      for (const value of [
        planet.surface.cloudiness,
        planet.surface.turbulence,
        planet.surface.bandiness,
        planet.surface.roughness,
        planet.surface.nightLights,
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(Number.isInteger(planet.surface.seed)).toBe(true);
      const key = JSON.stringify(colors);
      const set = byKind.get(planet.kind) ?? new Set<string>();
      set.add(key);
      byKind.set(planet.kind, set);
    }
    const kinds: readonly PlanetKind[] = [
      'terrestrial',
      'ocean',
      'desert',
      'ice',
      'lava',
      'toxic',
      'barren',
      'gas',
      'icegiant',
    ];
    for (const kind of kinds) {
      expect(byKind.has(kind), `no ${kind} in the sample`).toBe(true);
      expect(byKind.get(kind)?.size ?? 0, `${kind} has only one look`).toBeGreaterThan(1);
    }
  });

  it('gives every kind at least one representative among the extreme galaxies', () => {
    const kinds = new Set<PlanetKind>();
    for (const sample of samples) {
      for (const system of sample.systems) {
        for (const planet of system.planets) kinds.add(planet.kind);
      }
    }
    for (const kind of [
      ...ROCKY_KINDS,
      'gas',
      'icegiant',
    ] as const) {
      expect(kinds.has(kind), `missing ${kind}`).toBe(true);
    }
  });
});

describe('system determinism', () => {
  it('reproduces the same JSON for the same stub', () => {
    const stub = generateGalaxy(DEFAULT_PARAMS).systems[7];
    expect(stub).toBeDefined();
    if (!stub) return;
    expect(JSON.stringify(generateSystem(stub))).toBe(JSON.stringify(generateSystem(stub)));
  });

  it('changes when the per-system context changes', () => {
    const galaxy = generateGalaxy(DEFAULT_PARAMS);
    let changed = false;
    for (const stub of galaxy.systems) {
      if (!stub.context) continue;
      if (generateSystem(stub).planets.length === 0) continue;
      const hot = generateSystem({ ...stub, context: { ...stub.context, metallicity: 1 } });
      const cold = generateSystem({ ...stub, context: { ...stub.context, metallicity: 0 } });
      if (JSON.stringify(hot) !== JSON.stringify(cold)) changed = true;
      break;
    }
    expect(changed).toBe(true);
  });

  it('favours rocky worlds at high metallicity', () => {
    const params = { ...DEFAULT_PARAMS, seed: 'metallic', systemCount: 300 };
    const count = (metallicity: number): { rocky: number; total: number } => {
      const galaxy = generateGalaxy({ ...params, metallicity });
      let rocky = 0;
      let total = 0;
      for (const stub of galaxy.systems) {
        const system = generateSystem(stub);
        for (const planet of system.planets) {
          total += 1;
          if (planet.kind !== 'gas' && planet.kind !== 'icegiant') rocky += 1;
        }
      }
      return { rocky, total };
    };
    const low = count(0);
    const high = count(1);
    expect(high.rocky / high.total).toBeGreaterThan(low.rocky / low.total);
  });
});
