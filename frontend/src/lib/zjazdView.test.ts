import { describe, expect, it } from 'vitest';
import { copyCandidates, defaultZjazd, inZjazd, zjazdyOf } from './zjazdView';

const rule = (extra: Partial<Parameters<typeof inZjazd>[0]> = {}) => ({
  cycle: 'ZJAZD' as const,
  pattern: 'ALL' as const,
  numbers: [] as number[],
  fromIndex: null as number | null,
  toIndex: null as number | null,
  ...extra,
});

const zjazdy = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('inZjazd', () => {
  it('kazdy zjazd: wszystkie', () => expect(zjazdy.every((z) => inZjazd(rule(), z))).toBe(true));
  it('kazdy zjazd z zakresem 1-6: nie w 7', () => {
    expect(inZjazd(rule({ toIndex: 6 }), 6)).toBe(true);
    expect(inZjazd(rule({ toIndex: 6 }), 7)).toBe(false);
    expect(inZjazd(rule({ fromIndex: 3 }), 2)).toBe(false);
  });
  it('lista zjazdow', () => {
    expect(inZjazd(rule({ pattern: 'LIST', numbers: [1, 3] }), 3)).toBe(true);
    expect(inZjazd(rule({ pattern: 'LIST', numbers: [1, 3] }), 2)).toBe(false);
  });
  it('rytm tygodniowy nie zalezy od zjazdu', () => expect(inZjazd(rule({ cycle: 'WEEK', pattern: 'LIST', numbers: [1] }), 5)).toBe(true));
});

describe('zjazdyOf', () => {
  it('kazdy zjazd z zakresem, lista, rytm bez ograniczen', () => {
    expect(zjazdyOf(rule({ fromIndex: 3, toIndex: 5 }), zjazdy)).toEqual([3, 4, 5]);
    expect(zjazdyOf(rule({ pattern: 'LIST', numbers: [2, 9, 12] }), zjazdy)).toEqual([2, 9]);
    expect(zjazdyOf(rule(), [1, 2])).toEqual([1, 2]);
  });
});

describe('defaultZjazd', () => {
  const cal = [
    { number: 1, startDate: '2026-10-02', endDate: '2026-10-04' },
    { number: 2, startDate: '2026-10-09', endDate: '2026-10-11' },
    { number: 3, startDate: '2026-10-16', endDate: '2026-10-18' },
  ];
  it('trwajacy zjazd', () => expect(defaultZjazd(cal, '2026-10-10')).toBe(2));
  it('miedzy zjazdami: najblizszy', () => expect(defaultZjazd(cal, '2026-10-12')).toBe(3));
  it('przed semestrem: pierwszy', () => expect(defaultZjazd(cal, '2026-09-01')).toBe(1));
  it('po semestrze: pierwszy', () => expect(defaultZjazd(cal, '2027-02-01')).toBe(1));
  it('bez zjazdow: brak', () => expect(defaultZjazd([], '2026-10-10')).toBeNull());
});

describe('copyCandidates', () => {
  it('tylko listy z zjazdem zrodlowym, bez docelowego', () => {
    const a = rule({ pattern: 'LIST', numbers: [1, 3] });
    const b = rule({ pattern: 'LIST', numbers: [1, 4] });
    const c = rule({ pattern: 'LIST', numbers: [2] });
    const d = rule();
    expect(copyCandidates([a, b, c, d], 1, 4)).toEqual([a]);
  });
  it('pomija liste, ktorej zakres wyklucza zjazd docelowy', () => {
    expect(copyCandidates([rule({ pattern: 'LIST', numbers: [1], toIndex: 5 })], 1, 8)).toEqual([]);
  });
});
