import { Router } from 'express';
import { createGrid, deleteGrid, listGrids, updateGrid } from '../controllers/timeGrids.controller';
import { authenticate, authorize } from '../middleware/authenticate';
import { validateBody } from '../middleware/validate';
import { timeGridCreateSchema, timeGridUpdateSchema } from '../schemas/timeGrid';

/** Siatki godzin wydzialow (podstawowe i siatki dnia): odczyt dla planistow, zmiany tylko admin. */
const router = Router();

router.get('/', authenticate, authorize('ADMIN', 'DEAN_OFFICE'), listGrids);
router.post('/', authenticate, authorize('ADMIN'), validateBody(timeGridCreateSchema), createGrid);
router.put('/:id', authenticate, authorize('ADMIN'), validateBody(timeGridUpdateSchema), updateGrid);
router.delete('/:id', authenticate, authorize('ADMIN'), deleteGrid);

export default router;
