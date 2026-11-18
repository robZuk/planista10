import { describe, expect, it } from 'vitest';
import { instructorConflicts, proposeInstructor, staffMismatch } from './planStaff';

describe('staffMismatch', () => {
  const staff = [
    { instructorId: 'kow', hours: 15 },
    { instructorId: 'now', hours: 15 },
  ];

  it('prowadzacy z obsady — zgodnie', () => {
    expect(staffMismatch('kow', staff, 30)).toBeNull();
  });

  it('prowadzacy spoza obsady — FOREIGN (takze gdy obsada pusta albo NN)', () => {
    expect(staffMismatch('wis', staff, 30)).toBe('FOREIGN');
    expect(staffMismatch('wis', [], 30)).toBe('FOREIGN');
    expect(staffMismatch('wis', [{ instructorId: null, hours: 30 }], 30)).toBe('FOREIGN');
  });

  it('NN w planie przy pelnej obsadzie — MISSING', () => {
    expect(staffMismatch(null, staff, 30)).toBe('MISSING');
  });

  it('NN w planie przy wakacie, brakujacych godzinach albo bez obsady — zgodnie', () => {
    expect(staffMismatch(null, [{ instructorId: 'kow', hours: 15 }, { instructorId: null, hours: 15 }], 30)).toBeNull();
    expect(staffMismatch(null, [{ instructorId: 'kow', hours: 15 }], 30)).toBeNull();
    expect(staffMismatch(null, [], 30)).toBeNull();
  });
});

describe('proposeInstructor', () => {
  it('osoba, ktorej nie ma jeszcze w planie tych zajec, z najwieksza liczba godzin', () => {
    const staff = [
      { instructorId: 'kow', hours: 20 },
      { instructorId: 'wis', hours: 5 },
      { instructorId: 'now', hours: 10 },
    ];
    expect(proposeInstructor(staff, new Set(['kow']))).toBe('now');
    expect(proposeInstructor(staff, new Set())).toBe('kow');
  });

  it('wszyscy juz w planie — najwiecej godzin; bez osob — NN', () => {
    expect(proposeInstructor([{ instructorId: 'a', hours: 5 }, { instructorId: 'b', hours: 25 }], new Set(['a', 'b']))).toBe('b');
    expect(proposeInstructor([{ instructorId: null, hours: 30 }], new Set())).toBeNull();
    expect(proposeInstructor([], new Set())).toBeNull();
  });
});

describe('instructorConflicts', () => {
  const dates = [
    { date: '2026-10-05', startMinute: 480, endMinute: 570 },
    { date: '2026-10-12', startMinute: 480, endMinute: 570 },
  ];
  const slot = (over: Partial<Parameters<typeof instructorConflicts>[3][number]>) => ({
    date: '2026-10-05',
    startMinute: 540,
    endMinute: 630,
    instructorId: 'now',
    jointKey: null,
    label: 'Fizyka (W) MBM-S1',
    ...over,
  });

  it('nakladajace sie minuty tej samej osoby w tym samym dniu', () => {
    expect(instructorConflicts(dates, 'now', null, [slot({})])).toEqual([{ date: '2026-10-05', with: 'Fizyka (W) MBM-S1' }]);
  });

  it('inna osoba, inny dzien albo styk przedzialow — bez kolizji', () => {
    expect(instructorConflicts(dates, 'now', null, [slot({ instructorId: 'kow' })])).toEqual([]);
    expect(instructorConflicts(dates, 'now', null, [slot({ date: '2026-10-06' })])).toEqual([]);
    expect(instructorConflicts(dates, 'now', null, [slot({ startMinute: 570, endMinute: 660 })])).toEqual([]);
  });

  it('zajecia laczone (ten sam jointKey) nie koliduja', () => {
    expect(instructorConflicts(dates, 'now', 'j1', [slot({ jointKey: 'j1' })])).toEqual([]);
    expect(instructorConflicts(dates, 'now', 'j1', [slot({ jointKey: 'j2' })])).toHaveLength(1);
  });
});
