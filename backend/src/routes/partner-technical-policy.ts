import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { createPrismaPartnerTechnicalPolicyService, type PartnerTechnicalPolicyCommand } from '../services/partnerSales/management/technicalPolicy';
import type { PartnerTechnicalPolicyReceipt } from '@sabalanerp/partner-sales-contracts';

type PolicyService = {
  read(profileId: string): Promise<Result<unknown>>;
  publish(command: PartnerTechnicalPolicyCommand): Promise<Result<PartnerTechnicalPolicyReceipt>>;
};

const reply = (response: Response, result: Result<unknown>) => {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (result.ok) return response.json({ success: true, data: result.value });
  return response.status(result.error.status).json({ success: false, code: result.error.code,
    error: result.error.message, supportReference: randomUUID() });
};

export function createPartnerTechnicalPolicyRouter(dependencies: {
  serviceFor(request: AuthRequest): PolicyService;
  authenticate?: RequestHandler;
}) {
  const router = Router();
  router.use(dependencies.authenticate ?? protect);
  router.get('/:profileId', async (request: AuthRequest, response) => {
    try { return reply(response, await dependencies.serviceFor(request).read(request.params.profileId)); }
    catch { return reply(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.post('/', async (request: AuthRequest, response) => {
    try { return reply(response, await dependencies.serviceFor(request).publish(request.body)); }
    catch { return reply(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  return router;
}

export default createPartnerTechnicalPolicyRouter({ serviceFor(request) {
  if (!request.user) throw new Error('Authentication required');
  const supplied = request.get('X-Correlation-Id');
  const correlationId = supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
  return createPrismaPartnerTechnicalPolicyService({ database: prisma, actorId: request.user.id,
    authorize: async (tx, input) => {
      const authorization = createAuditedPartnerAuthorization(tx,
        { actorId: input.actorId, purpose: 'MANAGEMENT', channel: 'API' },
        { correlationId, reason: input.reason });
      const decision = await authorization.authorize('COMMERCIAL_TERMS_MANAGE', { kind: 'PROFILE', id: input.profileId });
      return decision.ok ? { ok: true, value: undefined } : decision;
    } });
} });
