import type { Prisma } from '@prisma/client';
import { readManagedCrmOperations } from '../../crmOperationAuthority';
import { FEATURES } from '../../../middleware/feature';
import { getEffectiveUserAccess, type EffectiveWorkspacePermission } from '../../../services/effectiveAccessService';
import { readPartnerCommercialAccountingCapabilities } from '../accounting/capabilities';
import { readSharedOperationAuthority } from './sharedOperationAuthority';

const rank: Record<EffectiveWorkspacePermission, number> = { view: 1, edit: 2, admin: 3 };

export type PartnerWorkspaceAuthority = {
  isSystemAdmin: boolean;
  disabledFeatures?: string[];
  canViewAssigned: boolean;
  canRespondAssigned: boolean;
  canManageInquiries: boolean;
  grants: Array<{
    action: string;
    rootKind: 'PROFILE' | 'INQUIRY' | 'CASE' | 'CUSTOMER';
    purpose: 'ONBOARDING' | 'MANAGEMENT' | 'ACCOUNTING' | 'RESPONDER' | 'CRM' | 'FULFILLMENT';
    scope: 'ASSIGNED' | 'COMPANY';
  }>;
};

/** Bridges the central workspace/feature editor into Partner's scoped policy.
 * Scope is still fixed here: a feature can never ask the client for a wider
 * resource scope. Workspace levels cap the generated authority. */
export async function resolvePartnerWorkspaceAuthority(
  tx: Prisma.TransactionClient,
  actorId: string,
  purpose?: 'ACCOUNTING',
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
  const canViewAssigned = atLeast(FEATURES.SALES_PARTNER_INQUIRIES_VIEW, 'view');
  const canRespondAssigned = atLeast(FEATURES.SALES_PARTNER_INQUIRIES_RESPOND, 'edit');
  const canManageInquiries = atLeast(FEATURES.SALES_PARTNER_SELLERS_MANAGE, 'admin');
  const grants: PartnerWorkspaceAuthority['grants'] = [];
  const add = (grant: PartnerWorkspaceAuthority['grants'][number]) => {
    if (!grants.some(item => item.action === grant.action && item.rootKind === grant.rootKind &&
        item.purpose === grant.purpose && item.scope === grant.scope)) grants.push(grant);
  };

  if ((await readPartnerCommercialAccountingCapabilities(tx, actorId)).view) {
    add({ action: 'ACCOUNTING_READ', rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY' });
  }

  // Broad Case access is only the first gate. Every shared command retains its
  // exact feature check, so payments authority cannot enqueue an invoice, and
  // Guard authority cannot create a loading or materialize stock lineage.
  const shared = await readSharedOperationAuthority(tx, actorId);
  const accountingWrites = [FEATURES.ACCOUNTING_INVOICE_CANDIDATES_MANAGE,
    FEATURES.ACCOUNTING_RECEIVABLES_MANAGE, FEATURES.ACCOUNTING_PAYMENTS_MANAGE,
    FEATURES.ACCOUNTING_TAX_MANAGE, FEATURES.ACCOUNTING_RECORDS_APPROVE_VOID,
    FEATURES.ACCOUNTING_ACTIONS_MANAGE, FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE,
    FEATURES.ACCOUNTING_EVIDENCE_MANAGE, FEATURES.ACCOUNTING_CORRECTIONS_MANAGE,
    FEATURES.ACCOUNTING_CORRECTIONS_APPROVE, FEATURES.ACCOUNTING_CORRECTIONS_VERIFY];
  if ((await Promise.all([...accountingWrites, FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_VIEW,
    FEATURES.ACCOUNTING_AUDIT_VIEW].map(feature => shared('accounting', feature, 'view')))).some(Boolean)) {
    add({ action: 'ACCOUNTING_READ', rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY' });
  }
  if ((await Promise.all(accountingWrites.map(feature => shared('accounting', feature)))).some(Boolean)) {
    add({ action: 'ACCOUNTING_WRITE', rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY' });
  }
  for (const [action, feature] of [
    ['FINANCIAL_PROCESS', FEATURES.ACCOUNTING_CORRECTIONS_MANAGE],
    ['FINANCIAL_APPROVE', FEATURES.ACCOUNTING_CORRECTIONS_APPROVE],
    ['FINANCIAL_VERIFY', FEATURES.ACCOUNTING_CORRECTIONS_VERIFY],
  ] as const) {
    if (await shared('accounting', feature) &&
        (action === 'FINANCIAL_PROCESS' || await shared('accounting', null, 'admin'))) {
      add({ action, rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY' });
    }
  }
  // Accounting's policy never consumes CRM, responder or fulfillment grants.
  // Read its complete live authority without constructing those other bridges.
  // Credit terms are the remaining Accounting-purpose PROFILE action below.
  if (purpose === 'ACCOUNTING') {
    if (atLeast(FEATURES.ACCOUNTING_PARTNER_TERMS_MANAGE, 'edit')) {
      add({ action: 'CREDIT_TERMS_MANAGE', rootKind: 'PROFILE', purpose: 'ACCOUNTING', scope: 'COMPANY' });
    }
    return { isSystemAdmin, canViewAssigned, canRespondAssigned, canManageInquiries, grants,
      disabledFeatures: effective.disabledFeatures };
  }
  if (await shared('logistics', FEATURES.LOGISTICS_LOADINGS_VIEW, 'view') || await shared('security', null, 'view')) {
    add({ action: 'FULFILLMENT_READ', rootKind: 'CASE', purpose: 'FULFILLMENT', scope: 'COMPANY' });
  }
  if ((await Promise.all([FEATURES.LOGISTICS_LOADINGS_CREATE, FEATURES.LOGISTICS_LOADINGS_EDIT,
    FEATURES.LOGISTICS_LOADINGS_FINALIZE, FEATURES.LOGISTICS_DRIVERS_MANAGE].map(feature => shared('logistics', feature)))).some(Boolean)
      || await shared('security', null)) {
    add({ action: 'FULFILLMENT_WRITE', rootKind: 'CASE', purpose: 'FULFILLMENT', scope: 'COMPANY' });
  }

  const crm = await readManagedCrmOperations(tx, actorId);
  if (crm.visible) {
    add({ action: 'CUSTOMER_READ', rootKind: 'CUSTOMER', purpose: 'CRM', scope: 'COMPANY' });
    if ((await Promise.all(['project_addresses', 'contacts', 'leads'].flatMap(subject =>
      ['create', 'edit', 'delete'].map(operation => crm.has(`crm_${subject}_${operation}`))))).some(Boolean)) {
      add({ action: 'CUSTOMER_WRITE', rootKind: 'CUSTOMER', purpose: 'CRM', scope: 'COMPANY' });
    }
  }

  if (atLeast(FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE, 'edit')) {
    add({ action: 'CUSTOMER_READ', rootKind: 'CUSTOMER', purpose: 'CRM', scope: 'COMPANY' });
    add({ action: 'CUSTOMER_TRANSFER_DECIDE', rootKind: 'CUSTOMER', purpose: 'CRM', scope: 'COMPANY' });
  }

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
  if (atLeast('VERIFY_PARTNER_IDENTITY', 'edit')) {
    add({ action: 'PROFILE_READ', rootKind: 'PROFILE', purpose: 'ONBOARDING', scope: 'COMPANY' });
    add({ action: 'IDENTITY_VERIFY', rootKind: 'PROFILE', purpose: 'ONBOARDING', scope: 'COMPANY' });
  }
  if (atLeast(FEATURES.ACCOUNTING_PARTNER_TERMS_MANAGE, 'edit')) {
    add({ action: 'PROFILE_READ', rootKind: 'PROFILE', purpose: 'ONBOARDING', scope: 'COMPANY' });
    add({ action: 'COMMERCIAL_TERMS_MANAGE', rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'COMPANY' });
    add({ action: 'CREDIT_TERMS_MANAGE', rootKind: 'PROFILE', purpose: 'ACCOUNTING', scope: 'COMPANY' });
  }
  if (atLeast(FEATURES.BI_PARTNER_REPORTS_VIEW, 'view')) {
    add({ action: 'REPORT_READ', rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'COMPANY' });
    add({ action: 'REPORT_READ', rootKind: 'CASE', purpose: 'MANAGEMENT', scope: 'COMPANY' });
  }
  return { isSystemAdmin, canViewAssigned, canRespondAssigned, canManageInquiries, grants, disabledFeatures: effective.disabledFeatures };
}
