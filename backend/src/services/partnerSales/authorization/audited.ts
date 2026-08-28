import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PartnerActionV2Schema, PermissionContextSchema, partnerError, type PartnerActionV2, type PartnerAuthorizationV2Port, type Result } from '@sabalanerp/partner-sales-contracts';
import { appendAuthorizationDecision, readAuthorizationDecisions } from '../../effectiveAuthorization/audit';
import type { AuthorizationBinding, AuthorizationEvidence, AuthorizationRoot } from './contracts';
import { prismaAuthorizationSource } from './prisma';
import { resolvePartnerScopedAuthority } from './centralAuthority';
import { createPartnerAuthorizationV2 } from './service';
import { readActions } from './capabilities';

/** Real persisted composition, still unmounted. A denial must be returned from
 * the transaction (not thrown) to retain its audit. Business commands must not
 * mutate before authorization. Rollback rolls back both mutation and evidence. */
export function createAuditedPartnerAuthorization(tx: Prisma.TransactionClient, binding: AuthorizationBinding,
  audit: { correlationId: string; reason?: string }, target?: { correctionOpportunityId: string }): PartnerAuthorizationV2Port {
  if (!audit.correlationId.trim() || audit.correlationId.length > 200 || (audit.reason?.length ?? 0) > 2000) {
    throw new Error('Valid authorization audit context required');
  }
  const source = prismaAuthorizationSource(tx, resolvePartnerScopedAuthority, target);
  return { async authorize(action, root) {
    // Malformed transport input is not a resource decision and must never be
    // copied into retained audit data. The transport owns request-error logs.
    if (!PartnerActionV2Schema.safeParse(action).success || !PermissionContextSchema.shape.root.safeParse(root).success) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    let observed: AuthorizationEvidence<PartnerActionV2> | undefined;
    const policy = createPartnerAuthorizationV2({ read: async (actorId, actualRoot) => {
      observed = await source.read(actorId, actualRoot); return observed;
    } }, binding);
    let result = await policy.authorize(action, root);
    const evidence = observed as AuthorizationEvidence<PartnerActionV2> | undefined;
    const isAdmin = Boolean(evidence?.actor.role === 'ADMIN' && !evidence.actor.partnerProfile);
    if (result.ok && isAdmin && !readActions.has(action) && !audit.reason?.trim()) {
      result = { ok: false, error: partnerError('FORBIDDEN') };
    }
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    await appendAuthorizationDecision(tx, { domain: 'PARTNER', actorId: binding.actorId, action,
      rootKind: root.kind, rootId: root.id, purpose: binding.purpose, channel: binding.channel,
      allowed: result.ok, isAdmin, code: result.ok ? 'ALLOWED' : result.error.code,
      scope: result.ok ? result.value.scope : null, reason: audit.reason?.trim() || null, correlationId: audit.correlationId,
      authorizationRevision: evidence?.authorizationRevision ?? null, lifecycleRevision: evidence?.resource?.lifecycleRevision ?? null,
      assignmentId: evidence?.resource?.assignment?.assignmentId ?? null,
      assignmentRevision: evidence?.resource?.assignment?.revision ?? null,
      evaluatedAt: evidence ? new Date(evidence.evaluatedAt) : clock.now,
      evaluatedGrantIds: evidence?.grants.filter(grant => grant.rootKind === root.kind && grant.purpose === binding.purpose)
        .flatMap(grant => grant.provenance ? [grant.provenance.grantId] : []) ?? [],
    });
    return result;
  } };
}

export async function readPartnerAuthorizationAudit(tx: Prisma.TransactionClient, binding: AuthorizationBinding, root: AuthorizationRoot)
  : Promise<Result<Awaited<ReturnType<typeof readAuthorizationDecisions>>>> {
  const policy = createAuditedPartnerAuthorization(tx, binding, { correlationId: randomUUID() });
  const decision = await policy.authorize('AUDIT_READ', root);
  if (!decision.ok) return decision;
  const records = await readAuthorizationDecisions(tx, 'PARTNER', root.kind, root.id);
  const refreshed = await policy.authorize('AUDIT_READ', root);
  return refreshed.ok ? { ok: true, value: records } : refreshed;
}
