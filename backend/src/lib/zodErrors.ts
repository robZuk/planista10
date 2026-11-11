import { z } from 'zod';
import { plural } from './plural';

/**
 * Bledy walidacji API po polsku (bez diakrytykow) — trafiaja wprost do komunikatow w UI
 * (np. "Semestr: Wartosc nie moze byc mniejsza niz 1" zamiast
 * "semester: Too small: expected number to be >=1"). Komunikat podany w schemacie ma
 * pierwszenstwo. Ten sam slownik co frontend/src/lib/zodErrors.
 */
const chars = (n: number) => plural(n, 'znak', 'znaki', 'znakow');

export function polishZodMessage(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.expected === 'number' || issue.expected === 'int') {
        return issue.expected === 'int' ? 'Podaj liczbe calkowita' : 'Podaj liczbe';
      }
      if (issue.input === undefined) return 'Pole jest wymagane';
      return 'Nieprawidlowa wartosc';
    case 'too_small':
      if (issue.origin === 'number' || issue.origin === 'int') {
        return issue.inclusive ? `Wartosc nie moze byc mniejsza niz ${issue.minimum}` : `Wartosc musi byc wieksza niz ${issue.minimum}`;
      }
      if (issue.origin === 'string') {
        return Number(issue.minimum) <= 1 ? 'Pole nie moze byc puste' : `Wpisz co najmniej ${chars(Number(issue.minimum))}`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') return `Podaj co najmniej ${issue.minimum}`;
      return undefined;
    case 'too_big':
      if (issue.origin === 'number' || issue.origin === 'int') {
        return issue.inclusive ? `Wartosc nie moze byc wieksza niz ${issue.maximum}` : `Wartosc musi byc mniejsza niz ${issue.maximum}`;
      }
      if (issue.origin === 'string') return `Wpisz najwyzej ${chars(Number(issue.maximum))}`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Podaj najwyzej ${issue.maximum}`;
      return undefined;
    case 'invalid_format':
      if (issue.format === 'email') return 'To nie wyglada na adres email';
      return 'Nieprawidlowy format';
    case 'invalid_value':
      return 'Niedozwolona wartosc';
    default:
      return undefined;
  }
}

/** Polskie nazwy pol ze schematow API — do prefiksu komunikatu ("Semestr: ..."). */
const FIELD_LABELS: Record<string, string> = {
  name: 'Nazwa',
  shortName: 'Skrot',
  code: 'Kod',
  label: 'Etykieta',
  title: 'Tytul',
  firstName: 'Imie',
  lastName: 'Nazwisko',
  email: 'E-mail',
  password: 'Haslo',
  address: 'Adres',
  number: 'Numer',
  capacity: 'Pojemnosc',
  type: 'Typ',
  kind: 'Rodzaj',
  status: 'Status',
  semester: 'Semestr',
  totalSemesters: 'Liczba semestrow',
  defaultStartType: 'Semestr rozpoczecia',
  ects: 'ECTS',
  hoursLecture: 'Godziny wykladu',
  hoursExercise: 'Godziny cwiczen',
  hoursLab: 'Godziny laboratorium',
  hoursProject: 'Godziny projektu',
  hoursSeminar: 'Godziny seminarium',
  assessmentType: 'Forma zaliczenia',
  subjectId: 'Przedmiot',
  specializationId: 'Specjalnosc',
  facultyId: 'Wydzial',
  fieldOfStudyId: 'Kierunek',
  instructorId: 'Prowadzacy',
  studentGroupIds: 'Grupy studenckie',
  studyMode: 'Tryb studiow',
  degreeLevel: 'Stopien studiow',
  startYear: 'Rok',
  startDate: 'Data poczatku',
  endDate: 'Data konca',
  date: 'Data',
  breaks: 'Przerwy',
  days: 'Dni',
  zjazdy: 'Zjazdy',
  blocks: 'Bloki',
  startTime: 'Poczatek',
  endTime: 'Koniec',
  from: 'Od',
  to: 'Do',
  day: 'Dzien',
  followsWeekday: 'Plan dnia',
  closedFromBlockOrder: 'Odwolane od bloku',
};

/** "Semestr: Wartosc ..." albo "Przerwy (2.) — Nazwa: ..." dla pol w listach. */
export function formatZodIssue(issue: z.core.$ZodIssue): string {
  const parts: string[] = [];
  for (const key of issue.path) {
    if (typeof key === 'number') parts.push(`(${key + 1}.)`);
    else parts.push(FIELD_LABELS[String(key)] ?? String(key));
  }
  const where = parts.join(' ').replace(/\) (?=\S)/g, ') — ');
  return where ? `${where}: ${issue.message}` : issue.message;
}

export function installPolishZodErrors(): void {
  z.config({ customError: polishZodMessage });
}
