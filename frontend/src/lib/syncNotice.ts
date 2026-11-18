import { plural } from '@/lib/setupSteps';
import { groupSyncProblems, splitArchivedProblems } from '@/lib/syncProblems';
import type { SyncProblem, SyncReport } from '@/types';

/**
 * Komunikat na stronie "Obsada" zamiast przycisku "Synchronizuj zajecia": podglad synchronizacji
 * liczy sie sam przy wejsciu, a komunikat pojawia sie tylko, gdy jest cos do zrobienia. Zmiany
 * dodajace (nowe zajecia, godziny zajec bez planu) stosuja sie same po zapisie naboru, grup,
 * wersji programu albo kalendarza — tu zostaja glownie decyzje: usuniecia, osierocenia i godziny
 * zajec w planie. Stosuje sie je z okna podgladu.
 *  - create   — semestr bez zajec (np. dane sprzed samoczynnej synchronizacji): "Utworz zajecia semestru",
 *  - changes  — zmiany zajec do zastosowania (z podgladem),
 *  - problems — tylko sprawy do wyjasnienia (program w projekcie, brak grupy specjalnosci).
 * Roczniki z kalendarzem w archiwum to informacja, nie problem — same nie daja komunikatu.
 */
export interface SyncNotice {
  kind: 'create' | 'changes' | 'problems';
  title: string;
  description: string;
  action: string;
}

const KIND_LABELS: Record<Exclude<SyncProblem['kind'], 'ARCHIVED_CALENDAR'>, string> = {
  DRAFT_PROGRAM_VERSION: 'wersja programu w projekcie',
  MISSING_SPECIALIZATION_GROUP: 'brak grupy specjalnosci',
  NO_ROOT_GROUP: 'rocznik bez grup',
};

/** Liczba zmian, ktore zastosuje synchronizacja. */
export function syncChanges(report: SyncReport): number {
  return report.created.length + report.hoursChanged.length + report.reactivated.length + report.orphaned.length + report.deleted.length;
}

export function syncNotice(report: SyncReport, sections: number): SyncNotice | null {
  const problems = groupSyncProblems(splitArchivedProblems(report.problems).rest);
  const kinds = [...new Set(problems.map((p) => KIND_LABELS[p.kind as keyof typeof KIND_LABELS] ?? p.message))];
  const toExplain = problems.length > 0 ? `do wyjasnienia: ${problems.length} (${kinds.join(', ')})` : null;
  const changes = syncChanges(report);

  if (sections === 0 && report.created.length > 0) {
    return {
      kind: 'create',
      title: 'Utworz zajecia semestru',
      description: [`${plural(report.created.length, 'zajecia', 'zajecia', 'zajec')} z programow i grup rocznikow`, toExplain]
        .filter(Boolean)
        .join(' · '),
      action: 'Pokaz i utworz',
    };
  }
  if (changes > 0) {
    const parts = [
      report.created.length > 0 && `do dodania: ${report.created.length}`,
      report.hoursChanged.length > 0 && `zmiana godzin: ${report.hoursChanged.length}`,
      report.reactivated.length > 0 && `przywrocone: ${report.reactivated.length}`,
      report.deleted.length > 0 && `do usuniecia: ${report.deleted.length}`,
      report.orphaned.length > 0 && `osierocone: ${report.orphaned.length}`,
      toExplain,
    ].filter(Boolean);
    // Same usuniecia, osierocenia i godziny zajec w planie — to, czego nie stosujemy samoczynnie.
    const decisionsOnly = report.created.length === 0 && report.reactivated.length === 0;
    return {
      kind: 'changes',
      title: decisionsOnly
        ? 'Zmiany zajec czekaja na Twoja decyzje'
        : 'Program lub grupy rocznikow zmienily sie — zajecia czekaja na zmiany',
      description: parts.join(' · '),
      action: `Pokaz i zastosuj (${changes})`,
    };
  }
  if (problems.length > 0) {
    return {
      kind: 'problems',
      title: 'Zajecia zgodne z programem, ale sa sprawy do wyjasnienia',
      description: `${plural(problems.length, 'sprawa', 'sprawy', 'spraw')}: ${kinds.join(', ')} — przedmioty tych rocznikow nie maja zajec`,
      action: 'Pokaz',
    };
  }
  return null;
}
