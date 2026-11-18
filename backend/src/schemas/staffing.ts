import { z } from 'zod';

// Godziny sprawdza lib/staffing.staffProblem (komunikat z nazwa zajec), tu tylko ksztalt.
const staffRow = z.object({
  instructorId: z.string().min(1).nullable(),
  hours: z.number().int(),
});

/** Obsada wielu zajec naraz (np. wszystkie grupy przedmiotu) — podmiana w calosci. */
export const staffReplaceSchema = z.object({
  changes: z
    .array(z.object({ sectionId: z.string().min(1), assignments: z.array(staffRow).max(20) }))
    .min(1)
    .max(2000),
});

/** Godziny jednej osoby w wybranych zajeciach (0 = bez niej); obsada innych zostaje. */
export const personStaffSchema = z.object({
  items: z
    .array(z.object({ sectionId: z.string().min(1), hours: z.number().int().min(0) }))
    .min(1)
    .max(500),
});

/** Przepiecie prowadzacego w planie (Obsada → "Przepnij w planie"); dryRun — tylko podglad kolizji. */
export const planStaffSchema = z.object({
  dryRun: z.boolean(),
  changes: z
    .array(z.object({ placementId: z.string().min(1), instructorId: z.string().min(1).nullable() }))
    .min(1)
    .max(500),
});
