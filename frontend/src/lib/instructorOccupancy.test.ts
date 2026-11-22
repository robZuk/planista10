import { describe, expect, it } from 'vitest';
import type { Department, Instructor } from '@/types';
import { NO_DEPARTMENT, NO_FACULTY, defaultFacultyFilter, departmentsInFaculty, instructorRows, instructorUnit } from './instructorOccupancy';

const faculty = (id: string, shortName: string) => ({ id, name: `Wydzial ${shortName}`, shortName, createdAt: '' });
const WM = faculty('wm', 'WM');
const WE = faculty('we', 'WE');

const department = (id: string, shortName: string, name: string, f: typeof WM | null): Department => ({
  id,
  name,
  shortName,
  facultyId: f?.id ?? null,
  faculty: f ? { id: f.id, name: f.name, shortName: f.shortName } : null,
  createdAt: '',
});
const KMiPKM = department('kmi', 'KMiPKM', 'Katedra Mechaniki i Podstaw Konstrukcji Maszyn', WM);
const KEO = department('keo', 'KEO', 'Katedra Elektroenergetyki Okretowej', WE);
const SJO = department('sjo', 'SJO', 'Studium Jezykow Obcych', null);

const person = (id: string, lastName: string, firstName: string, f: typeof WM | null, d: Department | null, title: string | null = 'dr'): Instructor => ({
  id,
  firstName,
  lastName,
  email: `${id}@umg.edu.pl`,
  title,
  facultyId: f?.id ?? null,
  faculty: f,
  departmentId: d?.id ?? null,
  department: d,
  createdAt: '',
});

const people = [
  person('zak', 'Żak', 'Ewa', WM, KMiPKM),
  person('nowak', 'Nowak', 'Jan', WM, null, null),
  person('kow', 'Kowalski', 'Piotr', WE, KEO, 'dr inz.'),
  person('lis', 'Lis', 'Anna', null, SJO, 'mgr'),
];
const all = { faculty: 'all', department: 'all', query: '' };

describe('instructorRows', () => {
  it('po nazwisku (polska kolejnosc: Ż na koncu)', () => {
    expect(instructorRows(people, all).map((i) => i.id)).toEqual(['kow', 'lis', 'nowak', 'zak']);
  });

  it('wydzial prowadzacego, ogolnouczelniani i katedra', () => {
    expect(instructorRows(people, { ...all, faculty: 'wm' }).map((i) => i.id)).toEqual(['nowak', 'zak']);
    expect(instructorRows(people, { ...all, faculty: NO_FACULTY }).map((i) => i.id)).toEqual(['lis']);
    expect(instructorRows(people, { ...all, faculty: 'wm', department: 'kmi' }).map((i) => i.id)).toEqual(['zak']);
    expect(instructorRows(people, { ...all, faculty: 'wm', department: NO_DEPARTMENT }).map((i) => i.id)).toEqual(['nowak']);
  });

  it('szukanie po nazwisku, imieniu i katedrze — bez polskich znakow', () => {
    expect(instructorRows(people, { ...all, query: 'zak' }).map((i) => i.id)).toEqual(['zak']);
    expect(instructorRows(people, { ...all, query: 'keo' }).map((i) => i.id)).toEqual(['kow']);
    expect(instructorRows(people, { ...all, query: 'jezykow' }).map((i) => i.id)).toEqual(['lis']);
    expect(instructorRows(people, { ...all, query: 'jan nowak' }).map((i) => i.id)).toEqual(['nowak']);
  });
});

describe('katedry i jednostka', () => {
  it('katedry do filtra — tylko z prowadzacymi w wybranym wydziale', () => {
    expect(departmentsInFaculty(people, 'wm').map((d) => d.id)).toEqual(['kmi']);
    expect(departmentsInFaculty(people, 'all').map((d) => d.id)).toEqual(['keo', 'kmi', 'sjo']);
  });

  it('jednostka jak w obsadzie: katedra z wydzialem, bez katedry — wydzial', () => {
    expect(instructorUnit(people[0]!)).toBe('KMiPKM-WM');
    expect(instructorUnit(people[1]!)).toBe('WM');
    expect(instructorUnit(people[3]!)).toBe('SJO');
    expect(instructorUnit(person('x', 'X', 'Y', null, null))).toBeNull();
  });
});

describe('domyslny wydzial', () => {
  it('wydzial dziekanatu albo wydzial z filtra admina, gdy ma prowadzacych', () => {
    expect(defaultFacultyFilter('DEAN_OFFICE', 'wm', 'all', people)).toBe('wm');
    expect(defaultFacultyFilter('DEAN_OFFICE', 'wn', 'all', people)).toBe('all');
    expect(defaultFacultyFilter('ADMIN', null, 'we', people)).toBe('we');
    expect(defaultFacultyFilter('ADMIN', null, 'all', people)).toBe('all');
  });
});
