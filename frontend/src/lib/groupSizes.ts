/**
 * Podzialy grupy (cwiczeniowe, laboratoryjne, specjalnosci...) dziela jej studentow na
 * rozlaczne czesci — suma liczebnosci jednego podzialu nie powinna przekraczac grupy.
 * Nie blokujemy zapisu (liczebnosci bywaja szacunkowe), tylko pokazujemy rozjazd.
 */
export interface PartitionOverflow {
  partitionKey: string;
  sum: number;
}

export function partitionOverflows(
  parent: { size: number },
  children: { partitionKey: string | null; size: number }[],
): PartitionOverflow[] {
  const sums = new Map<string, number>();
  for (const c of children) {
    const key = c.partitionKey ?? '';
    sums.set(key, (sums.get(key) ?? 0) + c.size);
  }
  return [...sums]
    .filter(([, sum]) => sum > parent.size)
    .map(([partitionKey, sum]) => ({ partitionKey, sum }))
    .sort((a, b) => a.partitionKey.localeCompare(b.partitionKey));
}
