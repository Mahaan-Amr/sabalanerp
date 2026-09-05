import express from 'express';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess } from '../middleware/feature';
import { DeterministicBiometricSimulator, readBiometricConnectorDiagnostics } from '../services/biometricConnector';
import { prisma } from '../lib/prisma';
import { BiometricWorkstationGateway, readBiometricWorkstationConfig } from '../services/biometricWorkstationGateway';
import { reconcileBiometricConnectorChallenges } from '../services/biometricConnectorReconciliation';

const router = express.Router();
const simulator = new DeterministicBiometricSimulator();
const access = [protect, requireFeatureAccess(FEATURES.ACCOUNTING_BIOMETRIC_DIAGNOSTICS_VIEW, FEATURE_PERMISSIONS.VIEW)];
const reconcileAccess = [protect, authorize('ADMIN')];
const gateway = () => new BiometricWorkstationGateway(prisma, readBiometricWorkstationConfig());
const liveEnrollmentReady = async (now = new Date()) => process.env.BIOMETRIC_CONNECTOR_MODE === 'physical'
  && process.env.BIOMETRIC_LEGAL_READY === 'true'
  && Boolean(await prisma.biometricGovernancePolicy.findFirst({ where: { activeFrom: { lte: now }, OR: [{ retiredAt: null }, { retiredAt: { gt: now } }] }, select: { id: true } }));

router.get(
  '/diagnostics',
  ...access,
  async (_req, res) => {
    const physical = process.env.BIOMETRIC_CONNECTOR_MODE === 'physical';
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const abandonedBefore = new Date(now.getTime() - 5 * 60_000);
    const [latest, failedConnectorCommands, expiredEnrollments, unhealthyConfirmations, expiredAuthorizations, unhealthyProjections, auditExceptions, activeOutages, smsAttention] = await Promise.all([
      physical ? prisma.biometricConnectorChallenge.findFirst({ where: { operation: 'HEALTH', status: 'COMPLETED' }, orderBy: { completedAt: 'desc' } }) : null,
      prisma.biometricConnectorChallenge.count({ where: { OR: [{ status: 'ISSUED', expiresAt: { lt: now } }, { status: 'PROCESSING', processingStartedAt: { lt: abandonedBefore } }] } }),
      prisma.driverBiometricEnrollment.count({ where: { status: 'ACTIVE', retentionUntil: { lte: now } } }),
      prisma.dispatchConfirmationSession.count({ where: { status: { in: ['FAILED', 'EXPIRED'] }, OR: [{ failedAt: { gte: since } }, { expiresAt: { gte: since, lte: now } }] } }),
      prisma.dispatchExitAuthorization.count({ where: { status: 'ACTIVE', validUntil: { lte: now } } }),
      prisma.shipmentQuantityProjection.count({ where: { health: { not: 'CURRENT' } } }),
      prisma.dispatchEvidenceException.count({ where: { status: 'OPEN' } }),
      prisma.dispatchOutage.count({ where: { status: 'VERIFIED' } }),
      prisma.dispatchBuyerSmsIntent.count({ where: { OR: [{ status: { in: ['UNKNOWN', 'NEEDS_ATTENTION'] } }, { status: 'RETRY', availableAt: { lte: now } }] } }),
    ]);
    const platform = { connector: failedConnectorCommands, lifecycle: expiredEnrollments, confirmation: unhealthyConfirmations, authorization: expiredAuthorizations,
      projection: unhealthyProjections, auditIntegrity: auditExceptions, outage: activeOutages, sms: smsAttention };
    const diagnostics = physical ? { mode: 'PHYSICAL', availability: (latest?.resultSummary as any)?.availability || 'UNKNOWN', liveEnrollmentEnabled: await liveEnrollmentReady(now),
      checkedAt: latest?.completedAt?.toISOString() || null, device: (latest?.resultSummary as any)?.device || null,
      supportedChecks: ['capture-quality', 'liveness', 'one-to-one-match', 'retry-recovery', 'licensing'], platform } : { ...(await readBiometricConnectorDiagnostics(simulator)), platform };
    res.json({ success: true, data: diagnostics });
  },
);

router.post('/diagnostics/command', ...access, async (req: AuthRequest, res) => {
  try { res.status(201).json({ success: true, data: await gateway().issueHealth({ workstationId: String(req.body.workstationId || ''), actorId: req.user!.id }) }); }
  catch (error) { res.status(409).json({ success: false, error: error instanceof Error ? error.message : 'Biometric diagnostics are unavailable.' }); }
});

router.post('/diagnostics/reconcile', ...reconcileAccess, async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await reconcileBiometricConnectorChallenges(prisma, { actorId: req.user!.id }) }); }
  catch (error) { res.status(409).json({ success: false, error: error instanceof Error ? error.message : 'Biometric reconciliation failed.' }); }
});

router.post('/diagnostics/result', ...access, async (req: AuthRequest, res) => {
  try {
    const claimed = await gateway().claimHealth({ challengeId: String(req.body.challengeId || ''), actorId: req.user!.id, signedResponse: req.body.signedResponse });
    await gateway().complete([claimed.challenge.id], true);
    res.json({ success: true, data: { mode: 'PHYSICAL', availability: claimed.response.result.availability, liveEnrollmentEnabled: await liveEnrollmentReady(),
      checkedAt: claimed.response.completedAt, device: claimed.response.result.device, supportedChecks: ['capture-quality', 'liveness', 'one-to-one-match', 'retry-recovery', 'licensing'] } });
  } catch (error) { res.status(409).json({ success: false, error: error instanceof Error ? error.message : 'Biometric diagnostics are unavailable.' }); }
});

export default router;
