import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as partnerContracts from '@sabalanerp/partner-sales-contracts';
import { CustomerOutputSnapshotSchema, canonicalHash, partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { prisma as applicationPrisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createPrismaPartnerCaseService } from '../services/partnerSales/cases/aggregate';
import { createPrismaPartnerCaseDependencies } from '../services/partnerSales/cases/prismaComposition';
import { createPartnerCaseLifecycleService } from '../services/partnerSales/cases/lifecycle';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../services/effectiveAuthorization/audit';
import { generateCustomerContractPdf } from '../utils/pdf';
import { contractConfirmationService } from '../services/contractConfirmationService';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../services/partnerSales/authorization/technicalRollout';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function correlation(request: Request) {
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

export function createPartnerCaseRouter(input: { database?: PrismaClient; authenticate?: RequestHandler } = {}) {
  const prisma = input.database ?? applicationPrisma;
  const router = Router();
  router.use(input.authenticate ?? protect);
  router.get('/creation-context', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    try {
      const result = await prisma.$transaction(async tx => {
        const profile = await tx.partnerProfile.findUnique({ where: { userId: request.user!.id }, select: {
          id: true, state: true,
          commercialAccount: { select: { terms: { orderBy: [{ effectiveDate: 'desc' }, { version: 'desc' }] } } },
          inquiries: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
          customers: { where: { isActive: true }, orderBy: { createdAt: 'desc' }, select: {
            id: true, firstName: true, lastName: true, companyName: true,
            address: true, workAddress: true, homeAddress: true,
          } },
        } });
        if (!profile) return { ok: true as const, value: partnerContracts.PartnerCreationContextSchema.parse({
          schemaVersion: 1, kind: 'ORDINARY_SALES' }) };
        const terms = profile.commercialAccount?.terms.find(item => {
          const value = item.terms;
          return value && typeof value === 'object' && !Array.isArray(value) &&
            (value as Prisma.JsonObject).purpose === 'PARTNER_CREDIT_TERMS';
        });
        const rollout = await authorizePartnerTechnicalRollout(tx, profile.id, 'MUTATE');
        const permission = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'PARTNER', channel: 'API' }, { correlationId: correlation(request) })
          .authorize('CASE_DRAFT_WRITE', { kind: 'PROFILE', id: profile.id });
        const writable = profile.state === 'ACTIVE' && Boolean(terms) && rollout.ok && permission.ok;
        const blockedCode = !terms ? 'STATE_CONFLICT' : !rollout.ok ? rollout.error.code
          : !permission.ok ? permission.error.code : profile.state !== 'ACTIVE' ? 'PARTNER_NOT_ACTIVE' : undefined;
        const value = partnerContracts.PartnerCreationContextSchema.safeParse({ schemaVersion: 1, kind: 'PARTNER',
          actorId: request.user!.id, profileId: profile.id, writable, ...(blockedCode ? { blockedCode } : {}),
          ...(terms ? { sabalanTermsVersionId: terms.id } : {}),
          ...(profile.inquiries[0] ? { latestInquiryId: profile.inquiries[0].id } : {}),
          customers: profile.customers.map(customer => ({ id: customer.id,
            displayName: customer.companyName || `${customer.firstName} ${customer.lastName}`.trim(),
            address: customer.address || customer.workAddress || customer.homeAddress || 'ثبت‌نشده' })),
        });
        return value.success ? { ok: true as const, value: value.data }
          : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.post('/commands', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const command = partnerContracts.PartnerCommandSchema.safeParse(request.body);
    if (!command.success || !['CASE_SUBMIT', 'CASE_DRAFT_REVISE'].includes(command.data.type)) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    try {
      const dependencies = createPrismaPartnerCaseDependencies({ database: prisma, actorId: request.user.id,
        correlationId: correlation(request) });
      const service = createPrismaPartnerCaseService({ database: prisma, ...dependencies });
      respond(response, await service.execute(command.data));
    } catch {
      respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') });
    }
  });
  router.post('/query-v2', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const input = partnerContracts.PartnerCaseRuntimeQuerySchema.safeParse(request.body);
    if (!input.success) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    const body = input.data;
    const correlationId = correlation(request);
    try {
      const result = await prisma.$transaction(async tx => {
        const actorProfile = await tx.partnerProfile.findUnique({ where: { userId: request.user!.id }, select: { id: true } });
        const rows = await tx.partnerSaleCase.findMany({ where: body.caseId ? { id: body.caseId } : undefined,
          orderBy: { createdAt: 'desc' }, select: { id: true, state: true, headRevision: true, integrityHash: true,
            head: { select: { internalProjection: true } }, outputs: { orderBy: { recordedAt: 'desc' }, take: 1,
              select: { id: true } } } });
        // A list can span several cases belonging to one profile. Acquire every
        // root first, in a deterministic order, before authorization locks any
        // profile. This preserves the global root -> profile lock order when a
        // concurrent detail/collection read starts from any case in the list.
        for (const caseId of rows.map(row => row.id).sort()) {
          await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
        }
        const cases: unknown[] = [];
        for (const row of rows) {
          const allowed = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
            purpose: actorProfile ? 'PARTNER' : 'MANAGEMENT', channel: body.caseId ? 'DETAIL' : 'LIST' },
          { correlationId }).authorize('CASE_READ', { kind: 'CASE', id: row.id });
          if (!allowed.ok) {
            if (['NOT_FOUND', 'FORBIDDEN'].includes(allowed.error.code)) continue;
            return allowed;
          }
          const projection = row.head.internalProjection && typeof row.head.internalProjection === 'object' &&
            !Array.isArray(row.head.internalProjection) ? (row.head.internalProjection as Prisma.JsonObject).partner : undefined;
          const view = partnerContracts.PartnerCaseViewSchema.safeParse(projection);
          if (!view.success || view.data.owner.caseId !== row.id ||
              view.data.owner.revision !== row.headRevision || view.data.owner.integrityHash !== row.integrityHash) {
            return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
          }
          const casePurpose = actorProfile ? 'PARTNER' as const : 'MANAGEMENT' as const;
          const authorized = async (action: partnerContracts.PartnerAction,
            purpose: partnerContracts.PermissionContext['purpose'],
            channel: partnerContracts.PermissionContext['channel']) => {
            const decision = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
              purpose, channel }, { correlationId }).authorize(action, { kind: 'CASE', id: row.id });
            if (decision.ok) return true;
            if (['NOT_FOUND', 'FORBIDDEN', 'PARTNER_NOT_ACTIVE', 'NOT_ASSIGNED'].includes(decision.error.code)) return false;
            throw Object.assign(new Error('Partner action authorization failed'), { result: decision });
          };
          // Authorization is audited. Keep these writes in a stable order so duplicate
          // read requests cannot deadlock while acquiring the same audit-related locks.
          const output = await authorized('CUSTOMER_OUTPUT', 'CUSTOMER_OUTPUT', 'PDF');
          const commit = await authorized('CASE_COMMIT', casePurpose, 'API');
          const correction = await authorized('CORRECTION_REQUEST', casePurpose, 'API');
          const cancel = await authorized('CASE_CANCEL', casePurpose, 'API');
          const voidRequest = await authorized('VOID_REQUEST', casePurpose, 'API');
          cases.push({ view: { ...view.data, state: row.state }, snapshotId: row.outputs[0]?.id || null,
            actions: { canPreview: output && Boolean(row.outputs[0]),
              canIssue: output && commit && Boolean(row.outputs[0]) && ['CUSTOMER_APPROVED', 'COMMITTED'].includes(row.state),
              canSendConfirmation: output && ['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION'].includes(row.state),
              canRequestCorrection: correction && row.state === 'COMMITTED',
              canCancel: cancel && ['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION', 'CUSTOMER_APPROVED'].includes(row.state),
              canRequestVoid: voidRequest && row.state === 'COMMITTED' } });
        }
        const output = partnerContracts.PartnerCaseRuntimeResultSchema.safeParse({ cases });
        return output.success ? { ok: true as const, value: output.data }
          : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.post('/:caseId/confirmation', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    if (request.body && (typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length)) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    const row = await prisma.partnerSaleCase.findUnique({ where: { id: request.params.caseId },
      select: { customerContractId: true } });
    if (!row) { respond(response, { ok: false, error: partnerError('NOT_FOUND') }); return; }
    const result = await contractConfirmationService.sendForConfirmation({ contractId: row.customerContractId,
      requestedBy: request.user.id, resend: true, meta: { ipAddress: request.ip,
        userAgent: request.get('user-agent') } });
    if (!result.success) { response.status(409).json(result); return; }
    response.setHeader('Cache-Control', 'private, no-store'); response.json(result);
  });
  router.post('/:caseId/output', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const parsed = partnerContracts.PartnerCustomerOutputRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    const { mode, snapshotId: snapshotIdValue } = parsed.data;
    const correlationId = correlation(request);
    try {
      const prepared = await prisma.$transaction(async tx => {
        const snapshotRecord = await tx.partnerCustomerOutputSnapshot.findUnique({ where: { id: snapshotIdValue } });
        const snapshot = CustomerOutputSnapshotSchema.safeParse(snapshotRecord?.content);
        const row = await tx.partnerSaleCase.findUnique({ where: { id: request.params.caseId }, select: {
          id: true, state: true, headRevision: true, integrityHash: true,
          customerContractId: true, profile: { select: { userId: true } },
        } });
        if (!snapshotRecord || !snapshot.success || !row || snapshotRecord.caseId !== row.id ||
            snapshot.data.owner.caseId !== row.id) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const allowed = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'CUSTOMER_OUTPUT', channel: 'PDF' }, { correlationId }).authorize('CUSTOMER_OUTPUT', { kind: 'CASE', id: row.id });
        if (!allowed.ok) return allowed;
        if (mode === 'FINAL' && row.state !== 'CUSTOMER_APPROVED' && row.state !== 'COMMITTED') {
          return { ok: false as const, error: partnerError('STATE_CONFLICT') };
        }
        if (mode === 'FINAL') {
          const verified = await tx.contractPublicConfirmation.findFirst({ where: { contractId: row.customerContractId,
            createdBy: `partner-output:${snapshot.data.snapshotId}`, status: 'VERIFIED', verifiedAt: { not: null } } });
          if (!verified) return { ok: false as const, error: partnerError('STATE_CONFLICT') };
        }
        const existing = mode === 'PREVIEW' ? null : await tx.partnerCustomerArtifact.findUnique({
          where: { snapshotId_mode: { snapshotId: snapshot.data.snapshotId, mode: 'FINAL' } } });
        return { ok: true as const, value: { snapshot: snapshot.data, row, existing } };
      });
      if (!prepared.ok) { respond(response, prepared); return; }
      if (mode === 'DOWNLOAD_EXISTING' && !prepared.value.existing) {
        respond(response, { ok: false, error: partnerError('NOT_FOUND') }); return;
      }
      if (prepared.value.existing) {
        const existing = prepared.value.existing;
        const actualByteHash = `sha256-v1:${createHash('sha256').update(existing.content).digest('hex')}`;
        if (!existing.publishedAt || existing.caseId !== prepared.value.row.id ||
            existing.caseRevision !== prepared.value.snapshot.owner.revision ||
            existing.outputHash !== prepared.value.snapshot.content.outputHash || existing.byteHash !== actualByteHash) {
          respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); return;
        }
      }
      let bytes = prepared.value.existing?.content ?? await generateCustomerContractPdf(partnerContracts,
        prepared.value.snapshot.content);
      if (mode === 'FINAL' && !prepared.value.existing) {
        const byteHash = `sha256-v1:${createHash('sha256').update(bytes).digest('hex')}`;
        const committed = await prisma.$transaction(async tx => {
          await lockPartnerOperationsControl(tx);
          const artifactId = randomUUID();
          const artifact = await tx.partnerCustomerArtifact.create({ data: { id: artifactId,
            snapshotId: prepared.value.snapshot.snapshotId, caseId: prepared.value.row.id,
            caseRevision: prepared.value.snapshot.owner.revision, mode: 'FINAL',
            outputHash: prepared.value.snapshot.content.outputHash, byteHash, content: bytes,
            actorId: request.user!.id, publishedAt: new Date() } });
          const authorize = async (_tx: Prisma.TransactionClient, input: { actorId: string; action: 'CASE_COMMIT' | 'CASE_CANCEL' | 'CUSTOMER_OUTPUT';
            purpose: 'PARTNER' | 'MANAGEMENT' | 'CUSTOMER_OUTPUT'; root: { kind: 'CASE'; id: string } }) => {
            const decision = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
              purpose: input.purpose, channel: input.action === 'CUSTOMER_OUTPUT' ? 'PDF' : 'API' }, { correlationId })
              .authorize(input.action, input.root);
            if (!decision.ok) return decision;
            const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: request.user!.id,
              action: input.action, rootKind: 'CASE', rootId: input.root.id, purpose: input.purpose,
              channel: input.action === 'CUSTOMER_OUTPUT' ? 'PDF' : 'API', correlationId, allowed: true });
            return evidence ? { ok: true as const, value: { evidenceId: evidence.id } }
              : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
          };
          const service = createPartnerCaseLifecycleService({ actorId: request.user!.id, cancellationPurpose: 'PARTNER',
            transaction: work => work(tx), authorize,
            verifyOutputEvidence: async (_tx, input) => {
              const current = await tx.partnerCustomerArtifact.findUnique({ where: { id: input.authenticatedOutputEvidenceId } });
              if (!current || current.id !== artifact.id || current.caseId !== input.caseId || current.mode !== 'FINAL' ||
                  current.outputHash !== prepared.value.snapshot.content.outputHash || current.byteHash !== byteHash ||
                  `sha256-v1:${createHash('sha256').update(current.content).digest('hex')}` !== byteHash) {
                return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
              }
              return { ok: true, value: { evidenceId: current.id, occurredAt: new Date().toISOString(), outputHash: current.outputHash } };
            },
            cancelConfirmationSessions: async () => ({ ok: true, value: { invalidatedSessionIds: [],
              preservedSnapshotIds: [prepared.value.snapshot.snapshotId] } }),
            recordEvidenceReview: async () => undefined,
          });
          const intent = { trigger: 'PRINTED' as const, authenticatedOutputEvidenceId: artifact.id };
          const commandId = randomUUID();
          const result = await service.execute({ schemaVersion: 1, type: 'CASE_COMMIT', commandId, correlationId,
            expected: prepared.value.snapshot.owner, expectedState: prepared.value.row.state === 'COMMITTED' ? 'COMMITTED' : 'CUSTOMER_APPROVED',
            ...intent, idempotency: { actorId: request.user!.id, operation: 'CASE_COMMIT',
              targetId: prepared.value.row.id, key: artifact.id,
              payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_COMMIT', ...intent }) } });
          if (!result.ok) throw Object.assign(new Error('Partner print commitment failed'), { result });
          return result;
        });
        if (!committed.ok) { respond(response, committed); return; }
      }
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Content-Type', 'application/pdf');
      response.setHeader('Content-Disposition', `inline; filename="partner-contract-${request.params.caseId}.pdf"`);
      response.send(bytes);
    } catch (error) {
      const result = error && typeof error === 'object' && 'result' in error ? (error as { result: Result<unknown> }).result : undefined;
      respond(response, result ?? { ok: false, error: partnerError('INTEGRITY_CONFLICT') });
    }
  });
  return router;
}

export default createPartnerCaseRouter();
