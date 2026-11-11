import { z } from 'zod';

export const subjectCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana'),
  // Pusty kod = brak kodu (kontroler zapisuje null, zeby przedmioty bez kodu nie zderzaly sie na unikalnosci).
  code: z.string().trim().optional(),
});

export const subjectUpdateSchema = subjectCreateSchema;
