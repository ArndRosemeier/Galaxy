/**
 * One way to turn a thrown thing into a sentence.
 *
 * Every UI error surface (the inspector's error card, the copy toast, the clock's
 * out-of-range note) reads its message through here, so a user never sees
 * "[object Object]" in a panel.
 */

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const text = String(error);
  return text === '[object Object]' ? 'unknown error (see the console)' : text;
}
