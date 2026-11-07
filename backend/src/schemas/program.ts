import { z } from 'zod';

const hours = z.number().int().min(0).max(1000).default(0);

export const programCreateSchema = z.object({
  code: z.string().trim().min(1, 'Kod jest wymagany').max(30),
  name: z.string().trim().min(1, 'Nazwa jest wymagana').max(200),
  fieldOfStudyId: z.string().min(1, 'Wybierz kierunek'),
  degreeLevel: z.enum(['BACHELOR', 'MASTER']),
  studyMode: z.enum(['FULL_TIME', 'PART_TIME']),
});

export const programUpdateSchema = programCreateSchema.pick({ code: true, name: true });

export const versionCreateSchema = z.object({
  label: z.string().trim().min(1, 'Etykieta jest wymagana').max(80),
  totalSemesters: z.number().int().min(1).max(14).optional(),
  defaultStartType: z.enum(['WINTER', 'SUMMER']).optional(),
  /** Klon istniejacej wersji (tego samego programu) — zmiana programu = nowa wersja. */
  cloneFromVersionId: z.string().optional(),
});

export const versionUpdateSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  status: z.enum(['DRAFT', 'APPROVED']).optional(),
  totalSemesters: z.number().int().min(1).max(14).optional(),
  defaultStartType: z.enum(['WINTER', 'SUMMER']).optional(),
});

export const programEntrySchema = z.object({
  subjectId: z.string().min(1, 'Wybierz przedmiot'),
  semester: z.number().int().min(1),
  /** null = przedmiot wspolny dla calego kierunku */
  specializationId: z.string().nullable().default(null),
  hoursLecture: hours,
  hoursExercise: hours,
  hoursLab: hours,
  hoursProject: hours,
  hoursSeminar: hours,
  ects: z.number().int().min(0).max(60).default(0),
  assessmentType: z.enum(['EXAM', 'CREDIT']).default('CREDIT'),
});

export type ProgramEntryInput = z.infer<typeof programEntrySchema>;
