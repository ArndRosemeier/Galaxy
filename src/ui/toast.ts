/**
 * A single transient message — copy confirmations and copy failures.
 *
 * `role="status"` so a screen reader hears it without stealing focus; it never covers a
 * control and it hides itself.
 */

import { el, setAttr, setText } from './dom';

export type ToastTone = 'info' | 'error';

export interface Toast {
  readonly el: HTMLElement;
  show(message: string, tone?: ToastTone): void;
  dispose(): void;
}

const VISIBLE_MS = 2800;

export function createToast(): Toast {
  const text = el('span', { class: 'gx-toast__text' });
  const node = el(
    'div',
    {
      class: 'gx-toast',
      attrs: {
        role: 'status',
        'aria-live': 'polite',
        'data-tone': 'info',
        hidden: true,
      },
    },
    el('span', { class: 'gx-toast__dot', attrs: { 'aria-hidden': 'true' } }),
    text,
  );

  let timer: ReturnType<typeof setTimeout> | null = null;

  const hide = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    setAttr(node, 'hidden', '');
  };

  return {
    el: node,
    show(message: string, tone: ToastTone = 'info'): void {
      if (timer !== null) clearTimeout(timer);
      setText(text, message);
      setAttr(node, 'data-tone', tone);
      node.hidden = false;
      timer = setTimeout(hide, VISIBLE_MS);
    },
    dispose(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
