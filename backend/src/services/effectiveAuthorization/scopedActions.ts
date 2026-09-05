import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export interface ScopedActionGrant {
  principal: { kind: 'USER' | 'ROLE'; id: string };
  domain: string; action: string; rootKind: string; purpose: string;
  scope: 'OWN' | 'ASSIGNED' | 'DEPARTMENT' | 'COMPANY' | 'PURPOSE_BOUND';
  effect: 'ALLOW' | 'DENY'; boundRootId?: string;
  effectiveFrom?: Date; expiresAt?: Date;
}
export interface AuthorityMutation { actorId: string; reason: string; correlationId: string }
interface GrantRow {
  id: string; principalKind: 'USER' | 'ROLE'; principalId: string; domain: string;
  action: string; rootKind: string; purpose: string; scope: ScopedActionGrant['scope'];
  effect: 'ALLOW' | 'DENY'; boundRootId: string | null; expiresAt: Date | null;
}

/** Call only inside the owning command transaction. User locks precede the
 * singleton authority lock. The latter protects missing grants and role grants
 * too, and is held through command commit, never cached across transactions. */
export async function resolveScopedActions(tx: Prisma.TransactionClient, actorId: string, domain: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
  const [version] = await tx.$queryRaw<Array<{ revision: number }>>`
    SELECT revision FROM effective_authorization_state WHERE id = 1 FOR UPDATE`;
  return scopedActionSnapshot(tx, actorId, domain, version);
}

/** Advisory/read-model visibility only. It never authorizes a mutation and so
 * must not join the command lock graph. The returned revision lets callers
 * identify the snapshot they displayed. */
export async function readScopedActions(tx: Prisma.TransactionClient, actorId: string, domain: string) {
  const [version] = await tx.$queryRaw<Array<{ revision: number }>>`
    SELECT revision FROM effective_authorization_state WHERE id = 1`;
  return scopedActionSnapshot(tx, actorId, domain, version);
}

async function scopedActionSnapshot(tx: Prisma.TransactionClient, actorId: string, domain: string,
  version: { revision: number } | undefined) {
  if (!version) throw new Error('Scoped authority state unavailable');
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  const rows = !actor?.isActive ? [] : await tx.$queryRaw<GrantRow[]>`
    SELECT id, "principalKind", "principalId", domain, action, "rootKind", purpose, scope, effect, "boundRootId", "expiresAt"
    FROM effective_action_grants WHERE domain = ${domain} AND "revokedAt" IS NULL
      AND "effectiveFrom" <= clock_timestamp() AND ("expiresAt" IS NULL OR "expiresAt" > clock_timestamp())
      AND (("principalKind" = 'USER' AND "principalId" = ${actorId})
        OR ("principalKind" = 'ROLE' AND "principalId" = ${actor.role})) ORDER BY id`;
  const direct = new Set(rows.filter(row => row.principalKind === 'USER').map(key));
  const selected = rows.filter(row => row.principalKind === 'USER' || !direct.has(key(row)));
  const denied = new Set(selected.filter(row => row.effect === 'DENY').map(key));
  return { authorizationRevision: version.revision, grants: selected.filter(row => row.effect === 'ALLOW' && !denied.has(key(row)))
    .map(row => ({ action: row.action, rootKind: row.rootKind, purpose: row.purpose, scope: row.scope,
      ...(row.boundRootId ? { boundRootId: row.boundRootId } : {}),
      ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
      provenance: { source: row.principalKind === 'USER' ? 'DIRECT_ACTION' as const : 'ROLE_ACTION' as const,
        grantId: row.id, version: 1 as const } })) };
}
function key(row: Pick<GrantRow, 'action' | 'rootKind' | 'purpose'>) { return JSON.stringify([row.action, row.rootKind, row.purpose]); }

/** Trusted central provisioning seam, not an HTTP endpoint. New explicit grants
 * require an active non-Partner system administrator; no legacy conversion. */
export async function grantScopedAction(tx: Prisma.TransactionClient, authority: AuthorityMutation, grant: ScopedActionGrant) {
  if (![grant.domain, grant.action, grant.rootKind, grant.purpose].every(value => /^[A-Z][A-Z0-9_]{0,79}$/.test(value)) ||
      !['USER', 'ROLE'].includes(grant.principal.kind) || !grant.principal.id.trim() || grant.principal.id.length > 200 ||
      !['OWN', 'ASSIGNED', 'DEPARTMENT', 'COMPANY', 'PURPOSE_BOUND'].includes(grant.scope) || !['ALLOW', 'DENY'].includes(grant.effect) ||
      (grant.scope === 'PURPOSE_BOUND' ? !grant.boundRootId?.trim() : grant.boundRootId !== undefined) ||
      (grant.effectiveFrom && !Number.isFinite(grant.effectiveFrom.getTime())) || (grant.expiresAt && !Number.isFinite(grant.expiresAt.getTime()))) {
    throw new Error('Invalid scoped grant');
  }
  await mutationAuthority(tx, authority, grant.principal.kind === 'USER' ? grant.principal.id : undefined);
  if (grant.principal.kind === 'ROLE') {
    const roles = await tx.$queryRaw<Array<{ role: string }>>`SELECT unnest(enum_range(NULL::"UserRole"))::text AS role`;
    if (!roles.some(row => row.role === grant.principal.id)) throw new Error('Invalid grant role');
  }
  const id = randomUUID();
  await tx.$executeRaw`INSERT INTO effective_action_grants
    (id, "principalKind", "principalId", "subjectUserId", domain, action, "rootKind", purpose, scope, effect,
      "boundRootId", "effectiveFrom", "expiresAt", "grantedBy", reason, "correlationId")
    VALUES (${id}, ${grant.principal.kind}, ${grant.principal.id}, ${grant.principal.kind === 'USER' ? grant.principal.id : null},
      ${grant.domain}, ${grant.action}, ${grant.rootKind}, ${grant.purpose}, ${grant.scope}, ${grant.effect}, ${grant.boundRootId ?? null},
      COALESCE(${grant.effectiveFrom ?? null}::timestamp, clock_timestamp()), ${grant.expiresAt ?? null},
      ${authority.actorId}, ${authority.reason.trim()}, ${authority.correlationId})`;
  return { id };
}
async function mutationAuthority(tx: Prisma.TransactionClient, authority: AuthorityMutation, subject?: string) {
  if (!authority.reason.trim() || authority.reason.length > 2000 || !authority.correlationId.trim() || authority.correlationId.length > 200) {
    throw new Error('Reason and correlation required');
  }
  for (const id of [...new Set([authority.actorId, ...(subject ? [subject] : [])])].sort()) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
  }
  const actor = await tx.user.findUnique({ where: { id: authority.actorId }, select: { role: true, isActive: true, partnerProfile: { select: { id: true } } } });
  if (!actor?.isActive || actor.role !== 'ADMIN' || actor.partnerProfile) throw new Error('Scoped authority mutation forbidden');
  await tx.$queryRaw`SELECT revision FROM effective_authorization_state WHERE id = 1 FOR UPDATE`;
}

export async function revokeScopedAction(tx: Prisma.TransactionClient, authority: AuthorityMutation, grantId: string) {
  // Immutable identity may be read without a lock to retain User -> authority ->
  // grant ordering. The guarded update never erases or replaces original facts.
  const [grant] = await tx.$queryRaw<Array<{ subjectUserId: string | null }>>`
    SELECT "subjectUserId" FROM effective_action_grants WHERE id = ${grantId}`;
  await mutationAuthority(tx, authority, grant?.subjectUserId ?? undefined);
  if (!grant) return { found: false, changed: false };
  const changed = await tx.$executeRaw`UPDATE effective_action_grants SET "revokedAt" = clock_timestamp(),
    "revokedBy" = ${authority.actorId}, "revocationReason" = ${authority.reason.trim()},
    "revocationCorrelationId" = ${authority.correlationId} WHERE id = ${grantId} AND "revokedAt" IS NULL`;
  return { found: true, changed: changed === 1 };
}
