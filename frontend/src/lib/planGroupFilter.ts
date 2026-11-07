/**
 * Filtr grupy w Ukladaniu planu: "co ma student tej grupy" — wybrana grupa i jej
 * przodkowie (C-A widzi tez wyklad i zajecia calego rocznika), bez rodzenstwa i podgrup
 * (C-A nie widzi C-B ani laboratoriow L-A1). Ta sama regula dla siatki i listy
 * "Do zaplanowania". Opcje filtra ukladaja sie w drzewo grup rocznika.
 */

interface GroupRef {
  id: string;
  name: string;
  /** Przodkowie od korzenia, bez samej grupy. */
  ancestors: { id: string; name: string }[];
}

export interface GroupTreeOption {
  id: string;
  name: string;
  depth: number;
}

/** Grupy widoczne przy filtrze albo null, gdy filtra nie ma (albo grupy nie ma w drzewie). */
export function visibleGroupIds(groups: GroupRef[], filterId: string): Set<string> | null {
  if (filterId === 'all') return null;
  const chosen = groups.find((g) => g.id === filterId);
  if (chosen) return new Set([chosen.id, ...chosen.ancestors.map((a) => a.id)]);
  // Grupa nadrzedna bez wlasnych zajec (np. caly rocznik) — znana tylko jako przodek.
  for (const g of groups) {
    const i = g.ancestors.findIndex((a) => a.id === filterId);
    if (i >= 0) return new Set(g.ancestors.slice(0, i + 1).map((a) => a.id));
  }
  return null;
}

/**
 * Opcje filtra w kolejnosci drzewa (rodzic, pod nim podgrupy wg nazwy) z glebokoscia.
 * Obejmuje tez przodkow bez wlasnych zajec, zeby drzewo nie mialo dziur.
 */
export function groupTreeOptions(groups: GroupRef[]): GroupTreeOption[] {
  const names = new Map<string, string>();
  const parentOf = new Map<string, string | null>();
  for (const g of groups) {
    const chain = [...g.ancestors, { id: g.id, name: g.name }];
    chain.forEach((node, i) => {
      names.set(node.id, node.name);
      if (!parentOf.has(node.id)) parentOf.set(node.id, i > 0 ? chain[i - 1]!.id : null);
    });
  }
  const children = new Map<string | null, string[]>();
  for (const [id, parent] of parentOf) children.set(parent, [...(children.get(parent) ?? []), id]);
  const byName = (a: string, b: string) => names.get(a)!.localeCompare(names.get(b)!, 'pl', { numeric: true });

  const out: GroupTreeOption[] = [];
  const visit = (id: string, depth: number) => {
    out.push({ id, name: names.get(id)!, depth });
    for (const child of (children.get(id) ?? []).sort(byName)) visit(child, depth + 1);
  };
  for (const root of (children.get(null) ?? []).sort(byName)) visit(root, 0);
  return out;
}

/** Etykieta opcji w natywnym <select>: wciecie twardymi spacjami + znacznik galezi. */
export function treeOptionLabel(option: GroupTreeOption): string {
  return option.depth === 0 ? option.name : `${'   '.repeat(option.depth - 1)} └ ${option.name}`;
}
