import { Router } from 'express';
import { getAll, create, update, remove } from '../controllers/specializations.controller';
import { authenticate, authorize } from '../middleware/authenticate';
import { validateBody } from '../middleware/validate';
import { specializationCreateSchema, specializationUpdateSchema } from '../schemas/specialization';

const router = Router();

router.get('/', authenticate, authorize('ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR', 'STUDENT'), getAll);
router.post('/', authenticate, authorize('ADMIN'), validateBody(specializationCreateSchema), create);
router.put('/:id', authenticate, authorize('ADMIN'), validateBody(specializationUpdateSchema), update);
router.delete('/:id', authenticate, authorize('ADMIN'), remove);

export default router;
