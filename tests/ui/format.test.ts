import { describe, expect, it } from 'vitest';

import {
  chemicalFormula,
  cssColor,
  formatAu,
  formatAuRange,
  formatDayLength,
  formatEarthMasses,
  formatFraction,
  formatGravity,
  formatGreenhouse,
  formatKelvin,
  formatKilometreRange,
  formatKilometres,
  formatLuminosity,
  formatPercent,
  formatPressure,
  formatSimDate,
  formatSimDay,
  formatSolarMass,
  formatSolarRadius,
  formatTemperature,
  formatThickness,
  formatYearLength,
  groupDigits,
} from '../../src/ui/format';

describe('ui formatting', () => {
  it('groups thousands and keeps a typeset minus', () => {
    expect(groupDigits(1_234_567)).toBe('1,234,567');
    expect(groupDigits(1234.5, 1)).toBe('1,234.5');
    expect(groupDigits(-1234.5, 1)).toBe('\u22121,234.5');
    expect(groupDigits(-0.4, 0)).toBe('0');
    expect(groupDigits(0, 1)).toBe('0.0');
  });

  it('refuses to format a non-finite value', () => {
    expect(() => groupDigits(Number.NaN)).toThrow(/not a finite number/);
    expect(() => formatKelvin(Number.POSITIVE_INFINITY)).toThrow(/not a finite number/);
    expect(() => formatSimDate(Number.NaN)).toThrow(/not a finite number/);
  });

  it('formats the fields a person reads in the dossier', () => {
    expect(formatKilometres(6371)).toBe('6,371 km');
    expect(formatKilometres(0.5)).toBe('0.50 km');
    expect(formatKilometres(421_700)).toBe('421,700 km');
    expect(formatKilometreRange(12_000, 14_000)).toBe('12,000–14,000 km');
    expect(formatThickness(0.01)).toBe('10 m');
    expect(formatThickness(1.5)).toBe('1.50 km');

    expect(formatEarthMasses(1)).toBe('1.00 × Earth');
    expect(formatEarthMasses(317.8)).toBe('318 × Earth');
    expect(formatEarthMasses(0.05)).toBe('0.05 × Earth');

    expect(formatGravity(9.81)).toBe('9.81 m/s²');
    expect(formatGravity(24.79)).toBe('24.8 m/s²');

    expect(formatTemperature(288)).toBe('288 K (15 °C)');
    expect(formatTemperature(4478.6999999)).toBe('4,479 K (4,206 °C)');
    expect(formatKelvin(165)).toBe('165 K');

    expect(formatDayLength(14.2)).toBe('14.2 h');
    expect(formatDayLength(24)).toBe('24.0 h');
    expect(formatDayLength(-5832)).toBe('243 d · retrograde');

    expect(formatYearLength(365.25)).toBe('365 d');
    expect(formatYearLength(12.5)).toBe('13 d');
    expect(formatYearLength(4332.6)).toBe('11.9 yr');

    expect(formatAu(0.387)).toBe('0.387 AU');
    expect(formatAu(1)).toBe('1.00 AU');
    expect(formatAu(30.07)).toBe('30.1 AU');
    expect(formatAuRange(0.39, 2.1)).toBe('0.39–2.10 AU');

    expect(formatPercent(0.71)).toBe('71%');
    expect(formatPercent(0.015)).toBe('2%');
    expect(formatFraction(0.78)).toBe('78%');
    expect(formatFraction(0.03)).toBe('3.0%');
    expect(formatFraction(0.0003)).toBe('0.03%');

    expect(formatPressure(1)).toBe('1.00 atm');
    expect(formatPressure(0.006)).toBe('0.006 atm');
    expect(formatPressure(0.0004)).toBe('< 0.001 atm');
    expect(formatGreenhouse(33)).toBe('+33 K greenhouse');
    expect(formatGreenhouse(0.1)).toBe('no greenhouse warming');

    expect(formatSolarRadius(1)).toBe('1.00 R☉');
    expect(formatSolarRadius(0.0084)).toBe('0.008 R☉');
    expect(formatSolarMass(1)).toBe('1.00 M☉');
    expect(formatLuminosity(1)).toBe('1.00 L☉');
    expect(formatLuminosity(0.0001)).toBe('0.0001 L☉');
    expect(formatLuminosity(12.5)).toBe('12.5 L☉');
    expect(formatLuminosity(125_000)).toBe('125,000 L☉');
  });

  it('renders the simulation clock as a day count and a calendar date', () => {
    expect(formatSimDay(0)).toBe('Day 0.0');
    expect(formatSimDay(1234.56)).toBe('Day 1,234.6');
    expect(formatSimDate(0)).toBe('1 Jan 2000');
    expect(formatSimDate(365)).toBe('31 Dec 2000');
    expect(formatSimDate(1234)).toBe('19 May 2003');
    expect(formatSimDate(366)).toBe('1 Jan 2001');
  });

  it('converts a linear-space colour to a CSS sRGB triplet', () => {
    expect(cssColor([1, 1, 1])).toBe('rgb(255, 255, 255)');
    expect(cssColor([0, 0, 0])).toBe('rgb(0, 0, 0)');
    expect(cssColor([0.5, 0.5, 0.5])).toBe('rgb(188, 188, 188)');
    expect(cssColor([2, -1, 0.2])).toBe('rgb(255, 0, 124)');
    expect(() => cssColor([Number.NaN, 0, 0])).toThrow(/not a finite number/);
  });

  it('sets gas formulae like a chemist', () => {
    expect(chemicalFormula('H2O')).toBe('H₂O');
    expect(chemicalFormula('N2')).toBe('N₂');
    expect(chemicalFormula('Ar')).toBe('Ar');
    expect(chemicalFormula('CH4')).toBe('CH₄');
  });
});
