import { Router } from 'express';
import { getAll, create, update, remove } from '../controllers/fieldsOfStudy.controller';
import { authenticate, authorize } from '../middleware/authenticate';
import { validateBody } from '../middleware/validate';
import { fieldOfStudyCreateSchema, fieldOfStudyUpdateSchema } from '../schemas/fieldOfStudy';

const router = Router();

router.get('/', authenticate, authorize('ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR', 'STUDENT'), getAll);
router.post('/', authenticate, authorize('ADMIN'), validateBody(fieldOfStudyCreateSchema), create);
router.put('/:id', authenticate, authorize('ADMIN'), validateBody(fieldOfStudyUpdateSchema), update);
router.delete('/:id', authenticate, authorize('ADMIN'), remove);

export default router;
