import { randomUUID } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { PartnerActivationCommandV3Schema, partnerError, type PartnerActivationPackageV3Port,
  type Result } from '@sabalanerp/partner-sales-contracts';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../services/effectiveAuthorization/audit';
import { createPrismaPartnerActivationPackage } from '../services/partnerSales/activationPackage/prisma';
import { resolveDeploymentReadiness } from '../services/partnerSales/activationPackage/releaseEvidence';

function correlation(request: Request) {
  const supplied = request.get('X-Correlation-Id');
  return supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
}

function reply(response: Response, result: Result<unknown>) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (result.ok) return response.json({ success: true, data: result.value });
  return response.status(result.error.status).json({ success: false, code: result.error.code,
    error: result.error.message, supportReference: randomUUID() });
}

export function createPartnerActivationRouter(dependencies: {
  portFor(request: AuthRequest): PartnerActivationPackageV3Port;
  authenticate?: RequestHandler;
}) {
  const router = Router();
  router.use(dependencies.authenticate ?? protect);
  router.post('/query-v3', async (request: AuthRequest, response) => {
    const body = request.body as Record<string, unknown>;
    if (body?.schemaVersion !== 3 || body?.purpose !== 'PARTNER_ACTIVATION' ||
        (body.userId !== undefined && typeof body.userId !== 'string')) {
      return reply(response, { ok: false, error: partnerError('INVALID_PAYLOAD') });
    }
    return reply(response, await dependencies.portFor(request).query(body as {
      schemaVersion: 3; purpose: 'PARTNER_ACTIVATION'; userId?: string;
    }));
  });
  router.post('/commands-v3', async (request: AuthRequest, response) => {
    const parsed = PartnerActivationCommandV3Schema.safeParse(request.body);
    if (!parsed.success) return reply(response, { ok: false, error: partnerError('INVALID_PAYLOAD') });
    return reply(response, await dependencies.portFor(request).execute(parsed.data));
  });
  return router;
}

export default createPartnerActivationRouter({ portFor(request) {
  if (!request.user) throw new Error('Authentication required');
  const correlationId = correlation(request), actorId = request.user.id;
  return createPrismaPartnerActivationPackage({ database: prisma, actorId,
    runtimeIdentity: { releaseId: String(process.env.DEPLOYMENT_RELEASE_ID || '').trim(),
      schemaId: String(process.env.PARTNER_SCHEMA_ID || '').trim() },
    resolveVerifiedReadiness: (tx, deploymentId) => resolveDeploymentReadiness(tx, deploymentId, {
      releaseId: String(process.env.DEPLOYMENT_RELEASE_ID || '').trim(),
      schemaId: String(process.env.PARTNER_SCHEMA_ID || '').trim(),
    }),
    authorize: async (tx: Prisma.TransactionClient, authorization) => {
      const policy = createAuditedPartnerAuthorization(tx, { actorId, purpose: authorization.purpose, channel: 'API' },
        { correlationId, reason: authorization.reason }, authorization.prospectiveOwnerId
          ? { prospectiveProfileOwnerId: authorization.prospectiveOwnerId } : undefined);
      const result = await policy.authorize(authorization.action, authorization.root);
      if (!result.ok) return result;
      const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId,
        action: authorization.action, rootKind: authorization.root.kind, rootId: authorization.root.id,
        purpose: authorization.purpose, channel: 'API', correlationId, allowed: true });
      return evidence ? { ok: true as const, value: { evidenceId: evidence.id, isAdmin: result.value.isAdmin } }
        : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
    } });
} });
