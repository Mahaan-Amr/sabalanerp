import type { Prisma } from '@prisma/client';
import { getEffectiveUserAccess } from '../../effectiveAccessService';
import { resolveNarrowFeatureAccess } from '../../narrowFeatureAccess';
import type { PartnerPermissionReadClient } from '../authorization/fencedPermissionReads';

/** Current internal Accounting authority, in addition to the audited Case grant.
 * Never accept a route's earlier permission snapshot as mutation authority.
 * Caller first acquires current audited Partner authority (User -> central
 * revision). Accounting grant changes advance that revision at commit, including
 * newly inserted overrides. Do not lock individual permission rows here: bulk
 * permission replacement owns those rows before entering the revision fence. */
export async function readPartnerAccountingCapabilities(tx: Prisma.TransactionClient, actorId: string) {
  const denied = { payments: false, tax: false, approve: false, deleteDraft: false, receivables: false };
  const edit = await readPartnerAccountingEditAuthority(tx, actorId);
  if (!edit) return denied;
  const [payments, tax, approve, receivables] = await Promise.all([
    edit.allows('accounting_payments_manage'), edit.allows('accounting_tax_manage'),
    edit.allows('accounting_records_approve_void'), edit.allows('accounting_receivables_manage'),
  ]);
  return { payments, tax, receivables, deleteDraft: approve, approve: approve && (edit.role === 'ADMIN' || edit.workspace === 'admin') };
}

export async function readPartnerAccountingListCapabilities(tx: PartnerPermissionReadClient, actorId: string) {
  const edit = await readPartnerAccountingEditAuthority(tx, actorId);
  if (!edit) return { payments: false, tax: false };
  const [payments, tax] = await Promise.all([
    edit.allows('accounting_payments_manage'), edit.allows('accounting_tax_manage'),
  ]);
  return { payments, tax };
}

async function readPartnerAccountingEditAuthority(tx: PartnerPermissionReadClient, actorId: string, at?: Date) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive) return;
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role, at });
  const workspace = effective.workspaces.find(row => row.workspace === 'accounting')?.permission;
  if (workspace !== 'edit' && workspace !== 'admin') return;
  return { role: actor.role, workspace, allows: async (feature: string) => (await resolveNarrowFeatureAccess(tx,
    { userId: actorId, role: actor.role, workspace: 'accounting', feature, requiredPermission: 'edit' }, at)).allowed };
}

/** Re-evaluate payments authority against the Case snapshot's permission
 * rows at the current decision time. */
export async function readPartnerPaymentsCapability(tx: PartnerPermissionReadClient, actorId: string, at: Date) {
  const edit = await readPartnerAccountingEditAuthority(tx, actorId, at);
  return edit ? edit.allows('accounting_payments_manage') : false;
}

/** Re-evaluate the narrow dispatch mutation capability in the transaction that
 * commits the Partner Case mutation. Route middleware is only a preflight and
 * must not remain authoritative after a concurrent permission revocation. */
export async function readPartnerDispatchAccountingCapability(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive) return false;
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role });
  const workspace = effective.workspaces.find(row => row.workspace === 'accounting')?.permission;
  if (!['edit', 'admin'].includes(workspace || '')) return false;
  return (await resolveNarrowFeatureAccess(tx, { userId: actorId, role: actor.role,
    workspace: 'accounting', feature: 'accounting_dispatch_candidates_manage', requiredPermission: 'edit' })).allowed;
}

/** Current list authority evaluated only after the caller has entered the
 * Partner authorization fence for every Case in its snapshot. */
export async function readPartnerDispatchAccountingViewCapability(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive) return false;
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role });
  const workspace = effective.workspaces.find(row => row.workspace === 'accounting')?.permission;
  if (!['view', 'edit', 'admin'].includes(workspace || '')) return false;
  return (await resolveNarrowFeatureAccess(tx, { userId: actorId, role: actor.role,
    workspace: 'accounting', feature: 'accounting_dispatch_candidates_view', requiredPermission: 'view' })).allowed;
}


export async function readPartnerCommercialAccountingCapabilities(tx: PartnerPermissionReadClient, actorId: string,
  options: { viewOnly?: boolean; at?: Date } = {}) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive) return { view: false, paper: false };
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role, at: options.at });
  const workspace = effective.workspaces.find(row => row.workspace === 'accounting')?.permission;
  const view = ['view', 'edit', 'admin'].includes(workspace || '') && (await resolveNarrowFeatureAccess(tx, { userId: actorId, role: actor.role, workspace: 'accounting', feature: 'accounting_contracts_view', requiredPermission: 'view' }, options.at)).allowed;
  const paper = !options.viewOnly && view && ['edit', 'admin'].includes(workspace || '') && (await resolveNarrowFeatureAccess(tx, { userId: actorId, role: actor.role, workspace: 'accounting', feature: 'accounting_actions_manage', requiredPermission: 'edit' }, options.at)).allowed;
  return { view, paper };
}
