import { z } from 'zod';
import { isIsoDate } from '../lib/isoDate';
import { MAX_EXTERNAL_DATES } from '../lib/externalBusy';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Godzina w formacie GG:MM');
const isoDate = (message: string) => z.string().refine(isIsoDate, message);

/**
 * Zajetosc zewnetrzna (zajecia innych wydzialow zgloszone mailem): prowadzacy i/lub sala,
 * godziny (GG:MM — inne wydzialy maja inne siatki) i konkretne daty.
 */
export const externalBusySchema = z.object({
  source: z.string().trim().min(1, 'Podaj, kto zglosil (np. „WE – dziekanat”)').max(200),
  receivedOn: isoDate('Nieprawidlowa data zgloszenia'),
  instructorId: z.string().min(1).nullable(),
  roomId: z.string().min(1).nullable(),
  startTime: time,
  endTime: time,
  dates: z.array(isoDate('Nieprawidlowa data')).min(1, 'Podaj co najmniej jedna date').max(MAX_EXTERNAL_DATES),
  note: z.string().trim().max(500).nullable().optional(),
});

export type ExternalBusyBody = z.infer<typeof externalBusySchema>;
