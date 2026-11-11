import { describe, expect, it } from 'vitest';
import { foldName } from './foldName';

describe('foldName', () => {
  it('ignoruje wielkosc liter, polskie znaki i nadmiarowe spacje', () => {
    expect(foldName('  Wydział   Mechaniczny ')).toBe(foldName('wydzial mechaniczny'));
    expect(foldName('Zarządzanie i Nauki o Jakości')).toBe('zarzadzanie i nauki o jakosci');
    expect(foldName('ŁÓDŹ')).toBe('lodz');
  });
});
