import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchInstructorOccupancy, fetchRoomOccupancy } from '@/api/occupancy';
import { visibleDays, weekChange } from '@/lib/occupancyView';
import type { OccupancyResource } from '@/types';

const FETCH = { room: fetchRoomOccupancy, instructor: fetchInstructorOccupancy };
const QUERY_KEY = { room: 'room-occupancy', instructor: 'instructor-occupancy' };

/**
 * Tydzien widoku zajetosci (sale albo prowadzacy): tydzien i dzien z adresu (?week=&day=), dane tygodnia,
 * dni widoku (weekend tylko z zajeciami), swieta i przejscia miedzy tygodniami/dniami.
 */
export function useOccupancyWeek(resource: OccupancyResource, termKey: string | undefined) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const weekParam = params.get('week');
  const dayParam = params.get('day');

  const query = useQuery({
    queryKey: [QUERY_KEY[resource], termKey, weekParam ?? 'default'],
    queryFn: async () => {
      const result = await FETCH[resource](termKey!, weekParam);
      // Tydzien domyslny zapisany tez pod swoim poniedzialkiem — powrot do niego z listy nie pobiera go drugi raz.
      if (!weekParam && result.week) queryClient.setQueryData([QUERY_KEY[resource], termKey, result.week], result);
      return result;
    },
    enabled: !!termKey,
    // Przy zmianie tygodnia zostaje poprzedni (z wskaznikiem ladowania) — tabela nie znika.
    placeholderData: keepPreviousData,
  });
  const { data, isPlaceholderData } = query;

  const entries = data?.entries;
  const days = useMemo(() => visibleDays(data?.days ?? [], entries ?? []), [data?.days, entries]);
  const holidays = useMemo(() => new Map((data?.holidays ?? []).map((h) => [h.date, h.name])), [data?.holidays]);
  const week = data?.week ?? null;
  const weeks = useMemo(() => data?.weeks ?? [], [data?.weeks]);
  // Dzien z adresu, gdy nalezy do pokazanego tygodnia (w trakcie ladowania innego tygodnia — tez, zeby
  // widok nie przeskakiwal na chwile na caly tydzien).
  const day = dayParam && week && (days.includes(dayParam) || isPlaceholderData) ? dayParam : null;

  const setParam = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: false },
      ),
    [setParams],
  );
  /** Inny tydzien — w widoku dnia ten sam dzien tygodnia. */
  const goToWeek = (monday: string) => setParam(weekChange(monday, week, day));

  return { ...query, entries, days, holidays, week, weeks, day, dayParam, setParam, goToWeek };
}
