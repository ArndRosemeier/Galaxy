/**
 * View-scale constants — the ONE place a number changes meaning between views.
 *
 * `docs/ARCHITECTURE.md` (View scales) requires that numbers never cross a view
 * boundary unchanged: the galaxy is measured in galaxy units (gu), a star system in
 * AU, and a world in its own radius. Every conversion and every deliberate visual
 * lie in the renderer is stated here, with its reason, so the next reader can tell
 * an aesthetic exaggeration from a bug.
 */

/** Kilometres in one astronomical unit (IAU 2012). */
export const KM_PER_AU = 149_597_870.7;

// ---------------------------------------------------------------------------
// System view: body radii are EXAGGERATED (documented lie)
// ---------------------------------------------------------------------------

/**
 * **SYSTEM_VIEW_RADIUS_EXAGGERATION = 3500.**
 *
 * True planetary radii are invisible at the only camera that fits a system: Earth is
 * 4.26e-5 AU, i.e. 0.004% of a 1 AU orbit, far below one pixel. Every body radius in
 * the system view is therefore multiplied by this factor before drawing:
 *
 *   Earth   6 371 km → 0.149 AU
 *   Jupiter 69 911 km → 1.635 AU   (still 11× Earth — relative sizes stay true)
 *
 * The result is then *clamped* against orbit spacing by `clampVisualRadii`, so a hot
 * Jupiter cannot swallow its neighbours. The inspector shows true numbers; only the
 * painted sphere is exaggerated. If this constant changes, this comment changes.
 */
export const SYSTEM_VIEW_RADIUS_EXAGGERATION = 3500;

/** Exaggerated radius of a body, in AU, before spacing clamps. */
export function exaggeratedRadiusAU(radiusKm: number): number {
  return (radiusKm * SYSTEM_VIEW_RADIUS_EXAGGERATION) / KM_PER_AU;
}

export interface OrbitRadius {
  readonly semiMajorAU: number;
  /** Un-clamped exaggerated radius, AU. */
  readonly radiusAU: number;
}

/**
 * Clamp exaggerated radii so neighbouring bodies never touch.
 *
 * Each body gets at most 30% of the gap to either neighbour's semi-major axis, and at
 * most 30% of its own semi-major axis (so it can never reach the star). Semi-major
 * axes are sorted first; the inner/outer gaps are measured on sorted order. The result
 * keeps the *ordering* and the relative look of a system, which is all the painted
 * sphere is for.
 */
export function clampVisualRadii(bodies: readonly OrbitRadius[]): number[] {
  const order = bodies.map((_, i) => i).sort((a, b) => bodies[a]!.semiMajorAU - bodies[b]!.semiMajorAU);
  const radii = bodies.map((b) => b.radiusAU);
  for (let k = 0; k < order.length; k += 1) {
    const i = order[k]!;
    const self = bodies[i]!;
    let limit = self.semiMajorAU * 0.3;
    const prev = k > 0 ? bodies[order[k - 1]!]! : null;
    const next = k + 1 < order.length ? bodies[order[k + 1]!]! : null;
    if (prev) limit = Math.min(limit, (self.semiMajorAU - prev.semiMajorAU) * 0.3);
    if (next) limit = Math.min(limit, (next.semiMajorAU - self.semiMajorAU) * 0.3);
    radii[i] = Math.max(Math.min(radii[i]!, limit), 0.002);
  }
  return radii;
}

/**
 * Visual star radius, in AU.
 *
 * A true star has the same problem as a planet (the Sun is 0.00465 AU) so the star is
 * drawn as a compositional object: 42% of the innermost orbit, gently scaled by the
 * true stellar radius (radiusSun^0.25, clamped 0.6..1.4) so a red dwarf still reads
 * smaller than a supergiant. The corona shell reaches far beyond this radius and is
 * what makes the star feel big.
 */
export function starVisualRadiusAU(radiusSun: number, innermostOrbitAU: number): number {
  const multiplier = Math.min(Math.max(Math.pow(Math.max(radiusSun, 1e-3), 0.25), 0.6), 1.4);
  return Math.max(0.42 * Math.max(innermostOrbitAU, 0.02) * multiplier, 0.004);
}

/**
 * Visual radius of a moon in the system view, in AU. Same exaggeration as a planet so
 * the moon-to-planet size ratio stays true; clamped to 45% of its drawn orbit so a
 * close-in moon cannot fill the screen.
 */
export function moonVisualRadiusAU(radiusKm: number, visualOrbitAU: number): number {
  return Math.max(Math.min(exaggeratedRadiusAU(radiusKm), visualOrbitAU * 0.45), 0.0008);
}

/**
 * Drawn moon orbit radius (AU) around a planet, in the system view.
 *
 * True moon orbits are *also* invisible at system scale (the Moon is 0.0026 AU; its
 * drawn planet is 0.106 AU, i.e. the moon would orbit inside the planet's painted
 * sphere). Moons are therefore ranked by true orbit radius and placed at 1.7..4.2
 * drawn planet radii, which preserves order and phase while keeping them clickable.
 */
export function moonOrbitVisualAU(planetVisualRadiusAU: number, rank: number, count: number): number {
  const t = count <= 1 ? 0.4 : rank / (count - 1);
  return planetVisualRadiusAU * (1.7 + 2.5 * t);
}

// ---------------------------------------------------------------------------
// Planet view: the world is the unit
// ---------------------------------------------------------------------------

/**
 * Drawn moon orbit around the world in planet view, in world radii (compressed).
 *
 * True moon orbits are 10-60 planet radii: at a camera that fills the frame with the
 * world, a true-distance moon is 60° off-axis and never in shot. Moons are therefore
 * brought in to 1.9-2.3 radii (2.8-3.2 for ringed worlds, so they do not cut through
 * the rings), which is what lets one hang in the sky of the default view.
 */
export function planetViewMoonDistance(rank: number, count: number, ringed = false): number {
  const t = count <= 1 ? 0.5 : rank / (count - 1);
  return (ringed ? 2.8 : 1.9) + 0.4 * t;
}

/** How much a moon's true radius ratio is shrunk for planet-view composition. */
export const PLANET_VIEW_MOON_SCALE = 0.6;

/**
 * Moon radius in the planet view: the true moon/planet radius ratio, clamped so a
 * pebble is still visible and a giant moon does not fill the sky.
 */
export function planetViewMoonRadius(moonRadiusKm: number, planetRadiusKm: number): number {
  const ratio = planetRadiusKm > 0 ? moonRadiusKm / planetRadiusKm : 0.02;
  return Math.min(Math.max(ratio * PLANET_VIEW_MOON_SCALE, 0.01), 0.20);
}

/**
 * A belt body's drawn radius in AU, as a fraction of the belt span (decorative only).
 *
 * True belt bodies are 10-1000 km (1e-7..7e-6 AU): at any camera that fits a system
 * they are far below a pixel. A belt body is drawn a few hundredths of an AU across so the ring
 * reads as granular instead of invisible; the belt's true extent and count are still
 * what the data says.
 */
export const BELT_BODY_RADIUS_FRACTION = 0.018;

/** Hard cap on instanced belt bodies: 3 000 × 20 triangles = 60 000 triangles (budget). */
export const MAX_BELT_BODIES = 3000;

