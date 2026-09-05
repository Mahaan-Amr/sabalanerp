import type { Prisma } from '@prisma/client';
import { getEffectiveUserAccess } from '../../effectiveAccessService';
import { resolveNarrowFeatureAccess } from '../../narrowFeatureAccess';

/** Current internal Accounting authority, in addition to the audited Case grant.
 * Never accept a route's earlier permission snapshot as mutation authority.
 * Caller first acquires current audited Partner authority (User -> central
 * revision). Accounting grant changes advance that revision at commit, including
 * newly inserted overrides. Do not lock individual permission rows here: bulk
 * permission replacement owns those rows before entering the revision fence. */
export async function readPartnerAccountingCapabilities(tx: Prisma.TransactionClient, actorId: string) {
  const denied = { payments: false, tax: false, approve: false };
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive) return denied;
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role });
  const workspace = effective.workspaces.find(row => row.workspace === 'accounting')?.permission;
  if (!['edit', 'admin'].includes(workspace || '')) return denied;
  const allowed = async (feature: string) => (await resolveNarrowFeatureAccess(tx, { userId: actorId, role: actor.role,
    workspace: 'accounting', feature, requiredPermission: 'edit' })).allowed;
  const [payments, tax, approve] = await Promise.all([
    allowed('accounting_payments_manage'), allowed('accounting_tax_manage'), allowed('accounting_records_approve_void'),
  ]);
  return { payments, tax, approve: approve && (actor.role === 'ADMIN' || workspace === 'admin') };
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
