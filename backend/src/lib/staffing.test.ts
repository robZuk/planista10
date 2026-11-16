import { describe, expect, it } from 'vitest';
import { freeHours, staffProblem, withPersonHours } from './staffing';

describe('staffProblem', () => {
  it('poprawna obsada z podzialem i NN', () => {
    expect(staffProblem([{ instructorId: 'a', hours: 20 }, { instructorId: null, hours: 10 }], 30)).toBeNull();
  });

  it('godziny dodatnie i calkowite', () => {
    expect(staffProblem([{ instructorId: 'a', hours: 0 }], 30)).toBe('Godziny prowadzacego musza byc dodatnie');
    expect(staffProblem([{ instructorId: 'a', hours: 1.5 }], 30)).toBe('Godziny prowadzacego musza byc dodatnie');
  });

  it('suma ponad godziny zajec', () => {
    expect(staffProblem([{ instructorId: 'a', hours: 20 }, { instructorId: 'b', hours: 15 }], 30)).toBe(
      'Suma godzin obsady (35) przekracza godziny zajec (30)',
    );
  });

  it('ta sama osoba dwa razy (NN moze byc kilka razy)', () => {
    expect(staffProblem([{ instructorId: 'a', hours: 10 }, { instructorId: 'a', hours: 10 }], 30)).toBe('Prowadzacy powtarza sie w obsadzie');
    expect(staffProblem([{ instructorId: null, hours: 10 }, { instructorId: null, hours: 10 }], 30)).toBeNull();
  });
});

describe('withPersonHours', () => {
  it('nowa osoba dochodzi na koncu, inni zostaja', () => {
    expect(withPersonHours([{ instructorId: 'a', hours: 15 }], 'b', 15, 30)).toEqual([
      { instructorId: 'a', hours: 15 },
      { instructorId: 'b', hours: 15 },
    ]);
  });

  it('zmiana godzin osoby w miejscu; 0 h usuwa ja z obsady', () => {
    const rows = [{ instructorId: 'a', hours: 10 }, { instructorId: 'b', hours: 20 }];
    expect(withPersonHours(rows, 'a', 5, 30)).toEqual([{ instructorId: 'a', hours: 5 }, { instructorId: 'b', hours: 20 }]);
    expect(withPersonHours(rows, 'a', 0, 30)).toEqual([{ instructorId: 'b', hours: 20 }]);
  });

  it('NN ustepuje osobie: najpierw sie kurczy, potem znika', () => {
    expect(withPersonHours([{ instructorId: null, hours: 30 }], 'a', 15, 30)).toEqual([
      { instructorId: null, hours: 15 },
      { instructorId: 'a', hours: 15 },
    ]);
    expect(withPersonHours([{ instructorId: null, hours: 30 }], 'a', 30, 30)).toEqual([{ instructorId: 'a', hours: 30 }]);
  });

  it('cudzej obsady nie zabiera — nadmiar zostaje do odrzucenia przez staffProblem', () => {
    const rows = withPersonHours([{ instructorId: 'b', hours: 30 }], 'a', 15, 30);
    expect(rows).toEqual([{ instructorId: 'b', hours: 30 }, { instructorId: 'a', hours: 15 }]);
    expect(staffProblem(rows, 30)).toMatch(/przekracza/);
  });
});

describe('freeHours', () => {
  it('godziny zajec minus obsada prowadzacych; NN sie nie liczy', () => {
    expect(freeHours([{ instructorId: 'a', hours: 10 }, { instructorId: null, hours: 20 }], 30)).toBe(20);
    expect(freeHours([{ instructorId: 'a', hours: 40 }], 30)).toBe(0);
  });
});
