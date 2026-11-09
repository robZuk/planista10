import { describe, expect, it } from 'vitest';
import { sortByTime, todayShortlist } from './todayEntries';

const e = (id: string, from: string, to: string) => ({ id, startBlock: { startTime: from }, endBlock: { endTime: to } });

describe('sortByTime', () => {
  it('po godzinie, nie po numerze bloku (rozne siatki wydzialow)', () => {
    expect(sortByTime([e('we', '07:15', '08:00'), e('wm', '07:00', '09:00'), e('wn', '07:30', '08:15')]).map((x) => x.id)).toEqual([
      'wm',
      'we',
      'wn',
    ]);
  });
});

describe('todayShortlist', () => {
  const day = [e('a', '07:00', '09:00'), e('b', '09:00', '10:00'), e('c', '10:00', '12:00'), e('d', '12:00', '13:00')];

  it('trwajace i najblizsze, najwyzej limit', () => {
    const r = todayShortlist(day, '09:30', 2);
    expect(r.shown.map((x) => x.id)).toEqual(['b', 'c']);
    expect(r.total).toBe(4);
  });

  it('wieczorem — ostatnie zajecia dnia zamiast pustej karty', () => {
    expect(todayShortlist(day, '20:00', 2).shown.map((x) => x.id)).toEqual(['c', 'd']);
  });
});
