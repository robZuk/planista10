import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authenticate';
import * as sections from '../controllers/sections.controller';
import { planLocked, termFromKey } from '../middleware/planLocked';

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
// Zapis (dryRun: false) pod blokada semestru: dwa rownolegle przebiegi dublowaly obsade
// (przeniesienie, import) albo wywracaly sie na unikalnym kluczu zajec (synchronizacja).
const locked = planLocked(termFromKey, { onlyWrites: true });
termSectionsRouter.post('/sections/sync', authenticate, planners, locked, sections.sync);
termSectionsRouter.post('/sections/carry', authenticate, planners, locked, sections.carry);
termSectionsRouter.post('/sections/import', authenticate, planners, locked, sections.importCsv);
termSectionsRouter.get('/workload', authenticate, viewers, sections.workload);

sectionsRouter.put('/:id/instructors', authenticate, planners, sections.setInstructors);
