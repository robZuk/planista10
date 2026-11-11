import { Router } from 'express';
import { getAll, create, update, remove } from '../controllers/subjects.controller';
import { authenticate, authorize } from '../middleware/authenticate';
import { validateBody } from '../middleware/validate';
import { subjectCreateSchema, subjectUpdateSchema } from '../schemas/subject';

const router = Router();

router.get('/', authenticate, authorize('ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR', 'STUDENT'), getAll);
router.post('/', authenticate, authorize('ADMIN'), validateBody(subjectCreateSchema), create);
router.put('/:id', authenticate, authorize('ADMIN'), validateBody(subjectUpdateSchema), update);
router.delete('/:id', authenticate, authorize('ADMIN'), remove);

export default router;
