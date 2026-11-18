import { describe, expect, it } from 'vitest';
import type { ClassSectionRow } from '@/types';
import { groupSections } from './obsadaGroups';
import { departmentOrders, orderCsv, staffedHours, suggestDepartments } from './departmentOrders';

const KEO = { id: 'd-keo', name: 'Katedra Elektroenergetyki Okretowej', label: 'KEO-WE' };
const row = (id: string, over: Partial<ClassSectionRow> = {}): ClassSectionRow => ({
  id,
  cohort: { id: 'c1', label: 'MiBM-N1', code: 'MiBM-N1', semester: 1, archived: false },
  subject: { id: 'el', name: 'Elektrotechnika', code: null },
  programEntryId: 'pe-el',
  programVersionId: 'v1',
  department: null,
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
const staff = (instructorId: string | null, hours: number) => ({ id: `${instructorId}-${hours}`, instructorId, name: instructorId ?? 'NN', hours });

describe('zlecenia dla katedr', () => {
  it('obsadzone godziny: NN to brak, nadmiar sie nie liczy', () => {
    expect(staffedHours(row('c1', { instructors: [staff('a', 10), staff(null, 5)] }))).toBe(10);
    expect(staffedHours(row('c1', { instructors: [staff('a', 20)] }))).toBe(15);
  });

  it('podsumowanie na katedre z brakami, bez katedry na koncu', () => {
    const groups = groupSections([
      row('c1', { department: KEO, instructors: [staff('a', 15)] }),
      row('c2', { department: KEO }),
      row('w1', { classType: 'LECTURE', programEntryId: 'pe-x', subject: { id: 'x', name: 'Fizyka', code: null } }),
    ]);
    const orders = departmentOrders(groups);
    expect(orders.map((o) => `${o.label} ${o.hours}/${o.staffed} brak ${o.missing}`)).toEqual(['KEO-WE 30/15 brak 15', 'Bez katedry 15/0 brak 15']);
  });

  it('podpowiedz z obsady tylko, gdy wszyscy prowadzacy sa z jednej katedry', () => {
    const groups = groupSections([
      row('c1', { instructors: [staff('a', 15)] }),
      row('c2', { instructors: [staff('b', 15)] }),
      row('w1', { classType: 'LECTURE', instructors: [staff('a', 15), staff('x', 15)] }),
      row('l1', { classType: 'LAB', instructors: [staff(null, 15)] }),
    ]);
    const instructors = [
      { id: 'a', department: { ...KEO, shortName: 'KEO', facultyId: 'we', faculty: { id: 'we', name: 'WE', shortName: 'WE' }, createdAt: '' } },
      { id: 'b', department: { ...KEO, shortName: 'KEO', facultyId: 'we', faculty: { id: 'we', name: 'WE', shortName: 'WE' }, createdAt: '' } },
      { id: 'x', department: null },
    ];
    const suggestions = suggestDepartments(groups, instructors, () => 'KEO-WE');
    expect(suggestions.map((s) => `${s.group.classType} ${s.department.label}`)).toEqual(['EXERCISE KEO-WE']);
  });

  it('CSV zlecenia: BOM, srednik, obsada grup i braki', () => {
    const [order] = departmentOrders(groupSections([row('c1', { department: KEO, instructors: [staff('a', 15)] }), row('c2', { department: KEO })]));
    const csv = orderCsv(order!);
    expect(csv.startsWith('﻿Rocznik;Semestr;Przedmiot')).toBe(true);
    expect(csv).toContain('MiBM-N1;1;Elektrotechnika;;Cwiczenia;2;30;C1: a 15 h | C2: brak;15');
  });
});
