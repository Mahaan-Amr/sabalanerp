import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { DispatchCutoverConflictError, DispatchCutoverValidationError, executeDispatchCutover, getDispatchCutoverStatus,
  recordDispatchCriticalFailure, recordLegacyDriverVehicleDisposition, resumeDispatchPilot, rollbackDispatchCutover,
  runDispatchCutoverRehearsal, recordDispatchPilotResumeApproval } from '../services/dispatchCutover';

const router = express.Router();
const prisma = new PrismaClient();
router.use(protect);
const handle = (res: Response, error: unknown) => {
  if (error instanceof DispatchCutoverValidationError) return res.status(400).json({ success: false, error: error.message });
  if (error instanceof DispatchCutoverConflictError) return res.status(409).json({ success: false, error: error.message });
  console.error('Dispatch cutover error:', error);
  return res.status(500).json({ success: false, error: 'Dispatch cutover command failed.' });
};

router.post('/resume-approvals', async (req: AuthRequest, res) => {
  try { return res.status(201).json({ success: true, data: await recordDispatchPilotResumeApproval(prisma,
    { actorId: req.user!.id, role: req.body.role, evidence: req.body.evidence }) }); }
  catch (error) { return handle(res, error); }
});
router.use(authorize('ADMIN'));
router.get('/', async (_req, res) => {
  try { return res.json({ success: true, data: await getDispatchCutoverStatus(prisma) }); }
  catch (error) { return handle(res, error); }
});
router.post('/dispositions', async (req: AuthRequest, res) => { try { res.status(201).json({ success: true, data: await recordLegacyDriverVehicleDisposition(prisma, { ...req.body, actorId: req.user!.id }) }); } catch (e) { handle(res, e); } });
router.post('/rehearsals', async (req: AuthRequest, res) => { try { res.status(201).json({ success: true, data: await runDispatchCutoverRehearsal(prisma,
  { rehearsalType: req.body.rehearsalType, operators: req.body.operators, runbook: req.body.runbook, actorId: req.user!.id }) }); } catch (e) { handle(res, e); } });
router.post('/execute', async (req: AuthRequest, res) => { try { res.json({ success: true, data: await executeDispatchCutover(prisma, { actorId: req.user!.id }) }); } catch (e) { handle(res, e); } });
router.post('/rollback', async (req: AuthRequest, res) => { try { res.json({ success: true, data: await rollbackDispatchCutover(prisma, { actorId: req.user!.id, reason: req.body.reason }) }); } catch (e) { handle(res, e); } });
router.post('/critical-failure', async (req: AuthRequest, res) => { try { res.json({ success: true, data: await recordDispatchCriticalFailure(prisma, { actorId: req.user!.id, reason: req.body.reason, evidence: req.body.evidence || {} }) }); } catch (e) { handle(res, e); } });
router.post('/resume', async (req: AuthRequest, res) => { try { res.json({ success: true, data: await resumeDispatchPilot(prisma, { ...req.body, actorId: req.user!.id }) }); } catch (e) { handle(res, e); } });

export default router;
