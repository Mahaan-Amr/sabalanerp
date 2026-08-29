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
  return { ...authorization,
    async authorizeCaseRecord(action: PartnerAction, target: { kind: 'PRODUCT_ROW' | 'INTERNAL_RECORD' | 'CUSTOMER_CONTRACT'; id: string },
      expectedCaseId: string): Promise<Result<PermissionContext>> {
      let caseId: string | null | undefined;
      if (target.kind === 'PRODUCT_ROW') {
        caseId = (await tx.partnerProductRow.findUnique({ where: { id: target.id }, select: { caseId: true } }))?.caseId;
      } else if (target.kind === 'INTERNAL_RECORD') {
        caseId = (await tx.sabalanToPartnerSaleRecord.findUnique({ where: { id: target.id }, select: { caseId: true } }))?.caseId;
      } else if (target.kind === 'CUSTOMER_CONTRACT') {
        const contract = await tx.salesContract.findUnique({ where: { id: target.id }, select: { partnerKind: true, partnerCaseId: true } });
        if (contract?.partnerKind === 'PARTNER_CUSTOMER') caseId = contract.partnerCaseId;
      }
      if (!caseId || caseId !== expectedCaseId) return { ok: false, error: partnerError('NOT_FOUND') };
      const root = { kind: 'CASE' as const, id: expectedCaseId };
      const decision = await authorization.authorize(action, root);
      if (!decision.ok) return decision;
      if (target.kind === 'PRODUCT_ROW') await tx.$queryRaw`SELECT id FROM partner_product_rows WHERE id = ${target.id} FOR UPDATE`;
      if (target.kind === 'INTERNAL_RECORD') await tx.$queryRaw`SELECT id FROM sabalan_to_partner_sale_records WHERE id = ${target.id} FOR UPDATE`;
      if (target.kind === 'CUSTOMER_CONTRACT') await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${target.id} FOR UPDATE`;
      // The three links are database-immutable. Recheck current grant/time after
      // acquiring the child, never reuse a permit issued before a lock wait.
      return authorization.authorize(action, root);
    },
    async authorizeInquiryRow(action: PartnerAction, rowId: string, expectedInquiryId: string): Promise<Result<PermissionContext>> {
      // inquiryId is immutable. Resolve it without acquiring a child-before-root
      // lock, and never infer a different root from a forged nested identifier.
      const row = await tx.partnerInquiryRow.findUnique({ where: { id: rowId }, select: { inquiryId: true } });
      if (!row || row.inquiryId !== expectedInquiryId) return { ok: false, error: partnerError('NOT_FOUND') };
      const root = { kind: 'INQUIRY' as const, id: expectedInquiryId };
      const decision = await authorization.authorize(action, root);
      if (!decision.ok) return decision;
      await tx.$queryRaw`SELECT id FROM partner_inquiry_rows WHERE id = ${rowId} FOR UPDATE`;
      return authorization.authorize(action, root);
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
