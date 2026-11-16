/**
 * Oznaczenie katedry jak w zleceniach wydzialu: skrot katedry i wydzialu ("KEO-WE");
 * jednostka miedzywydzialowa (SJO) — sam skrot. Jak frontend/src/lib/departments.
 */
export function departmentLabel(department: { shortName: string; faculty: { shortName: string } | null }): string {
  return department.faculty ? `${department.shortName}-${department.faculty.shortName}` : department.shortName;
}
