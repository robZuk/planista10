import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authenticate';
import * as sections from '../controllers/sections.controller';

/**
 * Zajecia semestru i obsada: /api/terms/:key/sections... (lista, synchronizacja,
 * przeniesienie obsady, eksport/import) oraz /api/sections/:id/instructors.
 */
export const termSectionsRouter = Router({ mergeParams: true });
export const sectionsRouter = Router();

const viewers = authorize('ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR');
const planners = authorize('ADMIN', 'DEAN_OFFICE');

termSectionsRouter.get('/sections', authenticate, viewers, sections.listSections);
termSectionsRouter.get('/sections/export.csv', authenticate, planners, sections.exportCsv);
termSectionsRouter.post('/sections/sync', authenticate, planners, sections.sync);
termSectionsRouter.post('/sections/carry', authenticate, planners, sections.carry);
termSectionsRouter.post('/sections/import', authenticate, planners, sections.importCsv);
termSectionsRouter.get('/workload', authenticate, viewers, sections.workload);

sectionsRouter.put('/:id/instructors', authenticate, planners, sections.setInstructors);
