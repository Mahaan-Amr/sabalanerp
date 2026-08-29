import { randomUUID } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { partnerError, type PartnerManagementCommandV2Port, type Result } from '@sabalanerp/partner-sales-contracts';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../services/effectiveAuthorization/audit';
import { resolveEligibleResponder } from '../services/partnerSales/inquiries/adapters';
import { createPrismaPartnerResponderAssignmentService } from '../services/partnerSales/management/responderAssignment';

function correlation(request: Request): string {
  const supplied = request.get('X-Correlation-Id');
  return supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
}

function reply(response: Response, result: Result<unknown>) {
  response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
  if (result.ok) return response.json({ success: true, data: result.value });
  return response.status(result.error.status).json({ success: false, code: result.error.code,
    error: result.error.message, supportReference: randomUUID() });
}

export function createPartnerManagementRouter(dependencies: {
  serviceFor(request: AuthRequest): PartnerManagementCommandV2Port;
  authenticate?: RequestHandler;
}) {
  const router = Router(); router.use(dependencies.authenticate ?? protect);
  router.post('/commands-v2', async (request: AuthRequest, response) => {
    try { return reply(response, await dependencies.serviceFor(request).execute(request.body)); }
    catch { return reply(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  return router;
}

export default createPartnerManagementRouter({ serviceFor(request) {
  if (!request.user) throw new Error('Authentication required');
  const correlationId = correlation(request);
  return createPrismaPartnerResponderAssignmentService({ database: prisma, actorId: request.user.id,
    resolveResponder: resolveEligibleResponder,
    authorize: async (tx, input) => {
      const policy = createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
        purpose: input.purpose, channel: 'API' }, { correlationId, reason: input.reason });
      const result = await policy.authorize(input.action, input.root);
      if (!result.ok) return result;
      const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: request.user!.id,
        action: input.action, rootKind: input.root.kind, rootId: input.root.id, purpose: input.purpose,
        channel: 'API', correlationId, allowed: true });
      return evidence ? { ok: true, value: { evidenceId: evidence.id } }
        : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    } });
} });
