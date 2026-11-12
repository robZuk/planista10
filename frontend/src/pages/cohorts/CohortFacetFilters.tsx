import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { CohortFacets, FacetFilters } from './cohortFilters';

/**
 * Pola filtrow rocznikow w kolejnosci zaleznosci: tryb, kierunek, stopien, semestr.
 * Kazda lista ma tylko opcje mozliwe przy pozostalych filtrach, z liczba rocznikow.
 * Podczas ladowania rocznikow liczby pomijamy — zapamietany filtr pokazywalby "(0)".
 */
export function CohortFacetFilters({
  filters,
  facets,
  onChange,
  loading = false,
}: {
  filters: FacetFilters;
  facets: CohortFacets;
  onChange: <K extends keyof FacetFilters>(key: K, value: FacetFilters[K]) => void;
  loading?: boolean;
}) {
  const fields: {
    key: keyof FacetFilters;
    label: string;
    all: string;
    className: string;
  }[] = [
    { key: 'studyMode', label: 'Tryb studiow', all: 'Wszystkie tryby', className: 'w-44' },
    { key: 'fieldOfStudyId', label: 'Kierunek', all: 'Wszystkie kierunki', className: 'w-48' },
    { key: 'degreeLevel', label: 'Stopien studiow', all: 'Wszystkie stopnie', className: 'w-44' },
    { key: 'semester', label: 'Semestr programu', all: 'Wszystkie semestry', className: 'w-44' },
  ];
  return (
    <>
      {fields.map(({ key, label, all, className }) => (
        <NativeSelect
          key={key}
          aria-label={label}
          className={className}
          value={filters[key]}
          title={facets[key].find((o) => o.value === filters[key])?.label ?? all}
          onChange={(e) => onChange(key, e.target.value as FacetFilters[typeof key])}
        >
          <NativeSelectOption value="all">{all}</NativeSelectOption>
          {facets[key].map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>
              {loading ? o.label : `${o.label} (${o.count})`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ))}
    </>
  );
}
