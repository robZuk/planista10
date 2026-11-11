/**
 * Domyslny rodzaj podgrup w oknie "Podgrupy": kolejny poziom podzialu rocznika — pod rocznikiem
 * i specjalnoscia cwiczenia (C), pod cwiczeniami laboratoria (L), pod laboratoriami projekty (P).
 * Wczesniej pod laboratorium proponowano cwiczenia, co prawie nigdy nie jest tym, czego chcesz.
 */
export function defaultSubPartition(parentKey: string | null): string {
  if (parentKey === 'C') return 'L';
  if (parentKey === 'L') return 'P';
  return 'C';
}
