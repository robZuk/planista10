/**
 * Pozycja programu, z ktorej powstaly juz zajecia (ClassSection), jest czescia historii planu:
 * zajecia wskazuja ja kluczem obcym i czerpia z niej przedmiot, specjalnosc i semestr. Zmiana
 * tych pol przepisalaby zajecia takze w poprzednich semestrach. Godziny, ECTS i zaliczenie
 * mozna zmieniac — zajecia maja wlasna kopie godzin, a biezacy semestr poprawia synchronizacja.
 */

export interface EntryIdentity {
  subjectId: string;
  specializationId: string | null;
  semester: number;
}

/** Nazwy pol tozsamosci, ktore zmienia edycja (pusta lista = zmiana dozwolona przy zajeciach). */
export function lockedEntryChanges(current: EntryIdentity, input: EntryIdentity): string[] {
  const changes: string[] = [];
  if (input.subjectId !== current.subjectId) changes.push('przedmiot');
  if ((input.specializationId ?? null) !== (current.specializationId ?? null)) changes.push('specjalnosc');
  if (input.semester !== current.semester) changes.push('semestr');
  return changes;
}

/** Komunikat 409 przy zmianie tozsamosci pozycji, z ktorej powstaly zajecia. */
export function lockedEntryMessage(changes: string[], sections: number): string {
  return (
    `Z tej pozycji powstaly juz zajecia (${sections}) — nie zmienia sie: ${changes.join(', ')} ` +
    '(zmienilyby sie tez zajecia w poprzednich semestrach). Godziny, ECTS i zaliczenie mozna zmieniac; ' +
    'inna zmiane zrob w nowej wersji programu (klon).'
  );
}

/** Komunikat 409 przy usuwaniu pozycji, z ktorej powstaly zajecia. */
export function lockedEntryDeleteMessage(sections: number): string {
  return (
    `Z tej pozycji powstaly juz zajecia (${sections}) — nie mozna jej usunac. Jesli sa tylko w biezacym ` +
    'semestrze: wyzeruj godziny, uruchom „Synchronizuj zajecia” i usun pozycje. Inaczej usun ja w nowej wersji programu (klon).'
  );
}
