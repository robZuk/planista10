import { describe, expect, it } from 'vitest';
import type { ClassSectionRow, Instructor, WorkloadItem, WorkloadPerson } from '@/types';
import { freeHoursFor, groupLabel, groupSections, groupSize, personHours } from './obsadaGroups';
import { NO_DEPARTMENT, inMode, itemSize, workloadBlocks } from './workloadView';

const cohort = { id: 'c1', label: 'MiBM-N1 · nabor 2026/27', code: 'MiBM-N1', semester: 1, archived: false };
const row = (id: string, over: Partial<ClassSectionRow> = {}): ClassSectionRow => ({
  id,
  cohort,
  subject: { id: 'el', name: 'Elektrotechnika i elektronika I', code: null },
  order: 1,
  specialization: null,
  specializationName: null,
  classType: 'EXERCISE',
  group: { id: `g-${id}`, partitionKey: 'C', name: id.toUpperCase() },
  hours: 15,
  status: 'ACTIVE',
  assignedHours: 0,
  hasVacancy: true,
  instructors: [],
  ...over,
});

describe('groupSections', () => {
  it('grupy tych samych zajec w jednej pozycji, z suma godzin i brakami', () => {
    const [group, ...rest] = groupSections([
      row('c1', { assignedHours: 15, hasVacancy: false }),
      row('c2'),
      row('c3', { assignedHours: 20, hasVacancy: false }),
    ]);
    expect(rest).toHaveLength(0);
    expect(group).toMatchObject({ hours: 45, assignedHours: 30, hasVacancy: true });
    expect(groupSize(group!)).toBe('3 gr. × 15 h');
    expect(groupLabel(group!)).toBe('MiBM-N1 s1 · Elektrotechnika i elektronika I · cwiczenia');
  });

  it('ten sam przedmiot innej specjalnosci i inna forma to osobne pozycje', () => {
    const groups = groupSections([row('c1'), row('w1', { classType: 'LECTURE' }), row('c2', { specialization: 'ESOiOO' })]);
    expect(groups.map((g) => g.sections.length)).toEqual([1, 1, 1]);
    expect(groupLabel(groups[2]!)).toContain('(ESOiOO)');
  });
});

describe('godziny osoby w zajeciach', () => {
  const section = row('c1', {
    hours: 30,
    instructors: [
      { id: 'a1', instructorId: 'a', name: 'A', hours: 10 },
      { id: 'n1', instructorId: null, name: 'NN', hours: 20 },
    ],
  });

  it('wolne godziny: bez obsady innych, NN ustepuje, wlasne godziny sie nie licza', () => {
    expect(freeHoursFor(section, 'b')).toBe(20);
    expect(freeHoursFor(section, 'a')).toBe(30);
    expect(personHours(section, 'a')).toBe(10);
    expect(personHours(section, 'b')).toBe(0);
  });
});

const item = (studyMode: WorkloadItem['studyMode'], hours: number): WorkloadItem => ({
  key: `${studyMode}-${hours}`,
  cohort: { id: 'c1', code: 'MiBM', semester: 1, label: 'MiBM' },
  subject: { id: 's', name: 'Przedmiot' },
  order: 1,
  classType: 'LECTURE',
  studyMode,
  groups: [],
  hours,
});
const KEO = { id: 'd-keo', name: 'Katedra Elektroenergetyki Okretowej', label: 'KEO-WE' };
const KPT = { id: 'd-kpt', name: 'Katedra Podstaw Techniki', label: 'KPT-WM' };
const person = (id: string, department: typeof KEO | null, fullTime: number, partTime: number): WorkloadPerson => ({
  id,
  name: `dr ${id}`,
  department,
  here: fullTime + partTime,
  fullTime,
  partTime,
  total: fullTime + partTime,
  items: [...(fullTime ? [item('FULL_TIME', fullTime)] : []), ...(partTime ? [item('PART_TIME', partTime)] : [])],
});

describe('itemSize', () => {
  const g = (hours: number) => ({ sectionId: `s${hours}`, name: 'G', hours, sectionHours: 15 });
  it('jak w arkuszu katedry', () => {
    expect(itemSize({ groups: [g(15), g(15), g(15)], hours: 45 })).toBe('3 gr. × 15 h = 45 h');
    expect(itemSize({ groups: [g(15), g(10)], hours: 25 })).toBe('2 gr. = 25 h');
    expect(itemSize({ groups: [g(30)], hours: 30 })).toBe('30 h');
  });
});

describe('obciazenia w ukladzie katedr', () => {
  const people = [person('Nowak', KEO, 30, 15), person('Lis', KEO, 60, 0), person('Kos', KPT, 0, 20), person('Mak', null, 10, 0)];

  it('katedry alfabetycznie z sumami, bez katedry na koncu; osoby od najwiekszego obciazenia', () => {
    const blocks = workloadBlocks(people, { department: 'all', mode: 'all', search: '' });
    expect(blocks.map((b) => `${b.label} ${b.hours}`)).toEqual(['KEO-WE 105', 'KPT-WM 20', 'Bez katedry 10']);
    expect(blocks[0]!.people.map((p) => p.id)).toEqual(['Lis', 'Nowak']);
  });

  it('tryb jak arkusz "niestac": tylko pozycje i godziny niestacjonarne, osoby bez nich znikaja', () => {
    const blocks = workloadBlocks(people, { department: 'all', mode: 'PART_TIME', search: '' });
    expect(blocks.map((b) => `${b.label} ${b.hours}`)).toEqual(['KEO-WE 15', 'KPT-WM 20']);
    expect(inMode(people[0]!, 'PART_TIME').items).toHaveLength(1);
  });

  it('wybrana katedra pokazuje tez czlonkow bez godzin (do dopisania zajec z arkusza)', () => {
    const members = [
      { id: 'Zet', firstName: 'Zet', lastName: 'Zet', title: 'mgr', departmentId: KEO.id, department: { ...KEO, shortName: 'KEO', facultyId: 'we', faculty: { id: 'we', name: 'WE', shortName: 'WE' }, createdAt: '' } },
    ] as unknown as Instructor[];
    const [block] = workloadBlocks(people, { department: KEO.id, mode: 'all', search: '', members });
    expect(block!.people.map((p) => `${p.id} ${p.here}`)).toEqual(['Lis 60', 'Nowak 45', 'Zet 0']);
    expect(block!.people[2]!.department?.label).toBe('KEO-WE');
  });

  it('bez katedry i szukanie po nazwisku', () => {
    expect(workloadBlocks(people, { department: NO_DEPARTMENT, mode: 'all', search: '' }).map((b) => b.label)).toEqual(['Bez katedry']);
    expect(workloadBlocks(people, { department: 'all', mode: 'all', search: 'nowak' })[0]!.people.map((p) => p.id)).toEqual(['Nowak']);
  });
});
