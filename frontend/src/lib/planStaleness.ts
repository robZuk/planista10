import type { StaleReason } from '@/types';

const REASON_TEXT: Record<StaleReason, string> = {
  PLACEMENTS: 'wzorzec zmienil sie',
  SECTIONS: 'godziny zajec zmienily sie (synchronizacja z programem)',
  DELETED: 'usunieto zajecia z wzorca, a ich terminy wciaz sa w „Terminach”',
  CALENDAR: 'zmienil sie kalendarz rocznika (daty, przerwy, dni wolne, zjazdy albo wybor kalendarza)',
};

/** Komunikat "Terminy nieaktualne": wszystkie powody w jednym zdaniu. */
export function staleMessage(reasons: StaleReason[]): string {
  const parts = reasons.map((r) => REASON_TEXT[r]);
  if (parts.length === 0) return '';
  const text = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} i ${parts[parts.length - 1]}`;
  return `Po ostatnim generowaniu ${text}.`;
}
