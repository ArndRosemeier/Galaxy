/**
 * The shortcut overlay (`?`).
 *
 * A modal dialog: focus moves to the close button, Tab cycles inside the card, Escape
 * closes it, and focus returns to whatever opened it. The keydown that opens and closes
 * it belongs to `index.ts`, which also owns the focus trap call.
 */

import { el, icon } from './dom';

const SHORTCUTS: readonly (readonly [string, string])[] = [
  ['Space', 'play or pause time'],
  ['Esc', 'go back one level'],
  ['R', 'randomize the seed'],
  ['C', 'copy a share link'],
  ['?', 'this list'],
  ['Drag', 'orbit the scene'],
  ['Scroll · pinch', 'zoom in on a place'],
  ['Click · tap', 'select a star or planet'],
];

export interface HelpOverlay {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  /** Trap Tab inside the card while the dialog is open. */
  trapTab(event: KeyboardEvent): void;
}

export function createHelpOverlay(): HelpOverlay {
  const closeButton = el(
    'button',
    {
      class: 'panel__close gx-help__close',
      attrs: { type: 'button', 'aria-label': 'Close keyboard shortcuts' },
    },
    icon('close'),
  );

  const keys = el('dl', { class: 'gx-keys' });
  for (const [key, meaning] of SHORTCUTS) {
    keys.append(
      el(
        'div',
        { class: 'gx-keys__row' },
        el('dt', {}, el('kbd', { text: key })),
        el('dd', { text: meaning }),
      ),
    );
  }

  const card = el(
    'div',
    {
      class: 'panel gx-help__card',
      attrs: { role: 'document' },
    },
    el(
      'div',
      { class: 'panel__head' },
      el('h2', { class: 'panel__title', attrs: { id: 'gx-help-title' }, text: 'Keys & gestures' }),
      closeButton,
    ),
    el(
      'div',
      { class: 'panel__body' },
      keys,
      el('p', {
        class: 'field__hint gx-help__note',
        text: 'Share links carry the seed, every slider and where you are in the galaxy.',
      }),
    ),
  );

  const backdrop = el(
    'div',
    {
      class: 'gx-help',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'gx-help-title',
        'data-testid': 'help-overlay',
        hidden: true,
      },
    },
    card,
  );

  let open = false;
  let lastFocus: HTMLElement | null = null;

  const close = (): void => {
    if (!open) return;
    open = false;
    backdrop.hidden = true;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  };

  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });

  return {
    el: backdrop,
    get isOpen(): boolean {
      return open;
    },
    open(): void {
      if (open) return;
      open = true;
      lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      backdrop.hidden = false;
      requestAnimationFrame(() => {
        if (open) closeButton.focus();
      });
    },
    close,
    trapTab(event: KeyboardEvent): void {
      if (!open) return;
      const focusable = [...card.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')]
        .filter((node) => !node.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !card.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !card.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    },
  };
}
