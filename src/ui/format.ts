/**
 * Human number formatting — the one place a raw sim value becomes something a person
 * reads. Every panel routes its numbers through here, so the inspector can never show
 * `NaN`, `undefined` or `4478.6999999`.
 *
 * Rules:
 *  - Group thousands with commas, always with an explicit locale-independent format
 *    (no `Intl`, so node and the browser agree).
 *  - Pick precision from magnitude: a 71,492 km radius does not need decimals, a
 *    0.387 AU orbit does.
 *  - A non-finite value is a data defect, not something to mask: the formatter throws
 *    (`docs/ARCHITECTURE.md` "Failure behaviour" and `AGENTS.md` rule 1). The inspector
 *    turns that throw into a visible error card.
 */

import type { Rgb } from '../sim/types';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Simulation day 0 is J2000.0 — the epoch the rest of astronomy also counts from. */
const SIM_EPOCH_MS = Date.UTC(2000, 0, 1, 0, 0, 0, 0);
const MS_PER_DAY = 86_400_000;
const MINUS = '\u2212';

function finite(value: number, what: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`ui format: ${what} is not a finite number (${String(value)})`);
  }
  return value;
}

/** `1234.5` → `"1,234.5"`; negative values use a typeset minus, not a hyphen. */
export function groupDigits(value: number, decimals = 0): string {
  finite(value, 'value');
  const magnitude = Math.abs(value).toFixed(decimals);
  const dot = magnitude.indexOf('.');
  const whole = dot === -1 ? magnitude : magnitude.slice(0, dot);
  const fraction = dot === -1 ? '' : magnitude.slice(dot + 1);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = value < 0 && Number(magnitude) !== 0 ? MINUS : '';
  return fraction === '' ? `${sign}${grouped}` : `${sign}${grouped}.${fraction}`;
}

export function formatCount(value: number): string {
  return groupDigits(value, 0);
}

/** A distance in km without its unit, for ranges and compound sentences. */
function kilometreNumber(km: number): string {
  const abs = Math.abs(finite(km, 'distance'));
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return groupDigits(km, decimals);
}

/** Radius in km: finer precision for small moons, whole kilometres for planets. */
export function formatKilometres(km: number): string {
  return `${kilometreNumber(km)} km`;
}

/** `9,000–14,000 km` — a unit on the end, not on both numbers. */
export function formatKilometreRange(innerKm: number, outerKm: number): string {
  return `${kilometreNumber(innerKm)}–${kilometreNumber(outerKm)} km`;
}

/** Ring thickness: metres while it is below a kilometre, which it almost always is. */
export function formatThickness(km: number): string {
  const abs = Math.abs(finite(km, 'thickness'));
  if (abs < 1) {
    const metres = km * 1000;
    const sized = Math.abs(metres);
    return `${groupDigits(metres, sized >= 10 ? 0 : sized >= 1 ? 1 : 2)} m`;
  }
  return `${kilometreNumber(km)} km`;
}

/** Mass in Earth masses, spelled so it reads as a comparison rather than a code. */
export function formatEarthMasses(massEarth: number): string {
  const abs = Math.abs(finite(massEarth, 'mass'));
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${groupDigits(massEarth, decimals)} × Earth`;
}

export function formatGravity(gravityG: number): string {
  const abs = Math.abs(finite(gravityG, 'gravity'));
  return `${groupDigits(gravityG, abs >= 10 ? 1 : 2)} m/s²`;
}

export function formatKelvin(kelvin: number): string {
  return `${groupDigits(finite(kelvin, 'temperature'), 0)} K`;
}

/** Kelvin is the physical unit; Celsius is what most visitors actually feel. */
export function formatTemperature(kelvin: number): string {
  finite(kelvin, 'temperature');
  return `${groupDigits(kelvin, 0)} K (${groupDigits(kelvin - 273.15, 0)} °C)`;
}

/** Sidereal day. Long days switch to days; negative rotation is named, not signed. */
export function formatDayLength(hours: number): string {
  finite(hours, 'day length');
  const abs = Math.abs(hours);
  const suffix = hours < 0 ? ' · retrograde' : '';
  if (abs >= 100) {
    const days = abs / 24;
    const decimals = days >= 100 ? 0 : days >= 10 ? 1 : 2;
    return `${groupDigits(days, decimals)} d${suffix}`;
  }
  return `${groupDigits(abs, abs >= 10 ? 1 : 2)} h${suffix}`;
}

/** Orbital period in days, promoted to years once it stops being readable. */
export function formatYearLength(days: number): string {
  finite(days, 'year length');
  if (days >= 1000) {
    const years = days / 365.25;
    const decimals = years >= 100 ? 0 : years >= 10 ? 1 : 2;
    return `${groupDigits(years, decimals)} yr`;
  }
  return `${groupDigits(days, days >= 10 ? 0 : 1)} d`;
}

export function formatAu(au: number): string {
  const abs = Math.abs(finite(au, 'distance'));
  const decimals = abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return `${groupDigits(au, decimals)} AU`;
}

/** `0.39–2.10 AU` — the span of a belt, one precision, the unit written once. */
export function formatAuRange(innerAu: number, outerAu: number): string {
  const scale = Math.max(Math.abs(finite(innerAu, 'inner distance')), Math.abs(finite(outerAu, 'outer distance')));
  const decimals = scale >= 10 ? 1 : scale >= 1 ? 2 : 3;
  return `${groupDigits(innerAu, decimals)}–${groupDigits(outerAu, decimals)} AU`;
}

export function formatPercent(fraction: number, decimals = 0): string {
  return `${groupDigits(finite(fraction, 'fraction') * 100, decimals)}%`;
}

/** A gas fraction: 78%, 3.0%, 0.03% — enough digits to see the trace gases. */
export function formatFraction(fraction: number): string {
  const pct = finite(fraction, 'fraction') * 100;
  const decimals = pct >= 10 ? 0 : pct >= 1 ? 1 : 2;
  return `${groupDigits(pct, decimals)}%`;
}

export function formatPressure(atm: number): string {
  finite(atm, 'pressure');
  if (atm === 0) return '0 atm';
  if (Math.abs(atm) < 0.001) return '< 0.001 atm';
  const abs = Math.abs(atm);
  const decimals = abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return `${groupDigits(atm, decimals)} atm`;
}

/** `+33 K greenhouse` — a sentence fragment, because the sign carries the meaning. */
export function formatGreenhouse(kelvin: number): string {
  finite(kelvin, 'greenhouse');
  if (Math.abs(kelvin) < 0.5) return 'no greenhouse warming';
  const sign = kelvin > 0 ? '+' : MINUS;
  return `${sign}${groupDigits(Math.abs(kelvin), 0)} K greenhouse`;
}

export function formatSolarRadius(radiusSun: number): string {
  const abs = Math.abs(finite(radiusSun, 'stellar radius'));
  const decimals = abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return `${groupDigits(radiusSun, decimals)} R☉`;
}

export function formatSolarMass(massSun: number): string {
  const abs = Math.abs(finite(massSun, 'stellar mass'));
  return `${groupDigits(massSun, abs >= 10 ? 1 : 2)} M☉`;
}

export function formatLuminosity(luminositySun: number): string {
  const abs = Math.abs(finite(luminositySun, 'luminosity'));
  const decimals = abs >= 1000 ? 0 : abs >= 10 ? 1 : abs >= 0.01 ? 2 : 4;
  return `${groupDigits(luminositySun, decimals)} L☉`;
}

/** Simulation clock, day form: always at least one decimal so it visibly advances. */
export function formatSimDay(days: number): string {
  return `Day ${groupDigits(Math.max(0, finite(days, 'simulation time')), 1)}`;
}

/** Simulation clock, calendar form: `14 May 2003`, UTC so it never depends on locale. */
export function formatSimDate(days: number): string {
  const date = new Date(SIM_EPOCH_MS + Math.max(0, finite(days, 'simulation time')) * MS_PER_DAY);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`ui format: simulation time is out of range (${String(days)} days)`);
  }
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]!} ${date.getUTCFullYear()}`;
}

const SUBSCRIPTS: Readonly<Record<string, string>> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
};

/** `H2O` → `H₂O`; the sim stores formulae, the panel sets them like a chemist. */
export function chemicalFormula(gas: string): string {
  return gas.replace(/\d/g, (digit) => SUBSCRIPTS[digit] ?? digit);
}

/** Linear-space sim colour → a CSS sRGB triplet (the sim never stores sRGB). */
export function cssColor(rgb: Rgb): string {
  const [red, green, blue] = rgb;
  finite(red, 'colour.red');
  finite(green, 'colour.green');
  finite(blue, 'colour.blue');
  return `rgb(${encodeSrgb(red)}, ${encodeSrgb(green)}, ${encodeSrgb(blue)})`;
}

function encodeSrgb(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  const encoded =
    clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}
