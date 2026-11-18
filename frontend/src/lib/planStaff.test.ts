import { describe, expect, it } from 'vitest';
import type { StaffMismatchRow } from '@/types';
import { changesPlan, checkText, initialChoices, planStaffNotice, staffChanges } from './planStaff';

const row = (placementId: string, over: Partial<StaffMismatchRow> = {}): StaffMismatchRow => ({
  placementId,
  cohort: { id: 'c1', label: 'MBM-S1', code: 'MBM', semester: 1 },
  subject: 'Fizyka',
  specialization: null,
  classType: 'LAB',
  group: 'L1',
  slot: 'poniedzialek 08:00–09:30',
  kind: 'FOREIGN',
  current: { id: 'old', name: 'dr Stary' },
  staff: [{ id: 'now', name: 'dr Nowy', hours: 30 }],
  proposed: 'now',
  ...over,
});

describe('planStaffNotice', () => {
  it('bez rozjazdu — bez komunikatu', () => {
    expect(planStaffNotice([])).toBeNull();
  });

  it('liczy osobno prowadzacych spoza obsady i NN mimo obsady', () => {
    const notice = planStaffNotice([row('a'), row('b'), row('c', { kind: 'MISSING', current: null })]);
    expect(notice?.description).toContain('2 zajecia z prowadzacym spoza obsady, 1 zajecia bez prowadzacego (NN)');
    expect(notice?.action).toBe('Pokaz i przepnij (3)');
  });
});

describe('wybory i zmiany', () => {
  it('podpowiedz serwera; NN jako pusty wybor', () => {
    expect(initialChoices([row('a'), row('b', { proposed: null })])).toEqual({ a: 'now', b: '' });
  });

  it('zmiana tylko, gdy wybor rozni sie od planu', () => {
    expect(changesPlan(row('a'), 'now')).toBe(true);
    expect(changesPlan(row('a'), 'old')).toBe(false);
    expect(changesPlan(row('a', { current: null }), '')).toBe(false);
    expect(changesPlan(row('a'), '')).toBe(true);
  });

  it('wysylamy zaznaczone zmiany w kolejnosci listy, NN jako null', () => {
    const rows = [row('a'), row('b'), row('c')];
    expect(staffChanges(rows, { a: '', b: 'now', c: 'old' }, new Set(['c', 'b', 'a']))).toEqual([
      { placementId: 'a', instructorId: null },
      { placementId: 'b', instructorId: 'now' },
    ]);
    expect(staffChanges(rows, { a: 'now', b: 'now' }, new Set(['b']))).toEqual([{ placementId: 'b', instructorId: 'now' }]);
  });
});

describe('checkText', () => {
  it('blad, brak kolizji, kolizje z data', () => {
    expect(checkText(undefined)).toBeNull();
    expect(checkText({ placementId: 'a', instructorId: 'x', error: 'Bez zmiany', conflicts: [] })).toEqual({ ok: false, text: 'Bez zmiany' });
    expect(checkText({ placementId: 'a', instructorId: 'x', error: null, conflicts: [] })).toEqual({ ok: true, text: 'bez kolizji' });
    const text = checkText({
      placementId: 'a',
      instructorId: 'x',
      error: null,
      conflicts: [
        { date: '2026-10-05', with: 'Mechanika (W) MBM-S1' },
        { date: '2026-10-12', with: 'Mechanika (W) MBM-S1' },
      ],
    });
    expect(text?.text).toBe('kolizje: 2 (5.10 — Mechanika (W) MBM-S1 …)');
    expect(text?.details).toBe('5.10 — Mechanika (W) MBM-S1\n12.10 — Mechanika (W) MBM-S1');
  });
});
