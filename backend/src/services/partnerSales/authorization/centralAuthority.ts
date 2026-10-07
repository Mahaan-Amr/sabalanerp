import type { Prisma } from '@prisma/client';
import { PartnerActionV2Schema, PermissionContextSchema, type PartnerActionV2 } from '@sabalanerp/partner-sales-contracts';
import { readScopedActions, resolveScopedActions } from '../../effectiveAccessService';
import type { ResolvePartnerAuthority } from './prisma';
import type { AuthorizationEvidence } from './contracts';
import { resolvePartnerWorkspaceAuthority } from './workspaceAuthority';

/** A vocabulary adapter to central Effective Authorization, not another grant
 * resolver. Domain restrictions and scope-to-current-root checks remain policy. */
export const resolvePartnerScopedAuthority: ResolvePartnerAuthority<PartnerActionV2> = async (tx, input) => {
  const current = await resolveScopedActions(tx, input.actorId, 'PARTNER');
  const workspace = await resolvePartnerWorkspaceAuthority(tx, input.actorId);
  const grants: AuthorizationEvidence<PartnerActionV2>['grants'] = [];
  for (const grant of current.grants) {
    const action = PartnerActionV2Schema.safeParse(grant.action);
    const kind = PermissionContextSchema.shape.root.shape.kind.safeParse(grant.rootKind);
    const purpose = PermissionContextSchema.shape.purpose.safeParse(grant.purpose);
    if (action.success && kind.success && purpose.success) grants.push({ ...grant, action: action.data, rootKind: kind.data, purpose: purpose.data });
  }
  for (const grant of workspace.grants) {
    const action = PartnerActionV2Schema.safeParse(grant.action);
    const kind = PermissionContextSchema.shape.root.shape.kind.safeParse(grant.rootKind);
    const purpose = PermissionContextSchema.shape.purpose.safeParse(grant.purpose);
    if (action.success && kind.success && purpose.success && !grants.some(item => item.action === action.data &&
        item.rootKind === kind.data && item.purpose === purpose.data && item.scope === grant.scope)) {
      grants.push({ action: action.data, rootKind: kind.data, purpose: purpose.data, scope: grant.scope });
    }
  }
  return { authorizationRevision: current.authorizationRevision, grants };
};

/** Route admission uses the existing responder feature bridge. Other Partner
 * entry points keep their scoped grants; resource assignment checks stay in policy. */
export async function readPartnerRouteAuthority(tx: Prisma.TransactionClient, actorId: string, _domain: string) {
  const current = await readScopedActions(tx, actorId, 'PARTNER');
  const workspace = await resolvePartnerWorkspaceAuthority(tx, actorId);
  return { ...current, grants: [...current.grants,
    ...workspace.grants.filter(grant => grant.purpose === 'RESPONDER' && ['ASSIGNED', 'COMPANY'].includes(grant.scope))] };
}
