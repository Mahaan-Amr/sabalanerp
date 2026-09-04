import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { IdSchema, PartnerCommandSchema, partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { prisma as applicationPrisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createPrismaPartnerRetailCorrectionService } from '../services/partnerSales/corrections/prismaRetailCorrection';
import { readRetailCorrectionState } from '../services/partnerSales/corrections/persistedRetailState';
import { createPrismaPartnerFinancialCorrectionComposition, executePrismaSharedCorrectionOpening }
  from '../services/partnerSales/corrections/prismaFinancialComposition';

function correlation(request: Request) {
  const supplied = request.get('X-Correlation-Id');
  return supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
}
function respond(response: Response, result: Result<unknown>) {
  response.setHeader('Cache-Control', 'private, no-store');
  if (result.ok) { response.json({ success: true, data: result.value }); return; }
  response.status(result.error.status).json({ success: false, code: result.error.code,
    error: result.error.message, supportReference: randomUUID() });
}

export function createPartnerCorrectionRouter(input: { database?: PrismaClient; authenticate?: RequestHandler } = {}) {
  const prisma = input.database ?? applicationPrisma;
  const router = Router();
  router.use(input.authenticate ?? protect);
  router.post('/query', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const body = request.body as Record<string, unknown>;
    const parsedCaseId = body && !Array.isArray(body) && Object.keys(body).every(key => key === 'caseId')
      ? IdSchema.safeParse(body.caseId) : { success: false as const };
    if (!parsedCaseId.success) { respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return; }
    const caseId = parsedCaseId.data;
    const correlationId = correlation(request);
    try {
      const result = await prisma.$transaction(async tx => {
        const allowed = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'PARTNER', channel: 'DETAIL' }, { correlationId })
          .authorize('CASE_READ', { kind: 'CASE', id: caseId });
        if (!allowed.ok) return allowed;
        const [opportunity, state, clock] = await Promise.all([
          tx.partnerCorrectionOpportunity.findFirst({ where: { caseId }, orderBy: { approvedAt: 'desc' },
            include: { save: true, gates: { orderBy: { recordedAt: 'asc' } } } }),
          readRetailCorrectionState(tx, caseId),
          tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`,
        ]);
        const serialized = state?.outcome as { correction?: { correctionId: string; status: string;
          opportunity?: { opportunityId: string; expiresAt: string }; successor?: unknown } } | undefined;
        if (serialized?.correction) {
          const correction = serialized.correction;
          return { ok: true as const, value: { opportunityId: correction.opportunity?.opportunityId ?? correction.correctionId,
            scope: 'RETAIL_ONLY', status: correction.status === 'SCOPE_APPROVED' ? 'APPROVED_TO_EDIT'
              : correction.status === 'AWAITING_CUSTOMER_CONFIRMATION' ? 'SAVED' : correction.status,
            expiresAt: correction.opportunity?.expiresAt, saved: Boolean(correction.successor),
            editableCustomerInstallmentIds: [] } };
        }
        if (!opportunity) return { ok: true as const, value: null };
        const rejected = opportunity.gates.some(gate => gate.outcome === 'REJECT');
        const effective = opportunity.gates.length >= 5 && !rejected;
        return { ok: true as const, value: { opportunityId: opportunity.id, scope: opportunity.scope,
          status: rejected ? 'REJECTED' : effective ? 'EFFECTIVE' : opportunity.save ? 'SAVED'
            : opportunity.approvedBy === 'PENDING_SCOPE' ? 'REQUESTED'
              : opportunity.expiresAt <= clock[0].now ? 'EXPIRED' : 'APPROVED_TO_EDIT',
          expiresAt: opportunity.expiresAt.toISOString(), saved: Boolean(opportunity.save),
          editableCustomerInstallmentIds: [] } };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.post('/commands', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const parsed = PartnerCommandSchema.safeParse(request.body);
    if (!parsed.success || !['VOID_REMEDIATION_REQUEST', 'CORRECTION_REQUEST', 'RETAIL_CORRECTION_SAVE',
      'SHARED_CORRECTION_SAVE', 'CORRECTION_GATE'].includes(parsed.data.type)) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    const command = parsed.data;
    try {
      const correlationId = correlation(request);
      const opening = await executePrismaSharedCorrectionOpening({ database: prisma,
        actorId: request.user.id, correlationId, command });
      if (opening) { respond(response, opening); return; }
      let retail = command.type === 'RETAIL_CORRECTION_SAVE' ||
        (command.type === 'CORRECTION_REQUEST' && (command as { scope?: unknown }).scope === 'RETAIL_ONLY');
      if (command.type === 'CORRECTION_GATE') {
        const opportunity = await prisma.partnerCorrectionOpportunity.findUnique({ where: {
          id: String((command as { correctionId?: unknown }).correctionId) }, select: { scope: true } });
        const state = await readRetailCorrectionState(prisma, command.expected.caseId);
        const saved = state?.outcome as { correction?: { correctionId?: string } } | undefined;
        retail = opportunity?.scope === 'RETAIL_ONLY' || saved?.correction?.correctionId === command.correctionId;
      }
      const financial = createPrismaPartnerFinancialCorrectionComposition({ database: prisma,
        actorId: request.user.id, correlationId, reason: 'reason' in command ? command.reason : undefined });
      const scope = command.type === 'CORRECTION_GATE'
        ? (await prisma.partnerCorrectionOpportunity.findUnique({ where: {
          id: String((command as { correctionId?: unknown }).correctionId) }, select: { scope: true } }))?.scope
        : undefined;
      const service = retail
        ? createPrismaPartnerRetailCorrectionService({ database: prisma, actorId: request.user.id, correlationId,
          reason: 'reason' in command ? command.reason : undefined })
        : command.type === 'SHARED_CORRECTION_SAVE' || ['SHARED', 'SABALAN_TERMS'].includes(String(scope))
          ? financial.shared : financial.voiding;
      respond(response, await service.execute(command as never));
    } catch {
      respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') });
    }
  });
  return router;
}

export default createPartnerCorrectionRouter();
