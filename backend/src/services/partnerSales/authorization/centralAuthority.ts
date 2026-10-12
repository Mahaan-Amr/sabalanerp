import { partnerOperationFeature } from './operationFeature';
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
  const explicit = await readExplicitPartnerDecisions(tx, input.actorId);
  const grants: AuthorizationEvidence<PartnerActionV2>['grants'] = [];
  for (const grant of current.grants) {
    const action = PartnerActionV2Schema.safeParse(grant.action);
    const kind = PermissionContextSchema.shape.root.shape.kind.safeParse(grant.rootKind);
    const purpose = PermissionContextSchema.shape.purpose.safeParse(grant.purpose);
    if (action.success && kind.success && purpose.success) grants.push({ ...grant, action: action.data, rootKind: kind.data, purpose: purpose.data });
  }
  for (const grant of workspace.grants) {
    // Explicit DENY and narrowed ALLOW own every action, including responder
    // route admission. A workspace bridge supplies only absent authority.
    if (explicit.has(decisionKey(grant))) continue;
    const action = PartnerActionV2Schema.safeParse(grant.action);
    const kind = PermissionContextSchema.shape.root.shape.kind.safeParse(grant.rootKind);
    const purpose = PermissionContextSchema.shape.purpose.safeParse(grant.purpose);
    if (action.success && kind.success && purpose.success) {
      for (const scoped of bridgeWithinExplicitReadScope(grant, current.grants, explicit)) {
        if (!grants.some(item => item.action === action.data && item.rootKind === kind.data &&
            item.purpose === purpose.data && item.scope === scoped.scope && item.boundRootId === scoped.boundRootId)) {
          grants.push({ ...scoped, action: action.data, rootKind: kind.data, purpose: purpose.data });
        }
      }
    }
  }
  return { authorizationRevision: current.authorizationRevision, grants: grants.filter(grant => {
    const feature = partnerOperationFeature(grant.action, grant.purpose);
    return !feature || !workspace.disabledFeatures?.includes(feature);
  }) };
};

/** Route admission uses the existing responder feature bridge. Other Partner
 * entry points keep their scoped grants; resource assignment checks stay in policy. */
export async function readPartnerRouteAuthority(tx: Prisma.TransactionClient, actorId: string, _domain: string) {
  const current = await readScopedActions(tx, actorId, 'PARTNER');
  const workspace = await resolvePartnerWorkspaceAuthority(tx, actorId);
  const explicit = await readExplicitPartnerDecisions(tx, actorId);
  return { ...current, grants: [...current.grants,
    ...workspace.grants.filter(grant => grant.purpose === 'RESPONDER' && ['ASSIGNED', 'COMPANY'].includes(grant.scope)
      && !explicit.has(decisionKey(grant)))].filter(grant => {
      const action = PartnerActionV2Schema.safeParse(grant.action);
      const purpose = PermissionContextSchema.shape.purpose.safeParse(grant.purpose);
      const feature = action.success && purpose.success ? partnerOperationFeature(action.data, purpose.data) : undefined;
      return !feature || !workspace.disabledFeatures?.includes(feature);
    }) };
}

/** A shared mutation cannot expand an explicit restricted resource audience.
 * Missing write authority inherits that audience; explicit write decisions
 * remain owned by the central resolver above. */
function bridgeWithinExplicitReadScope(grant: { action: string; rootKind: string; purpose: string; scope: 'ASSIGNED' | 'COMPANY' },
  current: Awaited<ReturnType<typeof readScopedActions>>['grants'], explicit: Set<string>) {
  const readAction = grant.purpose === 'ACCOUNTING' && grant.action !== 'ACCOUNTING_READ' ? 'ACCOUNTING_READ'
    : grant.purpose === 'FULFILLMENT' && grant.action !== 'FULFILLMENT_READ' ? 'FULFILLMENT_READ' : undefined;
  if (!readAction || !explicit.has(decisionKey({ ...grant, action: readAction }))) {
    return [{ ...grant, boundRootId: undefined, expiresAt: undefined }];
  }
  return current.filter(row => row.action === readAction && row.rootKind === grant.rootKind && row.purpose === grant.purpose)
    .map(row => ({ ...grant, scope: row.scope, boundRootId: row.boundRootId, expiresAt: row.expiresAt }));
}

const decisionKey = (row: { action: string; rootKind: string; purpose: string }) =>
  JSON.stringify([row.action, row.rootKind, row.purpose]);
async function readExplicitPartnerDecisions(tx: Prisma.TransactionClient, actorId: string) {
  const rows = await tx.$queryRaw<Array<{ action: string; rootKind: string; purpose: string }>>`
    SELECT g.action, g."rootKind", g.purpose
    FROM effective_action_grants g JOIN users u ON u.id = ${actorId}
    WHERE g.domain = 'PARTNER' AND g."revokedAt" IS NULL
      AND g."effectiveFrom" <= clock_timestamp()
      AND (g."expiresAt" IS NULL OR g."expiresAt" > clock_timestamp())
      AND ((g."principalKind" = 'USER' AND g."principalId" = u.id)
        OR (g."principalKind" = 'ROLE' AND g."principalId" = u.role::text))`;
  return new Set(rows.map(decisionKey));
}
