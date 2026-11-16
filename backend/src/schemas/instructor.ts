import { z } from 'zod';

export const instructorCreateSchema = z.object({
  firstName: z.string().trim().min(1, 'Imie jest wymagane').max(80),
  lastName: z.string().trim().min(1, 'Nazwisko jest wymagane').max(80),
  email: z.email('Nieprawidlowy adres email'),
  title: z.string().trim().max(60).optional(),
  // null = bez wydzialu / bez katedry (undefined w aktualizacji = bez zmian).
  facultyId: z.string().min(1).nullable().optional(),
  departmentId: z.string().min(1).nullable().optional(),
});

export const instructorUpdateSchema = instructorCreateSchema.partial();
