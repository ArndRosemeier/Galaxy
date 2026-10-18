/**
 * UI actions — every click path is one of these functions, so a button never has to
 * know how the store and the renderer have to be sequenced.
 *
 * They take the narrow `UiActions` interface, which makes them testable in node with a
 * fake app (see `tests/ui/actions.test.ts`).
 */

import type { AppState } from '../app/state';
import { DEFAULT_PARAMS, PARAM_SPECS, PRESETS } from '../sim';
import type { GalaxyParams, GalaxyPreset, Planet } from '../sim/types';
import { normalizeSeed } from './share';
import type { UiActions } from './types';

/**
 * Open a planet's dossier. Selection is dispatched before the view change because the
 * renderer must have the world built (`showPlanet`) before `setView('planet')` can
 * fly to it — the same order the renderer's own pick callback uses.
 */
export function selectPlanet(app: UiActions, planet: Planet): void {
  const { selection } = app.store.state;
  if (!selection.systemId) {
    throw new Error('ui: selectPlanet called with no system selected');
  }
  app.select({ systemId: selection.systemId, planetId: planet.id, moonId: null });
  app.setView('planet');
}

/** Select a moon, or clear the moon when it is already the selection (toggle). */
export function toggleMoon(app: UiActions, moonId: string): void {
  const { selection } = app.store.state;
  if (!selection.systemId) return;
  app.select({ ...selection, moonId: selection.moonId === moonId ? null : moonId });
}

/** Walk up to the galaxy map using the app's own back semantics (never guesses state). */
export function goToGalaxy(app: UiActions): void {
  for (let step = 0; step < 3 && app.store.state.view !== 'galaxy'; step += 1) {
    app.back();
  }
  if (app.store.state.view !== 'galaxy') {
    throw new Error(`ui: could not return to the galaxy view (stuck in "${app.store.state.view}")`);
  }
}

/** Walk up to the selected system: one level down from the map, none up from a planet. */
export function goToSystem(app: UiActions): void {
  const { selection, view } = app.store.state;
  if (!selection.systemId) return;
  if (view === 'planet') {
    app.back();
    return;
  }
  if (view !== 'system') app.setView('system');
}

/** Apply a preset wholesale (seed included); the store clamps every value. */
export function applyPreset(app: UiActions, preset: GalaxyPreset): void {
  app.setParams({ ...preset.params });
}

/**
 * Commit typed seed text. Returns whether anything changed, so the field can snap back
 * to the live seed when the input was empty.
 */
export function commitSeed(app: UiActions, raw: string): boolean {
  const seed = normalizeSeed(raw);
  if (seed === '') return false;
  if (seed === app.store.state.params.seed) return false;
  app.setParams({ seed });
  return true;
}

/** Reset every shape control to its default, keeping the seed (and so the galaxy). */
export function resetShape(app: UiActions): void {
  app.setParams({ ...DEFAULT_PARAMS, seed: app.store.state.params.seed });
}

/** Same galaxy? Seed plus every knob in `PARAM_SPECS` — used to light up a preset card. */
export function sameParams(a: GalaxyParams, b: GalaxyParams): boolean {
  if (a.seed !== b.seed) return false;
  return PARAM_SPECS.every((spec) => a[spec.key] === b[spec.key]);
}

/** The preset the current params exactly match, if any. */
export function activePresetId(state: AppState): string | null {
  for (const preset of PRESETS) {
    if (sameParams(state.params, preset.params)) return preset.id;
  }
  return null;
}
