/**
 * Share links and seed text — the pure part of the "copy this galaxy" affordance.
 *
 * A share link is the app's whole state: the seed, every slider, the simulation day and
 * where you are in the atlas (`encodeState`). The origin and pathname come from the
 * page, so the UI never guesses where it is deployed.
 */

import { encodeState } from '../app/state';
import type { AppState } from '../app/state';

export interface ShareBase {
  readonly origin: string;
  readonly pathname: string;
}

/** `?seed=…&systems=…` under the current origin/path — the string the copy button writes. */
export function shareUrl(state: AppState, base: ShareBase): string {
  return `${base.origin}${base.pathname}${encodeState(state)}`;
}

/** `decodeState` truncates seeds at 64 characters; the field must not offer more. */
export const SEED_MAX_LENGTH = 64;

/** Trim and collapse whitespace, then cap — what the seed field actually commits. */
export function normalizeSeed(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, SEED_MAX_LENGTH);
}

/**
 * Display form of a seed: long seeds keep their head and tail so two similar seeds are
 * still distinguishable in a chip. The full text always lives in the field itself.
 */
export function displaySeed(seed: string, max = 26): string {
  const text = seed.trim();
  if (text.length <= max) return text;
  const tail = 6;
  const head = Math.max(1, max - tail - 1);
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}
