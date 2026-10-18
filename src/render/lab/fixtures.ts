/**
 * DEV LAB FIXTURES — TEMPORARY.
 *
 * These objects exist only so `lab.html` can render and screenshot the three views
 * before the generator is integrated. They are hand-built from the frozen contract in
 * `src/sim/types.ts`; nothing here is generated content and nothing here ships to the
 * app. At integration the dispatcher swaps in `generateGalaxy` / `generateSystem`, and
 * this file becomes dead weight (or is deleted).
 *
 * The galaxy layout uses a LOCAL logarithmic-spiral formula, clearly marked below. It
 * is a stand-in for the real generator's layout so the renderer's arms/dust/star
 * treatment can be judged against a plausible disc — not a second implementation of
 * generation.
 */

import type {
  AsteroidBelt,
  Atmosphere,
  Galaxy,
  GalaxyParams,
  Hydrosphere,
  Moon,
  MoonOrbit,
  Orbit,
  Planet,
  PlanetKind,
  Rgb,
  RingSystem,
  SpectralClass,
  Star,
  StarSystem,
  SurfaceSpec,
  SystemStub,
} from '../../sim/types';
import { orbitalPeriodDays } from '../../sim/orbit';
import { mulberry32 } from '../rand';

/** Brightness jitter from two uniforms (triangular, no Math.random). */
function tri(rng: () => number): number {
  return (rng() + rng()) * 0.5;
}

function rgb(r: number, g: number, b: number): Rgb {
  return [r, g, b] as const;
}

const SPECTRAL: Record<Exclude<SpectralClass, 'NS' | 'BH'>, { color: Rgb; min: number; max: number }> = {
  O: { color: rgb(0.55, 0.68, 1.0), min: 0.85, max: 1.0 },
  B: { color: rgb(0.63, 0.75, 1.0), min: 0.7, max: 0.95 },
  A: { color: rgb(0.8, 0.87, 1.0), min: 0.5, max: 0.82 },
  F: { color: rgb(0.95, 0.95, 1.0), min: 0.4, max: 0.72 },
  G: { color: rgb(1.0, 0.88, 0.68), min: 0.32, max: 0.6 },
  K: { color: rgb(1.0, 0.76, 0.52), min: 0.22, max: 0.45 },
  M: { color: rgb(1.0, 0.58, 0.38), min: 0.1, max: 0.26 },
  WD: { color: rgb(0.78, 0.86, 1.0), min: 0.28, max: 0.5 },
};

const SPECTRAL_WEIGHTS: ReadonlyArray<readonly [Exclude<SpectralClass, 'NS' | 'BH'>, number]> = [
  ['M', 0.42],
  ['K', 0.24],
  ['G', 0.15],
  ['F', 0.08],
  ['A', 0.06],
  ['B', 0.03],
  ['O', 0.005],
  ['WD', 0.015],
];

const NAMES = [
  'Aster', 'Borealis', 'Caelum', 'Draco', 'Elysium', 'Fornax', 'Gorgon', 'Hesper',
  'Icarus', 'Janus', 'Kepler', 'Lyra', 'Mensa', 'Nereid', 'Orion', 'Pavo',
  'Quasar', 'Rhea', 'Sable', 'Tethys', 'Ursa', 'Vela', 'Wren', 'Xanthe',
  'Ymir', 'Zephyr', 'Ara', 'Cetus', 'Dorado', 'Equuleus', 'Fornax', 'Grus',
];

export const LAB_PARAMS: GalaxyParams = {
  seed: 'lab-2026',
  systemCount: 220,
  arms: 4,
  armTwist: 1.15,
  armSpread: 0.55,
  coreDensity: 0.5,
  galaxyRadius: 1100,
  ageGyr: 8.6,
  metallicity: 0.5,
  lifeChance: 0.25,
  hazard: 0.35,
};

/**
 * TEMPORARY local spiral layout for the fixture stubs.
 *
 * This is NOT `src/sim`'s generation: it exists so the lab has 220 stars on arms to
 * look at. At integration the real `generateGalaxy` replaces it wholesale.
 */
function makeStubs(params: GalaxyParams): SystemStub[] {
  const rng = mulberry32(0x5eed);
  const stubs: SystemStub[] = [];
  const arms = params.arms;
  const radius = params.galaxyRadius;
  for (let i = 0; i < params.systemCount; i += 1) {
    const arm = i % arms;
    const t = (Math.floor(i / arms) + 0.5) / Math.ceil(params.systemCount / arms);
    const r = radius * (0.055 + 0.945 * Math.pow(t, 0.68));
    // Logarithmic spiral: theta = arm phase + twist * ln(r / r0).
    let theta = (arm / arms) * Math.PI * 2 + params.armTwist * Math.log(r / (0.055 * radius));
    theta += (tri(rng) * 2 - 1) * params.armSpread * 1.15;
    const radial = 1 + (tri(rng) * 2 - 1) * 0.07;
    const x = Math.cos(theta) * r * radial;
    const z = Math.sin(theta) * r * radial;
    const bulge = (1 - r / radius) * 0.75 + 0.25;
    const y = (tri(rng) * 2 - 1) * radius * 0.012 * bulge * (0.5 + params.armSpread);

    let pick = rng();
    let spectral: Exclude<SpectralClass, 'NS' | 'BH'> = 'M';
    for (const [cls, weight] of SPECTRAL_WEIGHTS) {
      if (pick < weight) {
        spectral = cls;
        break;
      }
      pick -= weight;
    }
    const info = SPECTRAL[spectral];
    const brightness = info.min + rng() * (info.max - info.min);
    const name = `${NAMES[Math.floor(rng() * NAMES.length)] ?? 'Aster'} ${100 + Math.floor(rng() * 899)}`;
    stubs.push({
      id: `lab-star-${i}`,
      name,
      position: { x, y, z },
      spectral,
      color: info.color,
      brightness,
      seed: 1000 + i * 7919,
    });
  }
  return stubs;
}

const STUBS = makeStubs(LAB_PARAMS);

// The two systems the lab can fly into replace two stubs (position preserved), so the
// galaxy view and the system view agree about where they are.
const SYSTEM_A_STUB: SystemStub = {
  ...STUBS[0]!,
  id: 'lab-a',
  name: 'Aurora',
  spectral: 'G',
  color: SPECTRAL.G.color,
  brightness: 0.58,
  seed: 11001,
};
const SYSTEM_B_STUB: SystemStub = {
  ...STUBS[1]!,
  id: 'lab-b',
  name: 'Ember',
  spectral: 'M',
  color: SPECTRAL.M.color,
  brightness: 0.24,
  seed: 11002,
};
const ALL_STUBS = [SYSTEM_A_STUB, SYSTEM_B_STUB, ...STUBS.slice(2)];

export const LAB_GALAXY: Galaxy = {
  params: LAB_PARAMS,
  systems: ALL_STUBS,
};

// ---------------------------------------------------------------------------
// World recipes
// ---------------------------------------------------------------------------

interface SurfacePalette {
  readonly deep: Rgb;
  readonly low: Rgb;
  readonly mid: Rgb;
  readonly high: Rgb;
  readonly ice: Rgb;
  readonly water: Rgb | null;
}

interface SurfaceTuning {
  readonly cloudiness: number;
  readonly cloudColor: Rgb;
  readonly turbulence: number;
  readonly bandiness: number;
  readonly roughness: number;
  readonly nightLights: number;
}

function surface(
  kind: PlanetKind,
  seed: number,
  colors: SurfacePalette,
  tuning: Partial<SurfaceTuning> = {},
): SurfaceSpec {
  return {
    seed,
    kind,
    colors,
    cloudiness: tuning.cloudiness ?? 0.3,
    cloudColor: tuning.cloudColor ?? rgb(0.92, 0.95, 1.0),
    turbulence: tuning.turbulence ?? 0.5,
    bandiness: tuning.bandiness ?? 0.05,
    roughness: tuning.roughness ?? 0.45,
    nightLights: tuning.nightLights ?? 0,
  };
}

const SURF = {
  ocean: surface(
    'ocean',
    301,
    {
      deep: rgb(0.004, 0.02, 0.06),
      low: rgb(0.015, 0.07, 0.16),
      mid: rgb(0.1, 0.22, 0.12),
      high: rgb(0.32, 0.34, 0.2),
      ice: rgb(0.88, 0.94, 1.0),
      water: rgb(0.008, 0.06, 0.24),
    },
    { cloudiness: 0.52, turbulence: 0.62, roughness: 0.38, nightLights: 0.8 },
  ),
  terrestrial: surface(
    'terrestrial',
    302,
    {
      deep: rgb(0.012, 0.03, 0.02),
      low: rgb(0.03, 0.09, 0.05),
      mid: rgb(0.1, 0.22, 0.09),
      high: rgb(0.36, 0.38, 0.2),
      ice: rgb(0.85, 0.92, 0.95),
      water: rgb(0.02, 0.07, 0.1),
    },
    { cloudiness: 0.45, turbulence: 0.5, roughness: 0.5, nightLights: 0.18 },
  ),
  desert: surface(
    'desert',
    303,
    {
      deep: rgb(0.09, 0.035, 0.018),
      low: rgb(0.3, 0.13, 0.055),
      mid: rgb(0.55, 0.28, 0.12),
      high: rgb(0.75, 0.45, 0.25),
      ice: rgb(0.85, 0.85, 0.82),
      water: null,
    },
    { cloudiness: 0.08, cloudColor: rgb(0.8, 0.72, 0.6), turbulence: 0.45, roughness: 0.55 },
  ),
  ice: surface(
    'ice',
    304,
    {
      deep: rgb(0.02, 0.045, 0.08),
      low: rgb(0.16, 0.3, 0.45),
      mid: rgb(0.42, 0.62, 0.8),
      high: rgb(0.8, 0.9, 1.0),
      ice: rgb(0.86, 0.94, 1.0),
      water: null,
    },
    { cloudiness: 0.5, cloudColor: rgb(0.85, 0.93, 1.0), turbulence: 0.35, roughness: 0.25 },
  ),
  lava: surface(
    'lava',
    305,
    {
      deep: rgb(0.02, 0.008, 0.005),
      low: rgb(0.08, 0.02, 0.01),
      mid: rgb(0.28, 0.06, 0.015),
      high: rgb(0.55, 0.18, 0.04),
      ice: rgb(0.4, 0.36, 0.32),
      water: null,
    },
    { cloudiness: 0.2, cloudColor: rgb(0.4, 0.28, 0.2), turbulence: 0.8, roughness: 0.85 },
  ),
  toxic: surface(
    'toxic',
    306,
    {
      deep: rgb(0.04, 0.06, 0.01),
      low: rgb(0.15, 0.2, 0.04),
      mid: rgb(0.36, 0.42, 0.1),
      high: rgb(0.58, 0.55, 0.26),
      ice: rgb(0.75, 0.8, 0.6),
      water: null,
    },
    { cloudiness: 0.8, cloudColor: rgb(0.8, 0.9, 0.5), turbulence: 0.5, bandiness: 0.25, roughness: 0.3 },
  ),
  barren: surface(
    'barren',
    307,
    {
      deep: rgb(0.05, 0.05, 0.055),
      low: rgb(0.16, 0.16, 0.17),
      mid: rgb(0.3, 0.29, 0.3),
      high: rgb(0.5, 0.48, 0.46),
      ice: rgb(0.8, 0.82, 0.85),
      water: null,
    },
    { cloudiness: 0, turbulence: 0.3, roughness: 0.7 },
  ),
  gas: surface(
    'gas',
    308,
    {
      deep: rgb(0.14, 0.075, 0.04),
      low: rgb(0.42, 0.24, 0.12),
      mid: rgb(0.72, 0.5, 0.28),
      high: rgb(0.95, 0.8, 0.55),
      ice: rgb(0.9, 0.9, 0.85),
      water: null,
    },
    { cloudiness: 0.6, cloudColor: rgb(0.98, 0.95, 0.88), turbulence: 0.55, bandiness: 0.95, roughness: 0.12 },
  ),
  gasCold: surface(
    'gas',
    309,
    {
      deep: rgb(0.09, 0.07, 0.05),
      low: rgb(0.32, 0.24, 0.17),
      mid: rgb(0.6, 0.48, 0.34),
      high: rgb(0.88, 0.76, 0.55),
      ice: rgb(0.9, 0.92, 0.9),
      water: null,
    },
    { cloudiness: 0.55, cloudColor: rgb(0.95, 0.94, 0.9), turbulence: 0.5, bandiness: 0.9, roughness: 0.12 },
  ),
  icegiant: surface(
    'icegiant',
    310,
    {
      deep: rgb(0.015, 0.045, 0.075),
      low: rgb(0.1, 0.28, 0.4),
      mid: rgb(0.3, 0.6, 0.75),
      high: rgb(0.7, 0.88, 0.95),
      ice: rgb(0.9, 0.97, 1.0),
      water: null,
    },
    { cloudiness: 0.55, cloudColor: rgb(0.85, 0.95, 1.0), turbulence: 0.5, bandiness: 0.85, roughness: 0.1 },
  ),
  moonRock: surface(
    'barren',
    311,
    {
      deep: rgb(0.04, 0.04, 0.045),
      low: rgb(0.14, 0.14, 0.15),
      mid: rgb(0.28, 0.27, 0.26),
      high: rgb(0.5, 0.48, 0.44),
      ice: rgb(0.75, 0.78, 0.8),
      water: null,
    },
    { cloudiness: 0, turbulence: 0.35, roughness: 0.75 },
  ),
  moonIce: surface(
    'ice',
    312,
    {
      deep: rgb(0.04, 0.06, 0.09),
      low: rgb(0.2, 0.3, 0.4),
      mid: rgb(0.5, 0.62, 0.72),
      high: rgb(0.82, 0.9, 0.96),
      ice: rgb(0.92, 0.97, 1.0),
      water: null,
    },
    { cloudiness: 0, turbulence: 0.3, roughness: 0.4 },
  ),
} satisfies Record<string, SurfaceSpec>;

function atmosphere(
  pressureAtm: number,
  greenhouseK: number,
  color: Rgb,
  opacity: number,
  composition: Array<[string, number]>,
): Atmosphere {
  return { pressureAtm, greenhouseK, color, opacity, composition: composition.map(([gas, fraction]) => ({ gas, fraction })) };
}

function orbit(
  semiMajorAU: number,
  massSun: number,
  phase: number,
  eccentricity = 0.02,
  inclinationDeg = 1.4,
): Orbit {
  return {
    semiMajorAU,
    eccentricity,
    inclinationDeg,
    nodeDeg: (phase * 37) % 360,
    argPeriapsisDeg: (phase * 53) % 360,
    meanAnomalyDeg: (phase * 97) % 360,
    periodDays: orbitalPeriodDays(semiMajorAU, massSun),
  };
}

function moonOrbit(radiusKm: number, periodDays: number, phaseDeg: number, inclinationDeg = 2): MoonOrbit {
  return { radiusKm, eccentricity: 0.02, inclinationDeg, phaseDeg, periodDays };
}

function moon(
  id: string,
  name: string,
  radiusKm: number,
  orbitSpec: MoonOrbit,
  surfaceSpec: SurfaceSpec,
  notes: string[],
  atmosphereSpec: Atmosphere | null = null,
): Moon {
  return { id, name, radiusKm, orbit: orbitSpec, surface: surfaceSpec, atmosphere: atmosphereSpec, notes };
}

function rings(
  innerRadiusKm: number,
  outerRadiusKm: number,
  opacity: number,
  color: Rgb,
  composition: string,
): RingSystem {
  return { innerRadiusKm, outerRadiusKm, thicknessKm: 900, opacity, color, composition };
}

function hydrosphere(coverage: number, color: Rgb, depthKm: number): Hydrosphere {
  return { coverage, color, depthKm };
}

// ---------------------------------------------------------------------------
// Star system A — the showroom: lava → ocean with cities → gas giant with rings →
// ice world with moons → a belt. Star: G2V.
// ---------------------------------------------------------------------------

const AURORA_STAR: Star = {
  name: 'Aurora',
  spectral: 'G',
  temperatureK: 5778,
  radiusSun: 1,
  massSun: 1,
  luminositySun: 1,
  color: rgb(1.0, 0.93, 0.78),
};

const PLANETS_A: Planet[] = [
  {
    id: 'lab-a-1',
    name: 'Cinder',
    kind: 'lava',
    orbit: orbit(0.42, AURORA_STAR.massSun, 3, 0.03, 2.1),
    radiusKm: 5400,
    massEarth: 0.55,
    gravityG: 0.82,
    dayHours: 41,
    yearDays: orbitalPeriodDays(0.42, 1),
    temperatureK: 980,
    albedo: 0.12,
    atmosphere: atmosphere(0.02, 30, rgb(1.0, 0.35, 0.12), 0.3, [['SO2', 0.7], ['CO2', 0.3]]),
    hydrosphere: null,
    biosphere: null,
    rings: null,
    moons: [],
    surface: SURF.lava,
    description: 'A young volcanic world wrapped in sulphur haze; the nightside glows through cracks in its crust.',
    tags: ['hostile', 'volcanic'],
  },
  {
    id: 'lab-a-2',
    name: 'Vesper',
    kind: 'toxic',
    orbit: orbit(0.71, AURORA_STAR.massSun, 7, 0.02, 0.9),
    radiusKm: 7100,
    massEarth: 0.9,
    gravityG: 1.05,
    dayHours: 190,
    yearDays: orbitalPeriodDays(0.71, 1),
    temperatureK: 640,
    albedo: 0.18,
    atmosphere: atmosphere(14, 120, rgb(0.55, 0.85, 0.35), 0.7, [['CO2', 0.94], ['SO2', 0.05], ['N2', 0.01]]),
    hydrosphere: null,
    biosphere: null,
    rings: null,
    moons: [],
    surface: SURF.toxic,
    description: 'A runaway greenhouse with acid clouds and a surface hot enough to melt lead.',
    tags: ['hostile', 'greenhouse'],
  },
  {
    id: 'lab-a-3',
    name: 'Terra',
    kind: 'ocean',
    orbit: orbit(1.04, AURORA_STAR.massSun, 11, 0.017, 1.2),
    radiusKm: 6371,
    massEarth: 1,
    gravityG: 1,
    dayHours: 23.93,
    yearDays: orbitalPeriodDays(1.04, 1),
    temperatureK: 288,
    albedo: 0.29,
    atmosphere: atmosphere(1, 33, rgb(0.25, 0.5, 1.0), 0.8, [['N2', 0.78], ['O2', 0.21], ['H2O', 0.01]]),
    hydrosphere: hydrosphere(0.71, rgb(0.025, 0.13, 0.34), 3.8),
    biosphere: { level: 'civilization', summary: 'Industrial cities light the coastlines; the night side sparkles.' },
    rings: null,
    moons: [
      moon(
        'lab-a-3-m1',
        'Luna',
        1737,
        moonOrbit(384400, 27.32, 122, 5.1),
        SURF.moonRock,
        ['Airless and cratered', 'Tidally locked'],
      ),
    ],
    surface: SURF.ocean,
    description: 'A blue ocean world with continents, weather and a civilisation visible from orbit at night.',
    tags: ['habitable', 'civilization', 'ocean'],
  },
  {
    id: 'lab-a-4',
    name: 'Verdance',
    kind: 'terrestrial',
    orbit: orbit(1.62, AURORA_STAR.massSun, 17, 0.03, 2.4),
    radiusKm: 5900,
    massEarth: 0.7,
    gravityG: 0.86,
    dayHours: 30.4,
    yearDays: orbitalPeriodDays(1.62, 1),
    temperatureK: 262,
    albedo: 0.26,
    atmosphere: atmosphere(0.9, 18, rgb(0.45, 0.8, 0.6), 0.6, [['N2', 0.8], ['O2', 0.17], ['CO2', 0.03]]),
    hydrosphere: hydrosphere(0.32, rgb(0.02, 0.07, 0.1), 1.2),
    biosphere: { level: 'fauna', summary: 'Mossy highlands and shallow seas; something large is grazing the plains.' },
    rings: null,
    moons: [],
    surface: SURF.terrestrial,
    description: 'A cool, damp world whose green belts follow the rivers down to a single warm sea.',
    tags: ['habitable', 'biosphere'],
  },
  {
    id: 'lab-a-5',
    name: 'Rust',
    kind: 'desert',
    orbit: orbit(2.3, AURORA_STAR.massSun, 23, 0.05, 1.8),
    radiusKm: 6200,
    massEarth: 0.65,
    gravityG: 0.72,
    dayHours: 25.1,
    yearDays: orbitalPeriodDays(2.3, 1),
    temperatureK: 305,
    albedo: 0.22,
    atmosphere: atmosphere(0.05, 4, rgb(0.8, 0.5, 0.35), 0.2, [['CO2', 0.95], ['N2', 0.05]]),
    hydrosphere: null,
    biosphere: null,
    rings: null,
    moons: [
      moon('lab-a-5-m1', 'Phobos', 380, moonOrbit(9400, 0.32, 40, 1.1), SURF.moonRock, ['A captured lump of rock']),
    ],
    surface: SURF.desert,
    description: 'Iron-oxide dunes and dry canyon country, with a sky the colour of weak tea.',
    tags: ['dry', 'frontier'],
  },
  {
    id: 'lab-a-6',
    name: 'Halcyon',
    kind: 'gas',
    orbit: orbit(5.6, AURORA_STAR.massSun, 29, 0.04, 1.0),
    radiusKm: 69911,
    massEarth: 317.8,
    gravityG: 2.53,
    dayHours: 9.9,
    yearDays: orbitalPeriodDays(5.6, 1),
    temperatureK: 165,
    albedo: 0.5,
    atmosphere: atmosphere(1000, 0, rgb(1.0, 0.85, 0.6), 0.9, [['H2', 0.89], ['He', 0.1], ['CH4', 0.01]]),
    hydrosphere: null,
    biosphere: null,
    rings: rings(90884, 160795, 0.72, rgb(0.85, 0.78, 0.65), 'ice and dust'),
    moons: [
      moon('lab-a-6-m1', 'Io', 1821, moonOrbit(421700, 1.77, 20), SURF.moonRock, ['Sulphur-stained', 'Volcanic']),
      moon('lab-a-6-m2', 'Europa', 1560, moonOrbit(671100, 3.55, 140), SURF.moonIce, ['Ice shell over an ocean']),
      moon('lab-a-6-m3', 'Ganymede', 2634, moonOrbit(1070400, 7.15, 265), SURF.moonRock, ['Largest moon in the system']),
    ],
    surface: SURF.gas,
    description: 'A banded giant with a bright ring system and three large moons in a slow procession.',
    tags: ['gas giant', 'rings', 'moons'],
  },
  {
    id: 'lab-a-7',
    name: 'Boreas',
    kind: 'ice',
    orbit: orbit(9.4, AURORA_STAR.massSun, 31, 0.03, 0.6),
    radiusKm: 23000,
    massEarth: 14.5,
    gravityG: 0.9,
    dayHours: 16.1,
    yearDays: orbitalPeriodDays(9.4, 1),
    temperatureK: 110,
    albedo: 0.6,
    atmosphere: atmosphere(0.8, 0, rgb(0.45, 0.65, 0.95), 0.7, [['CH4', 0.8], ['N2', 0.2]]),
    hydrosphere: null,
    biosphere: null,
    rings: rings(31000, 46000, 0.3, rgb(0.72, 0.8, 0.9), 'icy debris'),
    moons: [
      moon('lab-a-7-m1', 'Nix', 610, moonOrbit(48000, 1.15, 100), SURF.moonIce, ['Frozen and bright']),
      moon('lab-a-7-m2', 'Hydra', 830, moonOrbit(64000, 1.64, 300), SURF.moonIce, ['Cratered ice']),
    ],
    surface: SURF.ice,
    description: 'A pale ice giant tilted almost on its side, with two small shepherd moons.',
    tags: ['ice giant', 'rings', 'moon'],
  },
  {
    id: 'lab-a-8',
    name: 'Nox',
    kind: 'barren',
    orbit: orbit(12.6, AURORA_STAR.massSun, 37, 0.08, 3.2),
    radiusKm: 2600,
    massEarth: 0.18,
    gravityG: 0.36,
    dayHours: 58,
    yearDays: orbitalPeriodDays(12.6, 1),
    temperatureK: 72,
    albedo: 0.14,
    atmosphere: null,
    hydrosphere: null,
    biosphere: null,
    rings: null,
    moons: [
      moon('lab-a-8-m1', 'Mote', 240, moonOrbit(12000, 0.72, 210), SURF.moonRock, ['A speck of rock']),
    ],
    surface: SURF.barren,
    description: 'A dark, airless rock at the edge of Aurora’s light.',
    tags: ['airless', 'cold'],
  },
];

const BELT_A: AsteroidBelt = {
  id: 'lab-a-belt',
  name: 'Cinder Belt',
  innerAU: 3.0,
  outerAU: 4.3,
  count: 3200,
  density: 0.85,
  inclinationDeg: 5,
  seed: 4242,
};

export const LAB_SYSTEM_A: StarSystem = {
  id: 'lab-a',
  name: 'Aurora',
  position: SYSTEM_A_STUB.position,
  seed: SYSTEM_A_STUB.seed,
  star: AURORA_STAR,
  planets: PLANETS_A,
  belts: [BELT_A],
};

// ---------------------------------------------------------------------------
// Star system B — the second palette: a red dwarf with compact orbits, an ice giant
// with rings and a wide belt. Covers 'icegiant' (the one kind system A lacks).
// ---------------------------------------------------------------------------

const EMBER_STAR: Star = {
  name: 'Ember',
  spectral: 'M',
  temperatureK: 3350,
  radiusSun: 0.42,
  massSun: 0.45,
  luminositySun: 0.035,
  color: rgb(1.0, 0.58, 0.4),
};

const PLANETS_B: Planet[] = [
  {
    id: 'lab-b-1',
    name: 'Kindle',
    kind: 'lava',
    orbit: orbit(0.12, EMBER_STAR.massSun, 2, 0.02, 3.1),
    radiusKm: 4800,
    massEarth: 0.4,
    gravityG: 0.62,
    dayHours: 61,
    yearDays: orbitalPeriodDays(0.12, 0.45),
    temperatureK: 720,
    albedo: 0.1,
    atmosphere: null,
    hydrosphere: null,
    biosphere: null,
    rings: null,
    moons: [],
    surface: SURF.lava,
    description: 'Tidally heated and airless, its lava seas visible from the system’s inner edge.',
    tags: ['hostile', 'tidal'],
  },
  {
    id: 'lab-b-2',
    name: 'Brine',
    kind: 'ocean',
    orbit: orbit(0.23, EMBER_STAR.massSun, 5, 0.02, 1.2),
    radiusKm: 7400,
    massEarth: 1.3,
    gravityG: 1.1,
    dayHours: 38,
    yearDays: orbitalPeriodDays(0.23, 0.45),
    temperatureK: 300,
    albedo: 0.24,
    atmosphere: atmosphere(1.4, 40, rgb(0.35, 0.65, 0.9), 0.8, [['N2', 0.7], ['O2', 0.15], ['H2O', 0.15]]),
    hydrosphere: hydrosphere(0.85, rgb(0.02, 0.1, 0.22), 6),
    biosphere: { level: 'flora', summary: 'Algal blooms stain the shallow seas a deep turquoise.' },
    rings: null,
    moons: [
      moon('lab-b-2-m1', 'Tide', 900, moonOrbit(24000, 1.1, 60), SURF.moonRock, ['Raises enormous tides']),
    ],
    surface: surface(
      'ocean',
      501,
      {
        deep: rgb(0.004, 0.03, 0.04),
        low: rgb(0.01, 0.09, 0.12),
        mid: rgb(0.08, 0.24, 0.2),
        high: rgb(0.3, 0.38, 0.26),
        ice: rgb(0.9, 0.96, 0.98),
        water: rgb(0.02, 0.16, 0.2),
      },
      { cloudiness: 0.6, turbulence: 0.55, roughness: 0.35, nightLights: 0 },
    ),
    description: 'A deep, warm ocean world under a red sun, where the tides are measured in kilometres.',
    tags: ['habitable', 'ocean'],
  },
  {
    id: 'lab-b-3',
    name: 'Verge',
    kind: 'terrestrial',
    orbit: orbit(0.34, EMBER_STAR.massSun, 9, 0.03, 2.2),
    radiusKm: 5200,
    massEarth: 0.55,
    gravityG: 0.72,
    dayHours: 44,
    yearDays: orbitalPeriodDays(0.34, 0.45),
    temperatureK: 280,
    albedo: 0.3,
    atmosphere: atmosphere(0.7, 12, rgb(0.55, 0.7, 0.9), 0.55, [['N2', 0.85], ['CO2', 0.1], ['O2', 0.05]]),
    hydrosphere: hydrosphere(0.28, rgb(0.03, 0.06, 0.08), 0.9),
    biosphere: { level: 'microbial', summary: 'Thin mats of purple microbes fringe the polar lakes.' },
    rings: null,
    moons: [
      moon('lab-b-3-m1', 'Shade', 420, moonOrbit(16000, 0.9, 200), SURF.moonRock, ['Small and dark']),
    ],
    surface: SURF.terrestrial,
    description: 'A cold, rocky world with a breathable-ish atmosphere and lakes that never thaw.',
    tags: ['frontier', 'life'],
  },
  {
    id: 'lab-b-4',
    name: 'Dune',
    kind: 'desert',
    orbit: orbit(0.52, EMBER_STAR.massSun, 13, 0.04, 0.8),
    radiusKm: 6100,
    massEarth: 0.6,
    gravityG: 0.7,
    dayHours: 19,
    yearDays: orbitalPeriodDays(0.52, 0.45),
    temperatureK: 330,
    albedo: 0.2,
    atmosphere: atmosphere(0.06, 5, rgb(0.75, 0.5, 0.32), 0.2, [['CO2', 0.9], ['N2', 0.1]]),
    hydrosphere: null,
    biosphere: null,
    rings: null,
    moons: [],
    surface: SURF.desert,
    description: 'A dusty desert world with continent-sized dunes and a sky of blowing ochre.',
    tags: ['dry'],
  },
  {
    id: 'lab-b-5',
    name: 'Miasma',
    kind: 'toxic',
    orbit: orbit(0.68, EMBER_STAR.massSun, 15, 0.02, 2.6),
    radiusKm: 8400,
    massEarth: 1.1,
    gravityG: 1.3,
    dayHours: 52,
    yearDays: orbitalPeriodDays(0.68, 0.45),
    temperatureK: 500,
    albedo: 0.16,
    atmosphere: atmosphere(20, 90, rgb(0.7, 0.85, 0.4), 0.75, [['CO2', 0.8], ['SO2', 0.15], ['N2', 0.05]]),
    hydrosphere: null,
    biosphere: null,
    rings: null,
    moons: [],
    surface: SURF.toxic,
    description: 'A high-gravity greenhouse with yellow clouds that glow when the star flares.',
    tags: ['hostile', 'greenhouse'],
  },
  {
    id: 'lab-b-6',
    name: 'Zephyr',
    kind: 'gas',
    orbit: orbit(1.5, EMBER_STAR.massSun, 19, 0.04, 1.4),
    radiusKm: 48000,
    massEarth: 95,
    gravityG: 1.9,
    dayHours: 12.4,
    yearDays: orbitalPeriodDays(1.5, 0.45),
    temperatureK: 120,
    albedo: 0.45,
    atmosphere: atmosphere(800, 0, rgb(0.9, 0.8, 0.65), 0.9, [['H2', 0.9], ['He', 0.1]]),
    hydrosphere: null,
    biosphere: null,
    rings: null,
    moons: [
      moon('lab-b-6-m1', 'Gale', 700, moonOrbit(50000, 1.4, 30), SURF.moonRock, ['Stripped and grey']),
      moon('lab-b-6-m2', 'Still', 460, moonOrbit(92000, 2.8, 150), SURF.moonIce, ['Cold, quiet']) ,
    ],
    surface: SURF.gasCold,
    description: 'A pale banded giant with two small moons and no rings worth naming.',
    tags: ['gas giant', 'moons'],
  },
  {
    id: 'lab-b-7',
    name: 'Niflheim',
    kind: 'icegiant',
    orbit: orbit(2.7, EMBER_STAR.massSun, 25, 0.02, 0.9),
    radiusKm: 25000,
    massEarth: 17,
    gravityG: 1.2,
    dayHours: 15.8,
    yearDays: orbitalPeriodDays(2.7, 0.45),
    temperatureK: 65,
    albedo: 0.55,
    atmosphere: atmosphere(0.7, 0, rgb(0.4, 0.65, 0.95), 0.8, [['CH4', 0.85], ['H2', 0.15]]),
    hydrosphere: null,
    biosphere: null,
    rings: rings(33750, 52500, 0.55, rgb(0.75, 0.82, 0.95), 'ice and dust'),
    moons: [
      moon('lab-b-7-m1', 'Rime', 500, moonOrbit(62000, 1.6, 80), SURF.moonIce, ['Coated in nitrogen frost']),
      moon('lab-b-7-m2', 'Hail', 1100, moonOrbit(98000, 3.1, 240), SURF.moonIce, ['Icy, densely cratered']),
    ],
    surface: SURF.icegiant,
    description: 'A blue-green ice giant with a bright, narrow ring system and two frost moons.',
    tags: ['ice giant', 'rings', 'moons'],
  },
  {
    id: 'lab-b-8',
    name: 'Frost',
    kind: 'ice',
    orbit: orbit(4.2, EMBER_STAR.massSun, 33, 0.05, 2.9),
    radiusKm: 8300,
    massEarth: 1.8,
    gravityG: 0.8,
    dayHours: 27,
    yearDays: orbitalPeriodDays(4.2, 0.45),
    temperatureK: 40,
    albedo: 0.7,
    atmosphere: null,
    hydrosphere: null,
    biosphere: null,
    rings: null,
    moons: [
      moon('lab-b-8-m1', 'Chill', 300, moonOrbit(22000, 1.9, 130), SURF.moonIce, ['Blue ice and old scars']),
    ],
    surface: SURF.ice,
    description: 'A frozen, airless world beyond the red dwarf’s pale reach.',
    tags: ['cold', 'airless'],
  },
];

const BELT_B: AsteroidBelt = {
  id: 'lab-b-belt',
  name: 'Ember Belt',
  innerAU: 0.9,
  outerAU: 1.15,
  count: 1800,
  density: 0.6,
  inclinationDeg: 8,
  seed: 7351,
};

export const LAB_SYSTEM_B: StarSystem = {
  id: 'lab-b',
  name: 'Ember',
  position: SYSTEM_B_STUB.position,
  seed: SYSTEM_B_STUB.seed,
  star: EMBER_STAR,
  planets: PLANETS_B,
  belts: [BELT_B],
};

export const LAB_SYSTEMS: readonly StarSystem[] = [LAB_SYSTEM_A, LAB_SYSTEM_B];

/** The lab's default destinations for `?view=system` and `?view=planet`. */
export const LAB_FOCUS = {
  systemId: 'lab-a',
  planetId: 'lab-a-3',
  planetHostId: 'lab-a',
} as const;

export function findLabSystem(id: string): StarSystem {
  const found = LAB_SYSTEMS.find((system) => system.id === id);
  if (!found) throw new Error(`Lab fixtures: no system "${id}".`);
  return found;
}

export function findLabPlanet(system: StarSystem, id: string): Planet {
  const found = system.planets.find((planet) => planet.id === id);
  if (!found) throw new Error(`Lab fixtures: no planet "${id}" in system "${system.id}".`);
  return found;
}
