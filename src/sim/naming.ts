/**
 * Names — the atlas layer.
 *
 * A galaxy has to read like a star atlas, not like a hash dump: catalogue codes, named
 * reaches, possessives, Greek letters over constellations. Names are generated from the
 * same seeded stream as everything else, and every public generator here is
 * *deterministic under collision*: a duplicate is retried, then resolved with a
 * numbered suffix, never by an unbounded search or a global mutable registry.
 */

import { Rng, type Weighted } from './rng';

const ROOTS = [
  'Acheron', 'Adeon', 'Aether', 'Alcyon', 'Aldera', 'Almach', 'Altair', 'Amber',
  'Ankaa', 'Arcadia', 'Argus', 'Astra', 'Avalon', 'Bastion', 'Borealis', 'Caelum',
  'Caldera', 'Camber', 'Carina', 'Cepheus', 'Cinder', 'Cirrus', 'Corvus', 'Cressida',
  'Cygnus', 'Draco', 'Elysium', 'Ember', 'Eos', 'Fornax', 'Galatea', 'Gorgon',
  'Helios', 'Hyperion', 'Icarus', 'Ignis', 'Iris', 'Kestrel', 'Kepler', 'Lacerta',
  'Lumen', 'Lyra', 'Mira', 'Nadir', 'Nereid', 'Nyx', 'Oberon', 'Orion',
  'Osiris', 'Pavo', 'Perseus', 'Phoenix', 'Pyxis', 'Rasal', 'Rigel', 'Sabik',
  'Sable', 'Selene', 'Seren', 'Sirius', 'Solace', 'Somnus', 'Tethys', 'Thalassa',
  'Titania', 'Tycho', 'Umbriel', 'Vega', 'Vela', 'Vesper', 'Vulcan', 'Wren',
  'Xanthe', 'Yggdrasil', 'Zephyr', 'Zenith',
] as const;

const NOUNS = [
  'Reach', 'Lantern', 'Hollow', 'Drift', 'Gate', 'Veil', 'Cradle', 'Spire',
  'Expanse', 'Shoal', 'March', 'Refuge', 'Crown', 'Throne', 'Haven', 'Bastion',
  'Verge', 'Deep', 'Wake', 'Shroud', 'Fount', 'Marrow', 'Anchor', 'Bloom',
  'Passage', 'Rift', 'Watch', 'Ember', 'Tide', 'Cairn',
] as const;

const GREEK = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi',
  'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
] as const;

const CONSTELLATIONS = [
  'Andromedae', 'Aquilae', 'Aurigae', 'Bootis', 'Cancri', 'Canis', 'Carinae',
  'Cassiopeiae', 'Centauri', 'Ceti', 'Columbae', 'Coronae', 'Corvi', 'Cygni',
  'Draconis', 'Eridani', 'Geminorum', 'Herculis', 'Hydrae', 'Leonis', 'Lupi',
  'Lyrae', 'Mensae', 'Normae', 'Octantis', 'Orionis', 'Pavonis', 'Pegasi',
  'Persei', 'Phoenicis', 'Piscis', 'Sagittarii', 'Scorpii', 'Serpentis', 'Tauri',
  'Tucanae', 'Ursae', 'Velorum', 'Virginis',
] as const;

const CATALOGUE_PREFIXES = [
  'KX', 'VY', 'GJ', 'HD', 'TY', 'RX', 'ZP', 'AQ', 'BN', 'CL',
  'DK', 'EF', 'GR', 'HS', 'JL', 'KM', 'NP', 'QR', 'ST', 'UZ',
  'VH', 'WK', 'XN', 'YR', 'ZB', 'AC', 'BD', 'CE', 'DF', 'EG',
] as const;

/** The name patterns a star can take. */
export type StarNameStyle = 'catalogue' | 'named' | 'possessive' | 'greek' | 'hyphenated';

const STYLE_WEIGHTS: readonly Weighted<StarNameStyle>[] = [
  { value: 'catalogue', weight: 0.38 },
  { value: 'named', weight: 0.27 },
  { value: 'possessive', weight: 0.11 },
  { value: 'greek', weight: 0.18 },
  { value: 'hyphenated', weight: 0.06 },
];

const MOON_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Roman numerals 1..3999, subtractive. Used for "<Star> I…XIV" planet names. */
export function romanNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3_999) {
    throw new Error(`romanNumeral: out of range (${String(value)})`);
  }
  const table: readonly (readonly [number, string])[] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let remaining = value;
  let out = '';
  for (const entry of table) {
    const [amount, glyph] = entry;
    while (remaining >= amount) {
      out += glyph;
      remaining -= amount;
    }
  }
  return out;
}

/** Generate one star name in a given style (a style is picked when omitted). */
export function starName(rng: Rng, style?: StarNameStyle): string {
  const chosen = style ?? rng.weighted(STYLE_WEIGHTS);
  switch (chosen) {
    case 'catalogue': {
      const prefix = rng.pick(CATALOGUE_PREFIXES);
      const number = rng.int(100, 9_999);
      return `${prefix}-${number}`;
    }
    case 'named':
      return `${rng.pick(ROOTS)} ${rng.pick(NOUNS)}`;
    case 'possessive':
      return `${rng.pick(ROOTS)}'s ${rng.pick(NOUNS)}`;
    case 'greek':
      return `${rng.pick(GREEK)} ${rng.pick(CONSTELLATIONS)}`;
    case 'hyphenated':
      return `${rng.pick(ROOTS)}-${rng.int(2, 96)}`;
    default:
      throw new Error(`starName: unknown style ${String(chosen)}`);
  }
}

/**
 * A star name that is not in `used`, added to `used`. Deterministic: a collision retries
 * a few times, then falls back to a numbered suffix, whose search is bounded by the
 * size of `used` and therefore always terminates.
 */
export function uniqueStarName(rng: Rng, used: Set<string>): string {
  const attempts = 24;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = starName(rng);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const base = starName(rng);
  const limit = used.size + 64;
  for (let suffix = 2; suffix <= limit; suffix += 1) {
    const candidate = `${base} ${romanNumeral(suffix)}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error(`uniqueStarName: deterministic suffix space exhausted (${used.size} in use)`);
}

/** `<Star> I…XIV` — `index` is 0-based, as planet arrays are. */
export function planetName(star: string, index: number): string {
  if (!star) throw new Error('planetName: empty star name');
  return `${star} ${romanNumeral(index + 1)}`;
}

/** `<Planet> a…h` — `index` is 0-based, as moon arrays are. */
export function moonName(planet: string, index: number): string {
  if (!planet) throw new Error('moonName: empty planet name');
  if (!Number.isInteger(index) || index < 0 || index >= MOON_LETTERS.length) {
    throw new Error(`moonName: index out of range (${String(index)})`);
  }
  return `${planet} ${MOON_LETTERS[index]}`;
}

/** The name of a system's asteroid or Kuiper-like belt. */
export function beltName(star: string, kind: 'asteroid' | 'kuiper'): string {
  if (!star) throw new Error('beltName: empty star name');
  if (kind === 'asteroid') return `${star} Asteroid Belt`;
  return `${star} Kuiper Belt`;
}
