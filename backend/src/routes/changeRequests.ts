import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authenticate';
import * as requests from '../controllers/changeRequests.controller';
import * as notifications from '../controllers/notifications.controller';

/**
 * Zgloszenia zmian: /api/terms/:key/requests|makeups, /api/occurrences/:id/request(s|-options),
 * /api/change-requests/:id/(approve|reject|withdraw). Powiadomienia: /api/notifications.
 */
export const termRequestsRouter = Router({ mergeParams: true });
export const occurrenceRequestsRouter = Router();
export const changeRequestsRouter = Router();
export const notificationsRouter = Router();

const involved = authorize('ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR');
const planners = authorize('ADMIN', 'DEAN_OFFICE');
const instructors = authorize('INSTRUCTOR');

termRequestsRouter.get('/requests', authenticate, involved, requests.list);
termRequestsRouter.get('/makeups', authenticate, involved, requests.makeups);

occurrenceRequestsRouter.get('/:id/request-options', authenticate, instructors, requests.options);
occurrenceRequestsRouter.post('/:id/requests', authenticate, instructors, requests.create);

changeRequestsRouter.post('/:id/approve', authenticate, planners, requests.approve);
changeRequestsRouter.post('/:id/reject', authenticate, planners, requests.reject);
changeRequestsRouter.post('/:id/withdraw', authenticate, instructors, requests.withdraw);

notificationsRouter.get('/', authenticate, notifications.list);
notificationsRouter.post('/read-all', authenticate, notifications.markAllRead);
notificationsRouter.post('/:id/read', authenticate, notifications.markRead);
