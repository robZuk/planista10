import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchFaculties } from '@/api/faculties';
import { useFacultyFilterStore } from '@/store/facultyStore';

/** Przelacznik wydzialu, dzielony miedzy widokami, ktore filtruja po wydziale. */
export function FacultySelector() {
  const { facultyId, setFacultyId } = useFacultyFilterStore();
  const { data: faculties } = useQuery({ queryKey: ['faculties'], queryFn: fetchFaculties });

  // Zapamietany wydzial moze nie istniec (usuniety, inna baza): bez resetu lista bylaby pusta,
  // a przelacznik nie pokazalby, ze cokolwiek filtruje. Wracamy na "Wszystkie wydzialy".
  useEffect(() => {
    if (facultyId !== 'all' && faculties && !faculties.some((faculty) => faculty.id === facultyId)) {
      setFacultyId('all');
    }
  }, [faculties, facultyId, setFacultyId]);

  return (
    <Select value={facultyId} onValueChange={setFacultyId}>
      <SelectTrigger className="w-48" aria-label="Wydzial">
        <Landmark className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Wydzial" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Wszystkie wydzialy</SelectItem>
        {faculties?.map((faculty) => (
          <SelectItem key={faculty.id} value={faculty.id}>
            {faculty.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
