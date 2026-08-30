import type { Prisma } from '@prisma/client';
import { partnerError, type PartnerAction, type PartnerActionV2, type PartnerAuthorizationV2Port,
  type PermissionContext, type Result } from '@sabalanerp/partner-sales-contracts';
import { createPartnerAuthorization, createPartnerAuthorizationV2 } from './service';
import type { AuthorizationBinding, AuthorizationEvidence, AuthorizationRoot, AuthorizationSource } from './contracts';

/** #296 composition contract. Resolve explicit action/scope grants using the
 * CENTRAL resolver; lock its grant rows/absence guards until this transaction
 * finishes. No route may implement a role/workspace fallback here. */
export type ResolvePartnerAuthority<Action extends PartnerActionV2 = PartnerAction> = (tx: Prisma.TransactionClient, input: {
  actorId: string; root: AuthorizationRoot;
}) => Promise<Pick<AuthorizationEvidence<Action>, 'grants' | 'authorizationRevision'>>;
export type PartnerAuthorizationTarget = { correctionOpportunityId: string } | { prospectiveProfileOwnerId: string }
  | { customerTransferId: string };
export type PartnerInquiryRecordTarget = {
  kind: 'ASSIGNMENT' | 'ROW' | 'APPROVAL' | 'EVENT' | 'NOTIFICATION_DELIVERY'; id: string;
};
export type PartnerCaseRecordTarget =
  | { kind: 'PRODUCT_ROW' | 'INTERNAL_RECORD' | 'CUSTOMER_CONTRACT' | 'INQUIRY_USAGE' | 'PAYMENT_PLAN'
      | 'PAYMENT_INSTALLMENT' | 'RETAIL_RECEIPT' | 'EVENT' | 'CUSTOMER_OUTPUT' | 'CORRECTION_OPPORTUNITY'
      | 'CORRECTION_SAVE' | 'CORRECTION_GATE' | 'CORRECTION_DEPENDENCY' | 'FINANCIAL_ADJUSTMENT'
      | 'OUTBOX_MESSAGE' | 'OUTBOX_ATTEMPT'; id: string }
  | { kind: 'COMMERCIAL_NUMBER'; number: string }
  | { kind: 'REVISION'; revision: number }
  | { kind: 'ROW_BINDING'; revision: number; productRowId: string }
  | { kind: 'DELIVERY'; id: string; revision: number }
  | { kind: 'DELIVERY_ITEM'; deliveryId: string; productRowId: string; revision: number }
  | { kind: 'RECEIPT_ALLOCATION'; receiptId: string; installmentId: string };

/** Transaction-scoped, using the caller's shared Prisma transaction. Never owns
 * a PrismaClient or commits/disconnects. Unsupported roots fail closed. */
export function prismaAuthorizationSource<Action extends PartnerActionV2>(tx: Prisma.TransactionClient,
  resolveAuthority: ResolvePartnerAuthority<Action>, target?: PartnerAuthorizationTarget): AuthorizationSource<Action> {
  return { read: async (actorId, root) => {
    let resource: AuthorizationEvidence['resource'] = null;
    let profileId = root.kind === 'PROFILE' ? root.id : null;
    if (root.kind === 'PROFILE' && target && 'prospectiveProfileOwnerId' in target) {
      for (const id of [...new Set([actorId, target.prospectiveProfileOwnerId])].sort()) {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
      }
      const prospective = await tx.user.findUnique({ where: { id: target.prospectiveProfileOwnerId },
        select: { isActive: true, departmentId: true, partnerProfile: { select: { id: true } } } });
      if (prospective?.isActive && !prospective.partnerProfile) {
        resource = { root, partnerSellerId: target.prospectiveProfileOwnerId, partnerStatus: 'PENDING',
          lifecycleRevision: 1, ...(prospective.departmentId ? { departmentId: prospective.departmentId } : {}) };
      }
      profileId = null;
    }
    if (root.kind === 'INQUIRY') {
      await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${root.id} FOR UPDATE`;
      profileId = (await tx.partnerInquiry.findUnique({ where: { id: root.id }, select: { profileId: true } }))?.profileId ?? null;
    }
    if (root.kind === 'CASE') {
      await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${root.id} FOR UPDATE`;
      profileId = (await tx.partnerSaleCase.findUnique({ where: { id: root.id }, select: { profileId: true } }))?.profileId ?? null;
    }
    if (root.kind === 'CUSTOMER') {
      await tx.$queryRaw`SELECT id FROM crm_customers WHERE id = ${root.id} FOR UPDATE`;
      const customer = await tx.crmCustomer.findUnique({ where: { id: root.id }, select: {
        ownerUserId: true, partnerRevision: true, isActive: true } });
      if (customer?.isActive && customer.ownerUserId && target && 'customerTransferId' in target) {
        await tx.$queryRaw`SELECT id FROM partner_customer_transfers WHERE id = ${target.customerTransferId} FOR UPDATE`;
        const transfer = await tx.partnerCustomerTransfer.findUnique({ where: { id: target.customerTransferId }, select: {
          customerId: true, fromOwnerUserId: true, fromProfileId: true, toProfileId: true, revision: true, status: true,
          fromProfile: { select: { state: true, revision: true } }, toProfile: { select: { userId: true } },
        } });
        if (transfer?.customerId === root.id && transfer.fromOwnerUserId === customer.ownerUserId &&
            transfer.status === 'PENDING') {
          for (const id of [...new Set([transfer.fromProfileId, transfer.toProfileId]
            .filter((item): item is string => Boolean(item)))].sort()) {
            await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${id} FOR UPDATE`;
          }
          for (const id of [...new Set([actorId, transfer.fromOwnerUserId, transfer.toProfile.userId])].sort()) {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
          }
          const owner = await tx.user.findUnique({ where: { id: transfer.fromOwnerUserId }, select: {
            isActive: true, departmentId: true } });
          if (owner) resource = { root, partnerSellerId: transfer.fromOwnerUserId,
            partnerStatus: transfer.fromProfile?.state ?? 'ACTIVE',
            lifecycleRevision: transfer.fromProfile?.revision ?? customer.partnerRevision ?? transfer.revision,
            ...(owner.departmentId ? { departmentId: owner.departmentId } : {}) };
        }
        profileId = null;
      } else if (customer?.isActive && customer.ownerUserId) {
        profileId = (await tx.partnerProfile.findUnique({ where: { userId: customer.ownerUserId }, select: { id: true } }))?.id ?? null;
      }
    }
    if (profileId) {
      await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${profileId} FOR UPDATE`;
      const profile = await tx.partnerProfile.findUnique({ where: { id: profileId }, select: { userId: true, state: true, revision: true } });
      if (profile) {
        // All callers lock root/profile before Users, never the inverse. Sorting
        // the two User ids prevents actor/owner lock inversion across profiles.
        const userIds = [...new Set([actorId, profile.userId])].sort();
        for (const id of userIds) await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
        const owner = await tx.user.findUnique({ where: { id: profile.userId }, select: { departmentId: true } });
        resource = { root, partnerSellerId: profile.userId, partnerStatus: profile.state, lifecycleRevision: profile.revision,
          ...(owner?.departmentId ? { departmentId: owner.departmentId } : {}) };
      }
    }
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: {
      id: true, isActive: true, role: true, departmentId: true, partnerProfile: { select: { state: true, revision: true } },
    } });
    if (root.kind === 'INQUIRY' && resource) {
      // The root FOR UPDATE excludes concurrent assignment commits through
      // their parent FK. Assignment evidence is append-only; never authorize
      // using its historical eligibility snapshot instead of current authority.
      const assignment = await tx.partnerInquiryAssignment.findFirst({ where: { inquiryId: root.id },
        orderBy: { revision: 'desc' }, select: { id: true, revision: true, responderId: true } });
      if (assignment) resource.assignment = { actorId: assignment.responderId, assignmentId: assignment.id,
        revision: assignment.revision, eligible: assignment.responderId === actorId && Boolean(actor?.isActive) && !actor?.partnerProfile };
    }
    if (target && 'correctionOpportunityId' in target && resource) {
      // A financial chain must be explicitly selected by the owning command.
      // Never infer the requester from the Case creator or the latest request.
      const opportunity = await tx.partnerCorrectionOpportunity.findUnique({ where: { id: target.correctionOpportunityId },
        select: { caseId: true, requesterId: true } });
      if (root.kind !== 'CASE' || opportunity?.caseId !== root.id) resource = null;
      else {
        // Its root/requester are immutable. Reject mismatches before taking an
        // unrelated aggregate's child lock; valid locks remain root-first.
        await tx.$queryRaw`SELECT id FROM partner_correction_opportunities WHERE id = ${target.correctionOpportunityId} FOR UPDATE`;
        resource.requesterId = opportunity.requesterId;
      }
    }
    const authority = actor?.isActive && resource ? await resolveAuthority(tx, { actorId, root }) : { grants: [], authorizationRevision: 1 };
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    return { ...authority, evaluatedAt: clock.now.toISOString(), resource, actor: {
      id: actorId, active: actor?.isActive ?? false, role: actor?.role ?? 'USER',
      ...(actor?.departmentId ? { departmentId: actor.departmentId } : {}),
      ...(actor?.partnerProfile ? { partnerProfile: actor.partnerProfile } : {}),
    } };
  } };
}

/** The versioned public port shares all persisted evidence and lock behavior.
 * It does not install a central grant provider or expand v1 action vocabulary. */
export function createPrismaPartnerAuthorizationV2(tx: Prisma.TransactionClient, binding: AuthorizationBinding,
  resolveAuthority: ResolvePartnerAuthority<PartnerActionV2>, target?: PartnerAuthorizationTarget): PartnerAuthorizationV2Port {
  return createPartnerAuthorizationV2(prismaAuthorizationSource(tx, resolveAuthority, target), binding);
}

export function createPrismaPartnerAuthorization(tx: Prisma.TransactionClient, binding: AuthorizationBinding,
  resolveAuthority: ResolvePartnerAuthority, target?: { correctionOpportunityId: string }) {
  const authorization = createPartnerAuthorization(prismaAuthorizationSource(tx, resolveAuthority, target), binding);
  type ChildRelationship = { rootId: string; paymentPurpose?: 'RETAIL' | 'SABALAN' };
  type ChildGuard = { resolve(): Promise<ChildRelationship | null | undefined>; lock(): Promise<unknown> };
  function inquiryRecordGuard(record: PartnerInquiryRecordTarget): ChildGuard {
    if (record.kind === 'ASSIGNMENT') return {
      resolve: async () => { const row = await tx.partnerInquiryAssignment.findUnique({ where: { id: record.id }, select: { inquiryId: true } });
        return row && { rootId: row.inquiryId }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_inquiry_assignments WHERE id = ${record.id} FOR UPDATE`,
    };
    if (record.kind === 'ROW') return {
      resolve: async () => { const row = await tx.partnerInquiryRow.findUnique({ where: { id: record.id }, select: { inquiryId: true } });
        return row && { rootId: row.inquiryId }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_inquiry_rows WHERE id = ${record.id} FOR UPDATE`,
    };
    if (record.kind === 'APPROVAL') return {
      resolve: async () => { const row = await tx.partnerInquiryApproval.findUnique({ where: { id: record.id },
        select: { row: { select: { inquiryId: true } } } }); return row && { rootId: row.row.inquiryId }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_inquiry_approvals WHERE id = ${record.id} FOR UPDATE`,
    };
    if (record.kind === 'EVENT') return {
      resolve: async () => { const row = await tx.partnerInquiryEvent.findUnique({ where: { id: record.id }, select: { inquiryId: true } });
        return row && { rootId: row.inquiryId }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_inquiry_events WHERE id = ${record.id} FOR UPDATE`,
    };
    return {
      resolve: async () => { const row = await tx.partnerInquiryNotificationDelivery.findUnique({ where: { eventId: record.id },
        select: { event: { select: { inquiryId: true } } } }); return row && { rootId: row.event.inquiryId }; },
      lock: () => tx.$queryRaw`SELECT "eventId" FROM partner_inquiry_notification_deliveries WHERE "eventId" = ${record.id} FOR UPDATE`,
    };
  }
  function caseRecordGuard(record: PartnerCaseRecordTarget, expectedCaseId: string): ChildGuard {
    const direct = (model: { findUnique(input: unknown): Promise<{ caseId: string } | null> }, id: string) =>
      async () => { const row = await model.findUnique({ where: { id }, select: { caseId: true } }); return row && { rootId: row.caseId }; };
    if (record.kind === 'PRODUCT_ROW') return { resolve: direct(tx.partnerProductRow, record.id),
      lock: () => tx.$queryRaw`SELECT id FROM partner_product_rows WHERE id = ${record.id} FOR UPDATE` };
    if (record.kind === 'INTERNAL_RECORD') return { resolve: direct(tx.sabalanToPartnerSaleRecord, record.id),
      lock: () => tx.$queryRaw`SELECT id FROM sabalan_to_partner_sale_records WHERE id = ${record.id} FOR UPDATE` };
    if (record.kind === 'CUSTOMER_CONTRACT') return {
      resolve: async () => { const row = await tx.salesContract.findUnique({ where: { id: record.id },
        select: { partnerKind: true, partnerCaseId: true } }); return row?.partnerKind === 'PARTNER_CUSTOMER' && row.partnerCaseId
          ? { rootId: row.partnerCaseId } : null; },
      lock: () => tx.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${record.id} FOR UPDATE`,
    };
    if (record.kind === 'COMMERCIAL_NUMBER') return {
      resolve: async () => { const row = await tx.partnerCommercialNumber.findUnique({ where: { number: record.number },
        select: { caseId: true } }); return row && { rootId: row.caseId }; },
      lock: () => tx.$queryRaw`SELECT number FROM partner_commercial_numbers WHERE number = ${record.number} FOR UPDATE`,
    };
    if (record.kind === 'REVISION') return {
      resolve: async () => (await tx.partnerCaseRevision.findUnique({ where: { caseId_revision: {
        caseId: expectedCaseId, revision: record.revision } }, select: { caseId: true } })) && { rootId: expectedCaseId },
      lock: () => tx.$queryRaw`SELECT revision FROM partner_case_revisions WHERE "caseId" = ${expectedCaseId}
        AND revision = ${record.revision} FOR UPDATE`,
    };
    if (record.kind === 'ROW_BINDING') return {
      resolve: async () => (await tx.partnerCaseRowBinding.findUnique({ where: { caseId_revision_productRowId: {
        caseId: expectedCaseId, revision: record.revision, productRowId: record.productRowId } }, select: { caseId: true } }))
        && { rootId: expectedCaseId },
      lock: () => tx.$queryRaw`SELECT "productRowId" FROM partner_case_row_bindings WHERE "caseId" = ${expectedCaseId}
        AND revision = ${record.revision} AND "productRowId" = ${record.productRowId} FOR UPDATE`,
    };
    if (record.kind === 'INQUIRY_USAGE') return { resolve: direct(tx.partnerInquiryUsage, record.id),
      lock: () => tx.$queryRaw`SELECT id FROM partner_inquiry_usages WHERE id = ${record.id} FOR UPDATE` };
    if (record.kind === 'DELIVERY') return {
      resolve: async () => (await tx.partnerCaseDelivery.findUnique({ where: { caseId_revision_id: {
        caseId: expectedCaseId, revision: record.revision, id: record.id } }, select: { caseId: true } }))
        && { rootId: expectedCaseId },
      lock: () => tx.$queryRaw`SELECT id FROM partner_case_deliveries WHERE "caseId" = ${expectedCaseId}
        AND revision = ${record.revision} AND id = ${record.id} FOR UPDATE`,
    };
    if (record.kind === 'DELIVERY_ITEM') return {
      resolve: async () => (await tx.partnerCaseDeliveryItem.findUnique({ where: { caseId_revision_deliveryId_productRowId: {
        caseId: expectedCaseId, revision: record.revision, deliveryId: record.deliveryId, productRowId: record.productRowId } },
        select: { caseId: true } })) && { rootId: expectedCaseId },
      lock: () => tx.$queryRaw`SELECT "productRowId" FROM partner_case_delivery_items WHERE "caseId" = ${expectedCaseId}
        AND revision = ${record.revision} AND "deliveryId" = ${record.deliveryId}
        AND "productRowId" = ${record.productRowId} FOR UPDATE`,
    };
    if (record.kind === 'PAYMENT_PLAN') return {
      resolve: async () => { const row = await tx.partnerPaymentPlan.findUnique({ where: { id: record.id },
        select: { caseId: true, purpose: true } }); return row && { rootId: row.caseId, paymentPurpose: row.purpose }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_payment_plans WHERE id = ${record.id} FOR UPDATE`,
    };
    if (record.kind === 'PAYMENT_INSTALLMENT') return {
      resolve: async () => { const row = await tx.partnerPaymentInstallment.findUnique({ where: { id: record.id },
        select: { plan: { select: { caseId: true, purpose: true } } } });
        return row && { rootId: row.plan.caseId, paymentPurpose: row.plan.purpose }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_payment_installments WHERE id = ${record.id} FOR UPDATE`,
    };
    if (record.kind === 'RETAIL_RECEIPT') return {
      resolve: async () => { const row = await tx.partnerRetailReceipt.findUnique({ where: { id: record.id },
        select: { caseId: true } }); return row && { rootId: row.caseId, paymentPurpose: 'RETAIL' }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_retail_receipts WHERE id = ${record.id} FOR UPDATE` };
    if (record.kind === 'RECEIPT_ALLOCATION') return {
      resolve: async () => { const row = await tx.partnerRetailReceiptAllocation.findUnique({ where: {
        receiptId_installmentId: { receiptId: record.receiptId, installmentId: record.installmentId } },
        select: { receipt: { select: { caseId: true } } } });
        return row && { rootId: row.receipt.caseId, paymentPurpose: 'RETAIL' }; },
      lock: () => tx.$queryRaw`SELECT "receiptId" FROM partner_retail_receipt_allocations
        WHERE "receiptId" = ${record.receiptId} AND "installmentId" = ${record.installmentId} FOR UPDATE`,
    };
    if (record.kind === 'EVENT') return { resolve: direct(tx.partnerCaseEvent, record.id),
      lock: () => tx.$queryRaw`SELECT id FROM partner_case_events WHERE id = ${record.id} FOR UPDATE` };
    if (record.kind === 'CUSTOMER_OUTPUT') return { resolve: direct(tx.partnerCustomerOutputSnapshot, record.id),
      lock: () => tx.$queryRaw`SELECT id FROM partner_customer_output_snapshots WHERE id = ${record.id} FOR UPDATE` };
    if (record.kind === 'CORRECTION_OPPORTUNITY') return { resolve: direct(tx.partnerCorrectionOpportunity, record.id),
      lock: () => tx.$queryRaw`SELECT id FROM partner_correction_opportunities WHERE id = ${record.id} FOR UPDATE` };
    if (record.kind === 'CORRECTION_SAVE') return {
      resolve: async () => { const row = await tx.partnerCorrectionSave.findUnique({ where: { opportunityId: record.id },
        select: { opportunity: { select: { caseId: true } } } }); return row && { rootId: row.opportunity.caseId }; },
      lock: () => tx.$queryRaw`SELECT "opportunityId" FROM partner_correction_saves WHERE "opportunityId" = ${record.id} FOR UPDATE`,
    };
    if (record.kind === 'CORRECTION_GATE') return {
      resolve: async () => { const row = await tx.partnerCorrectionGate.findUnique({ where: { id: record.id },
        select: { opportunity: { select: { caseId: true } } } }); return row && { rootId: row.opportunity.caseId }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_correction_gates WHERE id = ${record.id} FOR UPDATE`,
    };
    if (record.kind === 'CORRECTION_DEPENDENCY') return {
      resolve: async () => { const row = await tx.partnerCorrectionDependency.findUnique({ where: { id: record.id },
        select: { opportunity: { select: { caseId: true } } } }); return row && { rootId: row.opportunity.caseId }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_correction_dependencies WHERE id = ${record.id} FOR UPDATE`,
    };
    if (record.kind === 'FINANCIAL_ADJUSTMENT') return { resolve: direct(tx.partnerFinancialAdjustment, record.id),
      lock: () => tx.$queryRaw`SELECT id FROM partner_financial_adjustments WHERE id = ${record.id} FOR UPDATE` };
    if (record.kind === 'OUTBOX_MESSAGE') return {
      resolve: async () => { const row = await tx.partnerOutboxMessage.findUnique({ where: { id: record.id },
        select: { event: { select: { caseId: true } } } }); return row && { rootId: row.event.caseId }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_outbox_messages WHERE id = ${record.id} FOR UPDATE`,
    };
    return {
      resolve: async () => { const row = await tx.partnerOutboxAttempt.findUnique({ where: { id: record.id },
        select: { message: { select: { event: { select: { caseId: true } } } } } });
        return row && { rootId: row.message.event.caseId }; },
      lock: () => tx.$queryRaw`SELECT id FROM partner_outbox_attempts WHERE id = ${record.id} FOR UPDATE`,
    };
  }
  async function authorizeChild(action: PartnerAction, root: AuthorizationRoot, guard: ChildGuard,
    validate: (context: PermissionContext, relationship: ChildRelationship) => boolean = () => true): Promise<Result<PermissionContext>> {
    const relationship = await guard.resolve();
    if (!relationship || relationship.rootId !== root.id) return { ok: false, error: partnerError('NOT_FOUND') };
    const decision = await authorization.authorize(action, root);
    if (!decision.ok) return decision;
    if (!validate(decision.value, relationship)) return { ok: false, error: partnerError('FORBIDDEN') };
    await guard.lock();
    const currentRelationship = await guard.resolve();
    if (!currentRelationship || currentRelationship.rootId !== root.id) return { ok: false, error: partnerError('NOT_FOUND') };
    const current = await authorization.authorize(action, root);
    if (!current.ok) return current;
    return validate(current.value, currentRelationship) ? current : { ok: false, error: partnerError('FORBIDDEN') };
  }
  return { ...authorization,
    async authorizeCaseRecord(action: PartnerAction, target: PartnerCaseRecordTarget,
      expectedCaseId: string): Promise<Result<PermissionContext>> {
      const root = { kind: 'CASE' as const, id: expectedCaseId };
      return authorizeChild(action, root, caseRecordGuard(target, expectedCaseId), (context, relationship) => {
        if (!relationship.paymentPurpose) return true;
        if (context.persona === 'PARTNER' && relationship.paymentPurpose === 'SABALAN') return action === 'CASE_READ';
        if (context.purpose === 'ACCOUNTING' && relationship.paymentPurpose === 'RETAIL') return false;
        return context.purpose !== 'FULFILLMENT';
      });
    },
    async authorizeInquiryRecord(action: PartnerAction, target: PartnerInquiryRecordTarget,
      expectedInquiryId: string): Promise<Result<PermissionContext>> {
      return authorizeChild(action, { kind: 'INQUIRY', id: expectedInquiryId }, inquiryRecordGuard(target));
    },
    async authorizeInquiryRow(action: PartnerAction, rowId: string, expectedInquiryId: string): Promise<Result<PermissionContext>> {
      return authorizeChild(action, { kind: 'INQUIRY', id: expectedInquiryId }, inquiryRecordGuard({ kind: 'ROW', id: rowId }));
    },
    async authorizeProject(action: PartnerAction, projectId: string, expectedCustomerId: string): Promise<Result<PermissionContext>> {
      // Root before child, matching callers that already authorized the Customer.
      const decision = await authorization.authorize(action, { kind: 'CUSTOMER', id: expectedCustomerId });
      if (!decision.ok) return decision;
      await tx.$queryRaw`SELECT id FROM crm_potential_projects WHERE id = ${projectId} FOR UPDATE`;
      const project = await tx.crmPotentialProject.findUnique({ where: { id: projectId }, select: {
        customerId: true, responsibleSellerId: true, isActive: true,
      } });
      if (!project?.isActive || project.customerId !== expectedCustomerId) return { ok: false, error: partnerError('NOT_FOUND') };
      if (decision.value.persona === 'PARTNER' && project.responsibleSellerId !== decision.value.actorId) {
        return { ok: false, error: partnerError('NOT_FOUND') };
      }
      // The child lock may have waited past grant expiry. Refresh after that
      // wait; the already-held root locks preserve the established lock order.
      return authorization.authorize(action, { kind: 'CUSTOMER', id: project.customerId });
    },
  };
}
