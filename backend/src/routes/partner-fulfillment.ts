import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { FulfillmentViewSchema, RevisionRefSchema, partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createPartnerFulfillmentAdapter } from '../services/partnerSales/fulfillment/adapter';
import { createPrismaPartnerFulfillmentRepository } from '../services/partnerSales/fulfillment/prismaRepository';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { readPartnerSnapshot } from '../services/partnerSales/authorization/readSnapshot';

const correlation = (request: Request) => {
  const supplied = request.get('X-Correlation-Id');
  return supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
};
function respond(response: Response, result: Result<unknown>) {
  response.setHeader('Cache-Control', 'private, no-store');
  if (result.ok) { response.json({ success: true, data: result.value }); return; }
  response.status(result.error.status).json({ success: false, code: result.error.code,
    error: result.error.message, supportReference: randomUUID() });
}

const router = Router();
router.use(protect);
router.get('/:caseId', async (request: AuthRequest, response) => {
  if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
  const result = await readPartnerSnapshot(prisma, async tx => {
    const row = await tx.partnerSaleCase.findUnique({ where: { id: request.params.caseId }, select: {
      id: true, headRevision: true, integrityHash: true, internalRecordId: true,
      head: { select: { internalProjection: true } },
    } });
    if (!row) return { ok: false as const, error: partnerError('NOT_FOUND') };
    const allowed = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
      purpose: 'FULFILLMENT', channel: 'DETAIL' }, { correlationId: correlation(request) })
      .authorize('FULFILLMENT_READ', { kind: 'CASE', id: row.id });
    if (!allowed.ok) return allowed;
    const projection = row.head.internalProjection && typeof row.head.internalProjection === 'object' &&
      !Array.isArray(row.head.internalProjection)
      ? (row.head.internalProjection as Prisma.JsonObject).fulfillment : undefined;
    const view = FulfillmentViewSchema.safeParse(projection);
    if (!view.success || view.data.owner.caseId !== row.id || view.data.owner.revision !== row.headRevision ||
        view.data.owner.integrityHash !== row.integrityHash || view.data.recordId !== row.internalRecordId) {
      return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
    }
    return { ok: true as const, value: view.data };
  });
  respond(response, result);
});
router.post('/materialize', async (request: AuthRequest, response) => {
  if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
  const body = request.body as Record<string, unknown>;
  const view = FulfillmentViewSchema.safeParse(body?.view);
  const expected = RevisionRefSchema.safeParse(body?.expected);
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !['view', 'expected', 'commandId', 'idempotencyKey', 'reason'].includes(key)) ||
      (body.reason !== undefined && (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000)) ||
      !view.success || !expected.success || typeof body.commandId !== 'string' || typeof body.idempotencyKey !== 'string') {
    respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
  }
  const repository = createPrismaPartnerFulfillmentRepository({ database: prisma, actorId: request.user.id,
    correlationId: correlation(request), reason: typeof body.reason === 'string' ? body.reason : undefined });
  const service = createPartnerFulfillmentAdapter(repository);
  respond(response, await service.ensureCommittedLineage(view.data, { schemaVersion: 1,
    commandId: body.commandId, correlationId: correlation(request), authenticatedActorId: request.user.id,
    idempotencyKey: body.idempotencyKey, expected: expected.data }));
});
router.post('/dependencies', async (request: AuthRequest, response) => {
  if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
  const view = FulfillmentViewSchema.safeParse(request.body);
  if (!view.success) { respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return; }
  const service = createPartnerFulfillmentAdapter(createPrismaPartnerFulfillmentRepository({ database: prisma,
    actorId: request.user.id, correlationId: correlation(request) }));
  respond(response, await service.inspectDependencies(view.data));
});
export default router;
