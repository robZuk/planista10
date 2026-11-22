import { describe, expect, it } from 'vitest';
import { breadcrumbFor, termKeyFromPath, termScopedItemFor, visibleGroups } from './navigation';

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

describe('sekcja Podglad', () => {
  it('zajetosc sal i prowadzacych w osobnej sekcji, tylko dla planistow', () => {
    const podglad = visibleGroups('DEAN_OFFICE').find((g) => g.label === 'Podglad');
    expect(podglad?.items.map((i) => i.to)).toEqual(['/room-occupancy', '/instructor-occupancy']);
    expect(visibleGroups('DEAN_OFFICE').find((g) => g.label === 'Planowanie')?.items.some((i) => i.to.endsWith('-occupancy'))).toBe(false);
    // Bez widocznych pozycji sekcja znika — student i prowadzacy nie widza pustego naglowka.
    expect(visibleGroups('STUDENT').some((g) => g.label === 'Podglad')).toBe(false);
    expect(visibleGroups('INSTRUCTOR').some((g) => g.label === 'Podglad')).toBe(false);
  });

  it('breadcrumbs i semestr w adresie dzialaja jak dotad', () => {
    expect(breadcrumbFor('/instructor-occupancy/2026-Z')?.group).toBe('Podglad');
    expect(termScopedItemFor('/room-occupancy/2026-Z')?.label).toBe('Zajetosc sal');
  });
});
