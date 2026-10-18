import { describe, expect, it } from 'vitest';

import { INITIAL_STATE } from '../../src/app/state';
import type { AppState, Selection } from '../../src/app/state';
import { DEFAULT_PARAMS, PRESETS, clampParams, generateGalaxy, generateSystem } from '../../src/sim';
import {
  NO_SELECTION,
  activePresetId,
  applyPreset,
  commitSeed,
  goToGalaxy,
  goToSystem,
  resetShape,
  sameParams,
  selectPlanet,
  toggleMoon,
} from '../../src/ui/actions';
import type { UiActions, UiStore } from '../../src/ui/types';

interface FakeApp {
  readonly app: UiActions;
  readonly calls: string[];
  readonly state: AppState;
}

/** A fake that mirrors the controller's state transitions, so click paths are real. */
function createFakeApp(initial: AppState): FakeApp {
  let current = initial;
  const calls: string[] = [];
  const store: UiStore = {
    get state(): AppState {
      return current;
    },
    subscribe(): () => void {
      return () => undefined;
    },
  };
  const app: UiActions = {
    store,
    setParams(patch): void {
      calls.push('setParams');
      current = {
        ...current,
        params: clampParams({ ...current.params, ...patch }),
        selection: NO_SELECTION,
        view: 'galaxy',
      };
    },
    randomizeSeed(): void {
      calls.push('randomizeSeed');
    },
    select(selection: Selection): void {
      calls.push('select');
      current = { ...current, selection };
    },
    setView(view): void {
      calls.push('setView');
      current = { ...current, view };
    },
    setPlaying(playing): void {
      current = { ...current, playing };
    },
    setSpeed(speedDaysPerSec): void {
      current = { ...current, speedDaysPerSec };
    },
    setTime(timeDays): void {
      current = { ...current, timeDays };
    },
    back(): void {
      calls.push('back');
      if (current.view === 'planet') {
        current = {
          ...current,
          view: 'system',
          selection: { ...current.selection, planetId: null, moonId: null },
        };
      } else if (current.view === 'system') {
        current = { ...current, view: 'galaxy', selection: NO_SELECTION };
      }
    },
  };
  return {
    app,
    calls,
    get state(): AppState {
      return current;
    },
  };
}

const galaxy = generateGalaxy(DEFAULT_PARAMS);
const stub = galaxy.systems[0]!;
const system = generateSystem(stub);
const planet = system.planets[0]!;

function systemState(): AppState {
  return {
    ...INITIAL_STATE,
    view: 'system',
    selection: { systemId: stub.id, planetId: null, moonId: null },
  };
}

describe('ui actions', () => {
  it('opens a planet by selecting it first, then changing the view', () => {
    const fake = createFakeApp(systemState());
    selectPlanet(fake.app, planet);
    expect(fake.state.selection).toEqual({ systemId: stub.id, planetId: planet.id, moonId: null });
    expect(fake.state.view).toBe('planet');
    expect(fake.calls).toEqual(['select', 'setView']);
  });

  it('refuses to open a planet when no system is selected', () => {
    const fake = createFakeApp(INITIAL_STATE);
    expect(() => selectPlanet(fake.app, planet)).toThrow(/no system selected/);
  });

  it('toggles a moon selection', () => {
    const moon = planet.moons[0];
    if (moon) {
      const fake = createFakeApp({
        ...systemState(),
        view: 'planet',
        selection: { systemId: stub.id, planetId: planet.id, moonId: null },
      });
      toggleMoon(fake.app, moon.id);
      expect(fake.state.selection.moonId).toBe(moon.id);
      toggleMoon(fake.app, moon.id);
      expect(fake.state.selection.moonId).toBeNull();
    }
  });

  it('walks up one level at a time', () => {
    const fake = createFakeApp({
      ...INITIAL_STATE,
      view: 'planet',
      selection: { systemId: stub.id, planetId: planet.id, moonId: null },
    });
    goToSystem(fake.app);
    expect(fake.state.view).toBe('system');
    expect(fake.state.selection.planetId).toBeNull();
    goToSystem(fake.app);
    expect(fake.state.view).toBe('system');
    goToGalaxy(fake.app);
    expect(fake.state.view).toBe('galaxy');
    expect(fake.state.selection).toEqual(NO_SELECTION);
  });

  it('applies a preset wholesale and recognises it again', () => {
    const preset = PRESETS[0]!;
    const fake = createFakeApp(INITIAL_STATE);
    applyPreset(fake.app, preset);
    expect(fake.state.params).toEqual(preset.params);
    expect(activePresetId(fake.state)).toBe(preset.id);
    expect(sameParams(fake.state.params, preset.params)).toBe(true);
    expect(activePresetId({ ...fake.state, params: DEFAULT_PARAMS })).toBeNull();
  });

  it('commits typed seed text only when it is a real change', () => {
    const fake = createFakeApp(INITIAL_STATE);
    expect(commitSeed(fake.app, '   ')).toBe(false);
    expect(commitSeed(fake.app, DEFAULT_PARAMS.seed)).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(commitSeed(fake.app, '  vela   reach ')).toBe(true);
    expect(fake.state.params.seed).toBe('vela reach');
  });

  it('resets the shape controls without touching the seed', () => {
    const fake = createFakeApp({
      ...INITIAL_STATE,
      params: clampParams({ ...DEFAULT_PARAMS, seed: 'my-seed', arms: 6, systemCount: 590 }),
    });
    resetShape(fake.app);
    expect(fake.state.params.seed).toBe('my-seed');
    expect(fake.state.params.arms).toBe(DEFAULT_PARAMS.arms);
    expect(fake.state.params.systemCount).toBe(DEFAULT_PARAMS.systemCount);
  });
});
