/**
 * Galaxy — the data contract.
 *
 * This file is FROZEN. It is the only thing generation (`src/sim`) and presentation
 * (`src/render`, `src/ui`, `src/app`) share, and both sides are built against it
 * independently. Extend it only by adding OPTIONAL fields or new exports, and say so
 * in the decision ledger — changing a field another writer already builds against is
 * how parallel work stops being parallel.
 *
 * Conventions, once, so nobody has to guess:
 *  - **Angles** are degrees at the boundary; radians only inside maths helpers.
 *  - **Distances between stars** are in *galaxy units* (gu) — an arbitrary but fixed
 *    unit, `galaxyRadius` gu from the core to the rim. Nothing physical is derived
 *    from gu; it is a map, not a measurement.
 *  - **Distances around a star** are AU; **radii** are km; **masses** are Earth masses
 *    (`massEarth`) except stellar masses, which are solar (`massSun`).
 *  - **Times** are days unless the field says otherwise.
 *  - **Colours** are linear-space RGB triples in 0..1, never sRGB hex.
 *  - Everything is JSON-serialisable and deterministic: the same params must produce
 *    byte-identical output, because screenshots and tests depend on it.
 */

/** A point or direction in 3D. Treated as immutable at the boundary. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Linear-space colour, each channel 0..1. */
export type Rgb = readonly [number, number, number];

/**
 * Stellar classification. `WD` = white dwarf, `NS` = neutron star, `BH` = black hole
 * (renderable as a lensing disc + accretion glow; no surface).
 */
export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'WD' | 'NS' | 'BH';

/**
 * What a world is, which drives both its physical model and its look.
 * `gas` and `icegiant` are the two giant archetypes; the rest are solid bodies.
 */
export type PlanetKind =
  | 'terrestrial'
  | 'ocean'
  | 'desert'
  | 'ice'
  | 'lava'
  | 'toxic'
  | 'barren'
  | 'gas'
  | 'icegiant';

/** How alive a world is. `civilization` implies detectable night lights. */
export type LifeLevel = 'none' | 'microbial' | 'flora' | 'fauna' | 'civilization';

/**
 * The user-facing knobs. The UI edits exactly these; generation derives everything
 * else. Defaults are the app's default galaxy — useful, not arbitrary.
 */
export interface GalaxyParams {
  /** Any user text. The same seed always yields the same galaxy. */
  readonly seed: string;
  /** Number of star systems in the map. 24..600, default 180. */
  readonly systemCount: number;
  /** Number of spiral arms. 2..6, default 4. */
  readonly arms: number;
  /** How much the arms wind: radians of rotation per unit radius. 0..2.2, default 1.15. */
  readonly armTwist: number;
  /** How far stars scatter off the arm centreline. 0..1, default 0.55. */
  readonly armSpread: number;
  /** Extra density toward the core. 0..1, default 0.5. */
  readonly coreDensity: number;
  /** Map radius, core to rim, in galaxy units. 400..2000, default 1100. */
  readonly galaxyRadius: number;
  /** Galaxy age in gigayears. 1..13.5, default 8.6. Drives metallicity spread and habitability. */
  readonly ageGyr: number;
  /** Heavy-element richness. 0..1, default 0.5. Low metal → fewer rocky worlds. */
  readonly metallicity: number;
  /** Relative chance of life appearing anywhere. 0..1, default 0.25. */
  readonly lifeChance: number;
  /** Asteroid/ring/impact abundance. 0..1, default 0.35. */
  readonly hazard: number;
}

/** One star system as the galaxy map sees it: no planets are generated at this level. */
export interface SystemStub {
  readonly id: string;
  readonly name: string;
  /** Position in galaxy units, disc plane ≈ y = 0 with a thin bulge. */
  readonly position: Vec3;
  readonly spectral: SpectralClass;
  /** Display colour of the star, linear RGB. */
  readonly color: Rgb;
  /** 0..1 apparent brightness, used for sprite size/alpha. */
  readonly brightness: number;
  /** Stable per-system seed; `generateSystem(stub)` derives its worlds from it. */
  readonly seed: number;
}

/** The galaxy map. Systems are the only generated content here. */
export interface Galaxy {
  readonly params: GalaxyParams;
  readonly systems: readonly SystemStub[];
}

/** A star. */
export interface Star {
  readonly name: string;
  readonly spectral: SpectralClass;
  readonly temperatureK: number;
  /** Solar radii. */
  readonly radiusSun: number;
  readonly massSun: number;
  readonly luminositySun: number;
  /** Linear RGB at the photosphere. */
  readonly color: Rgb;
}

/**
 * A Keplerian orbit around the star.
 * Angles name the standard elements; `periodDays` follows from `semiMajorAU` and the
 * star's mass, so generation sets it rather than the renderer deriving it.
 */
export interface Orbit {
  readonly semiMajorAU: number;
  readonly eccentricity: number;
  readonly inclinationDeg: number;
  readonly nodeDeg: number;
  readonly argPeriapsisDeg: number;
  /** Anomaly at t = 0. */
  readonly meanAnomalyDeg: number;
  readonly periodDays: number;
}

/** A moon's orbit is given in kilometres around its planet — no AU, no solar mass. */
export interface MoonOrbit {
  /** Mean orbital radius from the planet's centre, km. */
  readonly radiusKm: number;
  readonly eccentricity: number;
  readonly inclinationDeg: number;
  readonly phaseDeg: number;
  readonly periodDays: number;
}

/** One layer of the gas envelope. */
export interface Atmosphere {
  /** Surface pressure in atm. */
  readonly pressureAtm: number;
  /** Molecule → fraction, fractions summing to ~1. */
  readonly composition: readonly { readonly gas: string; readonly fraction: number }[];
  /** Equilibrium temperature shift from the greenhouse effect, K. */
  readonly greenhouseK: number;
  /** Linear RGB tint for the limb glow. */
  readonly color: Rgb;
  /** 0..1 limb-glow strength. */
  readonly opacity: number;
}

export interface Hydrosphere {
  /** Fraction of the surface covered by liquid. 0..1. */
  readonly coverage: number;
  readonly color: Rgb;
  /** Mean depth, km. */
  readonly depthKm: number;
}

export interface Biosphere {
  readonly level: LifeLevel;
  /** One sentence, written for a person, shown in the detail panel. */
  readonly summary: string;
}

export interface RingSystem {
  readonly innerRadiusKm: number;
  readonly outerRadiusKm: number;
  readonly thicknessKm: number;
  /** 0..1. */
  readonly opacity: number;
  readonly color: Rgb;
  /** e.g. "ice and dust", "rocky debris". */
  readonly composition: string;
}

/** A moon. Small worlds carry appearance but not full orbital systems of their own. */
export interface Moon {
  readonly id: string;
  readonly name: string;
  readonly radiusKm: number;
  readonly orbit: MoonOrbit;
  readonly surface: SurfaceSpec;
  readonly atmosphere: Atmosphere | null;
  readonly notes: readonly string[];
}

/**
 * The renderer's recipe for a world's surface. Generation chooses the recipe, the
 * renderer owns how the shader turns it into pixels; neither side reaches into the
 * other. `bandiness` > 0 means latitude bands (giants, banded rock), `turbulence`
 * means domain-warped noise, `nightLights` > 0 means settlements on the night side.
 */
export interface SurfaceSpec {
  readonly seed: number;
  readonly kind: PlanetKind;
  readonly colors: {
    /** Deepest tone: ocean floor, canyon shadow, cloud belt. */
    readonly deep: Rgb;
    readonly low: Rgb;
    readonly mid: Rgb;
    readonly high: Rgb;
    /** Polar/cap tint. */
    readonly ice: Rgb;
    /** Liquid colour, or null for a dry world. */
    readonly water: Rgb | null;
  };
  /** 0..1 cloud layer coverage. */
  readonly cloudiness: number;
  readonly cloudColor: Rgb;
  /** 0..1 domain-warp strength. */
  readonly turbulence: number;
  /** 0..1 latitude banding. */
  readonly bandiness: number;
  /** 0..1 surface relief emphasis (affects normal perturbation). */
  readonly roughness: number;
  /** 0..1 night-side emissive settlement intensity. */
  readonly nightLights: number;
}

/** A planet (or a moon-scale world — planets are the ones with orbits). */
export interface Planet {
  readonly id: string;
  readonly name: string;
  readonly kind: PlanetKind;
  readonly orbit: Orbit;
  readonly radiusKm: number;
  readonly massEarth: number;
  readonly gravityG: number;
  /** Sidereal rotation, hours. Negative means retrograde. */
  readonly dayHours: number;
  /** Orbital period, days (mirrors orbit.periodDays for display convenience). */
  readonly yearDays: number;
  /** Mean surface/equilibrium temperature, K. */
  readonly temperatureK: number;
  /** Bond albedo, 0..1. */
  readonly albedo: number;
  readonly atmosphere: Atmosphere | null;
  readonly hydrosphere: Hydrosphere | null;
  readonly biosphere: Biosphere | null;
  readonly rings: RingSystem | null;
  readonly moons: readonly Moon[];
  readonly surface: SurfaceSpec;
  /** One paragraph of description for the inspector. */
  readonly description: string;
  /** Short labels: "tidally locked", "hostile", "habitable", … */
  readonly tags: readonly string[];
}

/** A belt of minor bodies orbiting the star. */
export interface AsteroidBelt {
  readonly id: string;
  readonly name: string;
  readonly innerAU: number;
  readonly outerAU: number;
  /** How many bodies the renderer should instance. */
  readonly count: number;
  /** 0..1 visual density multiplier. */
  readonly density: number;
  readonly inclinationDeg: number;
  readonly seed: number;
}

/** A fully generated system. */
export interface StarSystem {
  readonly id: string;
  readonly name: string;
  readonly position: Vec3;
  readonly seed: number;
  readonly star: Star;
  readonly planets: readonly Planet[];
  readonly belts: readonly AsteroidBelt[];
}

/**
 * A named, ready-to-use parameter set. Presets are data, not code: the UI lists
 * `PRESETS` and applies one by replacing the params.
 */
export interface GalaxyPreset {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly params: GalaxyParams;
}

/** Practical bounds the UI clamps to. Generation may assume the values are in range. */
export interface ParamBounds {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export type NumericParamKey =
  | 'systemCount'
  | 'arms'
  | 'armTwist'
  | 'armSpread'
  | 'coreDensity'
  | 'galaxyRadius'
  | 'ageGyr'
  | 'metallicity'
  | 'lifeChance'
  | 'hazard';

/** Display metadata for each numeric knob — the inspector and the sliders share it. */
export interface ParamSpec {
  readonly key: NumericParamKey;
  readonly label: string;
  readonly hint: string;
  readonly bounds: ParamBounds;
  /** How to render the value in the UI, e.g. 2 decimals. */
  readonly format: (value: number) => string;
  /** Short, human meaning of the ends of the slider. */
  readonly lowLabel?: string;
  readonly highLabel?: string;
}
