import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authenticate';
import { validateBody } from '../middleware/validate';
import * as programs from '../controllers/programs.controller';
import {
  programCreateSchema,
  programEntrySchema,
  programUpdateSchema,
  versionCreateSchema,
  versionUpdateSchema,
} from '../schemas/program';

/**
 * Programy studiow (/api/programs), ich wersje (/api/program-versions) i pozycje
 * (/api/program-entries). Odczyt: kadra uczelni; zapis: admin i planista wydzialu
 * (kontroler sprawdza, czy kierunek nalezy do jego wydzialu).
 */
export const programsRouter = Router();
export const programVersionsRouter = Router();
export const programEntriesRouter = Router();

const viewers = authorize('ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR');
const planners = authorize('ADMIN', 'DEAN_OFFICE');

programsRouter.get('/', authenticate, viewers, programs.listPrograms);
programsRouter.post('/', authenticate, planners, validateBody(programCreateSchema), programs.createProgram);
programsRouter.put('/:id', authenticate, planners, validateBody(programUpdateSchema), programs.updateProgram);
programsRouter.delete('/:id', authenticate, planners, programs.deleteProgram);
programsRouter.post('/:id/versions', authenticate, planners, validateBody(versionCreateSchema), programs.createVersion);

programVersionsRouter.get('/:id', authenticate, viewers, programs.getVersion);
programVersionsRouter.put('/:id', authenticate, planners, validateBody(versionUpdateSchema), programs.updateVersion);
programVersionsRouter.delete('/:id', authenticate, planners, programs.deleteVersion);
programVersionsRouter.post('/:id/entries', authenticate, planners, validateBody(programEntrySchema), programs.addEntry);
programVersionsRouter.put('/:id/order', authenticate, planners, programs.reorderEntries);

programEntriesRouter.put('/:id', authenticate, planners, validateBody(programEntrySchema), programs.updateEntry);
programEntriesRouter.delete('/:id', authenticate, planners, programs.deleteEntry);
