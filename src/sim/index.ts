/**
 * The public API of the simulation layer.
 *
 * `src/render`, `src/ui` and `src/app` import from here (or from the type contract);
 * anything else under `src/sim` is an implementation detail. Generation is pure: data
 * in, data out, no DOM, no three, no clock, no `Math.random`.
 */

export { generateGalaxy } from './galaxy';
export { generateSystem } from './system';
export { PRESETS } from './presets';
export { DEFAULT_PARAMS, PARAM_SPECS, clampParams, paramSpec } from './params';

export type {
  AsteroidBelt,
  Atmosphere,
  Biosphere,
  Galaxy,
  GalaxyParams,
  GalaxyPreset,
  Hydrosphere,
  LifeLevel,
  Moon,
  MoonOrbit,
  NumericParamKey,
  Orbit,
  ParamBounds,
  ParamSpec,
  Planet,
  PlanetKind,
  RingSystem,
  Rgb,
  SpectralClass,
  Star,
  StarSystem,
  SurfaceSpec,
  SystemContext,
  SystemStub,
  Vec3,
} from './types';

export type { StarNameStyle } from './naming';
