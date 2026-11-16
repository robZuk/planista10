import { describe, expect, it } from 'vitest';
import type { Department, Instructor } from '@/types';
import { compareDepartments, departmentLabel, memberOptions, membershipChanges } from './departments';

const WE = { id: 'f-we', name: 'Wydzial Elektryczny', shortName: 'WE' };
const WM = { id: 'f-wm', name: 'Wydzial Mechaniczny', shortName: 'WM' };
const dept = (shortName: string, faculty: typeof WE | null, id = `d-${shortName}`): Department => ({
  id,
  name: `Katedra ${shortName}`,
  shortName,
  facultyId: faculty?.id ?? null,
  faculty,
  createdAt: '2026-11-16',
});
const KEO = dept('KEO', WE);
const KPT = dept('KPT', WM);
const SJO = dept('SJO', null);

const person = (id: string, first: string, last: string, extra: Partial<Instructor> = {}): Instructor => ({
  id,
  firstName: first,
  lastName: last,
  email: `${id}@umg.edu.pl`,
  title: 'dr',
  facultyId: null,
  departmentId: null,
  createdAt: '2026-11-16',
  ...extra,
});

describe('departmentLabel', () => {
  it('katedra wydzialowa ze skrotem wydzialu, jak w zleceniach', () => {
    expect(departmentLabel(KEO)).toBe('KEO-WE');
  });

  it('jednostka miedzywydzialowa — sam skrot', () => {
    expect(departmentLabel(SJO)).toBe('SJO');
  });
});

describe('compareDepartments', () => {
  it('wydzialami, a jednostki miedzywydzialowe na koncu', () => {
    const sorted = [SJO, KPT, dept('KAOiP', WE), KEO].sort(compareDepartments).map(departmentLabel);
    expect(sorted).toEqual(['KAOiP-WE', 'KEO-WE', 'KPT-WM', 'SJO']);
  });
});

describe('memberOptions', () => {
  it('przy nazwisku inna katedra albo wydzial osoby bez katedry; czlonek tej katedry bez dopisku', () => {
    const options = memberOptions(
      [
        person('a', 'Anna', 'Lis', { departmentId: KEO.id, department: KEO, facultyId: WE.id, faculty: { ...WE, createdAt: '' } }),
        person('b', 'Jan', 'Kos', { departmentId: KPT.id, department: KPT }),
        person('c', 'Ewa', 'Mak', { facultyId: WM.id, faculty: { ...WM, createdAt: '' } }),
      ],
      KEO.id,
    );
    expect(options.map((o) => o.label)).toEqual(['dr Anna Lis', 'dr Jan Kos · KPT-WM', 'dr Ewa Mak · WM']);
  });

  it('imiennikow rozroznia e-mail', () => {
    const options = memberOptions([person('t1', 'Tomasz', 'Nowak'), person('t2', 'Tomasz', 'Nowak'), person('x', 'Jan', 'Kos')], KEO.id);
    expect(options.map((o) => o.label)).toEqual([
      'dr Tomasz Nowak · t1@umg.edu.pl',
      'dr Tomasz Nowak · t2@umg.edu.pl',
      'dr Jan Kos',
    ]);
  });
});

describe('membershipChanges', () => {
  const people = [
    person('a', 'Anna', 'Lis', { departmentId: KEO.id, facultyId: WE.id }),
    person('b', 'Jan', 'Kos', { departmentId: KPT.id, facultyId: WM.id }),
    person('c', 'Ewa', 'Mak', { facultyId: WE.id }),
  ];

  it('kto przechodzi z innej katedry, kto zostaje bez katedry i komu zmieni sie wydzial', () => {
    const changes = membershipChanges(people, KEO, ['b', 'c']);
    expect(changes.moving.map((i) => i.id)).toEqual(['b']);
    expect(changes.leaving.map((i) => i.id)).toEqual(['a']);
    expect(changes.facultyChanging.map((i) => i.id)).toEqual(['b']);
  });

  it('jednostka miedzywydzialowa nie zmienia wydzialu', () => {
    expect(membershipChanges(people, SJO, ['a', 'b']).facultyChanging).toEqual([]);
  });
});
