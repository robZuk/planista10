import { z } from 'zod';

export const fieldOfStudyCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana').max(200),
  shortName: z.string().trim().min(1, 'Skrot jest wymagany').max(20),
  facultyId: z.string().min(1, 'Wydzial jest wymagany'),
});

/** Zmiana nazwy i skrotu; przeniesienie kierunku do innego wydzialu nie jest edycja. */
export const fieldOfStudyUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana').max(200),
  shortName: z.string().trim().min(1, 'Skrot jest wymagany').max(20),
});
