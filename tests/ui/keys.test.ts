import { describe, expect, it } from 'vitest';

import { keyContext, shortcutFor, SPEED_STEPS, speedLabel } from '../../src/ui/keys';

const NOTHING = { tagName: 'DIV' };
const FREE = { textEditable: false, spaceOwner: false };

describe('keyboard dispatch', () => {
  it('classifies the focused element', () => {
    expect(keyContext({ tagName: 'INPUT', type: 'text' })).toEqual({
      textEditable: true,
      spaceOwner: true,
    });
    expect(keyContext({ tagName: 'INPUT', type: 'range' })).toEqual({
      textEditable: false,
      spaceOwner: true,
    });
    expect(keyContext({ tagName: 'TEXTAREA' }).textEditable).toBe(true);
    expect(keyContext({ tagName: 'SELECT' }).textEditable).toBe(true);
    expect(keyContext({ tagName: 'BUTTON' })).toEqual({ textEditable: false, spaceOwner: true });
    expect(keyContext({ tagName: 'A' }).spaceOwner).toBe(true);
    expect(keyContext({ tagName: 'DIV', isContentEditable: true }).textEditable).toBe(true);
    expect(keyContext(NOTHING)).toEqual({ textEditable: false, spaceOwner: false });
  });

  it('maps the documented shortcuts', () => {
    expect(shortcutFor({ key: ' ' }, FREE)).toBe('play');
    expect(shortcutFor({ key: 'Escape' }, FREE)).toBe('back');
    expect(shortcutFor({ key: 'r' }, FREE)).toBe('randomize');
    expect(shortcutFor({ key: 'R' }, FREE)).toBe('randomize');
    expect(shortcutFor({ key: 'c' }, FREE)).toBe('copy');
    expect(shortcutFor({ key: '?' }, FREE)).toBe('help');
    expect(shortcutFor({ key: 'x' }, FREE)).toBeNull();
  });

  it('never steals keys from a text field or a focused button', () => {
    expect(shortcutFor({ key: 'r' }, { textEditable: true, spaceOwner: true })).toBeNull();
    expect(shortcutFor({ key: '?' }, { textEditable: true, spaceOwner: true })).toBeNull();
    expect(shortcutFor({ key: ' ' }, { textEditable: false, spaceOwner: true })).toBeNull();
    expect(shortcutFor({ key: 'r' }, { textEditable: false, spaceOwner: true })).toBe('randomize');
  });

  it('ignores modified and repeated presses', () => {
    expect(shortcutFor({ key: 'r', ctrlKey: true }, FREE)).toBeNull();
    expect(shortcutFor({ key: 'r', metaKey: true }, FREE)).toBeNull();
    expect(shortcutFor({ key: 'c', altKey: true }, FREE)).toBeNull();
    expect(shortcutFor({ key: ' ', repeat: true }, FREE)).toBeNull();
  });

  it('offers the documented speed ladder', () => {
    expect(SPEED_STEPS).toEqual([0, 1, 2, 10, 50]);
    expect(speedLabel(10)).toBe('10');
    expect(() => speedLabel(-1)).toThrow(/invalid simulation speed/);
    expect(() => speedLabel(Number.NaN)).toThrow(/invalid simulation speed/);
  });
});
