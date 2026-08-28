import { checkPartnerDomainRestrictions, partnerError, PartnerActionSchema, PermissionContextSchema,
  type PartnerAuthorizationPort, type PermissionContext } from '@sabalanerp/partner-sales-contracts';
import type { AuthorizationBinding, AuthorizationSource } from './contracts';
import { internalCapabilities, partnerCapabilities, readActions } from './capabilities';

/** Actor/purpose/channel are trusted composition bindings, not request overrides. */
export function createPartnerAuthorization(source: AuthorizationSource, binding: AuthorizationBinding): PartnerAuthorizationPort {
  return { async authorize(action, root) {
    if (!PartnerActionSchema.safeParse(action).success || !PermissionContextSchema.shape.root.safeParse(root).success) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    // Public token consumers use #325's snapshot-bound output authority. A public
    // channel is never a way to request private Case/Accounting data.
    if (binding.channel === 'PUBLIC' && action !== 'CUSTOMER_OUTPUT') return { ok: false, error: partnerError('FORBIDDEN') };
    const evidence = await source.read(binding.actorId, root);
    const { actor, resource } = evidence;
    if (!actor.active || actor.id !== binding.actorId || !resource || resource.root.id !== root.id ||
        resource.root.kind !== root.kind) {
      return { ok: false, error: partnerError('NOT_FOUND') };
    }
    const partner = actor.partnerProfile;
    const admin = !partner && actor.role === 'ADMIN';
    if (partner && (resource.partnerSellerId !== actor.id || partner.state === 'TERMINATED' ||
        (partner.state === 'PENDING' && !(action === 'PROFILE_READ' && root.kind === 'PROFILE' && binding.purpose === 'ONBOARDING')))) {
      return { ok: false, error: partnerError('NOT_FOUND') };
    }
    if (partner && partner.state !== resource.partnerStatus) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const grants = evidence.grants.filter(grant => grant.rootKind === root.kind && grant.purpose === binding.purpose &&
      internalCapabilities[grant.action]?.some(([kind, purpose]) => kind === root.kind && purpose === binding.purpose) &&
      (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.parse(evidence.evaluatedAt)) &&
      (grant.scope === 'COMPANY' || (grant.scope === 'DEPARTMENT' && actor.departmentId && actor.departmentId === resource.departmentId) ||
        (grant.scope === 'ASSIGNED' && binding.purpose === 'RESPONDER' && resource.assignment?.actorId === actor.id && resource.assignment.eligible) ||
        (grant.scope === 'PURPOSE_BOUND' && ['ACCOUNTING', 'FULFILLMENT'].includes(binding.purpose) && grant.boundRootId === root.id)));
    if (!partner && !admin && !grants.length) return { ok: false, error: partnerError('NOT_FOUND') };
    if (binding.purpose === 'RESPONDER' && (!resource.assignment?.eligible || resource.assignment.actorId !== actor.id)) {
      return { ok: false, error: partnerError('NOT_ASSIGNED') };
    }
    const actionGrant = grants.find(grant => grant.action === action);
    const capabilities = partner ? partnerCapabilities : internalCapabilities;
    const context: PermissionContext = {
      ...binding, root: { kind: root.kind, id: root.id }, persona: partner ? 'PARTNER' : 'INTERNAL', isAdmin: admin,
      partnerSellerId: resource.partnerSellerId, partnerStatus: resource.partnerStatus,
      scope: partner ? 'OWN' : admin ? 'COMPANY' : (actionGrant ?? grants[0]).scope, resourceVisible: true,
      departmentId: actor.departmentId,
      actionGranted: (Boolean(partner) || admin || Boolean(actionGrant)) &&
        (capabilities[action]?.some(([kind, purpose]) => kind === root.kind && purpose === binding.purpose) ?? false),
      authorizationRevision: evidence.authorizationRevision, lifecycleRevision: resource.lifecycleRevision,
      evaluatedAt: evidence.evaluatedAt, grantExpiresAt: actionGrant?.expiresAt,
      assignment: resource.assignment, requesterId: resource.requesterId,
    };
    const parsed = PermissionContextSchema.safeParse(context);
    if (!parsed.success) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const denial = checkPartnerDomainRestrictions(action, parsed.data);
    if (denial) return { ok: false, error: denial };
    if (partner && !readActions.has(action) && partner.state !== 'ACTIVE') return { ok: false, error: partnerError('PARTNER_NOT_ACTIVE') };
    if (['CASE_COMMIT', 'CORRECTION_SCOPE_APPROVE'].includes(action) && resource.partnerStatus !== 'ACTIVE') {
      return { ok: false, error: partnerError('PARTNER_NOT_ACTIVE') };
    }
    return { ok: true, value: parsed.data };
  } };
}
