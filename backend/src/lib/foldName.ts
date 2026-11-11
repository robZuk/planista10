/**
 * Nazwa do porownan "czy to juz istnieje": bez wielkosci liter, polskich znakow i nadmiarowych
 * spacji ("Wydzial  mechaniczny" == "Wydział Mechaniczny"). W interfejsie wiele osob pisze
 * bez diakrytykow — bez tego powstawaly prawie-duplikaty.
 */
export function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
