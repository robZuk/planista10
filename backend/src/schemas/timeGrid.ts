import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Godzina w formacie GG:MM');
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

/** Zmiana siatki wydzialu: bloki (kolejnosc dowolna, numeracja wg godziny) i/lub dni z oknem godzin. */
export const timeGridUpdateSchema = z
  .object({
    blocks: z.array(z.object({ startTime: time, endTime: time })).min(1, 'Siatka musi miec co najmniej jeden blok').max(40).optional(),
    days: z
      .array(z.object({ day: z.enum(DAYS), from: time.nullable(), to: time.nullable() }))
      .min(1, 'Wybierz co najmniej jeden dzien zajec')
      .optional(),
  })
  .refine((v) => v.blocks || v.days, 'Podaj bloki albo dni');

export type TimeGridUpdate = z.infer<typeof timeGridUpdateSchema>;
