/**
 * The UI's view of the app.
 *
 * Panels are built against the narrowest interface that can do their job, so the
 * pure parts (actions, keyboard, formatting) can be unit-tested in node without a
 * DOM or a renderer. `GalaxyApp` satisfies all of these structurally; nothing in
 * `src/ui` ever constructs one.
 *
 * Layering (see `docs/ARCHITECTURE.md`): `src/ui` calls the app interface and never
 * touches a camera, a mesh or a GL context.
 */

import type { AppState, Selection, ViewKind } from '../app/state';
import type { GalaxyParams, Planet, StarSystem, SystemStub } from '../sim/types';

/** The store surface the UI reads: the single source of truth, plus change notice. */
export interface UiStore {
  readonly state: AppState;
  subscribe(listener: (state: AppState, previous: AppState) => void): () => void;
}

/**
 * Every app action the UI dispatches. Deliberately narrow: a fake that implements
 * these is enough to test a click path in node.
 */
export interface UiActions {
  readonly store: UiStore;
  setParams(patch: Partial<GalaxyParams>): void;
  randomizeSeed(): void;
  select(selection: Selection): void;
  setView(view: ViewKind): void;
  setPlaying(playing: boolean): void;
  setSpeed(daysPerSecond: number): void;
  setTime(days: number): void;
  back(): void;
}

/** Actions plus the generated content the inspector reads (cached inside the app). */
export interface UiApp extends UiActions {
  readonly selectedSystem: StarSystem | null;
  readonly selectedPlanet: Planet | null;
  systemFor(stub: SystemStub): StarSystem;
}
