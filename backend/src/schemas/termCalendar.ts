import { z } from 'zod';
import { isIsoDate } from '../lib/isoDate';

const isoDate = z.string().refine(isIsoDate, 'Nieprawidlowa data (RRRR-MM-DD)');

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

export const termCreateSchema = z.object({
  startYear: z.number().int().min(2000).max(2100),
  type: z.enum(['WINTER', 'SUMMER']),
});

/** Tresc kalendarza — wspolna dla zakladania, edycji i podgladu. */
export const calendarBodySchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana').max(60).default('Podstawowy'),
  kind: z.enum(['WEEKLY', 'ZJAZD']),
  startDate: isoDate,
  endDate: isoDate,
  breaks: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Nazwa przerwy jest wymagana').max(80),
        startDate: isoDate,
        endDate: isoDate,
      }),
    )
    .default([]),
  days: z
    .array(
      z.object({
        date: isoDate,
        kind: z.enum(['DAY_OFF', 'FOLLOWS_WEEKDAY', 'CLOSED_FROM']),
        name: z.string().trim().max(80).nullish(),
        followsWeekday: z.enum(DAYS).nullish(),
        closedFromBlockOrder: z.number().int().positive().nullish(),
      }),
    )
    .default([]),
  zjazdy: z
    .array(
      z.object({
        number: z.number().int().positive(),
        startDate: isoDate,
        endDate: isoDate,
      }),
    )
    .default([]),
});

export const calendarCreateSchema = calendarBodySchema.extend({
  studyMode: z.enum(['FULL_TIME', 'PART_TIME']),
  facultyId: z.string().optional(),
  /** Tylko ADMIN: zaloz ten sam kalendarz dla kazdego wydzialu (pomija istniejace). */
  allFaculties: z.boolean().optional(),
});

export const calendarPreviewSchema = calendarBodySchema.extend({
  studyMode: z.enum(['FULL_TIME', 'PART_TIME']),
});

export const calendarStatusSchema = z.object({
  status: z.enum(['PLANNING', 'PUBLISHED', 'ARCHIVED']),
});

export type CalendarBody = z.infer<typeof calendarBodySchema>;
