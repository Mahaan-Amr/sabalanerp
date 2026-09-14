import type { Prisma } from '@prisma/client';
import { FEATURES } from '../../../middleware/feature';
import { getEffectiveUserAccess, type EffectiveWorkspacePermission } from '../../../services/effectiveAccessService';

const rank: Record<EffectiveWorkspacePermission, number> = { view: 1, edit: 2, admin: 3 };

export type PartnerWorkspaceAuthority = {
  isSystemAdmin: boolean;
  canViewAssigned: boolean;
  canRespondAssigned: boolean;
  canManageInquiries: boolean;
  grants: Array<{
    action: string;
    rootKind: 'PROFILE' | 'INQUIRY' | 'CASE';
    purpose: 'ONBOARDING' | 'MANAGEMENT' | 'ACCOUNTING' | 'RESPONDER';
    scope: 'ASSIGNED' | 'COMPANY';
  }>;
};

/** Bridges the central workspace/feature editor into Partner's scoped policy.
 * Scope is still fixed here: a feature can never ask the client for a wider
 * resource scope. Workspace levels cap the generated authority. */
export async function resolvePartnerWorkspaceAuthority(
  tx: Prisma.TransactionClient,
  actorId: string,
): Promise<PartnerWorkspaceAuthority> {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true, isActive: true, partnerProfile: { select: { id: true } } },
  });
  if (!actor?.isActive || actor.partnerProfile) {
    return { isSystemAdmin: false, canViewAssigned: false, canRespondAssigned: false, canManageInquiries: false, grants: [] };
  }
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role });
  const level = (feature: string) => effective.features.find(item => item.feature === feature)?.permission;
  const atLeast = (feature: string, required: EffectiveWorkspacePermission) => {
    const actual = level(feature);
    return Boolean(actual && rank[actual] >= rank[required]);
  };
  const isSystemAdmin = actor.role === 'ADMIN';
  const canViewAssigned = isSystemAdmin || atLeast(FEATURES.SALES_PARTNER_INQUIRIES_VIEW, 'view');
  const canRespondAssigned = isSystemAdmin || atLeast(FEATURES.SALES_PARTNER_INQUIRIES_RESPOND, 'edit');
  const canManageInquiries = isSystemAdmin || atLeast(FEATURES.SALES_PARTNER_SELLERS_MANAGE, 'admin');
  const grants: PartnerWorkspaceAuthority['grants'] = [];
  const add = (grant: PartnerWorkspaceAuthority['grants'][number]) => {
    if (!grants.some(item => item.action === grant.action && item.rootKind === grant.rootKind &&
        item.purpose === grant.purpose && item.scope === grant.scope)) grants.push(grant);
  };

  if (canViewAssigned) {
    add({ action: 'INQUIRY_READ', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'ASSIGNED' });
  }
  if (canRespondAssigned) {
    add({ action: 'INQUIRY_RESPOND', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'ASSIGNED' });
  }
  if (canManageInquiries) {
    add({ action: 'INQUIRY_READ', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'COMPANY' });
    add({ action: 'INQUIRY_RESPOND', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'COMPANY' });
    add({ action: 'PROFILE_READ', rootKind: 'PROFILE', purpose: 'ONBOARDING', scope: 'COMPANY' });
    add({ action: 'COMMERCIAL_TERMS_MANAGE', rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'COMPANY' });
    add({ action: 'RESPONDER_ASSIGN', rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'COMPANY' });
    add({ action: 'RESPONDER_REASSIGN', rootKind: 'INQUIRY', purpose: 'MANAGEMENT', scope: 'COMPANY' });
    add({ action: 'PROFILE_CONVERSION_MANAGE', rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'COMPANY' });
  }
  if (isSystemAdmin || atLeast('VERIFY_PARTNER_IDENTITY', 'edit')) {
    add({ action: 'PROFILE_READ', rootKind: 'PROFILE', purpose: 'ONBOARDING', scope: 'COMPANY' });
    add({ action: 'IDENTITY_VERIFY', rootKind: 'PROFILE', purpose: 'ONBOARDING', scope: 'COMPANY' });
  }
  if (isSystemAdmin || atLeast(FEATURES.ACCOUNTING_PARTNER_TERMS_MANAGE, 'edit')) {
    add({ action: 'PROFILE_READ', rootKind: 'PROFILE', purpose: 'ONBOARDING', scope: 'COMPANY' });
    add({ action: 'COMMERCIAL_TERMS_MANAGE', rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'COMPANY' });
    add({ action: 'CREDIT_TERMS_MANAGE', rootKind: 'PROFILE', purpose: 'ACCOUNTING', scope: 'COMPANY' });
  }
  if (isSystemAdmin || atLeast(FEATURES.BI_PARTNER_REPORTS_VIEW, 'view')) {
    add({ action: 'REPORT_READ', rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'COMPANY' });
    add({ action: 'REPORT_READ', rootKind: 'CASE', purpose: 'MANAGEMENT', scope: 'COMPANY' });
  }
  return { isSystemAdmin, canViewAssigned, canRespondAssigned, canManageInquiries, grants };
}
