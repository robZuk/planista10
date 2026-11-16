/**
 * Katedry w bazie testowej: przykladowe katedry wydzialow, jednostki miedzywydzialowe (SJO,
 * SWFiS) i przypisanie FIKCYJNYCH prowadzacych wg przedmiotu, ktorego ucza najwiecej (obsada).
 * Nazwy i podzial przedmiotow sa przykladowe — to dane testowe, nie struktura uczelni.
 *
 * Dziala na istniejacej bazie i jest idempotentne: katedry zaklada po skrocie, przypisuje tylko
 * prowadzacych bez katedry. Mozna je wiec dolozyc do bazy deweloperskiej bez generowania od nowa:
 *
 *   docker exec planista10-backend-1 npx tsx scripts/pelne-dane/katedry.ts
 *
 * Generator (generuj.ts) wola je po zapisaniu obsady.
 */
import type { PrismaClient } from '@prisma/client';
import { foldName } from '../../src/lib/foldName';

interface UnitDef {
  short: string;
  name: string;
  /** Wzorzec nazwy przedmiotu po foldName (bez wielkosci liter i polskich znakow); brak = katedra domyslna wydzialu. */
  match?: RegExp;
}

// Kolejnosc ma znaczenie: wygrywa pierwszy pasujacy wzorzec, ostatnia pozycja (bez wzorca) zbiera reszte.
const FACULTY_UNITS: Record<string, UnitDef[]> = {
  WE: [
    { short: 'KEO', name: 'Katedra Elektroenergetyki Okrętowej', match: /elektroenerg|energii|naped|instalac|elektroterm|urzadzenia elektr|maszyn elektr|pola elektromagn/ },
    { short: 'KT', name: 'Katedra Telekomunikacji', match: /radio|telekomun|bezprzewod|lacznosc/ },
    { short: 'KAE', name: 'Katedra Automatyki i Elektroniki', match: /automaty|sterowan|wbudowan|mikroprocesor|programowaln|technika cyfrowa|sygnal|miernictw|elektronik/ },
    { short: 'KI', name: 'Katedra Informatyki', match: /informaty|programow|komputer|siec|danych|operacyjn|teleinformat|interakcj|architektur/ },
    { short: 'KMF', name: 'Katedra Matematyki i Fizyki', match: /matemat|fizyk|numeryczn/ },
    { short: 'KPE', name: 'Katedra Podstaw Elektrotechniki' },
  ],
  WM: [
    { short: 'KPT', name: 'Katedra Podstaw Techniki', match: /elektr/ },
    { short: 'KMOiTR', name: 'Katedra Materiałoznawstwa Okrętowego i Technologii Remontów', match: /material|wytwarzan|technolog|remont|obrobk|powierzchn|produkcj|metrolog|nieniszcz|zarzadzania projektami/ },
    { short: 'KSO', name: 'Katedra Siłowni Okrętowych', match: /silown|turbin|silnik|chlodnic|okret|maszyny i urzadzenia|diagnosty|eksploatac|plyny/ },
    { short: 'KMF', name: 'Katedra Matematyki i Fizyki', match: /matemat|fizyk/ },
    { short: 'KPT', name: 'Katedra Podstaw Techniki' },
  ],
  WN: [
    { short: 'KN', name: 'Katedra Nawigacji', match: /nawigac|map elektron|meteorolog|oceanograf|hydrograf|lacznosc|satelit/ },
    { short: 'KTL', name: 'Katedra Transportu i Logistyki', match: /transport|logisty|ruchu|lancuch|przewoz|przeladun|infrastruktur|telematyk/ },
    { short: 'KES', name: 'Katedra Eksploatacji Statku', match: /statk|stateczn|okret|maszyn|materialoznaw|elektr|automaty|eksploatac/ },
    { short: 'KMF', name: 'Katedra Matematyki i Fizyki', match: /matemat|fizyk|stochast|operacyjn|analiz/ },
    { short: 'KI', name: 'Katedra Informatyki', match: /informat|komputer|danych|teleinformat|przestrzenn|grafika/ },
    { short: 'KN', name: 'Katedra Nawigacji' },
  ],
  WZNJ: [
    { short: 'KLiST', name: 'Katedra Logistyki i Systemów Transportowych', match: /logisty|transport|modelowanie i symulacja/ },
    { short: 'KJPPiCH', name: 'Katedra Jakości Produktów Przemysłowych i Chemii', match: /jakosc|normaliz|certyfik|zgodnosc|sensorycz|zywnos|mikrobiolog|chemi|ekolog|sterowanie procesem|eksperyment|eksploatacja i diagnostyka|systemy i urzadzenia/ },
    { short: 'KMI', name: 'Katedra Metod Ilościowych', match: /matemat|statysty|ekonometr/ },
    { short: 'KZiE', name: 'Katedra Zarządzania i Ekonomii' },
  ],
};

// Jednostki bez wydzialu — dla prowadzacych bez wydzialu (w generatorze: pule jezykow i WF).
const SHARED_UNITS: Required<UnitDef>[] = [
  { short: 'SJO', name: 'Studium Języków Obcych', match: /^jezyk/ },
  { short: 'SWFiS', name: 'Studium Wychowania Fizycznego i Sportu', match: /wychowanie fizyczne/ },
];

const unitFor = (units: UnitDef[], subject: string): UnitDef | undefined =>
  units.find((u) => !u.match || u.match.test(foldName(subject)));

export async function assignTestDepartments(prisma: PrismaClient): Promise<{ departments: number; assigned: number }> {
  const faculties = await prisma.faculty.findMany({ select: { id: true, shortName: true } });
  const departmentId = new Map<string, string>(); // "WE|KEO" / "|SJO" -> id

  const ensure = async (facultyId: string | null, facultyShort: string, unit: UnitDef) => {
    const key = `${facultyShort}|${unit.short}`;
    if (departmentId.has(key)) return;
    const found = await prisma.department.findFirst({ where: { facultyId, shortName: unit.short } });
    const department = found ?? (await prisma.department.create({ data: { facultyId, shortName: unit.short, name: unit.name } }));
    departmentId.set(key, department.id);
  };
  for (const faculty of faculties) {
    for (const unit of FACULTY_UNITS[faculty.shortName] ?? []) await ensure(faculty.id, faculty.shortName, unit);
  }
  for (const unit of SHARED_UNITS) await ensure(null, '', unit);

  // Przedmiot, ktorego prowadzacy uczy najwiecej godzin (obsada calej bazy).
  const instructors = await prisma.instructor.findMany({
    where: { departmentId: null },
    select: {
      id: true,
      faculty: { select: { shortName: true } },
      sectionAssignments: { select: { hours: true, section: { select: { programEntry: { select: { subject: { select: { name: true } } } } } } } },
    },
  });
  const members = new Map<string, string[]>(); // departmentId -> prowadzacy
  for (const instructor of instructors) {
    const hoursBySubject = new Map<string, number>();
    for (const a of instructor.sectionAssignments) {
      const name = a.section.programEntry.subject.name;
      hoursBySubject.set(name, (hoursBySubject.get(name) ?? 0) + a.hours);
    }
    const subject = [...hoursBySubject].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
    const facultyShort = instructor.faculty?.shortName ?? '';
    const unit = facultyShort ? unitFor(FACULTY_UNITS[facultyShort] ?? [], subject) : SHARED_UNITS.find((u) => u.match.test(foldName(subject)));
    const id = unit && departmentId.get(`${facultyShort}|${unit.short}`);
    if (id) members.set(id, [...(members.get(id) ?? []), instructor.id]);
  }
  let assigned = 0;
  for (const [id, ids] of members) {
    // Katedry wydzialowe sa z wydzialu prowadzacego, a miedzywydzialowe wydzialu nie zmieniaja.
    assigned += (await prisma.instructor.updateMany({ where: { id: { in: ids } }, data: { departmentId: id } })).count;
  }
  return { departments: departmentId.size, assigned };
}

// Uruchomienie samodzielne: dolozenie katedr do istniejacej bazy (np. deweloperskiej).
if (require.main === module) {
  void (async () => {
    const { prisma } = await import('../../src/lib/prisma');
    const { logger } = await import('../../src/lib/logger');
    try {
      const result = await assignTestDepartments(prisma);
      logger.info(result, 'katedry testowe gotowe');
    } finally {
      await prisma.$disconnect();
    }
  })();
}
