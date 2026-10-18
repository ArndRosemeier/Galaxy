/**
 * Small numeric helpers shared by generation. Pure, deterministic, and loud: a
 * non-finite value is a bug in the caller, never something to paper over with a
 * default.
 */

/** Constrain `value` to `[min, max]`. Throws on a non-finite value or an empty range. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`clamp: value is not finite (${String(value)})`);
  }
  if (!(min <= max)) {
    throw new Error(`clamp: empty range [${min}, ${max}]`);
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Round to `decimals` decimal places. Rounding is part of the determinism contract:
 * stored numbers are rounded exactly once, at the boundary, so two runs serialise the
 * same digits.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`roundTo: value is not finite (${String(value)})`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    throw new Error(`roundTo: invalid decimals (${String(decimals)})`);
  }
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Round to `digits` significant digits. Used for values spanning many magnitudes. */
export function roundSig(value: number, digits: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`roundSig: value is not finite (${String(value)})`);
  }
  if (!Number.isInteger(digits) || digits < 1 || digits > 15) {
    throw new Error(`roundSig: invalid digits (${String(digits)})`);
  }
  if (value === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = 10 ** (digits - 1 - magnitude);
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** A human percentage (0..100) from a 0..1 fraction, rounded to a whole number. */
export function percent(fraction: number): number {
  return Math.round(clamp(fraction, 0, 1) * 100);
}
