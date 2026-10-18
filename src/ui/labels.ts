/**
 * Vocabulary — the words the panels use for sim values. One copy, so a kind or a life
 * level is named the same way in the planet list, the dossier and a screen reader.
 */

import type { GalaxyParams, LifeLevel, PlanetKind, SpectralClass } from '../sim/types';
import { formatCount, groupDigits } from './format';

const KIND_LABELS: Record<PlanetKind, string> = {
  terrestrial: 'Terrestrial',
  ocean: 'Ocean world',
  desert: 'Desert world',
  ice: 'Ice world',
  lava: 'Lava world',
  toxic: 'Toxic world',
  barren: 'Barren world',
  gas: 'Gas giant',
  icegiant: 'Ice giant',
};

export function kindLabel(kind: PlanetKind): string {
  return KIND_LABELS[kind];
}

const LIFE_LABELS: Record<LifeLevel, string> = {
  none: 'No detected life',
  microbial: 'Microbial life',
  flora: 'Plant life',
  fauna: 'Animal life',
  civilization: 'Civilization',
};

export function lifeLabel(level: LifeLevel): string {
  return LIFE_LABELS[level];
}

/** What the spectral class tells a person, not just its letter. */
const SPECTRAL_NOTES: Record<SpectralClass, string> = {
  O: 'hot blue giant',
  B: 'blue-white giant',
  A: 'white star',
  F: 'yellow-white star',
  G: 'yellow star',
  K: 'orange dwarf',
  M: 'red dwarf',
  WD: 'white dwarf',
  NS: 'neutron star',
  BH: 'black hole',
};

export function spectralNote(spectral: SpectralClass): string {
  return SPECTRAL_NOTES[spectral];
}

const ARM_WORDS: Record<number, string> = {
  2: 'two-armed',
  3: 'three-armed',
  4: 'four-armed',
  5: 'five-armed',
  6: 'six-armed',
};

/** One human sentence about the galaxy, used by the inspector's empty state. */
export function galaxySummary(params: GalaxyParams): string {
  const arms = ARM_WORDS[params.arms] ?? `${formatCount(params.arms)}-armed`;
  return `A ${arms} spiral of ${formatCount(params.systemCount)} star systems, ${groupDigits(
    params.ageGyr,
    1,
  )} billion years old.`;
}

/** The one-line gesture hint. Touch devices cannot scroll-zoom or press Esc. */
export function interactionHint(compact: boolean): string {
  return compact
    ? 'drag to orbit · pinch to zoom · tap to select'
    : 'drag to orbit · scroll to zoom · click to select · Esc to go back';
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}
