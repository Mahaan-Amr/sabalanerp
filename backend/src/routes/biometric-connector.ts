import express from 'express';
import { protect } from '../middleware/auth';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess } from '../middleware/feature';
import { DeterministicBiometricSimulator, readBiometricConnectorDiagnostics } from '../services/biometricConnector';

const router = express.Router();
const simulator = new DeterministicBiometricSimulator();

router.get(
  '/diagnostics',
  protect,
  requireFeatureAccess(FEATURES.ACCOUNTING_BIOMETRIC_DIAGNOSTICS_VIEW, FEATURE_PERMISSIONS.VIEW),
  async (_req, res) => {
    const diagnostics = await readBiometricConnectorDiagnostics(simulator);
    res.json({ success: true, data: diagnostics });
  },
);

export default router;
