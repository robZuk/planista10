import { Router } from 'express';
import { getAll } from '../controllers/timeBlocks.controller';
import { authenticate, authorize } from '../middleware/authenticate';

const router = Router();

router.get('/', authenticate, authorize('ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR'), getAll);

export default router;
