import { appendPartnerCommercialEvent } from './commercialEvents';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import * as partnerContracts from '@sabalanerp/partner-sales-contracts';
import { partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { projectionEvidence } from './lifecycle';
import { buildCaseProjections } from './projections';
import { generateContractNumberAssignment } from '../../contractNumberService';
import { consumePrismaPartnerTechnicalRecovery } from './prismaComposition';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
/** @internal Exported for transactional integration coverage. */
export async function allocatePartnerLinkedPair(tx: Prisma.TransactionClient, input: {
  caseId: string; actorId: string; expected: partnerContracts.RevisionRef;
  consumeRecovery?: typeof consumePrismaPartnerTechnicalRecovery;
}): Promise<Result<void>> {
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${input.caseId} FOR UPDATE`;
  const row = await tx.partnerSaleCase.findUnique({ where: { id: input.caseId }, select: {
    id: true, caseNumber: true, customerId: true, profileId: true, headRevision: true, integrityHash: true,
    pricingState: true, commercialFlowVersion: true, internalRecordId: true, customerContractId: true,
    profile: { select: { commercialAccount: { select: { id: true } },
      user: { select: { departmentId: true } } } },
    head: { select: { graphHash: true, graph: true, partySnapshots: true, wholesaleEnvelope: true,
      retailEnvelope: true, paymentEvidence: true, customerContent: true, internalProjection: true } },
    events: { where: { type: { in: ['CASE_CREATED', 'CASE_DRAFT_REVISED'] } }, orderBy: { sequence: 'desc' }, take: 1,
      select: { evidence: true } },
  } });
  if (!row) return { ok: false, error: partnerError('NOT_FOUND') };
  if (row.headRevision !== input.expected.revision || row.integrityHash !== input.expected.integrityHash) {
    return { ok: false, error: partnerError('ROW_STALE') };
  }
  if (row.internalRecordId || row.customerContractId) {
    return row.internalRecordId && row.customerContractId
      ? { ok: true, value: undefined }
      : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  if ((row.commercialFlowVersion !== 1 && row.pricingState !== 'READY_TO_FINALIZE') ||
      (row.head.retailEnvelope as Prisma.JsonObject)?.preparationCompleted === false || !row.profile.commercialAccount) {
    return { ok: false, error: partnerError('STATE_CONFLICT') };
  }
  const evidence = projectionEvidence(row.head);
  if (!evidence) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  const customerContent = row.head.customerContent && typeof row.head.customerContent === 'object' &&
    !Array.isArray(row.head.customerContent) ? row.head.customerContent as Prisma.JsonObject : undefined;
  if (!customerContent) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  const originalProjectId = typeof customerContent.projectId === 'string' ? customerContent.projectId : undefined;
  let legacyProjectId: string | undefined;
  let canonicalProjectId = originalProjectId;
  let tracedProjectId: string | undefined;
  if (originalProjectId) {
    await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${row.profileId}, true)`;
    const customerProject = await tx.projectAddress.findFirst({ where: {
      id: originalProjectId, customerId: row.customerId, isActive: true,
    }, select: { id: true } });
    if (!customerProject) {
      const legacyProject = await tx.crmPotentialProject.findFirst({ where: {
        id: originalProjectId, customerId: row.customerId, partnerRevision: { not: null },
      }, select: { id: true, title: true, address: true } });
      if (!legacyProject) return { ok: false, error: partnerError('NOT_FOUND') };
      if (!legacyProject.address?.trim()) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const tracedProject = await tx.projectAddress.create({ data: {
        id: randomUUID(), customerId: row.customerId, projectName: legacyProject.title,
        address: legacyProject.address.trim(),
      } });
      legacyProjectId = legacyProject.id;
      canonicalProjectId = tracedProject.id;
      tracedProjectId = tracedProject.id;
    }
  }
  const effectiveCustomerContent = canonicalProjectId && canonicalProjectId !== originalProjectId
    ? { ...customerContent, projectId: canonicalProjectId }
    : customerContent;
  const effectiveEvidence = canonicalProjectId && canonicalProjectId !== originalProjectId
    ? { ...evidence, customerContent: { ...evidence.customerContent, projectId: canonicalProjectId } }
    : evidence;
  const internalRecordId = randomUUID(), customerContractId = randomUUID();
  // Partner customer contracts share the public Sales numbering lane so every
  // workspace can search and identify them in exactly the same way. The
  // internal Sabalan obligation keeps its own explicit identity.
  const assignment = await generateContractNumberAssignment(input.actorId, tx);
  const customerContractNumber = assignment.contractNumber;
  const internalRecordNumber = `PI-${customerContractNumber}`;
  const projections = await buildCaseProjections({ caseId: row.id, revision: row.headRevision,
    integrityHash: row.integrityHash, caseNumber: row.caseNumber, internalRecordId, internalRecordNumber,
    customerContractNumber, commercialAccountId: row.profile.commercialAccount.id,
    state: 'DRAFT', evidence: effectiveEvidence });
  if (!projections.ok || !projections.value.customer || (row.commercialFlowVersion !== 1 &&
      (!projections.value.accounting || !projections.value.fulfillment))) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  const retailEnvelope = row.head.retailEnvelope && typeof row.head.retailEnvelope === 'object' &&
    !Array.isArray(row.head.retailEnvelope) ? row.head.retailEnvelope as Prisma.JsonObject : undefined;
  const totals = retailEnvelope?.totals && typeof retailEnvelope.totals === 'object' &&
    !Array.isArray(retailEnvelope.totals) ? retailEnvelope.totals as Prisma.JsonObject : undefined;
  if (!row.profile.user.departmentId || typeof customerContent.legalText !== 'string' || typeof totals?.payable !== 'string' ||
      typeof totals.currency !== 'string') return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  await tx.sabalanToPartnerSaleRecord.create({ data: { id: internalRecordId,
    recordNumber: internalRecordNumber, caseId: row.id, commercialAccountId: row.profile.commercialAccount.id,
    expectedRevision: row.headRevision, integrityHash: row.integrityHash, pricingState: row.pricingState } });
  await tx.salesContract.create({ data: { id: customerContractId, contractNumber: customerContractNumber,
    title: 'Partner customer sale', titlePersian: 'قرارداد فروش مشتری همکار', content: customerContent.legalText,
    customerId: row.customerId, departmentId: row.profile.user.departmentId,
    createdBy: input.actorId, responsibleSellerId: input.actorId,
    creatorSequenceNumber: assignment.creatorSequenceNumber,
    ...(row.commercialFlowVersion === 1 ? { commercialFlowVersion: 2, commercialRevision: 1 } : {}),
    partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: row.id, partnerRevision: row.headRevision,
    partnerIntegrityHash: row.integrityHash, totalAmount: totals.payable, currency: totals.currency,
    contractData: json(projections.value.customer) } });
  const linked = await tx.partnerSaleCase.updateMany({ where: { id: row.id, internalRecordId: null,
    customerContractId: null, headRevision: row.headRevision, integrityHash: row.integrityHash },
    data: { internalRecordId, customerContractId, stateRevision: { increment: 1 } } });
  if (linked.count !== 1) return { ok: false, error: partnerError('ROW_STALE') };
  await appendPartnerCommercialEvent(tx, row.id, input.actorId, 'PARTNER_LINKED_PAIR_ALLOCATED', { internalRecordId, customerContractId });
  await tx.partnerCaseRevision.update({ where: { caseId_revision: { caseId: row.id, revision: row.headRevision } },
    data: { internalProjection: json({ partner: projections.value.partner,
      ...(projections.value.accounting ? { accounting: projections.value.accounting } : {}),
      ...(projections.value.fulfillment ? { fulfillment: projections.value.fulfillment } : {}) }),
      customerProjection: json(projections.value.customer) } });
  if (legacyProjectId && tracedProjectId) {
      await tx.crmTimelineEvent.create({ data: { customerId: row.customerId,
        potentialProjectId: legacyProjectId, actorId: input.actorId,
        eventType: 'partner_contract_project_traced', title: 'ایجاد پروژه مشتری از پیش‌نویس قدیمی',
        description: `پروژه مشتری ${tracedProjectId} هنگام نهایی‌سازی قرارداد ${customerContractNumber} ایجاد شد.`,
      } });
      const project = await tx.crmPotentialProject.updateMany({ where: { id: legacyProjectId,
        customerId: row.customerId, wonSalesContractId: null, partnerRevision: { not: null } },
      data: { wonSalesContractId: customerContractId, partnerRevision: { increment: 1 } } });
      if (project.count !== 1) return { ok: false, error: partnerError('ROW_STALE') };
  }
  const latestEvidence = row.events[0]?.evidence;
  const technical = latestEvidence && typeof latestEvidence === 'object' && !Array.isArray(latestEvidence)
    ? latestEvidence as Prisma.JsonObject : undefined;
  if (typeof technical?.recoveryId !== 'string' || typeof technical.recoveryRevision !== 'number' ||
      technical.graphHash !== row.head.graphHash) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  return (input.consumeRecovery ?? consumePrismaPartnerTechnicalRecovery)(tx, { actorId: input.actorId,
    recoveryId: technical.recoveryId, recoveryRevision: technical.recoveryRevision,
    caseId: row.id, customerContractId });
}
