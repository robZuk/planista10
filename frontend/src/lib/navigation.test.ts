import { describe, expect, it } from 'vitest';
import { termKeyFromPath, termScopedItemFor } from './navigation';

describe('strony semestralne', () => {
  it('rozpoznaje strone semestralna i klucz semestru z adresu', () => {
    const item = termScopedItemFor('/plan/2026-L');
    expect(item?.to).toBe('/plan');
    expect(termKeyFromPath('/plan/2026-L', item!)).toBe('2026-L');
    expect(termKeyFromPath('/plan', item!)).toBeNull();
  });

  it('strony katalogu nie sa semestralne', () => {
    expect(termScopedItemFor('/buildings')).toBeNull();
    expect(termScopedItemFor('/curriculum/program/abc')).toBeNull();
  });
});
