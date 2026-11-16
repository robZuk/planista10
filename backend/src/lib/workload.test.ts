import { describe, expect, it } from 'vitest';
import { aggregateWorkload, type WorkloadEntry } from './workload';

const MIBM = { id: 'c-mibm', code: 'MiBM-N1', semester: 1, label: 'MiBM-N1 · nabor 2026/27' };
const EDST = { id: 'c-edst', code: 'EDST-S1', semester: 3, label: 'EDST-S1 · nabor 2025/26' };
const ELEKTRO = { id: 's-el', name: 'Elektrotechnika i elektronika I' };
const METRO = { id: 's-me', name: 'Metrologia' };

const entry = (instructorId: string, sectionId: string, hours: number, over: Partial<WorkloadEntry> = {}): WorkloadEntry => ({
  instructorId,
  hours,
  sectionId,
  sectionHours: 15,
  cohortId: MIBM.id,
  programEntryId: 'pe-el',
  classType: 'EXERCISE',
  view: { cohort: MIBM, subject: ELEKTRO, order: 2, group: sectionId.toUpperCase(), studyMode: 'PART_TIME' },
  ...over,
});

describe('aggregateWorkload', () => {
  it('grupy tych samych zajec skladaja sie w jedna pozycje jak w arkuszu katedry (3 gr. × 15 h = 45 h)', () => {
    const [person] = aggregateWorkload([entry('a', 'c3', 15), entry('a', 'c1', 15), entry('a', 'c2', 15)]);
    expect(person!.items).toHaveLength(1);
    expect(person!.items[0]!.hours).toBe(45);
    expect(person!.items[0]!.groups.map((g) => g.name)).toEqual(['C1', 'C2', 'C3']);
  });

  it('godziny w widoku osobno stacjonarne i niestacjonarne, a zajecia innych wydzialow tylko w sumie uczelni', () => {
    const [person] = aggregateWorkload([
      entry('a', 'c1', 15),
      entry('a', 'w1', 30, {
        cohortId: EDST.id,
        programEntryId: 'pe-me',
        classType: 'LECTURE',
        view: { cohort: EDST, subject: METRO, order: 1, group: 'EDST', studyMode: 'FULL_TIME' },
      }),
      entry('a', 'obce', 20, { view: null }),
    ]);
    expect(person).toMatchObject({ here: 45, fullTime: 30, partTime: 15, total: 65 });
  });

  it('osoby bez zajec w widoku pomija; kolejnosc od najwiekszego obciazenia', () => {
    const people = aggregateWorkload([entry('maly', 'c1', 10), entry('duzy', 'c2', 30), entry('obcy', 'x', 50, { view: null })]);
    expect(people.map((p) => p.instructorId)).toEqual(['duzy', 'maly']);
  });

  it('pozycje w kolejnosci rocznikow, programu i form', () => {
    const [person] = aggregateWorkload([
      entry('a', 'l1', 15, { classType: 'LAB' }),
      entry('a', 'w1', 15, { classType: 'LECTURE' }),
      entry('a', 'e1', 15, { cohortId: EDST.id, programEntryId: 'pe-me', view: { cohort: EDST, subject: METRO, order: 1, group: 'E', studyMode: 'FULL_TIME' } }),
    ]);
    expect(person!.items.map((i) => `${i.cohort.code} ${i.classType}`)).toEqual(['EDST-S1 EXERCISE', 'MiBM-N1 LECTURE', 'MiBM-N1 LAB']);
  });
});
