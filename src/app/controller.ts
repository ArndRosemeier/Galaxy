/**
 * The controller — the one place the simulation, the renderer and the app state meet.
 *
 * Flow: a state change in `AppStore` is applied to the renderer; a pick from the
 * renderer is dispatched back into the store. Nothing else in the app holds both sides
 * at once, which is what keeps the seams in `docs/ARCHITECTURE.md` real.
 *
 * Time is advanced here rather than through the store: the renderer needs a smooth
 * clock at frame rate, while the UI only needs it a few times a second. Pushing 60 Hz
 * through the store would re-render every panel for no reason, and 60 store writes a
 * second is the fastest way to make a good app feel slow.
 */

import { generateGalaxy, generateSystem } from '../sim';
import type { Galaxy, Planet, StarSystem, SystemStub } from '../sim/types';
import { clampParams } from '../sim/params';
import { GalaxyRenderer } from '../render';
import type { PickTarget, RenderInfo, ViewKind } from '../render';
import {
  AppStore,
  INITIAL_STATE,
  SystemCache,
  decodeState,
  encodeState,
  findPlanet,
} from './state';
import type { AppState, Selection } from './state';

const TIME_SYNC_MS = 250;
const URL_DEBOUNCE_MS = 400;
const EMPTY_SELECTION: Selection = { systemId: null, planetId: null, moonId: null };

export interface GalaxyAppOptions {
  canvas: HTMLCanvasElement;
  onError?(message: string, detail?: unknown): void;
  onReady?(): void;
}

export class GalaxyApp {
  readonly store: AppStore;
  readonly renderer: GalaxyRenderer;

  #options: GalaxyAppOptions;
  #cache = new SystemCache();
  #galaxy: Galaxy;
  #timeDays = 0;
  #lastFrame = 0;
  #lastSync = 0;
  #urlTimer: ReturnType<typeof setTimeout> | null = null;
  #raf = 0;
  #disposed = false;
  #applying = false;

  constructor(options: GalaxyAppOptions) {
    this.#options = options;

    const fromUrl = decodeState(window.location.search);
    this.store = new AppStore({ ...INITIAL_STATE, ...fromUrl });
    this.#timeDays = this.store.state.timeDays;

    this.renderer = new GalaxyRenderer({
      canvas: options.canvas,
      onPick: (target) => this.#handlePick(target),
      onHover: (target) => this.#handleHover(target),
      onViewChange: (view) => this.#handleViewChange(view),
    });

    this.#galaxy = generateGalaxy(this.store.state.params);
    this.renderer.setGalaxy(this.#galaxy);
    this.renderer.setTime(this.#timeDays);

    this.store.subscribe((state, prev) => this.#apply(state, prev));
    this.#applyInitial();

    this.#lastFrame = performance.now();
    this.#raf = requestAnimationFrame(this.#loop);

    window.addEventListener('popstate', this.#onPopState);
    void this.renderer.ready.then(() => {
      this.#options.onReady?.();
    });
  }

  get galaxy(): Galaxy {
    return this.#galaxy;
  }

  get selectedSystem(): StarSystem | null {
    const id = this.store.state.selection.systemId;
    if (!id) return null;
    const stub = this.#galaxy.systems.find((s) => s.id === id);
    return stub ? this.systemFor(stub) : null;
  }

  get selectedPlanet(): Planet | null {
    return findPlanet(this.selectedSystem, this.store.state.selection.planetId);
  }

  /** The generated system for a stub — generation is pure, the cache is only a cost save. */
  systemFor(stub: SystemStub): StarSystem {
    return this.#cache.get(stub, generateSystem);
  }

  /* ------------------------------------------------------------------ actions */

  /**
   * Edit the galaxy's parameters. Selection is cleared in the SAME state change: ids
   * are positional, so "the same id" after a param change is a different world.
   */
  setParams(patch: Partial<Galaxy['params']>): void {
    this.store.set({
      params: clampParams({ ...this.store.state.params, ...patch }),
      selection: EMPTY_SELECTION,
      view: 'galaxy',
    });
  }

  /** A fresh seed, keeping every other knob where the user left it. */
  randomizeSeed(random: () => number = Math.random): void {
    const words = ['vela', 'kepler', 'tycho', 'andromeda', 'orion', 'lyra', 'cygnus', 'aquila', 'draco', 'pavo'];
    const w = words[Math.floor(random() * words.length)] ?? 'vela';
    const n = Math.floor(random() * 9000) + 1000;
    this.setParams({ seed: `${w}-${n}` });
  }

  select(selection: Selection): void {
    this.store.select(selection);
  }

  setView(view: ViewKind): void {
    this.store.setView(view);
  }

  setPlaying(playing: boolean): void {
    this.store.set({ playing });
  }

  setSpeed(daysPerSecond: number): void {
    this.store.set({ speedDaysPerSec: Math.max(0, Math.min(500, daysPerSecond)) });
  }

  setTime(days: number): void {
    this.#timeDays = Math.max(0, days);
    this.store.set({ timeDays: this.#timeDays });
  }

  back(): void {
    const { view } = this.store.state;
    if (view === 'planet') {
      this.store.set({
        view: 'system',
        selection: { ...this.store.state.selection, planetId: null, moonId: null },
      });
    } else if (view === 'system') {
      this.store.set({ view: 'galaxy', selection: EMPTY_SELECTION });
    }
  }

  /** Navigate by index — used by automation and by tests. */
  goto(systemIndex: number): void {
    const stub = this.#galaxy.systems[systemIndex];
    if (!stub) return;
    this.store.select({ systemId: stub.id, planetId: null, moonId: null });
    this.store.setView('system');
  }

  gotoPlanet(systemIndex: number, planetIndex: number): void {
    const stub = this.#galaxy.systems[systemIndex];
    if (!stub) return;
    const system = this.systemFor(stub);
    const planet = system.planets[planetIndex];
    if (!planet) return;
    this.store.select({ systemId: stub.id, planetId: planet.id, moonId: null });
    this.store.setView('planet');
  }

  info(): RenderInfo {
    return this.renderer.info();
  }

  dispose(): void {
    this.#disposed = true;
    cancelAnimationFrame(this.#raf);
    window.removeEventListener('popstate', this.#onPopState);
    if (this.#urlTimer) clearTimeout(this.#urlTimer);
    this.renderer.dispose();
  }

  /* ---------------------------------------------------------------- internals */

  #applyInitial(): void {
    const state = this.store.state;
    const sel = state.selection;
    if (sel.systemId) {
      const stub = this.#galaxy.systems.find((s) => s.id === sel.systemId);
      if (stub) {
        const system = this.systemFor(stub);
        this.renderer.showSystem(system);
        const planet = findPlanet(system, sel.planetId);
        if (planet) {
          this.renderer.showPlanet(planet, system);
          this.renderer.setView('planet', false);
        } else {
          this.renderer.setView('system', false);
        }
      }
    }
  }

  #apply(state: AppState, prev: AppState): void {
    if (this.#disposed || this.#applying) return;
    // Hover is 60 Hz noise; it must not re-run the whole application pipeline.
    if (isHoverOnly(state, prev)) return;
    this.#applying = true;
    try {
      const paramsChanged = state.params !== prev.params;

      if (paramsChanged) {
        this.#galaxy = generateGalaxy(state.params);
        this.#cache.clear();
        this.renderer.setGalaxy(this.#galaxy);
      }

      const sel = state.selection;
      const systemChanged = paramsChanged || sel.systemId !== prev.selection.systemId;
      const planetChanged = paramsChanged || sel.planetId !== prev.selection.planetId;

      if (systemChanged) {
        if (sel.systemId) {
          const stub = this.#galaxy.systems.find((s) => s.id === sel.systemId);
          if (stub) {
            this.renderer.showSystem(this.systemFor(stub));
            this.renderer.select({ kind: 'system', id: stub.id });
          }
        } else if (!sel.planetId) {
          this.renderer.select(null);
        }
      }

      if (planetChanged) {
        const system = this.selectedSystem;
        const planet = findPlanet(system, sel.planetId);
        if (system && planet) {
          this.renderer.showPlanet(planet, system);
          this.renderer.select({ kind: 'planet', id: planet.id });
        }
      }

      if (sel.moonId !== prev.selection.moonId) {
        if (sel.moonId) {
          this.renderer.select({ kind: 'moon', id: sel.moonId });
        } else if (sel.planetId) {
          this.renderer.select({ kind: 'planet', id: sel.planetId });
        }
      }

      if (state.view !== prev.view) {
        this.renderer.setView(state.view);
      }

      if (state.speedDaysPerSec !== prev.speedDaysPerSec) {
        this.renderer.setSpeed(state.speedDaysPerSec);
      }
      if (state.playing !== prev.playing) {
        this.renderer.setPlaying(state.playing);
      }
      if (state.timeDays !== prev.timeDays) {
        this.#timeDays = state.timeDays;
        this.renderer.setTime(this.#timeDays);
      }

      this.#scheduleUrlWrite(state);
    } catch (error) {
      this.#options.onError?.(errorMessage(error), error);
    } finally {
      this.#applying = false;
    }
  }

  #handlePick(target: PickTarget | null): void {
    const { view, selection } = this.store.state;
    if (!target) {
      if (view === 'galaxy' && selection.systemId) this.store.select(EMPTY_SELECTION);
      return;
    }

    if (target.kind === 'system') {
      if (target.id === selection.systemId && view !== 'galaxy') return;
      this.store.select({ systemId: target.id, planetId: null, moonId: null });
      this.store.setView('system');
      return;
    }

    if (target.kind === 'planet') {
      if (target.id === selection.planetId) return;
      this.store.select({ ...selection, planetId: target.id, moonId: null });
      this.store.setView('planet');
      return;
    }

    this.store.select({ ...selection, moonId: target.id });
  }

  #handleHover(target: PickTarget | null): void {
    const id = target?.kind === 'system' ? target.id : null;
    if (id !== this.store.state.hoveredSystemId) this.store.set({ hoveredSystemId: id });
  }

  #handleViewChange(view: ViewKind): void {
    if (this.store.state.view !== view) this.store.set({ view });
  }

  #loop = (now: number): void => {
    if (this.#disposed) return;
    const dt = Math.min(0.1, (now - this.#lastFrame) / 1000);
    this.#lastFrame = now;

    if (this.store.state.playing) {
      this.#timeDays += this.store.state.speedDaysPerSec * dt;
      this.renderer.setTime(this.#timeDays);
      if (now - this.#lastSync > TIME_SYNC_MS) {
        this.#lastSync = now;
        this.store.set({ timeDays: this.#timeDays });
      }
    }
    this.#raf = requestAnimationFrame(this.#loop);
  };

  #scheduleUrlWrite(state: AppState): void {
    if (this.#urlTimer) clearTimeout(this.#urlTimer);
    this.#urlTimer = setTimeout(() => {
      const query = encodeState(state);
      if (query !== window.location.search) window.history.replaceState(null, '', query);
    }, URL_DEBOUNCE_MS);
  }

  #onPopState = (): void => {
    this.store.set(decodeState(window.location.search));
  };
}

function isHoverOnly(state: AppState, prev: AppState): boolean {
  return (
    state.hoveredSystemId !== prev.hoveredSystemId &&
    state.params === prev.params &&
    state.view === prev.view &&
    state.selection === prev.selection &&
    state.timeDays === prev.timeDays &&
    state.playing === prev.playing &&
    state.speedDaysPerSec === prev.speedDaysPerSec
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
