import type { Building, ClassType } from '@/types';
import type { ComboboxOption } from '@/components/Combobox';
import { ROOM_TYPES_FOR_CLASS } from './scheduleDisplay';

export interface RoomOption extends ComboboxOption {
  capacity: number;
}

/**
 * Lista sal do wyboru (umieszczenie, przeniesienie terminu, termin reczny): tylko typy sal pasujace do formy zajec, a sale mniejsze niz grupa —
 * do wyboru, ale z dopiskiem (zapis przejdzie, plan pokaze niezgodnosc).
 * Bez formy zajec (np. jeszcze nie wybrano zajec) — wszystkie sale.
 */
export function roomOptionsFor(buildings: Building[], classType?: ClassType | null, groupSize = 0): RoomOption[] {
  const allowed = classType ? ROOM_TYPES_FOR_CLASS[classType] : null;
  return buildings.flatMap((b) =>
    (b.rooms ?? [])
      .filter((r) => !allowed || allowed.includes(r.type))
      .map((r) => ({
        value: r.id,
        label: `${r.number} — ${b.name} (${r.capacity} miejsc)`,
        keywords: b.name,
        capacity: r.capacity,
        hint: groupSize > r.capacity ? `za mala — grupa ma ${groupSize} os.` : undefined,
      })),
  );
}

/** Ostrzezenie pod polem sali, gdy wybrana sala jest mniejsza niz grupa (null — w porzadku). */
export function roomTooSmallMessage(room: RoomOption | undefined, groupSize: number): string | null {
  if (!room || groupSize <= room.capacity) return null;
  return `Sala ma ${room.capacity} miejsc, a grupa ${groupSize} osob — zapis jest mozliwy, ale plan pokaze niezgodnosc.`;
}
