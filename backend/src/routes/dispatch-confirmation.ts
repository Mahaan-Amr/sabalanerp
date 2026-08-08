import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { protect, AuthRequest } from '../middleware/auth';
import { FEATURE_PERMISSIONS, FEATURES, requireNarrowFeatureAccess } from '../middleware/feature';
import { DeterministicBiometricSimulator } from '../services/biometricSimulator';
import { ProtectedTemplateVault } from '../services/biometricTemplateVault';
import { DispatchConfirmationConflictError, DispatchConfirmationService, DispatchConfirmationValidationError } from '../services/dispatchConfirmation';
import smsService from '../services/smsService';
import bcrypt from 'bcryptjs';
import { BiometricConnector } from '../services/biometricProtocol';
import { createHmac, randomUUID } from 'node:crypto';
import { PilotSafetyPauseError } from '../services/dispatchCutover';
import { resolveNarrowFeatureAccess } from '../services/narrowFeatureAccess';

const router = express.Router();
const prisma = new PrismaClient();
const unavailableConnector: BiometricConnector = { execute: async (command) => ({ commandId: command.commandId, operation: command.operation,
  availability: 'UNAVAILABLE', device: { model: 'UNCONFIGURED', serial: 'UNCONFIGURED', connectorVersion: 'none', sdkVersion: 'none' },
  captureQuality: { state: 'NOT_EVALUATED' }, liveness: { state: 'NOT_EVALUATED' }, match: { state: 'NOT_EVALUATED' },
  fallback: { goodQualityLiveNonMatchCount: 0, eligible: false }, errorCategory: 'INVALID_COMMAND', retryable: false }) };

const service = () => {
  const encodedKey = process.env.BIOMETRIC_TEMPLATE_KEY_BASE64 || '';
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new DispatchConfirmationConflictError('Biometric template protection is not configured.');
  const simulatorAllowed = process.env.NODE_ENV !== 'production' && process.env.BIOMETRIC_CONNECTOR_MODE === 'simulator';
  return new DispatchConfirmationService(prisma, { connector: simulatorAllowed ? new DeterministicBiometricSimulator() : unavailableConnector,
    vault: new ProtectedTemplateVault({ activeKeyId: 'dispatch-v1', keys: { 'dispatch-v1': key } }),
    otpSecret: process.env.DISPATCH_CONFIRMATION_OTP_SECRET || '',
    production: process.env.NODE_ENV === 'production', legalReadinessEnabled: process.env.BIOMETRIC_LEGAL_READY === 'true',
    sendOtp: async ({ phone, code }) => { const result = await smsService.sendVerificationCode(phone, code); if (!result.success) throw new Error(result.error || 'OTP delivery failed'); } });
};
const handle = (res: Response, error: unknown) => {
  if (error instanceof DispatchConfirmationValidationError) return res.status(400).json({ success: false, error: error.message });
  if (error instanceof DispatchConfirmationConflictError || error instanceof PilotSafetyPauseError) return res.status(409).json({ success: false, error: error.message });
  console.error('Dispatch confirmation error:', error);
  return res.status(500).json({ success: false, error: 'Dispatch confirmation failed.' });
};
const hrManage = [protect, requireNarrowFeatureAccess(FEATURES.HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE, FEATURE_PERMISSIONS.EDIT)];
const accountingManage = [protect, requireNarrowFeatureAccess(FEATURES.ACCOUNTING_DISPATCH_CONFIRMATION_MANAGE, FEATURE_PERMISSIONS.EDIT)];
const guardApprove = [protect, requireNarrowFeatureAccess(FEATURES.SECURITY_DISPATCH_CONFIRMATION_APPROVE, FEATURE_PERMISSIONS.EDIT)];
const evidenceView = [protect, requireNarrowFeatureAccess(FEATURES.SECURITY_DISPATCH_EVIDENCE_VIEW, FEATURE_PERMISSIONS.VIEW)];

router.get('/capabilities', protect, async (req: AuthRequest, res) => {
  try {
    const resolve = (workspace: string, feature: string) => resolveNarrowFeatureAccess(prisma,
      { userId: req.user!.id, role: req.user!.role, workspace, feature, requiredPermission: 'edit' });
    const [accountingCandidates, accountingConfirmation, guardConfirmation, hrBiometric] = await Promise.all([
      resolve('accounting', FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE),
      resolve('accounting', FEATURES.ACCOUNTING_DISPATCH_CONFIRMATION_MANAGE),
      resolve('security', FEATURES.SECURITY_DISPATCH_CONFIRMATION_APPROVE),
      resolve('hr', FEATURES.HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE),
    ]);
    return res.json({ success: true, data: { canManageAccountingCandidates: accountingCandidates.allowed,
      canManageAccountingConfirmation: accountingConfirmation.allowed, canApproveGuardConfirmation: guardConfirmation.allowed,
      canManageHrBiometric: hrBiometric.allowed } });
  } catch (error) { return handle(res, error); }
});

router.post('/governance-policies', hrManage, async (req: AuthRequest, res) => {
  try { return res.status(201).json({ success: true, data: await service().recordGovernancePolicy({ ...req.body,
    counselApprovedAt: new Date(req.body.counselApprovedAt), activeFrom: req.body.activeFrom ? new Date(req.body.activeFrom) : undefined, actorId: req.user!.id }) }); }
  catch (error) { return handle(res, error); }
});
router.post('/internal-drivers/:personnelId/enrollment', hrManage, async (req: AuthRequest, res) => {
  try {
    if (process.env.NODE_ENV === 'production' || process.env.BIOMETRIC_CONNECTOR_MODE !== 'simulator') throw new DispatchConfirmationConflictError('Enrollment capture connector is not configured; arbitrary biometric uploads are disabled.');
    if (req.body.rawImage || req.body.fingerprintImage || req.body.templates || req.body.protectedTemplateMaterial) throw new DispatchConfirmationValidationError('Raw or caller-supplied biometric material is not accepted.');
    const fingers = Array.isArray(req.body.fingers) ? req.body.fingers.map(String) : [];
    const capture = new DeterministicBiometricSimulator();
    const templates = await Promise.all(fingers.map(async (finger: string) => {
      if (!/^[A-Z_]{3,32}$/.test(finger)) throw new DispatchConfirmationValidationError('Finger identifiers must use the approved catalog.');
      const commandId = randomUUID();
      const result = await capture.execute({ commandId, nonce: randomUUID(), workstationId: String(req.body.workstationId || 'HR-ENROLLMENT'),
        issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), operation: 'CAPTURE',
        payload: { challengeId: `enroll:${req.params.personnelId}:${finger}` } });
      if (result.captureQuality.state !== 'ACCEPTED' || result.liveness.state !== 'LIVE') throw new DispatchConfirmationConflictError('Enrollment capture did not pass quality and liveness checks.');
      return { finger, format: 'ISO-19794-2', material: createHmac('sha256', process.env.DISPATCH_CONFIRMATION_OTP_SECRET!).update(`${commandId}:${req.params.personnelId}:${finger}`).digest(),
        deviceEvidence: { commandId, deviceModel: result.device.model, deviceSerial: result.device.serial, captureQuality: result.captureQuality, liveness: result.liveness }, provenance: 'APPROVED_CONNECTOR' as const };
    }));
    return res.status(201).json({ success: true, data: await service().enrollInternalDriver({ personnelId: req.params.personnelId,
      acknowledgement: req.body.acknowledgement, confirmationPhone: req.body.confirmationPhone, templates, actorId: req.user!.id }) });
  } catch (error) { return handle(res, error); }
});
router.post('/enrollments/:enrollmentId/withdraw', hrManage, async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await service().withdrawEnrollment({ enrollmentId: req.params.enrollmentId, actorId: req.user!.id, reason: req.body.reason }) }); }
  catch (error) { return handle(res, error); }
});
router.post('/waybills/:waybillId/sessions', accountingManage, async (req: AuthRequest, res) => {
  try { return res.status(201).json({ success: true, data: await service().startSession({ waybillId: req.params.waybillId, actorId: req.user!.id, workstationId: req.body.workstationId }) }); }
  catch (error) { return handle(res, error); }
});
router.post('/sessions/:sessionId/biometric-attempts', accountingManage, async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await service().verifyInternalBiometric({ sessionId: req.params.sessionId, actorId: req.user!.id,
    scenario: process.env.NODE_ENV === 'production' ? undefined : req.body.scenario }) }); }
  catch (error) { return handle(res, error); }
});
router.post('/sessions/:sessionId/fallback', accountingManage, async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await service().beginInternalFallback({ sessionId: req.params.sessionId, actorId: req.user!.id }) }); }
  catch (error) { return handle(res, error); }
});
router.post('/sessions/:sessionId/otp/resend', accountingManage, async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await service().resendOtp(req.params.sessionId) }); }
  catch (error) { return handle(res, error); }
});
router.post('/sessions/:sessionId/otp/verify', accountingManage, async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await service().verifyOtp({ sessionId: req.params.sessionId, code: req.body.code, actorId: req.user!.id }) }); }
  catch (error) { return handle(res, error); }
});
router.post('/sessions/:sessionId/guard-approval', guardApprove, async (req: AuthRequest, res) => {
  try {
    const guard = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { password: true } });
    if (!guard || typeof req.body.password !== 'string' || !await bcrypt.compare(req.body.password, guard.password)) {
      await service().auditControlDenied(req.params.sessionId, req.user!.id, 'GUARD_REAUTHENTICATION_FAILED');
      return res.status(401).json({ success: false, error: 'Fresh Guard reauthentication failed.' });
    }
    return res.json({ success: true, data: await service().approveByGuard({ sessionId: req.params.sessionId, guardActorId: req.user!.id,
      reauthenticatedAt: new Date(), reason: req.body.reason }) });
  }
  catch (error) { return handle(res, error); }
});
router.post('/authorizations/:authorizationId/revoke', accountingManage, async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await service().revokeAuthorization({ authorizationId: req.params.authorizationId, actorId: req.user!.id, reason: req.body.reason }) }); }
  catch (error) { return handle(res, error); }
});
router.post('/guard/authorizations/:authorizationId/revoke', guardApprove, async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await service().revokeAuthorization({ authorizationId: req.params.authorizationId, actorId: req.user!.id, reason: req.body.reason }) }); }
  catch (error) { return handle(res, error); }
});
router.get('/sessions/:sessionId/evidence', (req: AuthRequest, res, next) => {
  res.on('finish', () => {
    if ([401, 403].includes(res.statusCode)) {
      try { void service().auditControlDenied(req.params.sessionId, req.user?.id || 'ANONYMOUS', `EVIDENCE_HTTP_${res.statusCode}`).catch(() => undefined); }
      catch { /* Denial response must not depend on audit configuration availability. */ }
    }
  });
  next();
}, evidenceView, async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await service().readProtectedEvidence(req.params.sessionId, req.user!.id) }); }
  catch (error) { return handle(res, error); }
});

export default router;
