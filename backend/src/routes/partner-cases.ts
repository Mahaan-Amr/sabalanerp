import { canManageCommercialSettings } from '../services/ordinaryContractLifecycle';
import { appendPartnerCommercialEvent } from '../services/partnerSales/cases/commercialEvents';
import { approvePartnerCommercialSales, readPartnerCommercialState, resetPartnerCommercialApprovals, lockPartnerCommercialContract, assertPartnerCommercialAvailable } from '../services/partnerSales/cases/commercialLifecycle';
import { casePdfAvailability, resolveCasePdfSnapshot } from '../services/partnerSales/customerOutput/casePdf';
import { createCustomerOutputSnapshots } from '../services/partnerSales/customerOutput/snapshots';
import { CustomerOutputError } from '../services/partnerSales/customerOutput/contracts';
import { readCasePricingResponse } from '../services/partnerSales/cases/pricingResponse';
import { z } from 'zod';
import { createPartnerTechnicalEvidenceResolver } from '../services/partnerSales/cases/technicalEvidence';
import { compilePartnerTechnicalGraph } from '../services/partnerSales/cases/technicalGraph';
import { partnerCustomerGraphTotal } from '../services/partnerSales/cases/customerGraphTotal';
import { resolvePartnerTechnicalServices } from '../services/partnerSales/cases/technicalServices';
import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as partnerContracts from '@sabalanerp/partner-sales-contracts';
import { canonicalHash, partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { prisma as applicationPrisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { createPartnerCaseService, createPrismaPartnerCaseService } from '../services/partnerSales/cases/aggregate';
import { createPrismaPartnerCaseDependencies } from '../services/partnerSales/cases/prismaComposition';
import { createPartnerCaseLifecycleService, createPrismaPartnerCaseLifecycleService,
  projectionEvidence } from '../services/partnerSales/cases/lifecycle';
import { buildCaseProjections } from '../services/partnerSales/cases/projections';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../services/effectiveAuthorization/audit';
import { generateCustomerContractPdf } from '../utils/pdf';
import { contractConfirmationService } from '../services/contractConfirmationService';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../services/partnerSales/authorization/technicalRollout';
import { PARTNER_TECHNICAL_RECOVERY_KIND } from '../services/contractRecoveryProtection';
import { decodeTechnicalRecovery } from '../services/partnerSales/cases/technicalRecoveryRecords';
import { consumePrismaPartnerTechnicalRecovery, resolvePrismaPartnerCaseDraft } from '../services/partnerSales/cases/prismaComposition';
import { canRetainCasePricingApproval, resolveApprovalForUse } from '../services/partnerSales/inquiries/approvalUsage';
import { decodeTechnicalSavedSnapshot } from '../services/partnerSales/cases/technicalSavedRecords';
import { parseInquiryDefinition } from '../services/partnerSales/inquiries/definition';
import { assertContractEditOwnership, PrismaContractEditSessionStore } from '../services/contractEditSessionService';
import { assertPartnerCasePrismaClientCompatibility } from '../services/partnerSales/cases/prismaClientCompatibility';
import { createPartnerInquiryService, type PartnerInquiryDependencies } from '../services/partnerSales/inquiries/service';
import { ensureMissingResponderSupport, resolveEligibleResponder, resolveProfileResponder,
  resolveSavedTechnicalConfiguration } from '../services/partnerSales/inquiries/adapters';
import { dispatchPartnerInquiryEvents, inquiryNotificationAccess } from '../services/partnerSales/notifications/inquiryDelivery';
import { completePartnerPricingResultDutiesForCase } from '../services/crossWorkspaceDutyAdapters/partnerPricingDutyAdapter';
import { shouldExposePartnerRecovery } from '../services/partnerSales/cases/recoveryVisibility';
import { generateContractNumberAssignment } from '../services/contractNumberService';
import { enqueueCommittedPartnerCase } from '../services/partnerSales/accounting/commitQueue';
import { meaningfulPartnerWizardUpdatedAt, reconcilePartnerCreationDrafts } from '../services/partnerSales/cases/partnerDraftRetention';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function correlation(request: Request) {
  const supplied = request.get('X-Correlation-Id');
  return supplied && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(supplied) ? supplied : randomUUID();
}

function normalizeCustomerRecipient(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('0098')) return `+98${digits.slice(4)}`;
  if (digits.startsWith('98')) return `+${digits}`;
  if (digits.startsWith('0')) return `+98${digits.slice(1)}`;
  return `+98${digits}`;
}

function respond(response: Response, result: Result<unknown>) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (result.ok) { response.json({ success: true, data: result.value }); return; }
  response.status(result.error.status).json({ success: false, code: result.error.code,
    error: result.error.message, supportReference: randomUUID() });
}

export { allocatePartnerLinkedPair } from '../services/partnerSales/cases/linkedPair';
import { allocatePartnerLinkedPair } from '../services/partnerSales/cases/linkedPair';

export function createPartnerCaseRouter(input: { database?: PrismaClient; authenticate?: RequestHandler } = {}) {
  assertPartnerCasePrismaClientCompatibility();
  const prisma = input.database ?? applicationPrisma;
  const router = Router();
  router.use(input.authenticate ?? protect);
  router.get('/creation-context', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    try {
      const result = await prisma.$transaction(async tx => {
        const requestedCaseId = typeof request.query.caseId === 'string' ? request.query.caseId : undefined;
        const requestedCase = requestedCaseId ? await tx.partnerSaleCase.findFirst({ where: {
          id: requestedCaseId, profile: { userId: request.user!.id },
          OR: [{ state: { in: [...partnerContracts.PARTNER_EDITABLE_CASE_STATES] } }, { state: 'COMMITTED', commercialFlowVersion: 1 }],
        }, select: { customerContractId: true } }) : null;
        if (requestedCaseId && !requestedCase) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const profile = await tx.partnerProfile.findUnique({ where: { userId: request.user!.id }, select: {
          id: true, state: true,
          commercialAccount: { select: { terms: { orderBy: [{ effectiveDate: 'desc' }, { version: 'desc' }] } } },
          inquiries: { ...(requestedCaseId ? { where: { caseId: requestedCaseId } } : {}),
            orderBy: { createdAt: 'desc' }, take: 100, select: { id: true } },
          customers: { where: { isActive: true }, orderBy: { createdAt: 'desc' }, select: {
            id: true, firstName: true, lastName: true, companyName: true,
            address: true, workAddress: true, homeAddress: true,
            phoneNumbers: { where: { isActive: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 },
            projectAddresses: { where: { isActive: true }, orderBy: { updatedAt: 'desc' }, select: {
              id: true, customerId: true, projectName: true, address: true, city: true, projectType: true,
              projectManagerName: true, projectManagerNumber: true,
              marketerFirstName: true, marketerLastName: true, marketerPhoneNumber: true,
            } },
          } },
          user: { select: { firstName: true, lastName: true, username: true } },
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
        const requestedRecovery = requestedCaseId ? await tx.salesContractEditSession.findFirst({ where: {
          ownerUserId: request.user!.id, purpose: 'PARTNER_TECHNICAL',
          recovery: { path: ['partnerCaseId'], equals: requestedCaseId },
        }, orderBy: { updatedAt: 'desc' }, select: { draftId: true, baseRevision: true, recovery: true } }) : null;
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const recoverableDraftRows = [...rawDrafts, ...(requestedRecovery && !rawDrafts.some(item =>
          item.draftId === requestedRecovery.draftId) ? [requestedRecovery] : [])].flatMap(item => {
          const recovery = decodeTechnicalRecovery(item.recovery);
          return recovery && recovery.archived !== true && recovery.updatedAt <= clock.now.getTime() &&
              (Boolean(recovery.partnerCaseId) ||
                clock.now.getTime() - recovery.updatedAt <= 7 * 24 * 60 * 60 * 1000)
            ? [{ ...item, updatedAt: new Date(recovery.updatedAt),
              ...(typeof recovery.draftTitle === 'string' && recovery.draftTitle.trim()
                ? { title: recovery.draftTitle.trim().slice(0, 200) } : {}) }] : [];
        }).sort((left, right) => {
          if (requestedCaseId) {
            const leftRecovery = decodeTechnicalRecovery(left.recovery);
            const rightRecovery = decodeTechnicalRecovery(right.recovery);
            const leftBound = leftRecovery?.partnerCaseId === requestedCaseId ? 1 : 0;
            const rightBound = rightRecovery?.partnerCaseId === requestedCaseId ? 1 : 0;
            if (leftBound !== rightBound) return rightBound - leftBound;
          }
          return right.updatedAt.getTime() - left.updatedAt.getTime();
        }).slice(0, 50);
        const retention = reconcilePartnerCreationDrafts(recoverableDraftRows.map(item => {
          const caseId = decodeTechnicalRecovery(item.recovery)?.partnerCaseId;
          return { ...item, recoveryId: item.draftId, meaningfulUpdatedAt: item.updatedAt.getTime(),
            ...(typeof caseId === 'string' ? { caseId } : {}) };
        }));
        if (writable && retention.discardRecoveryIds.length) {
          await tx.salesContractEditSession.deleteMany({ where: { ownerUserId: request.user!.id,
            contractId: null, draftId: { in: retention.discardRecoveryIds } } });
          await tx.salesContractDraftAudit.createMany({ data: retention.discardRecoveryIds.map(draftId => ({
            draftId, ownerUserId: request.user!.id, action: 'LEGACY_PARTNER_DRAFT_AUTO_DISCARDED',
          })) });
        }
        const retainedDraftRows = [
          ...(retention.unnumbered ? [retention.unnumbered] : []),
          ...retention.numbered,
        ];
        const boundCaseIds = [...new Set(retainedDraftRows.flatMap(item => {
          const caseId = decodeTechnicalRecovery(item.recovery)?.partnerCaseId;
          return typeof caseId === 'string' ? [caseId] : [];
        }))];
        const editableOwnedCases = boundCaseIds.length ? await tx.partnerSaleCase.findMany({ where: {
          id: { in: boundCaseIds }, profileId: profile.id,
          state: { in: [...partnerContracts.PARTNER_EDITABLE_CASE_STATES] },
        }, select: { id: true, trackingCode: { select: { number: true } } } }) : [];
        const editableOwnedCaseIds = new Set(editableOwnedCases.map(row => row.id));
        const trackingByCaseId = new Map(editableOwnedCases.map(row => [row.id, row.trackingCode?.number]));
        const visibleRecoveries = retainedDraftRows.flatMap(item => {
          const rawCaseId = decodeTechnicalRecovery(item.recovery)?.partnerCaseId;
          const caseId = typeof rawCaseId === 'string' ? rawCaseId : undefined;
          return shouldExposePartnerRecovery(caseId, editableOwnedCaseIds)
            ? [{ ...item, ...(caseId ? { caseId,
              ...(trackingByCaseId.get(caseId) ? { trackingNumber: trackingByCaseId.get(caseId) } : {}) } : {}) }]
            : [];
        });
        const recoverableDraft = requestedCaseId
          ? visibleRecoveries.find(item => item.caseId === requestedCaseId)
          : visibleRecoveries[0];
        const recoverableDrafts = requestedCaseId
          ? visibleRecoveries.filter(item => item.caseId === requestedCaseId)
          : visibleRecoveries;
        const retainedWizard = recoverableDraft
          ? partnerContracts.PartnerWizardRecoverySnapshotSchema.safeParse(
            decodeTechnicalRecovery(recoverableDraft.recovery)?.wizardDraft)
          : undefined;
        const retainedProjectId = retainedWizard?.success ? retainedWizard.data.intent.projectId : undefined;
        const canonicalProjectIds = new Set(profile.customers.flatMap(customer =>
          customer.projectAddresses.map(project => project.id)));
        const retainedLegacyProject = retainedProjectId && !canonicalProjectIds.has(retainedProjectId)
          ? await tx.crmPotentialProject.findFirst({ where: { id: retainedProjectId,
            customer: { partnerOwnerProfileId: profile.id, ownerUserId: request.user!.id },
            responsibleSellerId: request.user!.id, partnerRevision: { not: null }, isActive: true,
          }, select: { id: true, customerId: true, title: true, address: true } })
          : null;
        const value = partnerContracts.PartnerCreationContextSchema.safeParse({ schemaVersion: 1, kind: 'PARTNER',
          actorId: request.user!.id,
          actorDisplayName: `${profile.user.firstName} ${profile.user.lastName}`.trim() || profile.user.username,
          profileId: profile.id, writable, ...(blockedCode ? { blockedCode } : {}),
          ...(profile.inquiries[0] ? { latestInquiryId: profile.inquiries[0].id } : {}),
          inquiryIds: profile.inquiries.map(inquiry => inquiry.id),
          ...(recoverableDraft ? { recoverableDraft: { recoveryId: recoverableDraft.draftId,
            ...(recoverableDraft.caseId ? { caseId: recoverableDraft.caseId } : {}),
            ...(recoverableDraft.trackingNumber ? { trackingNumber: recoverableDraft.trackingNumber } : {}),
            baseRevision: recoverableDraft.baseRevision, updatedAt: recoverableDraft.updatedAt.toISOString(),
            ...(recoverableDraft.title ? { title: recoverableDraft.title } : {}) } } : {}),
          recoverableDrafts: recoverableDrafts.map(item => ({ recoveryId: item.draftId,
            ...(item.caseId ? { caseId: item.caseId } : {}),
            ...(item.trackingNumber ? { trackingNumber: item.trackingNumber } : {}),
            baseRevision: item.baseRevision, updatedAt: item.updatedAt.toISOString(), ...(item.title ? { title: item.title } : {}) })),
          customers: profile.customers.map(customer => ({ id: customer.id,
            displayName: customer.companyName || `${customer.firstName} ${customer.lastName}`.trim(),
            address: customer.address || customer.workAddress || customer.homeAddress || 'ثبت‌نشده',
            ...(customer.phoneNumbers[0]?.number ? { phone: customer.phoneNumbers[0].number } : {}) })),
          projects: [
            ...profile.customers.flatMap(customer => customer.projectAddresses.map(project => ({
              id: project.id, customerId: project.customerId,
              title: project.projectName?.trim() || project.address,
              address: project.address, ...(project.city ? { city: project.city } : {}),
              ...(project.projectType ? { projectType: project.projectType } : {}),
              ...(project.projectManagerName ? { projectManagerName: project.projectManagerName } : {}),
              ...(project.projectManagerNumber ? { projectManagerNumber: project.projectManagerNumber } : {}),
              ...(project.marketerFirstName ? { marketerFirstName: project.marketerFirstName } : {}),
              ...(project.marketerLastName ? { marketerLastName: project.marketerLastName } : {}),
              ...(project.marketerPhoneNumber ? { marketerPhoneNumber: project.marketerPhoneNumber } : {}),
              source: 'CUSTOMER_PROJECT' as const,
            }))),
            ...(retainedLegacyProject ? [{ id: retainedLegacyProject.id,
              customerId: retainedLegacyProject.customerId, title: retainedLegacyProject.title,
              ...(retainedLegacyProject.address ? { address: retainedLegacyProject.address } : {}),
              source: 'LEGACY_POTENTIAL_PROJECT' as const,
            }] : []),
          ],
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
        await tx.salesContractDraftAudit.create({ data: { draftId: request.params.recoveryId,
          ownerUserId: request.user!.id, action: inquiryEvidence === 0
            ? 'PARTNER_DRAFT_DISCARDED' : 'PARTNER_DRAFT_ARCHIVED_WITH_INQUIRY_EVIDENCE' } });
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
      const wizard = recovery?.wizardDraft === undefined ? undefined
        : partnerContracts.PartnerWizardRecoverySnapshotSchema.safeParse(recovery.wizardDraft);
      respond(response, !session || session.ownerUserId !== request.user.id || session.purpose !== 'PARTNER_TECHNICAL'
        ? { ok: false, error: partnerError('NOT_FOUND') }
        : wizard?.success ? { ok: true, value: wizard.data }
          : { ok: false, error: partnerError(wizard ? 'INTEGRITY_CONFLICT' : 'NOT_FOUND') });
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.put('/drafts/:recoveryId/wizard', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const parsed = partnerContracts.PartnerWizardRecoverySaveSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.intent.recoveryId !== request.params.recoveryId ||
        parsed.data.editLease.recoveryId !== request.params.recoveryId) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    try {
      const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM sales_contract_edit_sessions WHERE "draftId" = ${request.params.recoveryId} FOR UPDATE`;
        const session = await tx.salesContractEditSession.findUnique({ where: { draftId: request.params.recoveryId },
          select: { id: true, ownerUserId: true, purpose: true, contractId: true, recovery: true } });
        const recovery = decodeTechnicalRecovery(session?.recovery);
        if (!session || session.ownerUserId !== request.user!.id || session.purpose !== 'PARTNER_TECHNICAL' || !recovery) {
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        }
        const ownership = await assertContractEditOwnership(new PrismaContractEditSessionStore(tx), {
          draftId: parsed.data.editLease.recoveryId, userId: request.user!.id,
          browserSessionId: parsed.data.editLease.browserSessionId,
          leaseToken: parsed.data.editLease.leaseToken, baseRevision: parsed.data.editLease.baseRevision,
        });
        if (!ownership.ok) return { ok: false as const, error: partnerError(ownership.code === 'revision-conflict'
          ? 'ROW_STALE' : ownership.code === 'edit-session-missing' ? 'NOT_FOUND' : 'FORBIDDEN') };
        const recoveryCaseId = typeof recovery.partnerCaseId === 'string' ? recovery.partnerCaseId : undefined;
        const boundContract = session.contractId ? await tx.salesContract.findUnique({ where: { id: session.contractId },
          select: { partnerKind: true, partnerCase: { select: { id: true, state: true, commercialFlowVersion: true,
            profile: { select: { userId: true } } } } } }) : null;
        const recoveryCase = !session.contractId && recoveryCaseId ? await tx.partnerSaleCase.findUnique({
          where: { id: recoveryCaseId }, select: { id: true, state: true, commercialFlowVersion: true, profile: { select: { userId: true } } },
        }) : null;
        const boundCase = boundContract?.partnerCase ?? recoveryCase;
        const invalidContractBinding = Boolean(session.contractId && boundContract?.partnerKind !== 'PARTNER_CUSTOMER');
        const invalidCaseBinding = Boolean((session.contractId || recoveryCaseId) && (!boundCase ||
          boundCase.profile.userId !== request.user!.id || !(partnerContracts.isPartnerCaseEditableState(boundCase.state) || boundCase.commercialFlowVersion === 1 && boundCase.state === 'COMMITTED')));
        if (invalidContractBinding || invalidCaseBinding) {
          return { ok: false as const, error: partnerError('STATE_CONFLICT') };
        }
        const profile = await tx.partnerProfile.findUnique({ where: { userId: request.user!.id }, select: { id: true, state: true } });
        if (!profile || profile.state !== 'ACTIVE') return { ok: false as const, error: partnerError('PARTNER_NOT_ACTIVE') };
        const rollout = await authorizePartnerTechnicalRollout(tx, profile.id, 'MUTATE');
        if (!rollout.ok) return rollout;
        const permission = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'PARTNER', channel: 'API' }, { correlationId: correlation(request) })
          .authorize('CASE_DRAFT_WRITE', boundCase
            ? { kind: 'CASE', id: boundCase.id } : { kind: 'PROFILE', id: profile.id });
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
            intentMaterialIds.some(id => !materialIds.includes(id))) {
          return { ok: false as const, error: partnerError('CONFIG_MISMATCH') };
        }
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const snapshot = partnerContracts.PartnerWizardRecoverySnapshotSchema.parse({ schemaVersion: 1,
          wizardRevision: currentRevision + 1, step: parsed.data.step, intent: parsed.data.intent,
          updatedAt: clock.now.toISOString() });
        const meaningfulUpdatedAt = meaningfulPartnerWizardUpdatedAt({
          ...(previous.success ? { previousIntent: previous.data.intent } : {}),
          nextIntent: parsed.data.intent, previousMeaningfulUpdatedAt: recovery.updatedAt,
          now: clock.now.getTime(),
        });
        await tx.salesContractEditSession.update({ where: { id: session.id }, data: { updatedAt: clock.now,
          recovery: json({ ...recovery, updatedAt: meaningfulUpdatedAt, wizardDraft: snapshot }) } });
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
        const ownedCase = parsed.data.caseId ? await tx.partnerSaleCase.findFirst({
          where: { id: parsed.data.caseId, profileId: profile.id }, select: { id: true, headRevision: true },
        }) : undefined;
        if (parsed.data.caseId && !ownedCase) return { ok: false as const, error: partnerError('NOT_FOUND') };
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
        const candidates = await tx.partnerInquiryRow.findMany({ where: { inquiry: { profileId: profile.id,
          ...(parsed.data.caseId ? { caseId: parsed.data.caseId } : {}) },
          outcome: 'APPROVED', approval: { is: { expiresAt: { gt: clock.now } } } },
          orderBy: [{ approval: { approvedAt: 'desc' } }, { id: 'desc' }], take: 500,
          select: { id: true, revision: true, configurationHash: true, definition: true,
            inquiry: { select: { caseRevision: true } },
            successor: { select: { outcome: true } }, approval: { select: { wholesaleUnitPrice: true, currency: true,
              approvedAt: true, expiresAt: true, note: true, usages: { include: { binding: { include: {
                caseRevision: { include: { case: { select: { caseNumber: true } } } },
              } } } }, materialUsages: { select: { caseId: true, caseRevision: true, pricingSubjectId: true } } } },
            inquiryId: true } });
        const rows: partnerContracts.PartnerApprovalMatchSet['rows'] = [];
        const missingPricingSubjectIds: string[] = [];
        for (const identityRow of saved.identities) {
          if (saved.draft.dependents?.some(item => item.kind === 'remainder' && item.productRowId === identityRow.productRowId)) continue;
          const subjectHash = await partnerContracts.inquiryConfigurationHash(identityRow.identity);
          let matched: typeof candidates[number] | undefined;
          let definition: ReturnType<typeof parseInquiryDefinition>;
          for (const candidate of candidates) {
            if (!candidate.approval || candidate.successor?.outcome === 'APPROVED') continue;
            const decoded = parseInquiryDefinition(candidate.definition);
            if (!decoded || decoded.identity.partnerSellerId !== request.user!.id ||
                await partnerContracts.inquiryConfigurationHash(decoded.identity) !== subjectHash) continue;
            if (parsed.data.caseId && ownedCase &&
                !canRetainCasePricingApproval(candidate.inquiry.caseRevision, ownedCase.headRevision)) continue;
            const usable = await resolveApprovalForUse(tx, { binding: { inquiryId: candidate.inquiryId,
              rowId: candidate.id, revision: candidate.revision }, partnerSellerId: request.user!.id,
              ...(parsed.data.caseId && ownedCase ? { caseId: parsed.data.caseId,
                pricingCaseRevision: candidate.inquiry.caseRevision ?? ownedCase.headRevision } : {}),
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
  router.post('/customer-total-preview', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const parsed = z.object({ recoveryId: partnerContracts.IdSchema,
      draft: partnerContracts.PartnerTechnicalDraftSchema,
    }).strict().safeParse(request.body);
    if (!parsed.success) { respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return; }
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
        const session = await tx.salesContractEditSession.findUnique({ where: { draftId: parsed.data.recoveryId },
          select: { id: true, ownerUserId: true, purpose: true, recovery: true } });
        if (!session || session.ownerUserId !== request.user!.id || session.purpose !== 'PARTNER_TECHNICAL')
          return { ok: false as const, error: partnerError('NOT_FOUND') };
        const recovery = decodeTechnicalRecovery(session.recovery);
        if (!recovery) return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        const history = recovery.validatedSnapshots;
        if (history !== undefined && !Array.isArray(history)) return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        const latest = Array.isArray(history) && history.length ? await decodeTechnicalSavedSnapshot(history.at(-1)) : undefined;
        if (Array.isArray(history) && history.length && (!latest || latest.sessionId !== session.id || latest.view.recoveryId !== parsed.data.recoveryId))
          return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        const evidence = await createPartnerTechnicalEvidenceResolver()(tx, { actorId: request.user!.id,
          recoveryId: parsed.data.recoveryId, draft: parsed.data.draft, previous: latest ?? null });
        if (!evidence.ok) return evidence;
        const compiled = compilePartnerTechnicalGraph(parsed.data.draft, evidence.value.context);
        if (!compiled.ok) return compiled;
        const services = await resolvePartnerTechnicalServices(tx, parsed.data.draft);
        if (!services.ok) return services;
        const wizard = partnerContracts.PartnerWizardRecoverySnapshotSchema.safeParse(recovery.wizardDraft);
        if (recovery.wizardDraft !== undefined && (!wizard.success || wizard.data.intent.recoveryId !== parsed.data.recoveryId))
          return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        const intent = wizard.success ? wizard.data.intent : undefined;
        const total = partnerCustomerGraphTotal(compiled.value.graph, parsed.data.draft,
          intent?.retailDiscount ?? { amount: '0', currency: 'IRT' }, intent?.retailDiscountPercent);
        return { ok: true as const, value: { inputRevision: parsed.data.draft.inputRevision,
          draftHash: await canonicalHash(parsed.data.draft), total } };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); }
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
        const resolved = await resolvePrismaPartnerCaseDraft(tx, { actorId: request.user!.id, command, purpose: 'QUOTE' });
        if (!resolved.ok) return resolved;
        for (const row of resolved.value.rows) {
          const binding = command.intent.rows.find(item => item.productRowId === row.productRowId)?.approvedRowBinding;
          if (!binding) continue;
          const approval = await resolveApprovalForUse(tx, { binding, partnerSellerId: request.user!.id,
            configurationHash: row.configurationHash });
          if (!approval.ok) return approval;
        }
        for (const material of resolved.value.additionalMaterialApprovals ?? []) {
          const binding = command.intent.additionalMaterialApprovals?.find(item =>
            item.pricingSubjectId === material.pricingSubjectId)?.approvedRowBinding;
          if (!binding) continue;
          const approval = await resolveApprovalForUse(tx, { binding, partnerSellerId: request.user!.id,
            configurationHash: material.configurationHash });
          if (!approval.ok) return approval;
        }
        return { ok: true as const, value: partnerContracts.PartnerWholesaleQuoteSchema.parse({ schemaVersion: 1,
          recoveryId: command.intent.recoveryId, recoveryRevision: command.intent.recoveryRevision,
          graphHash: command.intent.graphHash, rows: resolved.value.rows.map(row => ({ productRowId: row.productRowId,
            retailEffectiveUnitPrice: { amount: row.retailUnitPriceAmount, currency: 'IRT' as const },
            ...(row.retailLineTotalAmount !== undefined ? { retailLineTotal: {
              amount: row.retailLineTotalAmount, currency: 'IRT' as const } } : {}),
            ...(row.wholesaleUnitPriceAmount !== undefined ? { wholesaleUnitPrice: {
              amount: row.wholesaleUnitPriceAmount, currency: 'IRT' as const } } : {}),
            ...(row.wholesaleLineTotalAmount !== undefined ? { wholesaleLineTotal: {
              amount: row.wholesaleLineTotalAmount, currency: 'IRT' as const } } : {}) })),
          ...(resolved.value.serviceRows?.length ? { serviceRows: resolved.value.serviceRows.map(row => ({
            serviceRowId: row.serviceRowId, retailUnitPrice: row.retailUnitPrice,
            wholesaleUnitPrice: { amount: row.wholesaleUnitPriceAmount, currency: 'IRT' },
            retailLineTotal: { amount: new Prisma.Decimal(row.quantity).mul(row.retailUnitPrice.amount).toFixed(), currency: 'IRT' },
            wholesaleLineTotal: { amount: new Prisma.Decimal(row.quantity).mul(row.wholesaleUnitPriceAmount).toFixed(), currency: 'IRT' },
          })) } : {}) }) };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.post('/commands', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const command = partnerContracts.PartnerCommandSchema.safeParse(request.body);
    if (!command.success || !['CASE_SUBMIT', 'CASE_DRAFT_REVISE'].includes(command.data.type) ||
        (command.success && command.data.type === 'CASE_SUBMIT' && !command.data.intent.pricingRequest &&
          !(command.data.intent.rows.length === 0 && command.data.intent.serviceRows?.length))) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    const draftCommand = command.data as Extract<partnerContracts.PartnerCommand,
      { type: 'CASE_SUBMIT' | 'CASE_DRAFT_REVISE' }>;
    const correlationId = correlation(request);
    try {
      if (draftCommand.type === 'CASE_DRAFT_REVISE' && !draftCommand.intent.pricingRequest) {
        const dependencies = createPrismaPartnerCaseDependencies({ database: prisma, actorId: request.user.id,
          correlationId });
        const service = createPrismaPartnerCaseService({ database: prisma, ...dependencies });
        const revised = await service.execute(draftCommand);
        if (revised.ok && revised.value.case?.pricingState === 'READY_TO_FINALIZE') {
          try { await completePartnerPricingResultDutiesForCase(prisma, { caseId: revised.value.case.owner.caseId,
            actorUserId: request.user.id }); }
          catch { /* The duty is a retryable projection; the accepted Case remains authoritative. */ }
        }
        respond(response, revised); return;
      }
      let inquiryEventIds: readonly string[] = [];
      const result = await prisma.$transaction(async tx => {
        await lockPartnerOperationsControl(tx);
        const dependencies = createPrismaPartnerCaseDependencies({ database: prisma, actorId: request.user!.id,
          correlationId });
        const caseService = createPartnerCaseService({ ...dependencies, transaction: work => work(tx) });
        const savedCase = await caseService.execute(draftCommand);
        if (!savedCase.ok || !savedCase.value.case) {
          throw Object.assign(new Error('Atomic Partner Case creation rejected'), { result: savedCase });
        }
        if (!draftCommand.intent.pricingRequest) return savedCase;
        const pricing = draftCommand.intent.pricingRequest!;
        const pricingIntent = { schemaVersion: 1 as const, type: 'CASE_PRICING_SUBMIT' as const,
          caseId: savedCase.value.case.owner.caseId, expected: savedCase.value.case.owner,
          inquiryId: pricing.inquiryId, rows: pricing.rows };
        const payloadHash = await canonicalHash(pricingIntent);
        const pricingCommand = partnerContracts.PartnerCommandSchema.parse({ ...pricingIntent,
          commandId: payloadHash, correlationId, idempotency: { actorId: request.user!.id,
            operation: 'CASE_PRICING_SUBMIT', targetId: savedCase.value.case.owner.caseId,
            key: payloadHash, payloadHash } });
        const authorize: PartnerInquiryDependencies['authorize'] = async (innerTx, input) => {
          const policy = createAuditedPartnerAuthorization(innerTx, { actorId: request.user!.id,
            purpose: input.purpose, channel: 'API' }, { correlationId,
              ...(input.reason ? { reason: input.reason } : {}) });
          const decision = await policy.authorize(input.action, input.root);
          if (!decision.ok) return decision;
          const evidence = await readAuthorizationDecisionByCorrelation(innerTx, { domain: 'PARTNER',
            actorId: request.user!.id, action: input.action, rootKind: input.root.kind,
            rootId: input.root.id, purpose: input.purpose, channel: 'API', correlationId, allowed: true });
          return evidence ? { ok: true as const, value: { evidenceId: evidence.id,
            managementOverride: decision.value.isAdmin || decision.value.scope === 'COMPANY' } }
            : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        };
        const inquiryService = createPartnerInquiryService({ actorId: request.user!.id,
          replacePendingCaseInquiries: draftCommand.type === 'CASE_DRAFT_REVISE',
          transaction: work => work(tx), authorize, resolveInitialResponder: resolveProfileResponder,
          resolveResponder: resolveEligibleResponder, resolveConfiguration: resolveSavedTechnicalConfiguration,
          ensureMissingResponderSupport });
        const submittedPricing = await inquiryService.execute(pricingCommand);
        if (!submittedPricing.ok) {
          throw Object.assign(new Error('Atomic Partner pricing duty creation rejected'), { result: submittedPricing });
        }
        inquiryEventIds = submittedPricing.value.eventIds;
        return savedCase;
      }, { timeout: 30_000 });
      if (inquiryEventIds.length) {
        try { await dispatchPartnerInquiryEvents(prisma, inquiryEventIds, inquiryNotificationAccess); }
        catch { /* durable source events remain retryable */ }
      }
      respond(response, result);
    } catch (error) {
      console.error('Partner Case command failed:', { correlationId, error });
      const result = error && typeof error === 'object' && 'result' in error
        ? (error as { result: Result<unknown> }).result : undefined;
      respond(response, result ?? { ok: false, error: partnerError('INTEGRITY_CONFLICT') });
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
          orderBy: { createdAt: 'desc' }, select: { id: true, state: true, commercialFlowVersion: true, pricingState: true,
            customerConfirmationState: true, headRevision: true, integrityHash: true,
            customerContractId: true, trackingCode: { select: { number: true } },
            head: { select: { internalProjection: true, customerProjection: true } },
            events: { orderBy: { sequence: 'desc' }, take: body.caseId ? undefined : 0,
              select: { sequence: true, type: true, recordedAt: true } },
            outputs: { orderBy: { recordedAt: 'desc' }, take: 1, select: { id: true } } } });
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
          const edit = await authorized('CASE_DRAFT_WRITE', casePurpose, 'API');
          const commit = await authorized('CASE_COMMIT', casePurpose, 'API');
          const correction = await authorized('CORRECTION_REQUEST', casePurpose, 'API');
          const cancel = await authorized('CASE_CANCEL', casePurpose, 'API');
          const voidRequest = await authorized('VOID_REQUEST', casePurpose, 'API');
          const commercial = row.commercialFlowVersion === 1 ? await readPartnerCommercialState(tx, row.id) : undefined;
          const correctionRequired = commercial?.status === 'FINAL' || !!commercial?.firstFinancialRecordAt;
          const correctionDuty = correctionRequired && row.customerContractId ? await tx.crossWorkspaceDuty.findFirst({ where: { sourceType: 'SALES_CONTRACT_CORRECTION', sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION', status: 'OPEN', dueAt: { gt: new Date() }, currentAssigneeUserId: request.user!.id, sourceId: { in: (await tx.accountingCorrectionRequest.findMany({ where: { contractId: row.customerContractId, status: 'APPROVED_FOR_SALES_EDIT' }, select: { id: true } })).map(item => item.id) } } }) : null;
          const commercialWritable = !!commercial && commercial.status !== 'EXPIRED' && commercial.status !== 'CANCELLED' && (!correctionRequired || !!correctionDuty);
          const editSession = edit && (partnerContracts.isPartnerCaseEditableState(row.state) || commercialWritable)
            ? await tx.salesContractEditSession.findFirst({ where: {
              ownerUserId: request.user!.id, purpose: 'PARTNER_TECHNICAL',
              OR: [
                ...(row.customerContractId ? [{ contractId: row.customerContractId }] : []),
                { recovery: { path: ['partnerCaseId'], equals: row.id } },
              ],
            },
              select: { draftId: true, baseRevision: true, recovery: true } }) : null;
          const editableRecovery = editSession && decodeTechnicalRecovery(editSession.recovery) ? editSession : null;
          const customerOutput = output
            ? partnerContracts.CustomerContractOutputSchema.safeParse(row.head.customerProjection) : null;
          const accountingCorrectionRequests = row.customerContractId ?
            await tx.accountingContractFlag.findMany({ where: { contractId: row.customerContractId,
              status: 'OPEN', trackingCode: { startsWith: 'partner-internal-correction:' } },
              select: { id: true, note: true, createdAt: true }, orderBy: { createdAt: 'desc' } }) : [];
          const pricingResponseState = (row.state === 'DRAFT' || !!commercial) && actorProfile && editableRecovery
            ? await readCasePricingResponse(tx, { caseId: row.id, headRevision: row.headRevision,
              profileId: actorProfile.id, actorId: request.user!.id, recovery: editableRecovery.recovery }) : undefined;
          cases.push({ ...(commercial ? { commercial: await readPartnerCommercialState(tx, row.id, pricingResponseState) } : {}), ...(pricingResponseState ? { pricingResponseState } : {}), view: { ...view.data, ...(row.commercialFlowVersion === 1 ? { commercialFlowVersion: 1 as const } : {}), ...(row.trackingCode ? { trackingNumber: row.trackingCode.number } : {}), state: row.state,
            pricingState: row.pricingState, customerConfirmationState: row.customerConfirmationState },
            accountingCorrectionRequests: accountingCorrectionRequests.map(item => ({ id: item.id,
              reason: item.note || 'سند داخلی این پرونده نیازمند اصلاح است.',
              createdAt: item.createdAt.toISOString() })),
            ...(customerOutput?.success ? { customerOutput: customerOutput.data } : {}),
            history: row.events.map(event => ({ sequence: event.sequence, type: event.type,
              recordedAt: event.recordedAt.toISOString() })),
            snapshotId: row.outputs[0]?.id || null,
            ...(row.customerContractId ? { customerContractId: row.customerContractId } : {}),
            ...(editableRecovery ? { editRecovery: { recoveryId: editableRecovery.draftId,
              baseRevision: editableRecovery.baseRevision } } : {}),
            actions: { canContinue: Boolean(editableRecovery) && (!commercial || commercialWritable && commercial.status !== 'FINAL'),
              canRenew: !!commercial && commercial.status === 'EXPIRED' && !commercial.firstFinancialRecordAt && await canManageCommercialSettings(tx, request.user!),
              canApproveSales: commit && commercialWritable && view.data.preparationCompleted !== false && !commercial?.salesApproved,
              canRejectDraft: edit && commercialWritable && commercial?.status !== 'FINAL' && !commercial?.firstFinancialRecordAt && !!commercial?.salesApproved,
              ...casePdfAvailability({ authorized: output, state: row.state, commercialFlow: !!commercial && commercial.status !== 'EXPIRED' && commercial.status !== 'CANCELLED', hasContent: Boolean(customerOutput?.success), hasSnapshot: Boolean(row.outputs[0]) }),
              canFinalize: !commercial && commit && view.data.preparationCompleted !== false && row.pricingState === 'READY_TO_FINALIZE' &&
                row.customerConfirmationState !== 'REJECTED' &&
                partnerContracts.isPartnerCaseEditableState(row.state),
              canSendConfirmation: output && view.data.preparationCompleted !== false && (commercial ? !!row.customerContractId && commercial.status !== 'CANCELLED' && commercial.status !== 'EXPIRED' && !commercial.customerAccepted
                : row.state === 'COMMITTED' && row.customerConfirmationState !== 'REJECTED'),
              canRequestCorrection: correction && row.state === 'COMMITTED' && (!commercial || commercial.status === 'FINAL'),
              canCancel: cancel && partnerContracts.isPartnerCaseEditableState(row.state),
              canRequestVoid: voidRequest && row.state === 'COMMITTED' } });
        }
        const output = partnerContracts.PartnerCaseRuntimeResultSchema.safeParse({ cases });
        return output.success ? { ok: true as const, value: output.data }
          : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
      });
      respond(response, result);
    } catch { respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); }
  });
  router.post('/:caseId/commercial', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const parsed = z.object({ action: z.enum(['APPROVE_SALES', 'REJECT_DRAFT', 'REJECT_PRICE', 'RENEW']), revision: z.number().int().positive(),
      reason: z.string().trim().min(1).max(2000).optional() }).strict().safeParse(request.body);
    if (!parsed.success || (parsed.data.action !== 'APPROVE_SALES' && !parsed.data.reason)) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    try {
      await prisma.$transaction(async tx => {
        await lockPartnerOperationsControl(tx);
        const allowed = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id, purpose: 'PARTNER', channel: 'API' },
          { correlationId: correlation(request), reason: parsed.data.reason }).authorize(
            parsed.data.action === 'APPROVE_SALES' ? 'CASE_COMMIT' : 'CASE_DRAFT_WRITE', { kind: 'CASE', id: request.params.caseId });
        if (!allowed.ok) throw Object.assign(new Error(allowed.error.message), { result: allowed });
        const { root, contract } = await lockPartnerCommercialContract(tx, request.params.caseId);
        if (contract.commercialRevision !== parsed.data.revision) throw new Error('قرارداد تغییر کرده است؛ صفحه را تازه‌سازی کنید.');
        if (parsed.data.action === 'RENEW') {
          if (contract.isInactive || contract.firstFinancialRecordAt || !(contract.status === 'EXPIRED' || contract.commercialExpiresAt && contract.commercialExpiresAt <= new Date()) || !await canManageCommercialSettings(tx, request.user!)) throw new Error('تمدید در این وضعیت مجاز نیست.');
          await resetPartnerCommercialApprovals(tx, root.id, request.user!.id, parsed.data.reason);
          await tx.salesContract.update({ where: { id: contract.id }, data: { commercialExpiresAt: new Date(Date.now() + (contract.commercialExpiryDays || 10) * 86400000) } });
          return;
        }
        assertPartnerCommercialAvailable(contract);
        if (parsed.data.action === 'REJECT_PRICE') {
          if (contract.status === 'SIGNED' || root.pricingState === 'READY_TO_FINALIZE') throw new Error('قیمت‌های پذیرفته‌شده را از مسیر اصلاح تغییر دهید.');
          await tx.partnerSaleCase.update({ where: { id: root.id }, data: { stateRevision: { increment: 1 } } });
          await appendPartnerCommercialEvent(tx, root.id, request.user!.id, 'PARTNER_PRICING_REJECTED', { commercialRevision: contract.commercialRevision }, parsed.data.reason);
        } else if (parsed.data.action === 'APPROVE_SALES') await approvePartnerCommercialSales(tx, {
          caseId: request.params.caseId, actorId: request.user!.id, revision: parsed.data.revision });
        else {
          if (contract.status === 'SIGNED' || contract.firstFinancialRecordAt) throw new Error('بازگشت این قرارداد نیازمند اصلاح مجاز حسابداری است.');
          await resetPartnerCommercialApprovals(tx, request.params.caseId, request.user!.id, parsed.data.reason);
        }
      });
      response.setHeader('Cache-Control', 'private, no-store'); response.json({ success: true });
    } catch (error) { response.status(409).json({ success: false, error: error instanceof Error ? error.message : 'تغییر وضعیت انجام نشد.' }); }
  });
  router.post('/:caseId/confirmation', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    if (request.body && (typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length)) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    const row = await prisma.partnerSaleCase.findUnique({ where: { id: request.params.caseId },
      select: { customerContractId: true } });
    if (!row?.customerContractId) { respond(response, { ok: false, error: partnerError('STATE_CONFLICT') }); return; }
    const result = await contractConfirmationService.sendForConfirmation({ contractId: row.customerContractId,
      requestedBy: request.user.id, resend: true, meta: { ipAddress: request.ip,
        userAgent: request.get('user-agent') } });
    if (!result.success) { response.status(409).json(result); return; }
    response.setHeader('Cache-Control', 'private, no-store'); response.json(result);
  });
  router.post('/:caseId/finalize', async (request: AuthRequest, response) => {
    if (!request.user) { respond(response, { ok: false, error: partnerError('FORBIDDEN') }); return; }
    const parsed = partnerContracts.PartnerCaseFinalizeRequestSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.expected.caseId !== request.params.caseId) {
      respond(response, { ok: false, error: partnerError('INVALID_PAYLOAD') }); return;
    }
    const correlationId = correlation(request);
    try {
      // Keep the authorization audit even when the commercial transaction is
      // denied or later fails. Sensitive decisions must not disappear with a
      // rolled-back linked-pair allocation.
      const authorizationAudit = await prisma.$transaction(async tx => {
        const decision = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'PARTNER', channel: 'API' }, { correlationId })
          .authorize('CASE_COMMIT', { kind: 'CASE', id: request.params.caseId });
        const record = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER',
          actorId: request.user!.id, action: 'CASE_COMMIT', rootKind: 'CASE', rootId: request.params.caseId,
          purpose: 'PARTNER', channel: 'API', correlationId, allowed: decision.ok });
        return { decision, evidenceId: record?.id };
      });
      if (!authorizationAudit.decision.ok) { respond(response, authorizationAudit.decision); return; }
      if (!authorizationAudit.evidenceId) {
        respond(response, { ok: false, error: partnerError('INTEGRITY_CONFLICT') }); return;
      }
      const result = await prisma.$transaction(async tx => {
        await lockPartnerOperationsControl(tx);
        const flow = await tx.partnerSaleCase.findUnique({ where: { id: request.params.caseId }, select: { commercialFlowVersion: true } });
        if (flow?.commercialFlowVersion === 1) throw new Error('برای این قرارداد از تأیید فروش نسخه جاری استفاده کنید.');
        const allocation = await allocatePartnerLinkedPair(tx, { caseId: request.params.caseId,
          actorId: request.user!.id, expected: parsed.data.expected });
        if (!allocation.ok) throw Object.assign(new Error('Partner linked pair allocation rejected'), { result: allocation });
        const evidenceId = `finalization-evidence:${parsed.data.operationId}`;
        const evidence = { version: 1, purpose: 'PARTNER_EXPLICIT_FINALIZATION', actorId: request.user!.id,
          owner: parsed.data.expected, expectedState: parsed.data.expectedState,
          lossAccepted: parsed.data.lossAccepted, operationId: parsed.data.operationId };
        const evidenceHash = await canonicalHash(evidence);
        const priorEvidence = await tx.partnerCommandOutcome.findUnique({ where: {
          actorId_operation_targetScope_key: { actorId: request.user!.id,
            operation: 'PARTNER_FINALIZATION_CONFIRMATION', targetScope: request.params.caseId,
            key: parsed.data.operationId } } });
        const recordedEvidence = priorEvidence?.outcome && typeof priorEvidence.outcome === 'object' &&
          !Array.isArray(priorEvidence.outcome) ? priorEvidence.outcome as Prisma.JsonObject : undefined;
        if (priorEvidence && (priorEvidence.payloadHash !== evidenceHash ||
            typeof recordedEvidence?.recordedAt !== 'string')) {
          throw Object.assign(new Error('Partner finalization evidence conflicts'),
            { result: { ok: false as const, error: partnerError('IDEMPOTENCY_CONFLICT') } });
        }
        const recordedAt = typeof recordedEvidence?.recordedAt === 'string'
          ? recordedEvidence.recordedAt : new Date().toISOString();
        if (!priorEvidence) await tx.partnerCommandOutcome.create({ data: { id: evidenceId,
          actorId: request.user!.id, operation: 'PARTNER_FINALIZATION_CONFIRMATION',
          targetScope: request.params.caseId, key: parsed.data.operationId, payloadHash: evidenceHash,
          outcome: json({ ...evidence, recordedAt }) } });
        const authorize = async (_tx: Prisma.TransactionClient, authorization: { actorId: string;
          action: 'CASE_COMMIT' | 'CASE_CANCEL' | 'CUSTOMER_OUTPUT'; purpose: 'PARTNER' | 'MANAGEMENT' | 'CUSTOMER_OUTPUT';
          root: { kind: 'CASE'; id: string } }) => {
          if (authorization.action === 'CASE_COMMIT' && authorization.purpose === 'PARTNER' &&
              authorization.root.id === request.params.caseId) {
            return { ok: true as const, value: { evidenceId: authorizationAudit.evidenceId! } };
          }
          return { ok: false as const, error: partnerError('FORBIDDEN') };
        };
        const service = createPartnerCaseLifecycleService({ actorId: request.user!.id, cancellationPurpose: 'PARTNER',
          transaction: work => work(tx), authorize,
          verifyOutputEvidence: async (_tx, input) => {
            const recorded = await tx.partnerCommandOutcome.findUnique({ where: { id: input.authenticatedOutputEvidenceId } });
            if (!recorded || recorded.id !== evidenceId || recorded.operation !== 'PARTNER_FINALIZATION_CONFIRMATION' ||
                recorded.targetScope !== request.params.caseId || recorded.payloadHash !== evidenceHash) {
              return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
            }
            return { ok: true as const, value: { evidenceId, occurredAt: recordedAt,
              outputHash: evidenceHash } };
          },
          cancelConfirmationSessions: async () => ({ ok: true, value: { invalidatedSessionIds: [], preservedSnapshotIds: [] } }),
          recordEvidenceReview: async () => undefined,
        });
        const intent = { trigger: 'FINALIZED' as const, authenticatedOutputEvidenceId: evidenceId,
          lossAccepted: parsed.data.lossAccepted };
        const commandId = parsed.data.operationId;
        const finalized = await service.execute({ schemaVersion: 1, type: 'CASE_COMMIT', commandId, correlationId,
          expected: parsed.data.expected, expectedState: parsed.data.expectedState, ...intent,
          idempotency: { actorId: request.user!.id, operation: 'CASE_COMMIT', targetId: request.params.caseId,
            key: parsed.data.operationId, payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_COMMIT', ...intent }) } });
        if (!finalized.ok) throw Object.assign(new Error('Partner finalization rejected'), { result: finalized });
        const queued = await enqueueCommittedPartnerCase(tx, { caseId: request.params.caseId, actorId: request.user!.id });
        if (!queued.ok) throw Object.assign(new Error('Partner accounting handoff rejected'), { result: queued });
        const linked = await tx.partnerSaleCase.findUnique({ where: { id: request.params.caseId },
          select: { customerContractId: true } });
        if (!linked?.customerContractId) throw new Error('Committed Partner contract link missing');
        return { ...finalized, value: { ...finalized.value, customerContractId: linked.customerContractId } };
      });
      respond(response, result);
    } catch (error) {
      const result = error && typeof error === 'object' && 'result' in error
        ? (error as { result: Result<unknown> }).result : undefined;
      respond(response, result ?? { ok: false, error: partnerError('INTEGRITY_CONFLICT') });
    }
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
        await lockPartnerOperationsControl(tx);
        const caseId = request.params.caseId;
        await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
        const row = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
          id: true, state: true, commercialFlowVersion: true, pricingState: true, headRevision: true, integrityHash: true,
          customerContractId: true, profile: { select: { userId: true } },
        } });
        if (!row) return { ok: false as const, error: partnerError('NOT_FOUND') };
        const allowed = await createAuditedPartnerAuthorization(tx, { actorId: request.user!.id,
          purpose: 'CUSTOMER_OUTPUT', channel: 'PDF' }, { correlationId }).authorize('CUSTOMER_OUTPUT', { kind: 'CASE', id: row.id });
        if (!allowed.ok) return allowed;
        let snapshot;
        if (snapshotIdValue) {
          const record = await tx.partnerCustomerOutputSnapshot.findUnique({ where: { id: snapshotIdValue } });
          if (!record || record.caseId !== row.id) return { ok: false as const, error: partnerError('NOT_FOUND') };
          snapshot = await createCustomerOutputSnapshots(partnerContracts).read(record.content);
        } else {
          if (mode === 'DOWNLOAD_EXISTING' || !parsed.data.expected) return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
          snapshot = await resolveCasePdfSnapshot(tx, row.id, parsed.data.expected, mode);
        }
        if (snapshot.owner.caseId !== row.id) return { ok: false as const, error: partnerError('NOT_FOUND') };
        if (parsed.data.expected && partnerContracts.checkExpectedRevision(parsed.data.expected, snapshot.owner)) {
          return { ok: false as const, error: partnerError('ROW_STALE') };
        }
        if (mode === 'FINAL' && (row.state !== 'COMMITTED' ||
            snapshot.owner.revision !== row.headRevision || snapshot.owner.integrityHash !== row.integrityHash ||
            !['SIGNED', 'PRINTED'].includes(snapshot.content.status))) {
          return { ok: false as const, error: partnerError('STATE_CONFLICT') };
        }
        const existing = mode === 'PREVIEW' ? null : await tx.partnerCustomerArtifact.findUnique({
          where: { snapshotId_mode: { snapshotId: snapshot.snapshotId, mode: 'FINAL' } } });
        return { ok: true as const, value: { snapshot, row, existing } };
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
          const artifact = await tx.partnerCustomerArtifact.upsert({ where: { snapshotId_mode: { snapshotId: prepared.value.snapshot.snapshotId, mode: 'FINAL' } }, update: {}, create: { id: artifactId,
            snapshotId: prepared.value.snapshot.snapshotId, caseId: prepared.value.row.id,
            caseRevision: prepared.value.snapshot.owner.revision, mode: 'FINAL',
            outputHash: prepared.value.snapshot.content.outputHash, byteHash, content: bytes,
            actorId: request.user!.id, publishedAt: new Date() } });
          if (prepared.value.row.commercialFlowVersion === 1) return { content: artifact.content };
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
                  current.outputHash !== prepared.value.snapshot.content.outputHash || current.byteHash !== artifact.byteHash ||
                  `sha256-v1:${createHash('sha256').update(current.content).digest('hex')}` !== artifact.byteHash) {
                return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
              }
              return { ok: true, value: { evidenceId: current.id, occurredAt: new Date().toISOString(), outputHash: current.outputHash } };
            },
            cancelConfirmationSessions: async () => ({ ok: true, value: { invalidatedSessionIds: [],
              preservedSnapshotIds: [prepared.value.snapshot.snapshotId] } }),
            recordEvidenceReview: async () => undefined,
          });
          const intent = { trigger: 'PRINTED' as const, authenticatedOutputEvidenceId: artifact.id, lossAccepted: false };
          const commandId = randomUUID();
          const result = await service.execute({ schemaVersion: 1, type: 'CASE_COMMIT', commandId, correlationId,
            expected: prepared.value.snapshot.owner, expectedState: 'COMMITTED',
            ...intent, idempotency: { actorId: request.user!.id, operation: 'CASE_COMMIT',
              targetId: prepared.value.row.id, key: artifact.id,
              payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_COMMIT', ...intent }) } });
          if (!result.ok) throw Object.assign(new Error('Partner print commitment failed'), { result });
          return { ...result, content: artifact.content };
        });
        bytes = committed.content;
      }
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Content-Type', 'application/pdf');
      response.setHeader('Content-Disposition', `inline; filename="partner-contract-${request.params.caseId}.pdf"`);
      response.send(bytes);
    } catch (error) {
      const result = error && typeof error === 'object' && 'result' in error ? (error as { result: Result<unknown> }).result : undefined;
      respond(response, result ?? { ok: false, error: partnerError(error instanceof CustomerOutputError ? error.code : 'INTEGRITY_CONFLICT') });
    }
  });
  return router;
}

export default createPartnerCaseRouter();
