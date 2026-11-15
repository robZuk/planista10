import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authenticate';
import * as plan from '../controllers/plan.controller';
import * as setup from '../controllers/termSetup.controller';
import { planLocked, termFromKey, termOfOccurrence, termOfPlacement } from '../middleware/planLocked';

/**
 * Plan semestru (nowy model): /api/terms/:key/plan..., /api/placements/:id,
 * /api/occurrences/:id. Zapis dla admina i planisty wydzialu — tylko oni odwoluja, przenosza
 * i odrabiaja terminy (prowadzacy i student plan tylko ogladaja).
 */
export const termPlanRouter = Router({ mergeParams: true });
export const placementsRouter = Router();
export const occurrencesRouter = Router();

// Plan w trakcie ukladania (takze kalendarze "w planowaniu") widza tylko planisci;
// prowadzacy i student maja "Moj plan" z opublikowanych kalendarzy (/my-plan).
const planners = authorize('ADMIN', 'DEAN_OFFICE');

termPlanRouter.get('/plan', authenticate, planners, plan.getPlan);
termPlanRouter.get('/plan/availability', authenticate, planners, plan.getAvailability);
termPlanRouter.post('/placements', authenticate, planners, planLocked(termFromKey), plan.createPlacement);
termPlanRouter.post('/generate', authenticate, planners, planLocked(termFromKey, { onlyWrites: true }), plan.generateTerms);
termPlanRouter.get('/occurrences', authenticate, planners, plan.listOccurrences);
termPlanRouter.post('/occurrences', authenticate, planners, planLocked(termFromKey), plan.createManualOccurrence);
termPlanRouter.get('/makeups', authenticate, planners, plan.listCancelledToMakeUp);
termPlanRouter.post('/plan/carry', authenticate, planners, planLocked(termFromKey, { onlyWrites: true }), setup.carryPlanHandler);
termPlanRouter.get('/setup', authenticate, planners, setup.setupStatus);
termPlanRouter.get('/my-plan', authenticate, authorize('INSTRUCTOR', 'STUDENT'), setup.myPlan);

placementsRouter.put('/:id', authenticate, planners, planLocked(termOfPlacement), plan.updatePlacement);
placementsRouter.delete('/:id', authenticate, planners, plan.deletePlacement);

occurrencesRouter.put('/:id', authenticate, planners, planLocked(termOfOccurrence), plan.changeOccurrence);
occurrencesRouter.delete('/:id', authenticate, planners, plan.deleteManualOccurrence);
