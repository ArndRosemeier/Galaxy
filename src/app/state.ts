/**
 * Application state — the single mutable surface of the app.
 *
 * The UI reads it and dispatches actions; the controller (renderer glue) subscribes
 * and turns states into frames. Nothing here touches the DOM, WebGL or generation:
 * it is plain data plus change notification, which keeps it testable in node.
 *
 * Two invariants this file exists to keep:
 *  1. `params` is ALWAYS clamped (see `src/sim/params.ts`) before it reaches the
 *     generator, so a hand-edited URL cannot produce an unsupported galaxy.
 *  2. selection is a narrow set of ids; anything not present in the current galaxy
 *     resolves to `null` rather than a dangling reference.
 */

import { clampParams, DEFAULT_PARAMS } from '../sim/params';
import type { GalaxyParams, Planet, StarSystem, SystemStub } from '../sim/types';

export type ViewKind = 'galaxy' | 'system' | 'planet';

export interface Selection {
  readonly systemId: string | null;
  readonly planetId: string | null;
  readonly moonId: string | null;
}

export interface AppState {
  readonly params: GalaxyParams;
  readonly view: ViewKind;
  readonly selection: Selection;
  /** Simulation time in days since epoch. */
  readonly timeDays: number;
  readonly playing: boolean;
  /** Days of simulation per wall-clock second. */
  readonly speedDaysPerSec: number;
  /** System id under the cursor, for hover feedback. */
  readonly hoveredSystemId: string | null;
}

const EMPTY_SELECTION: Selection = { systemId: null, planetId: null, moonId: null };

export const INITIAL_STATE: AppState = {
  params: DEFAULT_PARAMS,
  view: 'galaxy',
  selection: EMPTY_SELECTION,
  timeDays: 0,
  playing: true,
  speedDaysPerSec: 2,
  hoveredSystemId: null,
};

export type Listener = (state: AppState, prev: AppState) => void;

/**
 * A tiny observable store. `set` merges, notifies only on an actual change, and never
 * re-enters: a listener that dispatches is queued to the next microtask so a UI event
 * cannot recursively re-render mid-notification.
 */
export class AppStore {
  #state: AppState;
  #listeners = new Set<Listener>();
  #notifying = false;
  #queued = false;

  constructor(initial: AppState = INITIAL_STATE) {
    this.#state = initial;
  }

  get state(): AppState {
    return this.#state;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(patch: Partial<AppState>): void {
    const next: AppState = { ...this.#state, ...patch };
    if (shallowEqual(this.#state, next)) return;
    const prev = this.#state;
    this.#state = next;
    this.#notify(prev);
  }

  /** Clamp and apply params; always a new params object so listeners see the change. */
  setParams(patch: Partial<GalaxyParams>): void {
    this.set({ params: clampParams({ ...this.#state.params, ...patch }) });
  }

  select(selection: Selection): void {
    this.set({ selection });
  }

  setView(view: ViewKind): void {
    this.set({ view });
  }

  tick(deltaSeconds: number): void {
    if (!this.#state.playing) return;
    this.set({ timeDays: this.#state.timeDays + this.#state.speedDaysPerSec * deltaSeconds });
  }

  #notify(prev: AppState): void {
    if (this.#notifying) {
      this.#queued = true;
      return;
    }
    this.#notifying = true;
    try {
      for (const listener of [...this.#listeners]) listener(this.#state, prev);
    } finally {
      this.#notifying = false;
    }
    if (this.#queued) {
      this.#queued = false;
      this.#notify(prev);
    }
  }
}

function shallowEqual(a: AppState, b: AppState): boolean {
  return (
    a.params === b.params &&
    a.view === b.view &&
    a.selection === b.selection &&
    a.timeDays === b.timeDays &&
    a.playing === b.playing &&
    a.speedDaysPerSec === b.speedDaysPerSec &&
    a.hoveredSystemId === b.hoveredSystemId
  );
}

/* ------------------------------------------------------------------ url state */

/** Query keys, short but readable. `seed` and the numbers are the share link. */
const URL_KEYS = {
  seed: 'seed',
  systemCount: 'systems',
  arms: 'arms',
  armTwist: 'twist',
  armSpread: 'spread',
  coreDensity: 'core',
  galaxyRadius: 'radius',
  ageGyr: 'age',
  metallicity: 'metal',
  lifeChance: 'life',
  hazard: 'hazard',
  timeDays: 't',
  view: 'view',
  systemId: 'system',
  planetId: 'planet',
  moonId: 'moon',
} as const;

/** Serialise the parts of the state worth sharing: the galaxy and where you are in it. */
export function encodeState(state: AppState): string {
  const p = new URLSearchParams();
  p.set(URL_KEYS.seed, state.params.seed);
  for (const key of [
    'systemCount',
    'arms',
    'armTwist',
    'armSpread',
    'coreDensity',
    'galaxyRadius',
    'ageGyr',
    'metallicity',
    'lifeChance',
    'hazard',
  ] as const) {
    p.set(URL_KEYS[key], trimNumber(state.params[key]));
  }
  if (state.timeDays > 0) p.set(URL_KEYS.timeDays, trimNumber(state.timeDays));
  if (state.view !== 'galaxy') p.set(URL_KEYS.view, state.view);
  if (state.selection.systemId) p.set(URL_KEYS.systemId, state.selection.systemId);
  if (state.selection.planetId) p.set(URL_KEYS.planetId, state.selection.planetId);
  if (state.selection.moonId) p.set(URL_KEYS.moonId, state.selection.moonId);
  return `?${p.toString()}`;
}

/** Parse a query string into a state patch. Unknown or invalid values are dropped, never guessed. */
export function decodeState(query: string): Partial<AppState> {
  const p = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const params: Partial<Record<keyof GalaxyParams, string | number>> = {};
  const seed = p.get(URL_KEYS.seed);
  if (seed !== null && seed.trim() !== '') params.seed = seed.trim().slice(0, 64);
  for (const key of [
    'systemCount',
    'arms',
    'armTwist',
    'armSpread',
    'coreDensity',
    'galaxyRadius',
    'ageGyr',
    'metallicity',
    'lifeChance',
    'hazard',
  ] as const) {
    const raw = p.get(URL_KEYS[key]);
    if (raw === null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) params[key] = n;
  }

  const patch: {
    params?: GalaxyParams;
    timeDays?: number;
    view?: ViewKind;
    selection?: Selection;
  } = {};

  if (Object.keys(params).length > 0) {
    patch.params = clampParams({ ...DEFAULT_PARAMS, ...params } as GalaxyParams);
  }

  const t = Number(p.get(URL_KEYS.timeDays) ?? '');
  if (Number.isFinite(t) && t >= 0) patch.timeDays = t;

  const view = p.get(URL_KEYS.view);
  if (view === 'galaxy' || view === 'system' || view === 'planet') patch.view = view;

  const systemId = p.get(URL_KEYS.systemId);
  const planetId = p.get(URL_KEYS.planetId);
  const moonId = p.get(URL_KEYS.moonId);
  if (systemId || planetId || moonId) {
    patch.selection = { systemId, planetId, moonId };
  }

  return patch;
}

function trimNumber(n: number): string {
  return Number(n.toFixed(3)).toString();
}

/* ------------------------------------------------------------ system details */

/**
 * Deep generation cache. Keyed by the FULL stub (id + spectral + seed + context), not by
 * id alone: the simulation writer measured that a param change alters `stub.spectral`
 * and the context while leaving `id` stable, so an id-only cache serves stale worlds.
 */
export class SystemCache {
  #byKey = new Map<string, StarSystem>();

  get(stub: SystemStub, generate: (stub: SystemStub) => StarSystem): StarSystem {
    const key = `${stub.id}|${stub.spectral}|${stub.seed}|${
      stub.context ? `${stub.context.metallicity},${stub.context.ageGyr},${stub.context.lifeChance},${stub.context.hazard}` : '-'
    }`;
    const hit = this.#byKey.get(key);
    if (hit) return hit;
    const system = generate(stub);
    this.#byKey.set(key, system);
    return system;
  }

  clear(): void {
    this.#byKey.clear();
  }

  get size(): number {
    return this.#byKey.size;
  }
}

/** Resolve a planet from a system by id — used by the inspector and the camera. */
export function findPlanet(system: StarSystem | null, planetId: string | null): Planet | null {
  if (!system || !planetId) return null;
  return system.planets.find((p) => p.id === planetId) ?? null;
}
