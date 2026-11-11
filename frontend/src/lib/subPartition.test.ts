import { describe, expect, it } from 'vitest';
import { defaultSubPartition } from './subPartition';

describe('defaultSubPartition', () => {
  it('kolejny poziom podzialu', () => {
    expect(defaultSubPartition('ROOT')).toBe('C');
    expect(defaultSubPartition('SPEC')).toBe('C');
    expect(defaultSubPartition('C')).toBe('L');
    expect(defaultSubPartition('L')).toBe('P');
    expect(defaultSubPartition(null)).toBe('C');
  });
});
