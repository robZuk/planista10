import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchInstructors } from '@/api/instructors';
import type { ComboboxOption } from '@/components/Combobox';
import { instructorOptions } from '@/lib/departments';
import { NN } from '@/lib/staffRows';

/**
 * Prowadzacy do wyboru w oknach obsady (z katedra przy nazwisku). `withNN` doklada na poczatku
 * "NN (wakat)" — w obsadzie zajec tak, przy wyborze osoby do Obciazen nie.
 */
export function useInstructorOptions(withNN: boolean) {
  const { data: instructors, isPending } = useQuery({ queryKey: ['instructors'], queryFn: fetchInstructors });
  const options = useMemo<ComboboxOption[]>(
    () => [...(withNN ? [{ value: NN, label: 'NN (wakat)' }] : []), ...instructorOptions(instructors ?? [])],
    [instructors, withNN],
  );
  return { options, instructors, isPending };
}
