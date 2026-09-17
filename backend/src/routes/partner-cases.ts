import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as partnerContracts from '@sabalanerp/partner-sales-contracts';
import { CustomerOutputSnapshotSchema, canonicalHash, partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { prisma as applicationPrisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createPrismaPartnerCaseService } from '../services/partnerSales/cases/aggregate';
import { createPrismaPartnerCaseDependencies } from '../services/partnerSales/cases/prismaComposition';
import { createPartnerCaseLifecycleService, createPrismaPartnerCaseLifecycleService } from '../services/partnerSales/cases/lifecycle';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../services/effectiveAuthorization/audit';
import { generateCustomerContractPdf } from '../utils/pdf';
import { contractConfirmationService } from '../services/contractConfirmationService';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../services/partnerSales/authorization/technicalRollout';
import { PARTNER_TECHNICAL_RECOVERY_KIND } from '../services/contractRecoveryProtection';
import { decodeTechnicalRecovery } from '../services/partnerSales/cases/technicalRecoveryRecords';
import { resolvePrismaPartnerCaseDraft } from '../services/partnerSales/cases/prismaComposition';
import { resolveApprovalForUse } from '../services/partnerSales/inquiries/approvalUsage';
import { decodeTechnicalSavedSnapshot } from '../services/partnerSales/cases/technicalSavedRecords';
import { parseInquiryDefinition } from '../services/partnerSales/inquiries/definition';

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
          inquiries: { orderBy: { createdAt: 'desc' }, take: 100, select: { id: true } },
          customers: { where: { isActive: true }, orderBy: { createdAt: 'desc' }, select: {
            id: true, firstName: true, lastName: true, companyName: true,
            address: true, workAddress: true, homeAddress: true,
            phoneNumbers: { where: { isActive: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 },
          } },
          user: { select: { firstName: true, lastName: true, username: true,
            responsibleCrmPotentialProjects: { where: { isActive: true, wonSalesContractId: null,
            partnerRevision: { not: null } }, orderBy: { updatedAt: 'desc' }, select: {
              id: true, customerId: true, title: true,
            } } } },
        } });
        if (!profile) return { ok: true as const, value: partnerContracts.PartnerCreationContextSchema.parse({
          schemaVersion: 1, kind: 'ORDINARY_SALES' }) };
        const rollout = await authorizePartnerTechnicalRollout(tx, profile.id, 'MUTATE');
        const permission = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'PARTNER', channel: 'API' }, { correlationId: correlation(request) })
          .authorize('CASE_DRAFT_WRITE', { kind: 'PROFILE', id: profile.id });
        const writable = profile.state === 'ACTIVE' && rollout.ok && permission.ok;
        const blockedCode = !rollout.ok ? rollout.error.code
          : !permission.ok ? permission.error.code : profile.state !== 'ACTIVE' ? 'PARTNER_NOT_ACTIVE' : undefined;
        const rawDrafts = await tx.salesContractEditSession.findMany({ where: { ownerUserId: request.user!.id,
          contractId: null,
          recovery: { path: ['kind'], equals: PARTNER_TECHNICAL_RECOVERY_KIND } },
          orderBy: { updatedAt: 'desc' }, take: 200, select: { draftId: true, baseRevision: true, recovery: true } });
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const recoverableDrafts = rawDrafts.flatMap(item => {
          const recovery = decodeTechnicalRecovery(item.recovery);
          return recovery && recovery.archived !== true && recovery.updatedAt <= clock.now.getTime() &&
              clock.now.getTime() - recovery.updatedAt <= 7 * 24 * 60 * 60 * 1000
            ? [{ ...item, updatedAt: new Date(recovery.updatedAt),
              ...(typeof recovery.draftTitle === 'string' && recovery.draftTitle.trim()
                ? { title: recovery.draftTitle.trim().slice(0, 200) } : {}) }] : [];
        }).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()).slice(0, 50);
        const recoverableDraft = recoverableDrafts[0];
        const value = partnerContracts.PartnerCreationContextSchema.safeParse({ schemaVersion: 1, kind: 'PARTNER',
          actorId: request.user!.id,
          actorDisplayName: `${profile.user.firstName} ${profile.user.lastName}`.trim() || profile.user.username,
          profileId: profile.id, writable, ...(blockedCode ? { blockedCode } : {}),
          ...(profile.inquiries[0] ? { latestInquiryId: profile.inquiries[0].id } : {}),
          inquiryIds: profile.inquiries.map(inquiry => inquiry.id),
          ...(recoverableDraft ? { recoverableDraft: { recoveryId: recoverableDraft.draftId,
            baseRevision: recoverableDraft.baseRevision, updatedAt: recoverableDraft.updatedAt.toISOString(),
            ...(recoverableDraft.title ? { title: recoverableDraft.title } : {}) } } : {}),
          recoverableDrafts: recoverableDrafts.map(item => ({ recoveryId: item.draftId,
            baseRevision: item.baseRevision, updatedAt: item.updatedAt.toISOString(), ...(item.title ? { title: item.title } : {}) })),
          customers: profile.customers.map(customer => ({ id: customer.id,
            displayName: customer.companyName || `${customer.firstName} ${customer.lastName}`.trim(),
            address: customer.address || customer.workAddress || customer.homeAddress || 'ثبت‌نشده',
            ...(customer.phoneNumbers[0]?.number ? { phone: customer.phoneNumbers[0].number } : {}) })),
          projects: profile.user.responsibleCrmPotentialProjects,
        });
        return value.success ? { ok: true as const, value: value.data }
          : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.patch('/drafts/:recoveryId', async (request: AuthRequest, response) => {
    if (!request.user || typeof request.body?.title !== 'string' || !request.body.title.trim() ||
        request.body.title.trim().length > 200) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    try {
      const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM sales_contract_edit_sessions WHERE "draftId" = ${request.params.recoveryId} FOR UPDATE`;
        const session = await tx.salesContractEditSession.findUnique({ where: { draftId: request.params.recoveryId },
          select: { id: true, ownerUserId: true, purpose: true, recovery: true } });
        const recovery = decodeTechnicalRecovery(session?.recovery);
        if (!session || session.ownerUserId !== request.user!.id || session.purpose !== 'PARTNER_TECHNICAL' || !recovery) {
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        }
        await tx.salesContractEditSession.update({ where: { id: session.id }, data: {
          recovery: json({ ...recovery, draftTitle: request.body.title.trim() }) } });
        return { ok: true as const, value: { recoveryId: request.params.recoveryId, title: request.body.title.trim() } };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.delete('/drafts/:recoveryId', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    try {
      const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM sales_contract_edit_sessions WHERE "draftId" = ${request.params.recoveryId} FOR UPDATE`;
        const session = await tx.salesContractEditSession.findUnique({ where: { draftId: request.params.recoveryId },
          select: { id: true, ownerUserId: true, purpose: true, recovery: true } });
        const recovery = decodeTechnicalRecovery(session?.recovery);
        if (!session || session.ownerUserId !== request.user!.id || session.purpose !== 'PARTNER_TECHNICAL' || !recovery) {
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        }
        const inquiryEvidence = await tx.partnerInquiryRow.count({ where: {
          definition: { path: ['configurationRef', 'recoveryId'], equals: request.params.recoveryId } } });
        if (inquiryEvidence === 0) await tx.salesContractEditSession.delete({ where: { id: session.id } });
        else await tx.salesContractEditSession.update({ where: { id: session.id }, data: {
          recovery: json({ ...recovery, archived: true }) } });
        return { ok: true as const, value: { recoveryId: request.params.recoveryId } };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.get('/drafts/:recoveryId/wizard', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    try {
      const session = await prisma.salesContractEditSession.findUnique({ where: { draftId: request.params.recoveryId },
        select: { ownerUserId: true, purpose: true, recovery: true } });
      const recovery = decodeTechnicalRecovery(session?.recovery);
      const wizard = recovery && partnerContracts.PartnerWizardRecoverySnapshotSchema.safeParse(recovery.wizardDraft);
      respond(response, !session || session.ownerUserId !== request.user.id || session.purpose !== 'PARTNER_TECHNICAL'
        ? { ok: false, error: partnerError('NOT_FOUND') }
        : wizard?.success ? { ok: true, value: wizard.data }
          : { ok: false, error: partnerError(wizard ? 'INTEGRITY_CONFLICT' : 'NOT_FOUND') });
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.put('/drafts/:recoveryId/wizard', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const parsed = partnerContracts.PartnerWizardRecoverySaveSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.intent.recoveryId !== request.params.recoveryId) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    try {
      const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM sales_contract_edit_sessions WHERE "draftId" = ${request.params.recoveryId} FOR UPDATE`;
        const session = await tx.salesContractEditSession.findUnique({ where: { draftId: request.params.recoveryId },
          select: { id: true, ownerUserId: true, purpose: true, recovery: true } });
        const recovery = decodeTechnicalRecovery(session?.recovery);
        if (!session || session.ownerUserId !== request.user!.id || session.purpose !== 'PARTNER_TECHNICAL' || !recovery) {
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        }
        const profile = await tx.partnerProfile.findUnique({ where: { userId: request.user!.id }, select: { id: true, state: true } });
        if (!profile || profile.state !== 'ACTIVE') return { ok: false as const, error: partnerError('PARTNER_NOT_ACTIVE') };
        const rollout = await authorizePartnerTechnicalRollout(tx, profile.id, 'MUTATE');
        if (!rollout.ok) return rollout;
        const permission = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'PARTNER', channel: 'API' }, { correlationId: correlation(request) })
          .authorize('CASE_DRAFT_WRITE', { kind: 'PROFILE', id: profile.id });
        if (!permission.ok) return permission;
        const previous = partnerContracts.PartnerWizardRecoverySnapshotSchema.safeParse(recovery.wizardDraft);
        if (recovery.wizardDraft !== undefined && !previous.success) {
          return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        }
        const currentRevision = previous.success ? previous.data.wizardRevision : 0;
        if (currentRevision !== parsed.data.expectedWizardRevision) {
          return { ok: false as const, error: partnerError('ROW_STALE') };
        }
        const records = Array.isArray(recovery.validatedSnapshots) ? recovery.validatedSnapshots : [];
        let saved: Awaited<ReturnType<typeof decodeTechnicalSavedSnapshot>> = undefined;
        for (const record of records) {
          const candidate = await decodeTechnicalSavedSnapshot(record);
          if (candidate?.view.recoveryRevision === parsed.data.intent.recoveryRevision) saved = candidate;
        }
        const primaryIds = saved?.view.rows.map(row => row.configurationRef.productRowId) ?? [];
        const intentIds = parsed.data.intent.rows.map(row => row.productRowId);
        const materialIds = (saved?.view.pricingSubjects ?? []).filter(subject => subject.role === 'ADDITIONAL_MATERIAL')
          .map(subject => subject.configurationRef.productRowId);
        const intentMaterialIds = (parsed.data.intent.additionalMaterialApprovals ?? []).map(item => item.pricingSubjectId);
        if (!saved || saved.view.recoveryId !== request.params.recoveryId || saved.view.graphHash !== parsed.data.intent.graphHash ||
            primaryIds.length !== intentIds.length || primaryIds.some(id => !intentIds.includes(id)) ||
            materialIds.length !== intentMaterialIds.length || materialIds.some(id => !intentMaterialIds.includes(id))) {
          return { ok: false as const, error: partnerError('CONFIG_MISMATCH') };
        }
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const snapshot = partnerContracts.PartnerWizardRecoverySnapshotSchema.parse({ schemaVersion: 1,
          wizardRevision: currentRevision + 1, step: parsed.data.step, intent: parsed.data.intent,
          updatedAt: clock.now.toISOString() });
        await tx.salesContractEditSession.update({ where: { id: session.id }, data: { updatedAt: clock.now,
          recovery: json({ ...recovery, updatedAt: clock.now.getTime(), wizardDraft: snapshot }) } });
        return { ok: true as const, value: snapshot };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.post('/approval-matches', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const parsed = partnerContracts.PartnerApprovalMatchRequestSchema.safeParse(request.body);
    if (!parsed.success) { respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return; }
    try {
      const result = await prisma.$transaction(async tx => {
        const profile = await tx.partnerProfile.findUnique({ where: { userId: request.user!.id },
          select: { id: true, state: true } });
        if (!profile) return { ok: false as const, error: partnerError('NOT_FOUND') };
        if (profile.state !== 'ACTIVE') return { ok: false as const, error: partnerError('PARTNER_NOT_ACTIVE') };
        const session = await tx.salesContractEditSession.findUnique({ where: { draftId: parsed.data.recoveryId },
          select: { ownerUserId: true, purpose: true, recovery: true } });
        const recovery = decodeTechnicalRecovery(session?.recovery);
        if (!session || session.ownerUserId !== request.user!.id || session.purpose !== 'PARTNER_TECHNICAL' || !recovery) {
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        }
        let saved: Awaited<ReturnType<typeof decodeTechnicalSavedSnapshot>> = undefined;
        for (const record of Array.isArray(recovery.validatedSnapshots) ? recovery.validatedSnapshots : []) {
          const candidate = await decodeTechnicalSavedSnapshot(record);
          if (candidate?.view.recoveryRevision === parsed.data.recoveryRevision) saved = candidate;
        }
        if (!saved || saved.view.recoveryId !== parsed.data.recoveryId) {
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        }
        const rollout = await authorizePartnerTechnicalRollout(tx, profile.id, 'READ');
        if (!rollout.ok) return rollout;
        const allowed = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'PARTNER', channel: 'API' }, { correlationId: correlation(request) })
          .authorize('CASE_DRAFT_WRITE', { kind: 'PROFILE', id: profile.id });
        if (!allowed.ok) return allowed;
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const candidates = await tx.partnerInquiryRow.findMany({ where: { inquiry: { profileId: profile.id },
          outcome: 'APPROVED', approval: { expiresAt: { gt: clock.now } } },
          orderBy: [{ approval: { approvedAt: 'desc' } }, { id: 'desc' }], take: 500,
          select: { id: true, revision: true, configurationHash: true, definition: true,
            successor: { select: { outcome: true } }, approval: { select: { wholesaleUnitPrice: true, currency: true,
              approvedAt: true, expiresAt: true, note: true, usages: { include: { binding: { include: {
                caseRevision: { include: { case: { select: { caseNumber: true } } } },
              } } } } } }, inquiryId: true } });
        const rows: partnerContracts.PartnerApprovalMatchSet['rows'] = [];
        const missingPricingSubjectIds: string[] = [];
        for (const identityRow of saved.identities) {
          const subjectHash = await partnerContracts.inquiryConfigurationHash(identityRow.identity);
          let matched: typeof candidates[number] | undefined;
          let definition: ReturnType<typeof parseInquiryDefinition>;
          for (const candidate of candidates) {
            if (!candidate.approval || candidate.successor?.outcome === 'APPROVED') continue;
            const decoded = parseInquiryDefinition(candidate.definition);
            if (!decoded || decoded.identity.partnerSellerId !== request.user!.id ||
                await partnerContracts.inquiryConfigurationHash(decoded.identity) !== subjectHash) continue;
            const usable = await resolveApprovalForUse(tx, { binding: { inquiryId: candidate.inquiryId,
              rowId: candidate.id, revision: candidate.revision }, partnerSellerId: request.user!.id,
              configurationHash: candidate.configurationHash });
            if (usable.ok) { matched = candidate; definition = decoded; break; }
          }
          if (!matched?.approval || !definition) { missingPricingSubjectIds.push(identityRow.productRowId); continue; }
          rows.push({ rowId: matched.id, revision: matched.revision, description: definition.description,
            state: 'APPROVED', configuration: definition.configuration,
            configurationRef: { recoveryId: saved.view.recoveryId, recoveryRevision: saved.view.recoveryRevision,
              productRowId: identityRow.productRowId },
            ...(definition.sellerNote ? { sellerNote: definition.sellerNote } : {}),
            approvedPrice: { amount: matched.approval.wholesaleUnitPrice.toString(), currency: matched.approval.currency as 'IRR' | 'IRT' },
            approvedAt: matched.approval.approvedAt.toISOString(), expiresAt: matched.approval.expiresAt.toISOString(),
            ...(matched.approval.note ? { noteOrReason: matched.approval.note } : {}),
            usedCaseNumbers: matched.approval.usages.map(usage => usage.binding.caseRevision.case.caseNumber),
            approvedRowBinding: { inquiryId: matched.inquiryId, rowId: matched.id, revision: matched.revision } });
        }
        const view = partnerContracts.PartnerApprovalMatchSetSchema.safeParse({ schemaVersion: 1,
          recoveryId: saved.view.recoveryId, recoveryRevision: saved.view.recoveryRevision,
          rows, missingPricingSubjectIds });
        return view.success ? { ok: true as const, value: view.data }
          : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.post('/quote', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const parsed = partnerContracts.PartnerCommandSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.type !== 'CASE_SUBMIT' ||
        parsed.data.idempotency.actorId !== request.user.id ||
        parsed.data.idempotency.targetId !== parsed.data.intent.recoveryId) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    const command = parsed.data as Extract<partnerContracts.PartnerCommand, { type: 'CASE_SUBMIT' }>;
    try {
      const result = await prisma.$transaction(async tx => {
        const profile = await tx.partnerProfile.findUnique({ where: { userId: request.user!.id }, select: { id: true } });
        if (!profile) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const rollout = await authorizePartnerTechnicalRollout(tx, profile.id, 'MUTATE');
        if (!rollout.ok) return rollout;
        const allowed = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'PARTNER', channel: 'API' }, { correlationId: correlation(request) })
          .authorize('CASE_DRAFT_WRITE', { kind: 'PROFILE', id: profile.id });
        if (!allowed.ok) return allowed;
        const resolved = await resolvePrismaPartnerCaseDraft(tx, { actorId: request.user!.id, command });
        if (!resolved.ok) return resolved;
        for (const row of resolved.value.rows) {
          const binding = command.intent.rows.find(item => item.productRowId === row.productRowId)?.approvedRowBinding;
          if (!binding) return { ok: false as const, error: partnerError('CONFIG_MISMATCH') };
          const approval = await resolveApprovalForUse(tx, { binding, partnerSellerId: request.user!.id,
            configurationHash: row.configurationHash });
          if (!approval.ok) return approval;
        }
        for (const material of resolved.value.additionalMaterialApprovals ?? []) {
          const binding = command.intent.additionalMaterialApprovals?.find(item =>
            item.pricingSubjectId === material.pricingSubjectId)?.approvedRowBinding;
          if (!binding) return { ok: false as const, error: partnerError('CONFIG_MISMATCH') };
          const approval = await resolveApprovalForUse(tx, { binding, partnerSellerId: request.user!.id,
            configurationHash: material.configurationHash });
          if (!approval.ok) return approval;
        }
        return { ok: true as const, value: partnerContracts.PartnerWholesaleQuoteSchema.parse({ schemaVersion: 1,
          recoveryId: command.intent.recoveryId, recoveryRevision: command.intent.recoveryRevision,
          graphHash: command.intent.graphHash, rows: resolved.value.rows.map(row => ({ productRowId: row.productRowId,
            wholesaleUnitPrice: { amount: row.wholesaleUnitPriceAmount, currency: 'IRT' as const } })) }) };
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
  router.post('/lifecycle/commands', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const command = partnerContracts.PartnerCommandSchema.safeParse(request.body);
    if (!command.success || command.data.type !== 'CASE_CANCEL') {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    const correlationId = correlation(request);
    try {
      const profile = await prisma.partnerProfile.findUnique({ where: { userId: request.user.id }, select: { id: true } });
      const purpose = profile ? 'PARTNER' as const : 'MANAGEMENT' as const;
      const service = createPrismaPartnerCaseLifecycleService({ database: prisma, actorId: request.user.id,
        cancellationPurpose: purpose,
        authorize: async (tx, input) => {
          const decision = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
            purpose: input.purpose, channel: 'API' }, { correlationId }).authorize(input.action, input.root);
          if (!decision.ok) return decision;
          const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: request.user!.id,
            action: input.action, rootKind: 'CASE', rootId: input.root.id, purpose: input.purpose,
            channel: 'API', correlationId, allowed: true });
          return evidence ? { ok: true as const, value: { evidenceId: evidence.id } }
            : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        },
        verifyOutputEvidence: async () => ({ ok: false as const, error: partnerError('STATE_CONFLICT') }),
        cancelConfirmationSessions: async (tx, input) => {
          const sessions = await tx.contractPublicConfirmation.findMany({ where: {
            contract: { partnerCaseId: input.caseId }, status: 'PENDING' }, select: { id: true } });
          if (sessions.length) await tx.contractPublicConfirmation.updateMany({ where: { id: { in: sessions.map(item => item.id) } },
            data: { status: 'CANCELLED', cancelledAt: new Date() } });
          return { ok: true as const, value: { invalidatedSessionIds: sessions.map(item => item.id), preservedSnapshotIds: [] } };
        },
        recordEvidenceReview: async (tx, review) => {
          const id = randomUUID();
          await tx.partnerCommandOutcome.create({ data: { id, actorId: request.user!.id,
            operation: 'PARTNER_CASE_INTEGRITY_REVIEW', targetScope: review.caseId, key: id,
            payloadHash: await canonicalHash(review.evidence), outcome: json(review) } });
        },
      });
      respond(response, await service.execute(command.data));
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
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
          orderBy: { createdAt: 'desc' }, select: { id: true, state: true, pricingState: true,
            customerConfirmationState: true, headRevision: true, integrityHash: true,
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
          cases.push({ view: { ...view.data, state: row.state,
            pricingState: row.pricingState, customerConfirmationState: row.customerConfirmationState },
            snapshotId: row.outputs[0]?.id || null,
            actions: { canPreview: output && Boolean(row.outputs[0]),
              canIssue: output && commit && row.pricingState === 'READY_TO_FINALIZE' && Boolean(row.outputs[0]) &&
                ['CUSTOMER_APPROVED', 'COMMITTED'].includes(row.state),
              canSendConfirmation: output && row.pricingState === 'READY_TO_FINALIZE' &&
                ['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION'].includes(row.state),
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
      select: { customerContractId: true, pricingState: true } });
    if (!row) { respond(response, { ok: false, error: partnerError('NOT_FOUND') }); return; }
    if (row.pricingState !== 'READY_TO_FINALIZE') {
      respond(response, { ok: false, error: partnerError('STATE_CONFLICT') }); return;
    }
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
          id: true, state: true, pricingState: true, headRevision: true, integrityHash: true,
          customerContractId: true, profile: { select: { userId: true } },
        } });
        if (!snapshotRecord || !snapshot.success || !row || snapshotRecord.caseId !== row.id ||
            snapshot.data.owner.caseId !== row.id) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const allowed = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'CUSTOMER_OUTPUT', channel: 'PDF' }, { correlationId }).authorize('CUSTOMER_OUTPUT', { kind: 'CASE', id: row.id });
        if (!allowed.ok) return allowed;
        if (mode === 'FINAL' && (row.pricingState !== 'READY_TO_FINALIZE' ||
            (row.state !== 'CUSTOMER_APPROVED' && row.state !== 'COMMITTED'))) {
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
