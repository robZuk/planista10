import { describe, expect, it } from 'vitest';
import { hourRange, weekColumns, weekLanes } from './myPlanWeek';

const row = (id: string, date: string, from: string, to: string) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return { id, date, startMinute: m(from), endMinute: m(to) };
};

describe('weekColumns', () => {
  it('pon-pt zawsze, weekend tylko z zajeciami', () => {
    expect(weekColumns('2026-11-09', [])).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    expect(weekColumns('2026-11-09', [{ date: '2026-11-15' }])).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-15',
    ]);
  });
});

describe('hourRange', () => {
  it('pelne godziny wokol zajec roznych siatek', () => {
    expect(hourRange([row('a', '2026-11-09', '07:15', '09:00'), row('b', '2026-11-10', '15:15', '17:00')])).toEqual({ from: 420, to: 1020 });
  });

  it('pusty tydzien: 8-16', () => {
    expect(hourRange([])).toEqual({ from: 480, to: 960 });
  });
});

describe('weekLanes', () => {
  it('nakladajace sie zajecia obok siebie, stykajace sie — nie', () => {
    const lanes = weekLanes([
      row('w', '2026-11-09', '09:00', '10:30'),
      row('c', '2026-11-09', '10:00', '11:00'),
      row('n', '2026-11-09', '11:00', '12:00'),
      row('inny-dzien', '2026-11-10', '09:00', '10:30'),
    ]);
    expect(lanes.get('w')).toMatchObject({ lane: 0, lanes: 2 });
    expect(lanes.get('c')).toMatchObject({ lane: 1, lanes: 2 });
    expect(lanes.get('n')).toMatchObject({ lane: 0, lanes: 1 });
    expect(lanes.get('inny-dzien')).toMatchObject({ lane: 0, lanes: 1 });
  });
});
