import { describe, expect, it } from 'vitest';
import type { Building } from '@/types';
import { buildingFilterOptions, defaultBuildingFilter, roomRows } from './roomOccupancy';

const building = (id: string, name: string, facultyId: string | null, rooms: [string, string, number][]): Building => ({
  id,
  name,
  address: null,
  facultyId,
  createdAt: '2026-01-01',
  rooms: rooms.map(([roomId, number, capacity]) => ({ id: roomId, number, capacity, type: capacity > 60 ? 'LECTURE' : 'LAB', buildingId: id })),
});

const buildings = [
  building('bc', 'Budynek C', 'wm', [['c1010', '1010', 30], ['c101', '101', 120], ['c2', '2', 24]]),
  building('aula', 'Aula Główna', null, [['a1', 'Aula', 400]]),
  building('we', 'Budynek D (WE)', 'we', [['d1', '101', 40]]),
];
const all = { building: 'all', type: 'all' as const, minCapacity: null, query: '' };

describe('roomRows', () => {
  it('budynki po nazwie, sale numerami rosnaco (2, 101, 1010)', () => {
    expect(roomRows(buildings, all).map((r) => r.room.id)).toEqual(['a1', 'c2', 'c101', 'c1010', 'd1']);
  });

  it('filtr wydzialu, budynkow ogolnouczelnianych i jednego budynku', () => {
    expect(roomRows(buildings, { ...all, building: 'faculty:wm' }).map((r) => r.room.id)).toEqual(['c2', 'c101', 'c1010']);
    expect(roomRows(buildings, { ...all, building: 'shared' }).map((r) => r.room.id)).toEqual(['a1']);
    expect(roomRows(buildings, { ...all, building: 'building:we' }).map((r) => r.room.id)).toEqual(['d1']);
  });

  it('typ, pojemnosc i wyszukiwanie (numer albo budynek, bez polskich znakow)', () => {
    expect(roomRows(buildings, { ...all, type: 'LECTURE' }).map((r) => r.room.id)).toEqual(['a1', 'c101']);
    expect(roomRows(buildings, { ...all, minCapacity: 40 }).map((r) => r.room.id)).toEqual(['a1', 'c101', 'd1']);
    expect(roomRows(buildings, { ...all, query: 'glowna' }).map((r) => r.room.id)).toEqual(['a1']);
    expect(roomRows(buildings, { ...all, query: '101 we' }).map((r) => r.room.id)).toEqual(['d1']);
  });
});

describe('filtr budynkow', () => {
  const faculties = [
    { id: 'wm', name: 'Wydzial Mechaniczny', shortName: 'WM', createdAt: '' },
    { id: 'we', name: 'Wydzial Elektryczny', shortName: 'WE', createdAt: '' },
    { id: 'wn', name: 'Wydzial Nawigacyjny', shortName: 'WN', createdAt: '' },
  ];

  it('opcje: wszystkie, wydzialy z budynkami, ogolnouczelniane, budynki z liczba sal', () => {
    const options = buildingFilterOptions(buildings, faculties);
    expect(options.groups.map((o) => o.label)).toEqual(['Wszystkie budynki', 'Budynki WE', 'Budynki WM', 'Ogolnouczelniane (bez wydzialu)']);
    // Nazwy bez dopisku wydzialu — „Budynek D (WE)” ma go w nazwie, „Budynek C” (WM) nie dostaje drugiego.
    expect(options.buildings.map((o) => o.label)).toEqual(['Aula Główna · 1 sala', 'Budynek C · 3 sale', 'Budynek D (WE) · 1 sala']);
  });

  it('domyslnie wydzial dziekanatu albo wydzial z filtra admina, gdy ma budynki', () => {
    expect(defaultBuildingFilter('DEAN_OFFICE', 'wm', 'all', buildings)).toBe('faculty:wm');
    expect(defaultBuildingFilter('DEAN_OFFICE', 'wn', 'all', buildings)).toBe('all');
    expect(defaultBuildingFilter('ADMIN', null, 'we', buildings)).toBe('faculty:we');
    expect(defaultBuildingFilter('ADMIN', null, 'all', buildings)).toBe('all');
  });
});
