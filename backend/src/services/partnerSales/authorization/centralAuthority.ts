import { PartnerActionV2Schema, PermissionContextSchema, type PartnerActionV2 } from '@sabalanerp/partner-sales-contracts';
import { resolveScopedActions } from '../../effectiveAccessService';
import type { ResolvePartnerAuthority } from './prisma';
import type { AuthorizationEvidence } from './contracts';

/** A vocabulary adapter to central Effective Authorization, not another grant
 * resolver. Domain restrictions and scope-to-current-root checks remain policy. */
export const resolvePartnerScopedAuthority: ResolvePartnerAuthority<PartnerActionV2> = async (tx, input) => {
  const current = await resolveScopedActions(tx, input.actorId, 'PARTNER');
  const grants: AuthorizationEvidence<PartnerActionV2>['grants'] = [];
  for (const grant of current.grants) {
    const action = PartnerActionV2Schema.safeParse(grant.action);
    const kind = PermissionContextSchema.shape.root.shape.kind.safeParse(grant.rootKind);
    const purpose = PermissionContextSchema.shape.purpose.safeParse(grant.purpose);
    if (action.success && kind.success && purpose.success) grants.push({ ...grant, action: action.data, rootKind: kind.data, purpose: purpose.data });
  }
  return { authorizationRevision: current.authorizationRevision, grants };
};
