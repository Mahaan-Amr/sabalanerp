import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

/** Internal evidence only. No business payloads, credentials, pricing, or raw
 * exception text. Call in the same transaction as a successful command. */
export interface AuthorizationDecisionAudit {
  domain: string; actorId: string; action: string; rootKind: string; rootId: string;
  purpose: string; channel: string; allowed: boolean; isAdmin: boolean;
  code: string; scope: string | null; reason: string | null; correlationId: string;
  authorizationRevision: number | null; lifecycleRevision: number | null;
  assignmentId: string | null; assignmentRevision: number | null;
  evaluatedAt: Date; evaluatedGrantIds: string[];
}
export async function appendAuthorizationDecision(tx: Prisma.TransactionClient, event: AuthorizationDecisionAudit) {
  const id = randomUUID();
  await tx.$executeRaw`INSERT INTO effective_authorization_audit
    (id, domain, "actorId", action, "rootKind", "rootId", purpose, channel, allowed, "isAdmin", code, scope, reason,
      "correlationId", "authorizationRevision", "lifecycleRevision", "assignmentId", "assignmentRevision", "evaluatedAt", "evaluatedGrantIds")
    VALUES (${id}, ${event.domain}, ${event.actorId}, ${event.action}, ${event.rootKind}, ${event.rootId}, ${event.purpose},
      ${event.channel}, ${event.allowed}, ${event.isAdmin}, ${event.code}, ${event.scope}, ${event.reason}, ${event.correlationId},
      ${event.authorizationRevision}, ${event.lifecycleRevision}, ${event.assignmentId}, ${event.assignmentRevision},
      ${event.evaluatedAt}, ${JSON.stringify(event.evaluatedGrantIds)}::jsonb)`;
  return { id };
}

/** Caller must authorize AUDIT_READ on this exact root in this transaction.
 * Kept out of the public central entry point; the scoped domain reader owns it. */
export async function readAuthorizationDecisions(tx: Prisma.TransactionClient, domain: string, rootKind: string, rootId: string) {
  return tx.$queryRaw<Array<AuthorizationDecisionAudit & { id: string }>>`
    SELECT id, domain, "actorId", action, "rootKind", "rootId", purpose, channel, allowed, "isAdmin", code, scope, reason,
      "correlationId", "authorizationRevision", "lifecycleRevision", "assignmentId", "assignmentRevision", "evaluatedAt", "evaluatedGrantIds"
    FROM effective_authorization_audit WHERE domain = ${domain} AND "rootKind" = ${rootKind} AND "rootId" = ${rootId}
    ORDER BY "recordedAt", id LIMIT 100`;
}

/** Resolve the evidence created for one authorization attempt without relying
 * on the bounded chronological audit listing. Correlation is transport-scoped;
 * the remaining fields make the lookup exact and non-ambiguous. */
export async function readAuthorizationDecisionByCorrelation(tx: Prisma.TransactionClient, input: {
  domain: string; actorId: string; action: string; rootKind: string; rootId: string;
  purpose: string; channel: string; correlationId: string; allowed: boolean;
}) {
  const rows = await tx.$queryRaw<Array<AuthorizationDecisionAudit & { id: string }>>`
    SELECT id, domain, "actorId", action, "rootKind", "rootId", purpose, channel, allowed, "isAdmin", code, scope, reason,
      "correlationId", "authorizationRevision", "lifecycleRevision", "assignmentId", "assignmentRevision", "evaluatedAt", "evaluatedGrantIds"
    FROM effective_authorization_audit
    WHERE domain = ${input.domain} AND "actorId" = ${input.actorId} AND action = ${input.action}
      AND "rootKind" = ${input.rootKind} AND "rootId" = ${input.rootId} AND purpose = ${input.purpose}
      AND channel = ${input.channel} AND "correlationId" = ${input.correlationId} AND allowed = ${input.allowed}
    ORDER BY "recordedAt" DESC, id DESC LIMIT 1`;
  return rows[0] ?? null;
}

export async function readAuthorizationDecisionById(tx: Prisma.TransactionClient, input: {
  id: string; domain: string; actorId: string; action: string; rootKind: string; rootId: string;
  purpose: string; channel: string; allowed: boolean;
}) {
  const rows = await tx.$queryRaw<Array<AuthorizationDecisionAudit & { id: string }>>`
    SELECT id, domain, "actorId", action, "rootKind", "rootId", purpose, channel, allowed, "isAdmin", code, scope, reason,
      "correlationId", "authorizationRevision", "lifecycleRevision", "assignmentId", "assignmentRevision", "evaluatedAt", "evaluatedGrantIds"
    FROM effective_authorization_audit
    WHERE id = ${input.id} AND domain = ${input.domain} AND "actorId" = ${input.actorId}
      AND action = ${input.action} AND "rootKind" = ${input.rootKind} AND "rootId" = ${input.rootId}
      AND purpose = ${input.purpose} AND channel = ${input.channel} AND allowed = ${input.allowed}
    LIMIT 1`;
  return rows[0] ?? null;
}
