/**
 * Keyboard dispatch — pure, so the shortcut map has exactly one home and can be tested
 * without a browser.
 *
 * Rules that matter to a visitor:
 *  - Shortcuts never fire while a text field has focus (typing "r" in the seed field
 *    must not reroll the galaxy).
 *  - Space belongs to whatever button or slider is focused; only an unfocused Space
 *    plays/pauses.
 *  - The handler is registered before `main.ts`'s own Escape listener and calls
 *    `preventDefault()`, so Escape travels back exactly one level.
 */

export type Shortcut = 'play' | 'back' | 'randomize' | 'copy' | 'help';

/** The bits of a `KeyboardEvent` the map needs. */
export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly repeat?: boolean;
}

/** The bits of the focused element that change what a key means. */
export interface KeyContext {
  /** A text entry (`<input type="text">`, textarea, select, contenteditable). */
  readonly textEditable: boolean;
  /** An element that already uses Space to activate itself (button, link, slider). */
  readonly spaceOwner: boolean;
}

/** Classify the focused element: where text goes in, and who owns Space. */
export function keyContext(target: {
  readonly tagName: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
}): KeyContext {
  const tag = target.tagName.toUpperCase();
  const type = (target.type ?? '').toLowerCase();
  const contentEditable = target.isContentEditable === true;

  if (tag === 'TEXTAREA' || contentEditable) {
    return { textEditable: true, spaceOwner: true };
  }
  if (tag === 'SELECT') {
    return { textEditable: true, spaceOwner: true };
  }
  if (tag === 'INPUT') {
    // Range, checkbox, radio and button inputs cannot hold text, so letter shortcuts
    // still work while one is focused; they do own Space and Enter.
    const typing = !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'].includes(
      type,
    );
    return { textEditable: typing, spaceOwner: true };
  }
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') {
    return { textEditable: false, spaceOwner: true };
  }
  return { textEditable: false, spaceOwner: false };
}

/** Resolve a keydown to an app action, or `null` if the app should leave it alone. */
export function shortcutFor(event: KeyEventLike, context: KeyContext): Shortcut | null {
  if (context.textEditable) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.repeat) return null;
  switch (event.key) {
    case ' ':
    case 'Spacebar':
      return context.spaceOwner ? null : 'play';
    case 'Escape':
      return 'back';
    case 'r':
    case 'R':
      return 'randomize';
    case 'c':
    case 'C':
      return 'copy';
    case '?':
      return 'help';
    default:
      return null;
  }
}

/** The speeds the time bar offers, in simulated days per wall-clock second. */
export const SPEED_STEPS: readonly number[] = [0, 1, 2, 10, 50];

/** Speed labels: whole numbers, no unit — the group's aria-label carries "days/second". */
export function speedLabel(daysPerSecond: number): string {
  if (!Number.isFinite(daysPerSecond) || daysPerSecond < 0) {
    throw new Error(`ui: invalid simulation speed (${String(daysPerSecond)})`);
  }
  return String(Math.round(daysPerSecond));
}
