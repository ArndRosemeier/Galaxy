import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, PRESETS, generateGalaxy } from '../../src/sim';
import type { Galaxy } from '../../src/sim';

const GALAXIES: readonly Galaxy[] = [
  generateGalaxy(DEFAULT_PARAMS),
  ...PRESETS.map((preset) => generateGalaxy(preset.params)),
];

function collect<G>(galaxies: readonly Galaxy[], pick: (galaxy: Galaxy) => G): G[] {
  return galaxies.map(pick);
}

describe('generateGalaxy structure', () => {
  it('returns exactly the requested number of systems with stable, unique ids and seeds', () => {
    for (const galaxy of GALAXIES) {
      expect(galaxy.systems).toHaveLength(galaxy.params.systemCount);
      const ids = new Set<string>();
      const seeds = new Set<number>();
      for (const system of galaxy.systems) {
        expect(system.id).toMatch(/^sys-\d{3,}$/);
        expect(ids.has(system.id)).toBe(false);
        ids.add(system.id);
        expect(Number.isInteger(system.seed)).toBe(true);
        expect(system.seed).toBeGreaterThanOrEqual(0);
        expect(system.seed).toBeLessThanOrEqual(0xffff_ffff);
        expect(seeds.has(system.seed)).toBe(false);
        seeds.add(system.seed);
        expect(system.spectral).toMatch(/^(O|B|A|F|G|K|M|WD|NS|BH)$/);
        expect(system.brightness).toBeGreaterThanOrEqual(0);
        expect(system.brightness).toBeLessThanOrEqual(1);
        for (const channel of system.color) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('keeps every system inside the disc radius and the thin-disc height', () => {
    for (const galaxy of GALAXIES) {
      const radius = galaxy.params.galaxyRadius;
      for (const system of galaxy.systems) {
        const cylindrical = Math.hypot(system.position.x, system.position.z);
        expect(cylindrical).toBeLessThanOrEqual(radius + 0.01);
        expect(Math.abs(system.position.y)).toBeLessThanOrEqual(radius * 0.2);
      }
    }
  });

  it('gives every system a plausible per-system context', () => {
    for (const galaxy of GALAXIES) {
      for (const system of galaxy.systems) {
        const context = system.context;
        expect(context).toBeDefined();
        if (!context) continue;
        expect(context.metallicity).toBeGreaterThanOrEqual(0);
        expect(context.metallicity).toBeLessThanOrEqual(1);
        expect(context.ageGyr).toBeGreaterThanOrEqual(1);
        expect(context.ageGyr).toBeLessThanOrEqual(13.5);
        expect(context.lifeChance).toBeGreaterThanOrEqual(0);
        expect(context.lifeChance).toBeLessThanOrEqual(1);
        expect(context.hazard).toBeGreaterThanOrEqual(0);
        expect(context.hazard).toBeLessThanOrEqual(1);
        if (galaxy.params.hazard === 0) expect(context.hazard).toBe(0);
        if (galaxy.params.lifeChance === 0) expect(context.lifeChance).toBe(0);
      }
    }
  });

  it('makes M and K stars dominate while O and B stay rare', () => {
    const counts = collect(GALAXIES, (galaxy) => {
      let cool = 0;
      let hot = 0;
      for (const system of galaxy.systems) {
        if (system.spectral === 'M' || system.spectral === 'K') cool += 1;
        if (system.spectral === 'O' || system.spectral === 'B') hot += 1;
      }
      return { cool, hot, total: galaxy.systems.length };
    });
    const total = counts.reduce((sum, entry) => sum + entry.total, 0);
    const cool = counts.reduce((sum, entry) => sum + entry.cool, 0);
    const hot = counts.reduce((sum, entry) => sum + entry.hot, 0);
    expect(cool / total).toBeGreaterThan(0.55);
    expect(hot / total).toBeLessThan(0.12);
    expect(cool).toBeGreaterThan(hot);
  });

  it('never repeats a system name across a large galaxy', () => {
    for (const seed of ['names-a', 'names-b', 'names-c']) {
      const galaxy = generateGalaxy({ ...DEFAULT_PARAMS, seed, systemCount: 600 });
      const names = new Set(galaxy.systems.map((system) => system.name));
      expect(names.size).toBe(600);
      const ids = new Set(galaxy.systems.map((system) => system.id));
      expect(ids.size).toBe(600);
    }
  });

  it('varies brightness and colour rather than stamping one star', () => {
    const galaxy = GALAXIES[0];
    if (!galaxy) throw new Error('sample galaxies are empty');
    const colors = new Set(galaxy.systems.map((system) => system.color.join(',')));
    const brightness = galaxy.systems.map((system) => system.brightness);
    expect(colors.size).toBeGreaterThan(5);
    expect(new Set(brightness).size).toBeGreaterThan(10);
    expect(Math.min(...brightness)).toBeLessThan(0.35);
    expect(Math.max(...brightness)).toBeGreaterThan(0.6);
  });
});

describe('generateGalaxy determinism', () => {
  it('is byte-identical for the same params', () => {
    const a = JSON.stringify(generateGalaxy(DEFAULT_PARAMS));
    const b = JSON.stringify(generateGalaxy(DEFAULT_PARAMS));
    expect(a).toBe(b);
  });

  it('changes when only the seed changes', () => {
    const a = generateGalaxy(DEFAULT_PARAMS);
    const b = generateGalaxy({ ...DEFAULT_PARAMS, seed: `${DEFAULT_PARAMS.seed}-other` });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(a.params.seed).toBe(DEFAULT_PARAMS.seed);
    expect(b.params.seed).toBe(`${DEFAULT_PARAMS.seed}-other`);
    for (let i = 0; i < a.systems.length; i += 1) {
      expect(a.systems[i]?.seed).not.toBe(b.systems[i]?.seed);
    }
  });

  it('changes shape when only a shape knob changes', () => {
    const base = generateGalaxy(DEFAULT_PARAMS);
    const wider = generateGalaxy({ ...DEFAULT_PARAMS, armSpread: 0.95 });
    const positionsDiffer = base.systems.some(
      (system, index) =>
        JSON.stringify(system.position) !== JSON.stringify(wider.systems[index]?.position),
    );
    expect(positionsDiffer).toBe(true);
  });

  it('keeps a system’s identity when only the shape changes', () => {
    const base = generateGalaxy(DEFAULT_PARAMS);
    const wider = generateGalaxy({ ...DEFAULT_PARAMS, armSpread: 0.95 });
    for (let i = 0; i < base.systems.length; i += 1) {
      expect(wider.systems[i]?.name).toBe(base.systems[i]?.name);
      expect(wider.systems[i]?.seed).toBe(base.systems[i]?.seed);
      expect(wider.systems[i]?.spectral).toBe(base.systems[i]?.spectral);
    }
  });

  it('generates a valid galaxy at the extremes of every knob', () => {
    const configurations = [
      { ...DEFAULT_PARAMS, systemCount: 24, arms: 2, armTwist: 0, armSpread: 0, coreDensity: 1, galaxyRadius: 400, ageGyr: 1, metallicity: 0, lifeChance: 0, hazard: 0 },
      { ...DEFAULT_PARAMS, systemCount: 600, arms: 6, armTwist: 2.2, armSpread: 1, coreDensity: 0, galaxyRadius: 2000, ageGyr: 13.5, metallicity: 1, lifeChance: 1, hazard: 1 },
    ];
    for (const params of configurations) {
      const galaxy = generateGalaxy(params);
      expect(galaxy.systems).toHaveLength(params.systemCount);
      for (const system of galaxy.systems) {
        expect(Number.isFinite(system.position.x)).toBe(true);
        expect(Number.isFinite(system.position.y)).toBe(true);
        expect(Number.isFinite(system.position.z)).toBe(true);
      }
    }
  });
});
