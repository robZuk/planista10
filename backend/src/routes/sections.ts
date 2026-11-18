import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authenticate';
import * as sections from '../controllers/sections.controller';
import { planLocked, termFromKey } from '../middleware/planLocked';
import { validateBody } from '../middleware/validate';
import { personStaffSchema, planStaffSchema, staffReplaceSchema } from '../schemas/staffing';

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
// Obsada wielu zajec naraz (grupy przedmiotu) i godziny jednej osoby (Obciazenia) — zawsze zapis,
// wiec zawsze pod blokada semestru (jak przeniesienie i import obsady).
termSectionsRouter.put('/staff', authenticate, planners, validateBody(staffReplaceSchema), planLocked(termFromKey), sections.replaceStaffHandler);
termSectionsRouter.put(
  '/instructors/:instructorId/staff',
  authenticate,
  planners,
  validateBody(personStaffSchema),
  planLocked(termFromKey),
  sections.personStaffHandler,
);

// Plan a obsada: zajecia w planie z prowadzacym spoza obsady albo NN mimo obsady; przepiecie z podgladem.
termSectionsRouter.get('/plan-staff', authenticate, planners, sections.planStaffList);
termSectionsRouter.post('/plan-staff', authenticate, planners, validateBody(planStaffSchema), locked, sections.planStaffChange);

sectionsRouter.put('/:id/instructors', authenticate, planners, sections.setInstructors);
