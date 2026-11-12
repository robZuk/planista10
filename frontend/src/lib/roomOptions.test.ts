import { describe, expect, it } from 'vitest';
import type { Building } from '@/types';
import { roomOptionsFor, roomTooSmallMessage } from './roomOptions';

const building: Building = {
  id: 'b',
  name: 'Budynek A',
  address: null,
  facultyId: null,
  createdAt: '',
  rooms: [
    { id: 'aula', number: 'Aula', type: 'LECTURE', capacity: 200, buildingId: 'b' },
    { id: 'c30', number: '116', type: 'EXERCISE', capacity: 30, buildingId: 'b' },
    { id: 'lab', number: '130', type: 'LAB', capacity: 16, buildingId: 'b' },
  ],
};

describe('roomOptionsFor', () => {
  it('tylko sale pasujace do formy zajec', () => {
    expect(roomOptionsFor([building], 'LAB').map((o) => o.value)).toEqual(['lab']);
    expect(roomOptionsFor([building], 'LECTURE').map((o) => o.value)).toEqual(['aula', 'c30']);
  });

  it('bez formy zajec — wszystkie sale', () => {
    expect(roomOptionsFor([building], null)).toHaveLength(3);
  });

  it('sala mniejsza niz grupa ma dopisek; wieksza — nie', () => {
    const [aula, small] = roomOptionsFor([building], 'LECTURE', 41);
    expect(aula!.hint).toBeUndefined();
    expect(small!.hint).toBe('za mala — grupa ma 41 os.');
  });

  it('ostrzezenie tylko dla za malej sali', () => {
    const [aula, small] = roomOptionsFor([building], 'LECTURE', 41);
    expect(roomTooSmallMessage(aula, 41)).toBeNull();
    expect(roomTooSmallMessage(small, 41)).toMatch(/^Sala ma 30 miejsc, a grupa 41 osob/);
    expect(roomTooSmallMessage(undefined, 41)).toBeNull();
  });
});
