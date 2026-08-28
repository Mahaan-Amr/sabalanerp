import type { Prisma } from '@prisma/client';
import { partnerError, type PartnerAction, type PermissionContext, type Result } from '@sabalanerp/partner-sales-contracts';
import { createPartnerAuthorization } from './service';
import type { AuthorizationBinding, AuthorizationEvidence, AuthorizationRoot } from './contracts';

/** #296 composition contract. Resolve explicit action/scope grants using the
 * CENTRAL resolver; lock its grant rows/absence guards until this transaction
 * finishes. No route may implement a role/workspace fallback here. */
export type ResolvePartnerAuthority = (tx: Prisma.TransactionClient, input: {
  actorId: string; root: AuthorizationRoot;
}) => Promise<Pick<AuthorizationEvidence, 'grants' | 'authorizationRevision'>>;

/** Transaction-scoped, using the caller's shared Prisma transaction. Never owns
 * a PrismaClient or commits/disconnects. Unsupported roots fail closed. */
export function createPrismaPartnerAuthorization(tx: Prisma.TransactionClient, binding: AuthorizationBinding,
  resolveAuthority: ResolvePartnerAuthority) {
  const authorization = createPartnerAuthorization({ read: async (actorId, root) => {
    let resource: AuthorizationEvidence['resource'] = null;
    let profileId = root.kind === 'PROFILE' ? root.id : null;
    if (root.kind === 'CUSTOMER') {
      await tx.$queryRaw`SELECT id FROM crm_customers WHERE id = ${root.id} FOR UPDATE`;
      const customer = await tx.crmCustomer.findUnique({ where: { id: root.id }, select: { ownerUserId: true, isActive: true } });
      if (customer?.isActive && customer.ownerUserId) {
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
    const authority = actor?.isActive && resource ? await resolveAuthority(tx, { actorId, root }) : { grants: [], authorizationRevision: 1 };
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    return { ...authority, evaluatedAt: clock.now.toISOString(), resource, actor: {
      id: actorId, active: actor?.isActive ?? false, role: actor?.role ?? 'USER',
      ...(actor?.departmentId ? { departmentId: actor.departmentId } : {}),
      ...(actor?.partnerProfile ? { partnerProfile: actor.partnerProfile } : {}),
    } };
  } }, binding);
  return { ...authorization,
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
