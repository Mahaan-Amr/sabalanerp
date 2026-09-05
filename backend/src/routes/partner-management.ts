import { randomUUID } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { PartnerManagementCommandV2Schema, partnerError, type PartnerCommandPort,
  type PartnerManagementCommandV2Port, type Result } from '@sabalanerp/partner-sales-contracts';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../services/effectiveAuthorization/audit';
import { resolveEligibleResponder } from '../services/partnerSales/inquiries/adapters';
import { createPrismaPartnerResponderAssignmentService } from '../services/partnerSales/management/responderAssignment';
import { createPartnerProfileService } from '../services/partnerSales/profiles/service';
import { createPrismaPartnerProfileStore } from '../services/partnerSales/profiles/prismaStore';
import { createPartnerProfileManagementService } from '../services/partnerSales/profiles/management';
import { createPrismaPartnerProfileManagementStore } from '../services/partnerSales/profiles/managementPrismaStore';

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
  profileServiceFor?(request: AuthRequest): PartnerCommandPort;
  authenticate?: RequestHandler;
}) {
  const router = Router(); router.use(dependencies.authenticate ?? protect);
  router.post('/commands-v2', async (request: AuthRequest, response) => {
    try { return reply(response, await dependencies.serviceFor(request).execute(request.body)); }
    catch { return reply(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  if (dependencies.profileServiceFor) router.post('/commands', async (request: AuthRequest, response) => {
    try { return reply(response, await dependencies.profileServiceFor!(request).execute(request.body)); }
    catch { return reply(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  return router;
}

function authorizeFor(request: AuthRequest, correlationId: string) {
  return async (tx: Prisma.TransactionClient, input: { action: 'RESPONDER_ASSIGN' | 'PROFILE_CREATE' |
    'IDENTITY_VERIFY' | 'COMMERCIAL_TERMS_MANAGE' | 'CREDIT_TERMS_MANAGE' | 'PROFILE_ACTIVATE' |
    'PROFILE_CONVERSION_MANAGE' | 'PROFILE_SUSPEND' | 'PROFILE_TERMINATE';
    purpose: 'MANAGEMENT' | 'ONBOARDING' | 'ACCOUNTING'; reason: string;
    root: { kind: 'PROFILE'; id: string }; prospectiveOwnerId?: string }) => {
    const policy = createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
      purpose: input.purpose, channel: 'API' }, { correlationId, reason: input.reason },
      input.prospectiveOwnerId ? { prospectiveProfileOwnerId: input.prospectiveOwnerId } : undefined);
    const result = await policy.authorize(input.action, input.root);
    if (!result.ok) return result;
    const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: request.user!.id,
      action: input.action, rootKind: input.root.kind, rootId: input.root.id, purpose: input.purpose,
      channel: 'API', correlationId, allowed: true });
    return evidence ? { ok: true as const, value: { evidenceId: evidence.id } }
      : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
  };
}

export default createPartnerManagementRouter({ serviceFor(request) {
  if (!request.user) throw new Error('Authentication required');
  const correlationId = correlation(request);
  const responder = createPrismaPartnerResponderAssignmentService({ database: prisma, actorId: request.user.id,
    resolveResponder: resolveEligibleResponder,
    authorize: authorizeFor(request, correlationId) });
  const profile = createPartnerProfileManagementService({ actorId: request.user.id,
    store: createPrismaPartnerProfileManagementStore(prisma), newId: randomUUID,
    authorize: authorizeFor(request, correlationId) });
  return { execute(input) {
    const parsed = PartnerManagementCommandV2Schema.safeParse(input);
    if (!parsed.success) return Promise.resolve({ ok: false as const, error: partnerError('INVALID_PAYLOAD') });
    return parsed.data.type === 'RESPONDER_ASSIGN' ? responder.execute(parsed.data) : profile.execute(parsed.data);
  } };
}, profileServiceFor(request) {
  if (!request.user) throw new Error('Authentication required');
  const correlationId = correlation(request);
  return createPartnerProfileService({ actorId: request.user.id, store: createPrismaPartnerProfileStore(prisma),
    authorize: authorizeFor(request, correlationId) });
} });
