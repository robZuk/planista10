/**
 * Dopasowanie w listach z wyszukiwaniem (Combobox): kazde wpisane slowo musi wystapic jako
 * fragment tekstu — bez "rozmytego" dopasowania cmdk, ktore dla "Aula" zwracalo sale Centrum
 * Symulatorowego (litery a-u-l-a w dowolnych miejscach). Bez znaczenia wielkosc liter i polskie
 * znaki: "wroblewski" znajdzie "Wróblewski".
 */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');
}

export function matchesAllWords(text: string, query: string): boolean {
  const haystack = normalizeForSearch(text);
  return normalizeForSearch(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
