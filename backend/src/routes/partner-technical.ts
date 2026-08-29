import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { PartnerTechnicalLeaseRequestSchema, PartnerTechnicalLeaseReceiptSchema, partnerError,
  type PartnerTechnicalCatalogPort, type PartnerTechnicalLeasePort, type PartnerTechnicalRecoveryPort,
  type PartnerTechnicalSavePort, type Result } from '@sabalanerp/partner-sales-contracts';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createPartnerTechnicalCatalogReader } from '../services/partnerSales/crm/technicalCatalogReader';
import { createPrismaPartnerTechnicalRecoveryService } from '../services/partnerSales/cases/technicalRecovery';
import { createPrismaPartnerTechnicalSaveService, type PartnerTechnicalSaveDependencies } from '../services/partnerSales/cases/technicalSave';
import { createPartnerTechnicalEvidenceResolver } from '../services/partnerSales/cases/technicalEvidence';
import { createPartnerTechnicalRecoveryAuthority } from '../services/partnerSales/authorization/technicalRecovery';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { authorizePartnerTechnicalRollout } from '../services/partnerSales/authorization/technicalRollout';
import { acquirePartnerTechnicalContractEditSession,
  PrismaContractEditSessionStore } from '../services/contractEditSessionService';

export type TechnicalRequest = { body: unknown };
export type TechnicalResponse = {
  status(code: number): TechnicalResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
};
type Handler = (request: TechnicalRequest, response: TechnicalResponse) => Promise<void>;
export interface TechnicalRouter {
  post(path: string, handler: Handler): unknown;
  put(path: string, handler: Handler): unknown;
}
export interface PartnerTechnicalServices {
  lease: PartnerTechnicalLeasePort;
  catalog: PartnerTechnicalCatalogPort;
  recovery: PartnerTechnicalRecoveryPort;
  saved: PartnerTechnicalSavePort;
}

/** Real request-scoped composition over the application's shared client. The
 * caller must first authenticate actorId and provide the owner-side private
 * evidence resolver; no browser field or fixture can satisfy that resolver. */
export function createPartnerTechnicalRequestServices(input: {
  database: PrismaClient;
  actorId: string;
  correlationId: string;
  resolveEvidence?: PartnerTechnicalSaveDependencies['resolveEvidence'];
}): PartnerTechnicalServices {
  const binding = { actorId: input.actorId, correlationId: input.correlationId };
  const authorize = createPartnerTechnicalRecoveryAuthority(binding);
  return {
    lease: { acquire: request => {
      const parsed = PartnerTechnicalLeaseRequestSchema.safeParse(request);
      if (!parsed.success) return Promise.resolve({ ok: false, error: partnerError('INVALID_PAYLOAD') });
      return input.database.$transaction(async tx => {
        await tx.$queryRaw`SELECT "draftId" FROM sales_contract_edit_sessions
          WHERE "draftId" = ${parsed.data.recoveryId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM partner_profiles WHERE "userId" = ${input.actorId} FOR UPDATE`;
        const profile = await tx.partnerProfile.findUnique({ where: { userId: input.actorId }, select: { id: true } });
        if (!profile) return { ok: false, error: partnerError('NOT_FOUND') };
        const decision = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
          purpose: 'PARTNER', channel: 'API' }, { correlationId: input.correlationId })
          .authorize('CASE_DRAFT_WRITE', { kind: 'PROFILE', id: profile.id });
        if (!decision.ok) return decision;
        const rollout = await authorizePartnerTechnicalRollout(tx, profile.id, 'MUTATE');
        if (!rollout.ok) return rollout;
        const acquired = await acquirePartnerTechnicalContractEditSession(new PrismaContractEditSessionStore(tx), {
          draftId: parsed.data.recoveryId, userId: input.actorId,
          browserSessionId: parsed.data.browserSessionId, schemaVersion: 1,
          baseRevision: parsed.data.baseRevision, takeover: parsed.data.takeover,
        });
        if (!acquired.ok) return { ok: false, error: partnerError(acquired.code === 'revision-conflict'
          ? 'ROW_STALE' : acquired.code === 'draft-owner-mismatch' ? 'NOT_FOUND' : 'FORBIDDEN') };
        return { ok: true, value: PartnerTechnicalLeaseReceiptSchema.parse({ schemaVersion: 1,
          recoveryId: acquired.session.draftId, browserSessionId: acquired.session.browserSessionId,
          leaseToken: acquired.session.leaseToken, baseRevision: acquired.session.baseRevision,
          updatedAt: acquired.session.updatedAt.toISOString(), takenOver: acquired.takenOver }) };
      });
    } },
    catalog: { read: query => input.database.$transaction(tx =>
      createPartnerTechnicalCatalogReader(tx, binding).read(query)) },
    recovery: createPrismaPartnerTechnicalRecoveryService({ database: input.database,
      actorId: input.actorId, authorize }),
    saved: createPrismaPartnerTechnicalSaveService({ database: input.database,
      actorId: input.actorId, authorize, resolveEvidence: input.resolveEvidence ?? createPartnerTechnicalEvidenceResolver() }),
  };
}

/** Closed transport composition. #334 supplies one freshly authenticated,
 * request-bound set of real ports. Merely registering this factory does not
 * activate Partner navigation, cohorts or a pricing-evidence producer. */
export function registerPartnerTechnicalRoutes(router: TechnicalRouter, dependencies: {
  servicesFor(request: TechnicalRequest): Promise<PartnerTechnicalServices>;
}) {
  const handle = (action: (services: PartnerTechnicalServices, body: unknown) => Promise<Result<unknown>>): Handler =>
    async (request, response) => {
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        const result = await action(await dependencies.servicesFor(request), request.body);
        if (result.ok) { response.json({ success: true, data: result.value }); return; }
        response.status(result.error.status).json({ success: false, code: result.error.code,
          error: result.error.message, supportReference: randomUUID() });
      } catch {
        const error = partnerError('INTEGRITY_CONFLICT');
        response.status(error.status).json({ success: false, code: error.code,
          error: error.message, supportReference: randomUUID() });
      }
  };
  router.post('/recoveries/acquire', handle((ports, body) => ports.lease.acquire(body as never)));
  router.post('/catalog/query', handle((ports, body) => ports.catalog.read(body as never)));
  router.post('/recoveries/read', handle((ports, body) => ports.recovery.read(body as never)));
  router.put('/recoveries/checkpoint', handle((ports, body) => ports.recovery.checkpoint(body as never)));
  router.post('/recoveries/save', handle((ports, body) => ports.saved.save(body as never)));
  router.post('/recoveries/read-saved', handle((ports, body) => ports.saved.readSaved(body as never)));
  return router;
}

/** Authenticated runtime adapter. Domain authorization, rollout state and the
 * current edit lease are still rechecked inside the owning transaction. */
export function createPartnerTechnicalRouter(database: PrismaClient = prisma) {
  const router = Router();
  router.use(protect);
  registerPartnerTechnicalRoutes(router as unknown as TechnicalRouter, { servicesFor: async request => {
    const authenticated = request as AuthRequest;
    if (!authenticated.user) throw new Error('Authentication required');
    const supplied = authenticated.get?.('X-Correlation-Id');
    const correlationId = supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
    return createPartnerTechnicalRequestServices({ database, actorId: authenticated.user.id, correlationId });
  } });
  return router;
}

export default createPartnerTechnicalRouter();
