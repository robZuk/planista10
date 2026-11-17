import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import type { SectionGroup } from '@/lib/obsadaGroups';
import type { ClassSectionRow, Instructor } from '@/types';

/**
 * Zlecenia dla katedr: pozycje przedmiot × forma przypisane katedrze (kolumna "Katedra" w zleceniu
 * wydzialu) i stan ich obsady. Braki to godziny bez prowadzacego (NN tez jest brakiem).
 */

/** Godziny zajec obsadzone prowadzacymi (NN sie nie liczy), najwyzej godziny zajec. */
export function staffedHours(section: Pick<ClassSectionRow, 'hours' | 'instructors'>): number {
  return Math.min(section.hours, section.instructors.reduce((sum, i) => sum + (i.instructorId ? i.hours : 0), 0));
}

export interface DepartmentOrder {
  /** null = pozycje bez katedry. */
  id: string | null;
  label: string;
  name: string | null;
  groups: SectionGroup[];
  hours: number;
  staffed: number;
  /** Godziny bez prowadzacego. */
  missing: number;
}

/** Podsumowanie zlecen: katedry alfabetycznie, "Bez katedry" na koncu. */
export function departmentOrders(groups: SectionGroup[]): DepartmentOrder[] {
  const map = new Map<string, DepartmentOrder>();
  for (const g of groups) {
    const key = g.department?.id ?? '';
    let order = map.get(key);
    if (!order) {
      order = { id: g.department?.id ?? null, label: g.department?.label ?? 'Bez katedry', name: g.department?.name ?? null, groups: [], hours: 0, staffed: 0, missing: 0 };
      map.set(key, order);
    }
    order.groups.push(g);
    for (const s of g.sections) {
      order.hours += s.hours;
      order.staffed += staffedHours(s);
    }
    order.missing = order.hours - order.staffed;
  }
  return [...map.values()].sort((a, b) => (!a.id !== !b.id ? (a.id ? -1 : 1) : a.label.localeCompare(b.label, 'pl')));
}

export interface DepartmentSuggestion {
  group: SectionGroup;
  department: { id: string; label: string; name: string };
}

/**
 * Podpowiedz katedr z obsady: pozycja bez katedry, ktorej wszyscy prowadzacy (bez NN) naleza do
 * jednej katedry, dostaje te katedre. Pozycje bez obsady albo z osobami z roznych katedr — nie.
 */
export function suggestDepartments(
  groups: SectionGroup[],
  instructors: Pick<Instructor, 'id' | 'department'>[],
  labelOf: (d: NonNullable<Instructor['department']>) => string,
): DepartmentSuggestion[] {
  const departmentOf = new Map(instructors.map((i) => [i.id, i.department ?? null]));
  // Pozycja programu obowiazuje kilka rocznikow — katedre ustala obsada ze wszystkich jej grup,
  // zeby dwa roczniki nie podpowiedzialy roznych katedr dla tej samej pozycji.
  const byEntry = new Map<string, SectionGroup[]>();
  for (const g of groups) {
    if (g.department || g.archived) continue;
    const key = `${g.programEntryId}|${g.classType}`;
    byEntry.set(key, [...(byEntry.get(key) ?? []), g]);
  }
  return [...byEntry.values()].flatMap((list) => {
    const ids = list.flatMap((g) => g.sections.flatMap((s) => s.instructors.map((i) => i.instructorId).filter((id): id is string => !!id)));
    if (ids.length === 0) return [];
    const departments = ids.map((id) => departmentOf.get(id) ?? null);
    const first = departments[0];
    if (!first || departments.some((d) => d?.id !== first.id)) return [];
    return [{ group: list[0]!, department: { id: first.id, label: labelOf(first), name: first.name } }];
  });
}

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Zlecenie dla katedry jako CSV (srednik, UTF-8 z BOM — Excel otwiera z polskimi znakami):
 * jak arkusz wydzialu — rocznik, semestr, przedmiot, forma, grupy, godziny i obecna obsada.
 */
export function orderCsv(order: Pick<DepartmentOrder, 'groups'>): string {
  const header = ['Rocznik', 'Semestr', 'Przedmiot', 'Specjalnosc', 'Forma', 'Liczba grup', 'Godzin razem', 'Obsada', 'Braki (h)'];
  const lines = order.groups.map((g) => {
    const staff = g.sections
      .map((s) => `${s.group.name}: ${s.instructors.length ? s.instructors.map((i) => `${i.name} ${i.hours} h`).join(', ') : 'brak'}`)
      .join(' | ');
    const missing = g.sections.reduce((sum, s) => sum + s.hours - staffedHours(s), 0);
    return [g.cohort.code, g.cohort.semester, g.subject.name, g.specialization ?? '', CLASS_FULL_LABELS[g.classType], g.sections.length, g.hours, staff, missing];
  });
  return '﻿' + [header, ...lines].map((cells) => cells.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
