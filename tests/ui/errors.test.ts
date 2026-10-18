import { describe, expect, it } from 'vitest';

import { errorText } from '../../src/ui/errors';

describe('ui error text', () => {
  it('never turns a thrown value into "[object Object]"', () => {
    expect(errorText(new Error('the renderer failed'))).toBe('the renderer failed');
    expect(errorText('a plain string')).toBe('a plain string');
    expect(errorText({ reason: 'x' })).toBe('unknown error (see the console)');
    expect(errorText(null)).toBe('null');
    expect(errorText(42)).toBe('42');
  });
});
