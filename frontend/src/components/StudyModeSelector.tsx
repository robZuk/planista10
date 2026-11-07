import { Clock } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { STUDY_MODE_LABELS, STUDY_MODES } from '@/lib/labels';
import { useStudyModeFilterStore, type StudyModeFilter } from '@/store/studyModeFilterStore';

/** Przelacznik trybu studiow, dzielony miedzy widokami, ktore filtruja po trybie. */
export function StudyModeSelector() {
  const { studyMode, setStudyMode } = useStudyModeFilterStore();

  return (
    <Select value={studyMode} onValueChange={(value) => setStudyMode(value as StudyModeFilter)}>
      <SelectTrigger className="w-44" aria-label="Tryb studiow">
        <Clock className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Tryb studiow" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Wszystkie tryby</SelectItem>
        {STUDY_MODES.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {STUDY_MODE_LABELS[mode]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
