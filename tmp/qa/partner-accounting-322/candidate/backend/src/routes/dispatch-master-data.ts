import express from 'express';
import { protect } from '../middleware/auth';
import hrRoutes from './dispatch-master-data.hr';
import vehicleOperationsRoutes from './dispatch-master-data.vehicle-operations';
import guardRoutes from './dispatch-master-data.guard';
import auditRoutes from './dispatch-master-data.audit';

const router = express.Router();
router.use(protect);
router.use(hrRoutes);
router.use(vehicleOperationsRoutes);
router.use(guardRoutes);
router.use(auditRoutes);

export default router;
