import { Router, type Request } from 'express';
import { authenticate, authorize } from '../middleware/authenticate';
import { validateBody } from '../middleware/validate';
import { planLocked, termFromKey } from '../middleware/planLocked';
import { prisma } from '../lib/prisma';
import { externalBusySchema } from '../schemas/externalBusy';
import * as external from '../controllers/externalBusy.controller';

/**
 * Zajetosci zewnetrzne (zajecia innych wydzialow zgloszone mailem):
 * /api/terms/:key/external-busy (lista, dodanie) i /api/external-busy/:id (zmiana, usuniecie).
 * Tylko planisci. Zapis pod blokada planu semestru — zmienia zajetosc, z ktora licza sie kolizje.
 */
export const termExternalBusyRouter = Router({ mergeParams: true });
export const externalBusyRouter = Router();

const planners = authorize('ADMIN', 'DEAN_OFFICE');

const termOfExternalBusy = async (req: Request) =>
  (await prisma.externalBusy.findUnique({ where: { id: String(req.params.id) }, select: { termId: true } }))?.termId ?? null;

termExternalBusyRouter.get('/external-busy', authenticate, planners, external.list);
termExternalBusyRouter.post('/external-busy', authenticate, planners, validateBody(externalBusySchema), planLocked(termFromKey), external.create);

externalBusyRouter.put('/:id', authenticate, planners, validateBody(externalBusySchema), planLocked(termOfExternalBusy), external.update);
externalBusyRouter.delete('/:id', authenticate, planners, planLocked(termOfExternalBusy), external.remove);
