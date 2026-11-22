import { describe, expect, it } from 'vitest';
import type { CalendarProposal } from '@/types';
import { addDaysKey, calendarDayLabel, formatDayKey, formatRange, proposalNote, semesterWeekOf } from './calendarUtils';

describe('semesterWeekOf — „tydz.” zjazdu', () => {
  it('tydzien semestru z lukami na przerwy (start w czwartek 1.10.2026)', () => {
    expect(semesterWeekOf('2026-10-02', '2026-10-01')).toBe(1);
    expect(semesterWeekOf('2026-11-06', '2026-10-01')).toBe(6);
    expect(semesterWeekOf('2027-01-08', '2026-10-01')).toBe(15);
    expect(semesterWeekOf('2027-03-28', '2027-02-22')).toBe(5); // przez zmiane czasu (28.03)
    expect(semesterWeekOf('', '2026-10-01')).toBeNull();
  });
});

describe('calendarUtils', () => {
  it('dodawanie dni przez koniec miesiaca i roku', () => {
    expect(addDaysKey('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysKey('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('formatowanie dat i zakresow', () => {
    expect(formatDayKey('2026-10-09')).toBe('9.10');
    expect(formatRange('2026-10-01', '2027-01-31')).toBe('1.10.2026 – 31.01.2027');
    expect(formatRange('2027-02-19', '2027-02-21')).toBe('19.02 – 21.02.2027');
  });
});

describe('proposalNote', () => {
  const calendar: CalendarProposal['calendar'] = { name: 'Podstawowy', kind: 'WEEKLY', startDate: '2027-02-15', endDate: '2027-06-15', breaks: [], days: [], zjazdy: [] };

  it('kopia z zeszlego roku', () => {
    const note = proposalNote({ source: { termKey: '2025-L', termLabel: '2025/26 letni', facultyName: 'WM', name: 'Podstawowy' }, calendar });
    expect(note.title).toBe('Propozycja na podstawie: 2025/26 letni (Podstawowy)');
    expect(note.description).toContain('przeniesione z 2025/26 letni na ten semestr');
  });

  it('wariant w tym samym semestrze: kopia, nie "pierwszy kalendarz"', () => {
    const note = proposalNote({ source: { termKey: '2026-Z', termLabel: '2026/27 zimowy', facultyName: 'WM', name: 'Podstawowy' }, calendar }, '2026-Z');
    expect(note.title).toBe('Kopia kalendarza „Podstawowy” z tego semestru');
    expect(note.description).toContain('Zmien tylko to, czym wariant sie rozni');
  });

  it('bez zrodla: domyslne daty i co dodac recznie', () => {
    const note = proposalNote({ source: null, calendar: { ...calendar, kind: 'ZJAZD' } });
    expect(note.title).toContain('domyslne daty');
    expect(note.description).not.toContain('przeniesione');
    expect(note.description).toContain('(15.02 – 15.06.2027), bez przerw');
    expect(note.description).toContain('Dodaj recznie: zjazdy, przerwy, dni wolne uczelni');
  });

  it('bez zrodla, zimowy z przerwa swiateczna', () => {
    const winter = { ...calendar, startDate: '2027-10-01', endDate: '2028-01-31', breaks: [{ name: 'Przerwa swiateczna', startDate: '2027-12-23', endDate: '2028-01-01' }] };
    const note = proposalNote({ source: null, calendar: winter });
    expect(note.description).toContain('przerwa: Przerwa swiateczna');
    expect(note.description).toContain('Dodaj recznie: pozostale przerwy, dni wolne uczelni');
  });
});

describe('calendarDayLabel — wyjatki dni w podsumowaniu kalendarza', () => {
  it('zamiana dni mowi, wg planu ktorego dnia', () => {
    expect(calendarDayLabel({ date: '2026-11-05', kind: 'FOLLOWS_WEEKDAY', name: null, followsWeekday: 'MONDAY' })).toBe('5.11 wg planu: poniedzialek');
    expect(calendarDayLabel({ date: '2027-01-04', kind: 'FOLLOWS_WEEKDAY', name: 'Zamiana', followsWeekday: 'WEDNESDAY' })).toBe(
      '4.01 Zamiana (wg planu: sroda)',
    );
  });
  it('dzien wolny z nazwa i bez nazwy, godziny rektorskie od bloku', () => {
    expect(calendarDayLabel({ date: '2026-11-02', kind: 'DAY_OFF', name: 'Dzień wolny od zajęć' })).toBe('2.11 Dzień wolny od zajęć');
    expect(calendarDayLabel({ date: '2026-11-02', kind: 'DAY_OFF', name: null })).toBe('2.11 dzien wolny');
    expect(calendarDayLabel({ date: '2026-11-12', kind: 'CLOSED_FROM', name: null, closedFromBlockOrder: 5 })).toBe(
      '12.11 godziny rektorskie od bloku 5',
    );
  });
});
