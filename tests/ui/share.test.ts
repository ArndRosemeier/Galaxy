import { describe, expect, it } from 'vitest';

import { INITIAL_STATE } from '../../src/app/state';
import { DEFAULT_PARAMS } from '../../src/sim/params';
import { displaySeed, normalizeSeed, SEED_MAX_LENGTH, shareUrl } from '../../src/ui/share';

describe('share links and seeds', () => {
  it('builds a link under the current origin and path', () => {
    const state = {
      ...INITIAL_STATE,
      params: { ...DEFAULT_PARAMS, seed: 'vela reach' },
      view: 'planet' as const,
      selection: { systemId: 'sys-7', planetId: 'sys-7-p2', moonId: null },
      timeDays: 42,
    };
    const link = shareUrl(state, { origin: 'https://galaxy.test', pathname: '/atlas/' });
    expect(link.startsWith('https://galaxy.test/atlas/?')).toBe(true);
    expect(link).toContain('seed=vela+reach');
    expect(link).toContain('view=planet');
    expect(link).toContain('system=sys-7');
    expect(link).toContain('planet=sys-7-p2');
    expect(link).toContain('t=42');
    expect(link).not.toContain('//?');
  });

  it('keeps the galaxy link free of view/selection noise', () => {
    const link = shareUrl(INITIAL_STATE, { origin: 'https://galaxy.test', pathname: '/' });
    expect(link.startsWith('https://galaxy.test/?seed=pleiades')).toBe(true);
    expect(link).not.toContain('view=');
    expect(link).not.toContain('system=');
  });

  it('normalises typed seed text', () => {
    expect(normalizeSeed('  vela   reach  ')).toBe('vela reach');
    expect(normalizeSeed('')).toBe('');
    expect(normalizeSeed('   ')).toBe('');
    expect(normalizeSeed('x'.repeat(200))).toHaveLength(SEED_MAX_LENGTH);
  });

  it('shortens only what is too long to show', () => {
    expect(displaySeed('pleiades')).toBe('pleiades');
    expect(displaySeed('  pleiades ')).toBe('pleiades');
    const long = 'andromeda-reach-ngc-224-vela-nine';
    const shown = displaySeed(long, 20);
    expect(shown).toHaveLength(20);
    expect(shown).toContain('…');
    expect(shown.startsWith('andromeda')).toBe(true);
    expect(shown.endsWith(long.slice(-5))).toBe(true);
  });
});
