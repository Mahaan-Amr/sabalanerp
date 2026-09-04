import type { Prisma } from '@prisma/client';
import { IdSchema, partnerError } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { getEffectiveUserAccess } from '../../effectiveAccessService';
import { resolveNarrowFeatureAccess } from '../../narrowFeatureAccess';

export type PartnerLoadingActor = { actorId: string; correlationId: string; reason?: string };
export const validPartnerLoadingActor = (input: PartnerLoadingActor) => IdSchema.safeParse(input.actorId).success &&
  IdSchema.safeParse(input.correlationId).success && (input.reason === undefined ||
    typeof input.reason === 'string' && input.reason.length <= 2000);
export class PartnerLoadingCommandError extends Error {
  constructor(readonly error: ReturnType<typeof partnerError>) { super(error.message); }
}

/** Caller owns the operations and Case locks. Case grants do not replace the
 * current workspace and narrow feature authority of the operational action. */
export async function authorizePartnerLoading(tx: Prisma.TransactionClient, input: PartnerLoadingActor,
  caseId: string, operation: 'READ' | 'CREATE' | 'ALLOCATE' | 'FINALIZE' | 'RESERVE' | 'RELEASE' | 'GUARD_READ' | 'GUARD_RELEASE') {
  if (!validPartnerLoadingActor(input)) return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
  const write = operation !== 'READ' && operation !== 'GUARD_READ';
  const authorization = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
    purpose: 'FULFILLMENT', channel: 'API' }, input)
    .authorize(write ? 'FULFILLMENT_WRITE' : 'FULFILLMENT_READ', { kind: 'CASE', id: caseId });
  if (!authorization.ok) return authorization;
  const denied = { ok: false as const, error: partnerError('FORBIDDEN') };
  const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive) return denied;
  const effective = await getEffectiveUserAccess(tx, { userId: input.actorId, userRole: actor.role });
  const workspaceName = operation === 'GUARD_READ' || operation === 'GUARD_RELEASE' ? 'security' : 'logistics';
  const workspace = effective.workspaces.find(row => row.workspace === workspaceName)?.permission;
  const feature = { READ: 'logistics_loadings_view', CREATE: 'logistics_loadings_create',
    ALLOCATE: 'logistics_loadings_edit',
    FINALIZE: 'logistics_loadings_finalize',
    RESERVE: 'logistics_drivers_manage', RELEASE: 'logistics_drivers_manage', GUARD_READ: null, GUARD_RELEASE: null }[operation];
  if (!(write ? ['edit', 'admin'] : ['view', 'edit', 'admin']).includes(workspace || '') ||
      (feature && !(await resolveNarrowFeatureAccess(tx, { userId: input.actorId, role: actor.role, workspace: workspaceName, feature,
        requiredPermission: write ? 'edit' : 'view' })).allowed)) return denied;
  return authorization;
}
