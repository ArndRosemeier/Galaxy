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
 * Visual radius of a moon in the system view, in AU.
 *
 * Same exaggeration as its planet, so the moon-to-planet size ratio is at least the
 * same order; then clamped to a **third of the planet's drawn radius**, so a moon
 * always reads as a moon and never as a second world in the same cluster. (The true
 * radii of this galaxy's moons are 0.7-8.6% of their planet; drawing a 45%-of-orbit
 * moon, as the earlier rule did, put moons at 0.8-1.9× the planet's drawn radius — the
 * "three worlds clustered" in the reported system frame were one planet and two
 * moons.) Still clamped to 45% of its drawn orbit and floored so a pebble is visible.
 */
export function moonVisualRadiusAU(
  radiusKm: number,
  planetVisualRadiusAU: number,
  visualOrbitAU: number,
): number {
  return Math.max(
    Math.min(exaggeratedRadiusAU(radiusKm), planetVisualRadiusAU * 0.34, visualOrbitAU * 0.45),
    0.0008,
  );
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
 * A belt body is drawn as a point sprite sized in **pixels**, not in AU.
 *
 * True belt bodies are 10-1000 km (1e-7..7e-6 AU): at any camera that fits a system they
 * are far below a pixel. Scaling them in AU is what turned the belt into a ring of
 * boulders in the frame the owner rejected — the size then grew with the frame like a
 * planet's, instead of staying dust. A fixed on-screen size is both cheaper (one point
 * sprite is no triangles) and the honest picture of "dust at this distance".
 */
export const BELT_BODY_MIN_PX = 1.0;
export const BELT_BODY_MAX_PX = 2.1;

/** Hard cap on belt point sprites per belt (points, so the 60k-triangle budget is free). */
export const MAX_BELT_BODIES = 24_000;

// ---------------------------------------------------------------------------
// System view: minimum on-screen sizes (the frame must read as a system)
// ---------------------------------------------------------------------------

/**
 * The star is the subject of a system view, so it has a floor in *pixels*.
 *
 * At a camera that fits the planets, a true-to-scale stellar photosphere is a fraction
 * of a pixel — the defect the owner reported was a frame in which the star could not be
 * found at all. The photosphere is drawn at least this many pixels in radius, and the
 * corona at least `MIN_STAR_CORONA_PX`, so the star always reads as the brightest thing
 * in the frame. Below the floor the drawn radius still follows the true one.
 */
export const MIN_STAR_PHOTOSPHERE_PX = 11;
export const MIN_STAR_CORONA_PX = 58;

/**
 * Planets get a floor too: at a system fit, an exaggerated Earth is one or two pixels
 * and cannot be found, let alone clicked. Drawings are scaled in screen space around
 * their own centre — up to the floor, down to the ceiling — and their *positions* are
 * untouched.
 *
 * **The ceiling is in pixels, not in AU.** A clamped exaggerated radius can still be
 * huge in a wide-span system (an M dwarf with a 97:1 orbital span puts a gas giant's
 * clamped radius at 1.8 AU), and drawing it at its AU size made worlds collide on
 * screen. Every planet is therefore drawn between the floor and
 * `MAX_PLANET_RADIUS_PX`, and `SystemView` resolves any remaining screen overlap by
 * shrinking the *drawing* (never the position). There is no cap on the upward
 * correction, because a hard-to-find world is the defect the floor exists to prevent.
 */
export const MIN_PLANET_RADIUS_PX = 5.5;
export const MAX_PLANET_RADIUS_PX = 14;

/** Clear screen-space gap left between two drawn bodies, CSS pixels. */
export const PLANET_OVERLAP_GAP_PX = 1.5;

/** The system view frames the planetary system, with this margin around the outer orbit. */
export const SYSTEM_FRAME_MARGIN = 1.15;

// ---------------------------------------------------------------------------
// Planet view: rings are compressed (documented lie)
// ---------------------------------------------------------------------------

/**
 * **RING_DRAWN_MAX = 2.6.**
 *
 * Real ring systems run to many planet radii: the gas giant in the default system has
 * rings out to **5.99 R**, and drawing that true-to-scale dwarfs the world into a dot in
 * the middle of a record (the owner's "over-dominant scale"). The drawn annulus is
 * therefore compressed about the planet centre so its outer edge is never more than
 * 2.6 planet radii — the planet stays the subject and a moon at 2.8-3.2 R still orbits
 * outside it. The inner edge is carried along proportionally so the ring keeps its
 * width ratio and order, and never starts inside the planet. A view may compress it
 * further to make both the planet and the ring fit its frame (the planet view does),
 * but nothing may draw it larger.
 *
 * The ring's *shadow* and the planet's shadow on the ring both read these same drawn
 * radii, so nothing can disagree about where the rings are. `RingSystem` itself is
 * untouched: the inspector still shows the true radii.
 */
export const RING_DRAWN_MAX = 2.6;

/** The narrowest a drawn ring annulus may be squeezed; below this it is just a rim. */
export const RING_DRAWN_MIN = 1.25;

/** Drawn ring radii in planet radii, from the generated ones, compressed under `cap`. */
export function drawnRingRadii(
  innerRatio: number,
  outerRatio: number,
  cap: number = RING_DRAWN_MAX,
): { inner: number; outer: number } {
  const trueOuter = Math.max(outerRatio, 1.05);
  // The cap can only shrink the ring; a view that needs less room passes a smaller one.
  const outerCap = Math.max(cap, RING_DRAWN_MIN);
  const outer = Math.min(trueOuter, outerCap);
  const factor = outer / trueOuter;
  const inner = Math.min(Math.max(innerRatio * factor, 1.10), Math.max(outer * 0.92, 1.02));
  return { inner: Math.min(inner, outer * 0.94), outer };
}

