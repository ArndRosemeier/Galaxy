/**
 * The masthead: the wordmark, the one-line description of what this is, and the galaxy's
 * seed as a chip with its copy-link button.
 *
 * The seed chip is the identity of the place you are looking at, so it stays visible
 * even when the parameters panel is collapsed.
 */

import type { AppState } from '../app/state';
import { el, icon, setAttr, setText } from './dom';
import { displaySeed } from './share';

export interface BrandPanel {
  readonly el: HTMLElement;
  update(state: AppState): void;
}

export function createBrand(onCopy: () => void): BrandPanel {
  const seedValue = el('span', { class: 'gx-seed__value mono' });
  const copyButton = el(
    'button',
    {
      class: 'gx-seed__copy',
      attrs: {
        type: 'button',
        'data-testid': 'copy-link',
        'aria-label': 'Copy a link to this galaxy',
        'aria-keyshortcuts': 'C',
        title: 'Copy a link to this galaxy',
      },
    },
    icon('copy'),
  );
  copyButton.addEventListener('click', onCopy);

  const seedChip = el(
    'div',
    { class: 'gx-seed' },
    el('span', { class: 'gx-seed__tag', text: 'seed' }),
    seedValue,
    copyButton,
  );

  const el_ = el(
    'header',
    { class: 'gx-brand' },
    el(
      'div',
      { class: 'gx-brand__line' },
      el('h1', { class: 'brand__name', text: 'Galaxy' }),
      el('p', { class: 'brand__sub', text: 'A procedural atlas' }),
    ),
    seedChip,
  );

  return {
    el: el_,
    update(state: AppState): void {
      const seed = state.params.seed;
      setText(seedValue, displaySeed(seed));
      setAttr(seedValue, 'title', seed);
      seedChip.dataset.seed = seed;
    },
  };
}
