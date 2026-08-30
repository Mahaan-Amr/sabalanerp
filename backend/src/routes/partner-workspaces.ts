import { randomUUID } from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import {
  PartnerQueryV2Schema,
  partnerError,
  type PartnerQueryV2Port,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import { protect, type AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../services/effectiveAuthorization/audit';
import {
  createPrismaPartnerWorkspaceQuery,
} from '../services/partnerSales/workspaces/prisma';

function correlation(request: Request) {
  const supplied = request.get('X-Correlation-Id');
  return supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
}

function reply(response: Parameters<RequestHandler>[1], result: Result<unknown>) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (result.ok === true) return response.json({ success: true, data: result.value });
  return response.status(result.error.status).json({
    success: false,
    code: result.error.code,
    error: result.error.message,
    supportReference: randomUUID(),
  });
}

export function createPartnerWorkspaceRouter(dependencies: {
  queryFor(request: AuthRequest): PartnerQueryV2Port;
  authenticate?: RequestHandler;
}) {
  const router = Router();
  router.use(dependencies.authenticate ?? protect);
  router.post('/query-v2', async (request: AuthRequest, response) => {
    const parsed = PartnerQueryV2Schema.safeParse(request.body);
    if (!parsed.success || !['PARTNER_MANAGEMENT', 'RESPONDER_WORKSPACE'].includes(parsed.data.purpose)) {
      return reply(response, { ok: false, error: partnerError('INVALID_PAYLOAD') });
    }
    try {
      return reply(response, await dependencies.queryFor(request).query(parsed.data as never));
    } catch {
      return reply(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') });
    }
  });
  return router;
}

export default createPartnerWorkspaceRouter({ queryFor(request) {
  if (!request.user) throw new Error('Authentication required');
  const correlationId = correlation(request);
  const actorId = request.user.id;
  return createPrismaPartnerWorkspaceQuery({
    database: prisma,
    actorId,
    correlationId,
    authorize: async (transaction: Prisma.TransactionClient, input) => {
      const policy = createAuditedPartnerAuthorization(transaction, {
        actorId,
        purpose: input.purpose,
        channel: 'API',
      }, { correlationId, ...(input.reason ? { reason: input.reason } : {}) });
      const result = await policy.authorize(input.action, input.root);
      if (result.ok === false) return { ok: false as const, error: result.error };
      const evidence = await readAuthorizationDecisionByCorrelation(transaction, {
        domain: 'PARTNER', actorId, action: input.action, rootKind: input.root.kind,
        rootId: input.root.id, purpose: input.purpose, channel: 'API', correlationId, allowed: true,
      });
      return evidence ? { ok: true as const, value: { evidenceId: evidence.id } }
        : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
    },
  });
} });
