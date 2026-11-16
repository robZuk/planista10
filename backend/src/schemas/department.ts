import { z } from 'zod';

export const departmentCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana').max(200),
  shortName: z.string().trim().min(1, 'Skrot jest wymagany').max(20),
  // null = jednostka miedzywydzialowa (SJO, prowadzacy zewnetrzni).
  facultyId: z.string().min(1).nullable().optional(),
});

// Aktualizacja czesciowa — dowolne z pol (Prisma pomija undefined).
export const departmentUpdateSchema = departmentCreateSchema.partial();

// Sklad katedry: pelna lista jej prowadzacych (pozostali traca te katedre).
export const departmentInstructorsSchema = z.object({
  instructorIds: z.array(z.string().min(1)).max(5000),
});
