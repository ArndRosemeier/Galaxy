/**
 * The look palette — the ONE place the renderer's colours are named.
 *
 * Every view composes its image from this small set instead of tinting noise with a
 * random hue. A galaxy photograph has four kinds of light (a warm old-population bulge,
 * a cool young disc, pink star-forming knots, and the dark of dust) plus one kind of
 * shadow; naming exactly those is what keeps the frame from turning into airbrushed
 * confetti. Values are **linear** RGB, per the data contract in `src/sim/types.ts`.
 *
 * Where a colour must come from generated data (`SystemStub.color`, `Star.color`,
 * `Atmosphere.color`, `SurfaceSpec.colors`, `RingSystem.color`) that data wins and
 * nothing here is used. This module is for light that is *unresolved*: the disc's glow,
 * the dust, the background sky.
 */

import * as THREE from 'three';
import type { Rgb } from '../sim/types';

/**
 * The galactic palette. Deliberately few values, deliberately close together: a Hubble
 * plate is not rainbow, it is warm cream, cool white, a little pink, and brown.
 */
export const GALAXY = {
  /** The cusp: the innermost, hottest light of the nucleus. Warm white. */
  nucleus: [1.0, 0.88, 0.66] as Rgb,
  /** The bulge: old, metal-rich stars. Yellow-orange. */
  bulge: [1.0, 0.70, 0.38] as Rgb,
  /** The inner disc: mixed population, warmer than the arms. */
  disc: [0.86, 0.82, 0.78] as Rgb,
  /** Young stars in the arms. Blue-white, never electric blue. */
  arm: [0.40, 0.62, 1.0] as Rgb,
  /** The arm's outer, older edge — slightly violet, so the arm has a cross-gradient. */
  armEdge: [0.30, 0.36, 0.80] as Rgb,
  /** H-II regions: hydrogen glowing pink. Sparse; pigment, not glitter. */
  hii: [1.0, 0.30, 0.46] as Rgb,
  /** Dust. Nearly black, with a little warmth: it is seen, not lit. */
  dust: [0.14, 0.08, 0.045] as Rgb,
  /** The galaxy's own faint halo — what keeps the background off pure black. */
  halo: [0.16, 0.20, 0.38] as Rgb,
  /** Background sky. Cold, extremely dim. */
  sky: [0.10, 0.13, 0.22] as Rgb,
} as const;

/**
 * Affordances and transitions — the colours that are *not* scenery: a selection ring is
 * a UI colour, not a star, and it must not drift when the look palette is tuned.
 */
export const AFFORDANCE = {
  /** An orbit line at rest. */
  orbit: [0.55, 0.68, 0.95] as Rgb,
  /** The orbit of the body under the cursor or the selection. */
  orbitFocus: [1.0, 0.80, 0.42] as Rgb,
  /** Hover ring. */
  hover: [0.55, 0.86, 1.0] as Rgb,
  /** Selection ring. */
  select: [1.0, 0.78, 0.42] as Rgb,
  /** The warmth of the light that covers a view transition. */
  flash: [1.0, 0.82, 0.58] as Rgb,
} as const;

/** A `THREE.Color` in the renderer's working (linear) space. */
export function linear(rgb: Rgb): THREE.Color {
  return new THREE.Color(rgb[0], rgb[1], rgb[2]);
}

/** Scale an RGB triple. Useful for a dimmer variant of a named colour. */
export function scaled(rgb: Rgb, factor: number): Rgb {
  return [rgb[0] * factor, rgb[1] * factor, rgb[2] * factor];
}

/**
 * Normalise a generated colour to a *hue*: linear RGB scaled so its brightest channel
 * is 1. Star colour carries classification, not intensity (`brightness` does that), so
 * a sprite must not be dimmed twice by a dark chroma.
 */
export function chroma(rgb: Rgb): Rgb {
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  if (!(max > 1e-4)) return [1, 1, 1];
  return [rgb[0] / max, rgb[1] / max, rgb[2] / max];
}
