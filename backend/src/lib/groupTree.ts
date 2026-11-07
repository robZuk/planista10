/**
 * Drzewo grup rocznika — czyste funkcje (bez bazy).
 *
 * Rocznik ma korzen (ROOT = caly rocznik). Pod nim grupy dziela studentow na rozlaczne
 * czesci wedlug PODZIALU (partitionKey): SPEC (specjalnosci), C (cwiczeniowe),
 * L (laboratoryjne), P, S albo wlasny (np. JEZ — jezyki). Dzieci jednego rodzica
 * o tym samym podziale sa rozlaczne (C-A i C-B nie maja wspolnych studentow);
 * dzieci o roznych podzialach moga sie przecinac (P-A i C-B — nie wiadomo, kto gdzie).
 *
 * Regula nakladania (kolizje planu, widok studenta):
 *   - grupa koliduje ze swoimi przodkami i potomkami,
 *   - dwie grupy sa ROZLACZNE, gdy ich sciezki od korzenia rozchodza sie w jakims
 *     wezle przez TEN SAM podzial; w przeciwnym razie koliduja,
 *   - grupy roznych rocznikow nie koliduja.
 * To zamyka luke starego modelu, w ktorym projekt P-A nie kolidowal z laboratorium L-A1.
 */

export const ROOT = 'ROOT';
export const SPEC = 'SPEC';

export interface TreeGroup {
  id: string;
  cohortId: string;
  parentId: string | null;
  partitionKey: string;
  code: string | null;
  specializationId?: string | null;
  fromSemester: number;
  toSemester: number | null;
}

export function isActiveIn(group: Pick<TreeGroup, 'fromSemester' | 'toSemester'>, semester: number): boolean {
  return group.fromSemester <= semester && (group.toSemester === null || semester <= group.toSemester);
}

export type GroupIndex = Map<string, TreeGroup>;

export function indexGroups(groups: TreeGroup[]): GroupIndex {
  return new Map(groups.map((g) => [g.id, g]));
}

/** Sciezka od korzenia do grupy (wlacznie). Odporna na cykle i brakujacych rodzicow. */
export function pathFromRoot(id: string, index: GroupIndex): TreeGroup[] {
  const path: TreeGroup[] = [];
  const seen = new Set<string>();
  let current = index.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }
  return path;
}

/** Czy dwie grupy moga miec wspolnych studentow. */
export function groupsOverlap(aId: string, bId: string, index: GroupIndex): boolean {
  if (aId === bId) return true;
  const a = index.get(aId);
  const b = index.get(bId);
  if (!a || !b || a.cohortId !== b.cohortId) return false;
  const pathA = pathFromRoot(aId, index);
  const pathB = pathFromRoot(bId, index);
  let i = 0;
  while (i < pathA.length && i < pathB.length && pathA[i]!.id === pathB[i]!.id) i++;
  // Jedna sciezka jest przedrostkiem drugiej -> przodek/potomek.
  if (i === pathA.length || i === pathB.length) return true;
  // Rozchodza sie w tym samym wezle: rozlaczne tylko przy tym samym podziale.
  // (Gdy i === 0, sciezki nie maja wspolnego korzenia — dane niespojne, traktujemy ostroznie.)
  if (i === 0) return true;
  return pathA[i]!.partitionKey !== pathB[i]!.partitionKey;
}

/** Wszystkie grupy z listy, ktore nakladaja sie na wskazana (wlacznie z nia sama). */
export function overlappingIds(id: string, groups: TreeGroup[], index: GroupIndex = indexGroups(groups)): Set<string> {
  return new Set(groups.filter((g) => groupsOverlap(id, g.id, index)).map((g) => g.id));
}

/** Litera formy w nazwie grupy: korzen i specjalnosc to grupy wykladowe (W). */
export function typeLetter(partitionKey: string): string {
  return partitionKey === ROOT || partitionKey === SPEC ? 'W' : partitionKey;
}

export interface NamingContext {
  fieldShortName: string;
  specShortNames: Map<string, string>;
  partTime: boolean;
  /** Numer semestru programu, w ktorym nazwe pokazujemy. */
  semester: number;
}

/**
 * Nazwa grupy liczona, nie wpisywana — rocznik 2024 w semestrze 3 sam ma nazwy "-3-".
 * Format jak w dotychczasowych danych: {DUT|EDST}{-SN}-{semestr}-{W|C|L|P|S}{-kod}.
 */
export function displayName(group: TreeGroup, index: GroupIndex, ctx: NamingContext): string {
  const path = pathFromRoot(group.id, index);
  const spec = [...path].reverse().find((g) => g.partitionKey === SPEC && g.specializationId);
  const prefix = (spec?.specializationId && ctx.specShortNames.get(spec.specializationId)) || ctx.fieldShortName;
  const showCode = group.partitionKey !== ROOT && group.partitionKey !== SPEC && group.code;
  return `${prefix}${ctx.partTime ? '-SN' : ''}-${ctx.semester}-${typeLetter(group.partitionKey)}${showCode ? `-${group.code}` : ''}`;
}

/** Kody kolejnych grup podzialu: A, B, C... albo dla podgrup: A1, A2 (z kodem rodzica). */
export function nextCodes(count: number, parentCode: string | null, existing: string[]): string[] {
  const taken = new Set(existing);
  const codes: string[] = [];
  for (let i = 0; codes.length < count && i < 200; i++) {
    const code = parentCode ? `${parentCode}${i + 1}` : String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '');
    if (!taken.has(code)) codes.push(code);
  }
  return codes;
}
