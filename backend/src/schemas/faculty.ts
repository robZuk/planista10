import { z } from 'zod';

export const facultyCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana').max(200),
  shortName: z.string().trim().min(1, 'Skrot jest wymagany').max(20),
});

// Aktualizacja czesciowa — dowolne z pol (Prisma pomija undefined).
export const facultyUpdateSchema = facultyCreateSchema.partial();
