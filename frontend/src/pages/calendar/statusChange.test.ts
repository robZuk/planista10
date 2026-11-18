import { describe, expect, it } from 'vitest';
import { statusChangeWarning, usageNote } from './statusChange';

const published = { status: 'PUBLISHED' as const, endDate: '2027-01-31' };

describe('statusChangeWarning', () => {
  it('cofniecie publikacji pyta', () => {
    expect(statusChangeWarning(published, 'PLANNING', '2026-11-08')?.confirmLabel).toBe('Cofnij publikacje');
  });

  it('archiwum w trakcie semestru pyta i podaje koniec semestru', () => {
    const w = statusChangeWarning(published, 'ARCHIVED', '2026-11-08');
    expect(w?.effect).toContain('31.01.2027');
    expect(statusChangeWarning(published, 'ARCHIVED', '2027-01-31')).not.toBeNull();
    expect(statusChangeWarning({ status: 'PLANNING', endDate: '2027-01-31' }, 'ARCHIVED', '2026-11-08')).not.toBeNull();
  });

  it('publikacja pyta (terminy przeliczone jeszcze raz, potem tylko „Generuj terminy”)', () => {
    const w = statusChangeWarning({ status: 'PLANNING', endDate: '2027-01-31' }, 'PUBLISHED', '2026-11-08');
    expect(w?.confirmLabel).toBe('Opublikuj');
    expect(w?.effect).toContain('przelicza sie jeszcze raz');
  });

  it('bez pytania: archiwum po semestrze, ten sam status, przywrocenie z archiwum', () => {
    expect(statusChangeWarning(published, 'ARCHIVED', '2027-02-01')).toBeNull();
    expect(statusChangeWarning(published, 'PUBLISHED', '2026-11-08')).toBeNull();
    expect(statusChangeWarning({ status: 'ARCHIVED', endDate: '2027-01-31' }, 'PUBLISHED', '2026-11-08')).toBeNull();
  });
});

describe('usageNote', () => {
  it('ladowanie, brak planu, roczniki z planem', () => {
    expect(usageNote(undefined, true)).toContain('Sprawdzam');
    expect(usageNote({ cohortsWithPlan: 0, occurrences: 0 }, false)).toContain('Zaden rocznik');
    expect(usageNote({ cohortsWithPlan: 18, occurrences: 9885 }, false)).toBe('Dotyczy rocznikow z planem: 18 (terminow: 9885).');
  });
});
