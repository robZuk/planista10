import { describe, expect, it } from 'vitest';
import { deriveSections, rescaleStaff, scaleHours, type DemandEntry } from './demand';
import type { TreeGroup } from './groupTree';

const g = (id: string, parentId: string | null, partitionKey: string, extra: Partial<TreeGroup> = {}): TreeGroup => ({
  id,
  cohortId: 'k',
  parentId,
  partitionKey,
  code: id,
  fromSemester: 1,
  toSemester: null,
  ...extra,
});

// Rocznik podzielony na specjalnosci DUT/ZEEW; DUT: C-A, C-B, L pod kazda C; ZEEW: C-A, bez L.
const groups = [
  g('root', null, 'ROOT'),
  g('dut', 'root', 'SPEC', { specializationId: 's-dut' }),
  g('zeew', 'root', 'SPEC', { specializationId: 's-zeew' }),
  g('dca', 'dut', 'C'),
  g('dcb', 'dut', 'C'),
  g('dla1', 'dca', 'L'),
  g('dlb1', 'dcb', 'L'),
  g('zca', 'zeew', 'C'),
];

const entry = (id: string, hours: Partial<DemandEntry>, specializationId: string | null = null): DemandEntry => ({
  id,
  specializationId,
  hoursLecture: 0,
  hoursExercise: 0,
  hoursLab: 0,
  hoursProject: 0,
  hoursSeminar: 0,
  ...hours,
});

const ids = (r: ReturnType<typeof deriveSections>, type: string) =>
  r.sections.filter((s) => s.classType === type).map((s) => s.groupId).sort();

describe('deriveSections', () => {
  it('wspolny wyklad osobno dla kazdej specjalnosci (SEPARATE) albo razem (JOINT)', () => {
    const e = [entry('fiz', { hoursLecture: 30 })];
    expect(ids(deriveSections({ entries: e, groups, semester: 1, lectureMode: 'SEPARATE' }), 'LECTURE')).toEqual(['dut', 'zeew']);
    expect(ids(deriveSections({ entries: e, groups, semester: 1, lectureMode: 'JOINT' }), 'LECTURE')).toEqual(['root']);
  });

  it('laboratorium wspolnego przedmiotu: wszystkie grupy L rocznika', () => {
    const r = deriveSections({ entries: [entry('fiz', { hoursLab: 15 })], groups, semester: 1, lectureMode: 'SEPARATE' });
    expect(ids(r, 'LAB')).toEqual(['dla1', 'dlb1']);
    expect(r.sections.every((s) => !s.fallback)).toBe(true);
  });

  it('przedmiot specjalnosciowy bierze grupy tylko ze swojej specjalnosci; brak L -> cwiczeniowe (fallback)', () => {
    const r = deriveSections({ entries: [entry('x', { hoursLab: 30, hoursExercise: 15 }, 's-zeew')], groups, semester: 1, lectureMode: 'SEPARATE' });
    expect(ids(r, 'LAB')).toEqual(['zca']);
    expect(r.sections.find((s) => s.classType === 'LAB')!.fallback).toBe(true);
    expect(ids(r, 'EXERCISE')).toEqual(['zca']);
  });

  it('projekt bez grup P i C -> grupa wykladowa', () => {
    const plain = [g('root', null, 'ROOT')];
    const r = deriveSections({ entries: [entry('p', { hoursProject: 15 })], groups: plain, semester: 1, lectureMode: 'SEPARATE' });
    expect(r.sections).toEqual([{ programEntryId: 'p', classType: 'PROJECT', groupId: 'root', hours: 15, fallback: true }]);
  });

  it('grupy nieaktywne w semestrze sa pomijane', () => {
    const later = [...groups.filter((x) => x.id !== 'dut' && x.id !== 'zeew' && x.parentId === null), g('ca', 'root', 'C', { fromSemester: 3 })];
    const r = deriveSections({ entries: [entry('m', { hoursExercise: 30 })], groups: later, semester: 1, lectureMode: 'SEPARATE' });
    expect(ids(r, 'EXERCISE')).toEqual(['root']);
  });

  it('brak grupy specjalnosci -> zajecia pominiete i problem do pokazania', () => {
    const plain = [g('root', null, 'ROOT')];
    const r = deriveSections({ entries: [entry('x', { hoursLecture: 10 }, 's-dut')], groups: plain, semester: 1, lectureMode: 'SEPARATE' });
    expect(r.sections).toEqual([]);
    expect(r.problems).toHaveLength(1);
    // Rodzaj i specjalnosc, zeby podglad mogl powiedziec, ktorej grupy brakuje.
    expect(r.problems[0]).toMatchObject({ programEntryId: 'x', kind: 'MISSING_SPECIALIZATION_GROUP', specializationId: 's-dut' });
  });

  it('brak grupy "caly rocznik" -> jeden problem bez specjalnosci', () => {
    const r = deriveSections({ entries: [entry('x', { hoursLecture: 10 })], groups: [], semester: 1, lectureMode: 'SEPARATE' });
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'NO_ROOT_GROUP', specializationId: null })]);
  });
});

describe('scaleHours', () => {
  it('bez zmiany godzin kopiuje', () => expect(scaleHours([20, 10], 30)).toEqual([20, 10]));
  it('skaluje proporcjonalnie, reszta dla pierwszego', () => expect(scaleHours([20, 10], 45)).toEqual([30, 15]));
  it('zaokraglenia', () => expect(scaleHours([10, 10, 10], 20)).toEqual([8, 6, 6]));
});

describe('rescaleStaff — obsada po zmianie godzin zajec', () => {
  it('pelna obsada jednej osoby idzie za godzinami (30 -> 20)', () => expect(rescaleStaff([30], 30, 20)).toEqual([20]));
  it('pelna obsada dzielona — proporcjonalnie, suma = nowe godziny', () => expect(rescaleStaff([20, 10], 30, 15)).toEqual([10, 5]));
  it('pelna obsada przy zwiekszeniu godzin zostaje pelna', () => expect(rescaleStaff([15], 15, 30)).toEqual([30]));
  it('niepelna obsada, ktora sie miesci — bez zmian', () => expect(rescaleStaff([10], 30, 20)).toBeNull());
  it('niepelna obsada wieksza niz nowe godziny — przycieta do nowych godzin', () => expect(rescaleStaff([25], 30, 20)).toEqual([20]));
  it('bez obsady albo bez zmiany godzin — nic', () => {
    expect(rescaleStaff([], 30, 20)).toBeNull();
    expect(rescaleStaff([30], 30, 30)).toBeNull();
  });
});
