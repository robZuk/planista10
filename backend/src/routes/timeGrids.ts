import { Router } from 'express';
import { listGrids, updateGrid } from '../controllers/timeGrids.controller';
import { authenticate, authorize } from '../middleware/authenticate';
import { validateBody } from '../middleware/validate';
import { timeGridUpdateSchema } from '../schemas/timeGrid';

/** Siatki godzin wydzialow: odczyt dla planistow, zmiany tylko admin. */
const router = Router();

router.get('/', authenticate, authorize('ADMIN', 'DEAN_OFFICE'), listGrids);
router.put('/:id', authenticate, authorize('ADMIN'), validateBody(timeGridUpdateSchema), updateGrid);

export default router;
