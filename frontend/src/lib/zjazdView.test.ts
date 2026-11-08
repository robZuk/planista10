import { describe, expect, it } from 'vitest';
import { copyCandidates, inZjazd, zjazdyDiffer } from './zjazdView';

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

describe('zjazdyDiffer', () => {
  it('same "kazdy zjazd": zjazdy jednakowe', () => expect(zjazdyDiffer([rule(), rule()], zjazdy)).toBe(false));
  it('zakres obejmujacy wszystkie zjazdy: jednakowe', () => expect(zjazdyDiffer([rule({ fromIndex: 1, toIndex: 10 })], zjazdy)).toBe(false));
  it('zakres 1-6 albo lista: roznia sie', () => {
    expect(zjazdyDiffer([rule(), rule({ toIndex: 6 })], zjazdy)).toBe(true);
    expect(zjazdyDiffer([rule({ pattern: 'LIST', numbers: [2] })], zjazdy)).toBe(true);
  });
  it('bez umieszczen: jednakowe', () => expect(zjazdyDiffer([], zjazdy)).toBe(false));
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
