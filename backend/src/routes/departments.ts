import { Router } from 'express';
import { create, getAll, getOne, remove, setInstructors, update } from '../controllers/departments.controller';
import { authenticate, authorize } from '../middleware/authenticate';
import { validateBody } from '../middleware/validate';
import { departmentCreateSchema, departmentInstructorsSchema, departmentUpdateSchema } from '../schemas/department';

/** Katedry: /api/departments — lista dla planistow, zmiany tylko admin (jak prowadzacy). */
const router = Router();

const canView = authorize('ADMIN', 'DEAN_OFFICE');
const canEdit = authorize('ADMIN');

router.get('/', authenticate, canView, getAll);
router.get('/:id', authenticate, canView, getOne);
router.post('/', authenticate, canEdit, validateBody(departmentCreateSchema), create);
router.put('/:id', authenticate, canEdit, validateBody(departmentUpdateSchema), update);
router.put('/:id/instructors', authenticate, canEdit, validateBody(departmentInstructorsSchema), setInstructors);
router.delete('/:id', authenticate, canEdit, remove);

export default router;
