import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authenticate';
import * as cohorts from '../controllers/cohorts.controller';

/**
 * Roczniki (/api/cohorts), ich grupy (/api/cohort-groups) i roczniki w semestrze
 * (/api/terms/:key/cohorts — podpiete w routes/terms.ts). Odczyt dla kadry,
 * zapis dla admina i planisty wydzialu (kontroler sprawdza wydzial programu).
 */
export const cohortsRouter = Router();
export const cohortGroupsRouter = Router();

const viewers = authorize('ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR');
const planners = authorize('ADMIN', 'DEAN_OFFICE');

cohortsRouter.get('/', authenticate, viewers, cohorts.listCohorts);
cohortsRouter.post('/', authenticate, planners, cohorts.createCohort);
cohortsRouter.put('/:id', authenticate, planners, cohorts.updateCohort);
cohortsRouter.delete('/:id', authenticate, planners, cohorts.deleteCohort);
cohortsRouter.get('/:id/groups', authenticate, viewers, cohorts.getCohortGroups);
cohortsRouter.post('/:id/groups', authenticate, planners, cohorts.createGroup);
cohortsRouter.post('/:id/groups/bulk', authenticate, planners, cohorts.createGroupsBulk);

cohortGroupsRouter.get('/options', authenticate, authorize('ADMIN', 'DEAN_OFFICE'), cohorts.listGroupOptions);
cohortGroupsRouter.put('/:id', authenticate, planners, cohorts.updateGroup);
cohortGroupsRouter.delete('/:id', authenticate, planners, cohorts.deleteGroup);
