import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Godzina w formacie GG:MM');
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

const blocks = z.array(z.object({ startTime: time, endTime: time })).min(1, 'Siatka musi miec co najmniej jeden blok').max(40);
const days = z
  .array(z.object({ day: z.enum(DAYS), from: time.nullable(), to: time.nullable() }))
  .min(1, 'Wybierz co najmniej jeden dzien zajec');

/** Zmiana siatki wydzialu: bloki (kolejnosc dowolna, numeracja wg godziny) i/lub dni z oknem godzin. */
export const timeGridUpdateSchema = z
  .object({ blocks: blocks.optional(), days: days.optional() })
  .refine((v) => v.blocks || v.days, 'Podaj bloki albo dni');

/** Siatka dnia: wlasne bloki dla wybranych dni wydzialu i trybu (dni przechodza z siatki podstawowej). */
export const timeGridCreateSchema = z.object({
  facultyId: z.string().trim().min(1, 'Wskaz wydzial'),
  studyMode: z.enum(['FULL_TIME', 'PART_TIME']),
  days,
  blocks,
});

export type TimeGridUpdate = z.infer<typeof timeGridUpdateSchema>;
export type TimeGridCreate = z.infer<typeof timeGridCreateSchema>;
