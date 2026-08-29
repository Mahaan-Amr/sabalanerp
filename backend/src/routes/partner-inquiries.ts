import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createPrismaPartnerInquiryService, type PartnerInquiryDependencies } from '../services/partnerSales/inquiries/service';
import { resolveEligibleResponder, resolveProfileResponder, resolveSavedTechnicalConfiguration } from '../services/partnerSales/inquiries/adapters';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../services/effectiveAuthorization/audit';

function correlation(request: Request): string {
  const supplied = request.get('X-Correlation-Id');
  return supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
}

function respond(response: Response, result: Result<unknown>) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (result.ok) { response.json({ success: true, data: result.value }); return; }
  response.status(result.error.status).json({ success: false, code: result.error.code,
    error: result.error.message, supportReference: randomUUID() });
}

export function createPartnerInquiryRouter() {
  const router = Router();
  router.use(protect);
  const serviceFor = (request: AuthRequest) => {
    if (!request.user) throw new Error('Authentication required');
    const correlationId = correlation(request);
    const authorize: PartnerInquiryDependencies['authorize'] = async (tx, input) => {
      const policy = createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
        purpose: input.purpose, channel: 'API' }, { correlationId, ...(input.reason ? { reason: input.reason } : {}) });
      const result = await policy.authorize(input.action, input.root);
      if (!result.ok) return result;
      const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: request.user!.id,
        action: input.action, rootKind: input.root.kind, rootId: input.root.id, purpose: input.purpose,
        channel: 'API', correlationId, allowed: true });
      return evidence ? { ok: true, value: { evidenceId: evidence.id } }
        : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    };
    return createPrismaPartnerInquiryService({ database: prisma, actorId: request.user.id, authorize,
      resolveInitialResponder: resolveProfileResponder, resolveResponder: resolveEligibleResponder,
      resolveConfiguration: resolveSavedTechnicalConfiguration });
  };
  router.post('/commands', async (request: AuthRequest, response) => {
    try { respond(response, await serviceFor(request).execute(request.body)); }
    catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.post('/query-v2', async (request: AuthRequest, response) => {
    try { respond(response, await serviceFor(request).query(request.body as never)); }
    catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  return router;
}

export default createPartnerInquiryRouter();
