import { describe, expect, it, vi } from 'vitest';

import {
  AppStore,
  decodeState,
  encodeState,
  findPlanet,
  INITIAL_STATE,
  SystemCache,
} from '../../src/app/state';
import { generateSystem } from '../../src/sim';
import { DEFAULT_PARAMS } from '../../src/sim/params';

describe('app state', () => {
  it('clamps params through every entry point', () => {
    const store = new AppStore();
    store.setParams({ systemCount: 9999, arms: -3 });
    expect(store.state.params.systemCount).toBeLessThanOrEqual(600);
    expect(store.state.params.arms).toBeGreaterThanOrEqual(2);
  });

  it('notifies once per real change and stays quiet on a no-op', () => {
    const store = new AppStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setView('system');
    expect(listener).toHaveBeenCalledTimes(1);
    store.setView('system');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not re-enter when a listener dispatches', () => {
    const store = new AppStore();
    let calls = 0;
    store.subscribe((state) => {
      calls += 1;
      if (state.view === 'system') store.setView('planet');
    });
    store.setView('system');
    expect(calls).toBe(2);
    expect(store.state.view).toBe('planet');
  });

  it('round-trips a shared link', () => {
    const state = {
      ...INITIAL_STATE,
      params: { ...DEFAULT_PARAMS, seed: 'vela reach', systemCount: 222, arms: 5 },
      view: 'system' as const,
      selection: { systemId: 'sys-7', planetId: 'p-2', moonId: null },
      timeDays: 123.456,
    };
    const query = encodeState(state);
    const patch = decodeState(query);
    expect(patch.params?.seed).toBe('vela reach');
    expect(patch.params?.systemCount).toBe(222);
    expect(patch.params?.arms).toBe(5);
    expect(patch.view).toBe('system');
    expect(patch.selection?.systemId).toBe('sys-7');
    expect(patch.timeDays).toBeCloseTo(123.456, 3);
  });

  it('drops invalid values instead of guessing', () => {
    const patch = decodeState('?systems=not-a-number&view=hyperspace&t=-4');
    expect(patch.params).toBeUndefined();
    expect(patch.view).toBeUndefined();
    expect(patch.timeDays).toBeUndefined();
  });

  it('keys the deep cache on the stub, not just its id — the stale-world hazard', () => {
    const stub = {
      id: 's-1',
      name: 'Test',
      position: { x: 0, y: 0, z: 0 },
      spectral: 'G' as const,
      color: [1, 1, 0.9] as const,
      brightness: 0.7,
      seed: 42,
      context: { metallicity: 0.5, ageGyr: 8.6, lifeChance: 0.25, hazard: 0.35 },
    };
    const cache = new SystemCache();
    const first = cache.get(stub, generateSystem);
    // Same id, different world: a param change alters the spectral class and context.
    const changed = cache.get({ ...stub, spectral: 'M' as const }, generateSystem);
    expect(changed.star.spectral).toBe('M');
    expect(changed).not.toBe(first);
    expect(cache.size).toBe(2);
  });

  it('finds a planet by id and resolves nothing for a dangling id', () => {
    const stub = {
      id: 's-2',
      name: 'Find',
      position: { x: 0, y: 0, z: 0 },
      spectral: 'K' as const,
      color: [1, 0.8, 0.6] as const,
      brightness: 0.6,
      seed: 7,
    };
    const system = generateSystem(stub);
    const planet = system.planets[0];
    expect(planet).toBeDefined();
    if (!planet) return;
    expect(findPlanet(system, planet.id)).toBe(planet);
    expect(findPlanet(system, 'not-a-planet')).toBeNull();
    expect(findPlanet(null, planet.id)).toBeNull();
  });
});
