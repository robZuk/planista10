import { describe, expect, it } from 'vitest';
import type { SetupCohort, SetupStatus } from '@/types';
import { plural, setupSteps } from './setupSteps';

const cohort = (over: Partial<SetupCohort> = {}): SetupCohort => ({
  id: 'c',
  label: 'MIBM-S1',
  code: 'MIBM-S1',
  program: {
    code: 'MIBM-S1',
    name: 'MiBM',
    studyMode: 'FULL_TIME',
    degreeLevel: 'BACHELOR',
    fieldOfStudy: { id: 'f', name: 'MiBM', shortName: 'MIBM' },
  },
  semester: 1,
  programVersion: { id: 'v', label: 'od naboru 2025/26', status: 'APPROVED' },
  calendar: { name: 'Podstawowy', status: 'PUBLISHED' },
  groups: 10,
  programEntries: 18,
  sections: 40,
  vacancies: 0,
  placedSections: 40,
  occurrences: 500,
  stale: false,
  staleReasons: [],
  ...over,
});

/** Gotowy semestr: 2 kalendarze opublikowane, 2 roczniki, wszystko ulozone. */
const ready = (over: Partial<SetupStatus> = {}, totals: Partial<SetupStatus['totals']> = {}): SetupStatus => ({
  calendars: [
    { id: 's', facultyId: 'wm', studyMode: 'FULL_TIME', name: 'Podstawowy', kind: 'WEEKLY', status: 'PUBLISHED' },
    { id: 'n', facultyId: 'wm', studyMode: 'PART_TIME', name: 'Podstawowy', kind: 'ZJAZD', status: 'PUBLISHED' },
  ],
  missingCalendars: 0,
  cohorts: [cohort({ id: 'a' }), cohort({ id: 'b' })],
  totals: {
    cohorts: 2,
    cohortsWithoutCalendar: 0,
    cohortsWithDraftVersion: 0,
    cohortsWithoutSections: 0,
    cohortsWithEmptySemester: 0,
    sections: 80,
    vacancies: 0,
    placedSections: 80,
    staleCohorts: 0,
    published: 2,
    ...totals,
  },
  ...over,
});

const step = (data: SetupStatus, n: number) => setupSteps(data, '2026-Z').find((s) => s.n === n)!;

describe('plural', () => {
  it('odmiana polska', () => {
    expect(plural(1, 'rocznik', 'roczniki', 'rocznikow')).toBe('1 rocznik');
    expect(plural(3, 'rocznik', 'roczniki', 'rocznikow')).toBe('3 roczniki');
    expect(plural(5, 'rocznik', 'roczniki', 'rocznikow')).toBe('5 rocznikow');
    expect(plural(12, 'rocznik', 'roczniki', 'rocznikow')).toBe('12 rocznikow');
    expect(plural(22, 'rocznik', 'roczniki', 'rocznikow')).toBe('22 roczniki');
    expect(plural(0, 'rocznik', 'roczniki', 'rocznikow')).toBe('0 rocznikow');
  });
});

describe('setupSteps', () => {
  it('gotowy semestr: wszystkie kroki z ptaszkiem i bez "do zrobienia"', () => {
    const steps = setupSteps(ready(), '2026-Z');
    expect(steps.map((s) => s.state)).toEqual(Array(7).fill('done'));
    expect(steps.every((s) => s.todo === null)).toBe(true);
  });

  it('plan niepelny -> "!" i ile zajec w ilu rocznikach umiescic', () => {
    const s = step(ready({ cohorts: [cohort({ id: 'a', placedSections: 29 }), cohort({ id: 'b' })] }, { placedSections: 69 }), 6);
    expect(s.state).toBe('warn');
    expect(s.todo).toBe('Umiesc jeszcze 11 zajec (1 rocznik) — mozesz zaczac od „Przenies plan z zeszlego roku”');
  });

  it('krok 7: nieopublikowany kalendarz to nie ptaszek, nawet gdy inny jest opublikowany', () => {
    const data = ready();
    data.calendars[1]!.status = 'PLANNING';
    const s = step(data, 7);
    expect(s.state).toBe('warn');
    expect(s.todo).toBe('Opublikuj 1 kalendarz w przygotowaniu');
    expect(s.link).toBe('Publikacja w kalendarzu');
    expect(s.summary).toContain('opublikowane kalendarze: 1/2');
  });

  it('krok 7: nieaktualne terminy i roczniki bez terminow -> najpierw generowanie (link do planu)', () => {
    const s = step(ready({ cohorts: [cohort({ id: 'a', stale: true }), cohort({ id: 'b', occurrences: 0 })] }, { staleCohorts: 1 }), 7);
    expect(s.state).toBe('warn');
    expect(s.todo).toBe('„Generuj terminy” 1 rocznikowi z nieaktualnymi terminami; „Generuj terminy” 1 rocznikowi bez terminow');
    expect(s.to).toBe('/plan/2026-Z');
  });

  it('pusty semestr: kroki zalezne wskazuja, co najpierw', () => {
    const data = ready(
      { cohorts: [], calendars: [] },
      { cohorts: 0, sections: 0, placedSections: 0, published: 0 },
    );
    const steps = setupSteps(data, '2026-Z');
    expect(steps.map((s) => s.state)).toEqual(Array(7).fill('todo'));
    expect(step(data, 7).todo).toBe('Najpierw plan rocznikow (krok 6)');
    expect(step(data, 2).todo).toContain('Nowy nabor');
    expect(step(data, 5).todo).toBe('Najpierw zajecia (krok 4)');
  });

  it('braki obsady i roczniki bez kalendarza -> "!" z czynnoscia', () => {
    const data = ready({}, { vacancies: 3, cohortsWithoutCalendar: 2 });
    expect(step(data, 5)).toMatchObject({ state: 'warn', summary: '3 zajecia bez pelnej obsady (NN)' });
    expect(step(data, 2)).toMatchObject({ state: 'warn', todo: 'Wybierz kalendarz 2 rocznikom bez kalendarza' });
  });
});

describe('krok 4 — semestr programu bez przedmiotow', () => {
  it('nie jest zaleglosci, ale podsumowanie o nim mowi', () => {
    const s4 = step(ready({}, { cohortsWithEmptySemester: 2 }), 4);
    expect(s4.state).toBe('done');
    expect(s4.todo).toBeNull();
    expect(s4.summary).toBe('80 zajec · 2 roczniki bez przedmiotow w tym semestrze programu');
  });
});
