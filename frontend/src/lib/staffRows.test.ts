import { describe, expect, it } from 'vitest';
import { NN, draftRows, sameAssignments, staffRowsProblem, toAssignments } from './staffRows';

describe('wiersze obsady w oknach', () => {
  it('start: obecna obsada albo pusty wiersz na wszystkie godziny', () => {
    expect(draftRows({ hours: 30, instructors: [] })).toEqual([{ instructorId: '', hours: '30' }]);
    expect(draftRows({ hours: 30, instructors: [{ instructorId: null, hours: 30 }] })).toEqual([{ instructorId: NN, hours: '30' }]);
  });

  it('problemy w kolejnosci: brak wyboru, zle godziny, powtorka osoby, za duzo godzin', () => {
    expect(staffRowsProblem([{ instructorId: '', hours: '30' }], 30)).toMatch(/Wybierz prowadzacego/);
    expect(staffRowsProblem([{ instructorId: 'a', hours: '1.5' }], 30)).toMatch(/liczba calkowita/);
    expect(staffRowsProblem([{ instructorId: 'a', hours: '10' }, { instructorId: 'a', hours: '10' }], 30)).toMatch(/dwa razy/);
    expect(staffRowsProblem([{ instructorId: 'a', hours: '20' }, { instructorId: NN, hours: '15' }], 30)).toBe(
      'Suma godzin (35) przekracza godziny zajec (30)',
    );
    expect(staffRowsProblem([{ instructorId: NN, hours: '10' }, { instructorId: NN, hours: '10' }], 30)).toBeNull();
  });

  it('zapis: NN jako null; zmiana wykrywana bez wzgledu na kolejnosc', () => {
    const rows = toAssignments([{ instructorId: 'a', hours: '20' }, { instructorId: NN, hours: '10' }]);
    expect(rows).toEqual([{ instructorId: 'a', hours: 20 }, { instructorId: null, hours: 10 }]);
    expect(sameAssignments(rows, [{ instructorId: null, hours: 10 }, { instructorId: 'a', hours: 20 }])).toBe(true);
    expect(sameAssignments(rows, [{ instructorId: 'a', hours: 30 }])).toBe(false);
  });
});
