import { z } from 'zod';

export const specializationCreateSchema = z.object({
  name: z.string().min(1, 'Nazwa jest wymagana'),
  shortName: z.string().min(1, 'Skrot jest wymagany'),
  fieldOfStudyId: z.string().min(1, 'Kierunek jest wymagany'),
});

/** Zmiana nazwy i skrotu (skrot wchodzi do liczonych nazw grup — zmienia sie wszedzie). */
export const specializationUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana'),
  shortName: z.string().trim().min(1, 'Skrot jest wymagany'),
});
