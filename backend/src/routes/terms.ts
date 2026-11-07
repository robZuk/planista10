import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authenticate';
import { validateBody } from '../middleware/validate';
import * as terms from '../controllers/terms.controller';
import * as cohorts from '../controllers/cohorts.controller';
import {
  calendarBodySchema,
  calendarCreateSchema,
  calendarPreviewSchema,
  calendarStatusSchema,
  termCreateSchema,
} from '../schemas/termCalendar';

/**
 * Semestry kalendarzowe (/api/terms) i ich kalendarze (/api/term-calendars).
 * Odczyt dla wszystkich zalogowanych (kontroler zaweza zakres), zapis dla planistow;
 * zakladanie i usuwanie samych semestrow — tylko admin.
 */
export const termsRouter = Router();
export const termCalendarsRouter = Router();

const viewAll = authorize('ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR', 'STUDENT');
const planners = authorize('ADMIN', 'DEAN_OFFICE');
const admin = authorize('ADMIN');

termsRouter.get('/', authenticate, viewAll, terms.listTerms);
termsRouter.post('/', authenticate, admin, validateBody(termCreateSchema), terms.createTerm);
// Przed '/:key', zeby "holidays" nie zostalo potraktowane jak klucz semestru.
termsRouter.get('/holidays', authenticate, viewAll, terms.statutoryHolidays);
termsRouter.delete('/:key', authenticate, admin, terms.deleteTerm);
termsRouter.get('/:key/calendars', authenticate, viewAll, terms.listCalendars);
termsRouter.get('/:key/calendars/proposal', authenticate, planners, terms.calendarProposal);
termsRouter.post('/:key/calendars', authenticate, planners, validateBody(calendarCreateSchema), terms.createCalendar);
termsRouter.get('/:key/cohorts', authenticate, authorize('ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR'), cohorts.listTermCohorts);
termsRouter.put('/:key/cohorts/:cohortId', authenticate, planners, cohorts.setCohortTerm);

termCalendarsRouter.post('/preview', authenticate, planners, validateBody(calendarPreviewSchema), terms.previewCalendar);
termCalendarsRouter.put('/:id', authenticate, planners, validateBody(calendarBodySchema), terms.updateCalendar);
termCalendarsRouter.put('/:id/status', authenticate, planners, validateBody(calendarStatusSchema), terms.setCalendarStatus);
termCalendarsRouter.delete('/:id', authenticate, planners, terms.deleteCalendar);
