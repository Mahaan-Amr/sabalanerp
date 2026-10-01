import { Prisma } from '@prisma/client';

type AuditHeader = { id: string; entityId: string | null; entityType: string | null;
  action: string; createdAt: Date };

/** The caller selects these headers through its authorized snapshot. The chart
 * only replays checkStatus from JSON; invoice and receipt events use timestamps. */
export async function attachAccountingTrendAuditState<T extends AuditHeader>(
  database: Pick<Prisma.TransactionClient, '$queryRaw'>, headers: T[],
): Promise<Array<T & { afterState: Prisma.JsonValue | null }>> {
  const checks = headers.filter(row => row.entityType === 'AccountingPaymentStatus' && row.action === 'UPDATE_CHECK_STATUS');
  const states = checks.length ? await database.$queryRaw<Array<{ id: string; afterState: Prisma.JsonValue }>>(Prisma.sql`
    SELECT id, jsonb_build_object('checkStatus', CASE
      WHEN jsonb_typeof("afterState"->'checkStatus') = 'string' THEN "afterState"->'checkStatus'
      ELSE 'null'::jsonb END) AS "afterState"
    FROM accounting_audit_logs WHERE id IN (${Prisma.join(checks.map(row => row.id))})
  `) : [];
  const byId = new Map(states.map(row => [row.id, row.afterState]));
  return headers.map(row => ({ ...row, afterState: byId.get(row.id) ?? null }));
}

/** Reject private audit owners using relational headers before decoding their
 * historical bodies. Authorized witnesses still receive complete validation. */
export async function readAuthorizedPartnerAuditWitnesses(
  database: Pick<Prisma.TransactionClient, 'accountingAuditLog'>,
  markedIds: string[], invoiceByEntity: ReadonlyMap<string, string>,
) {
  const headers = markedIds.length ? await database.accountingAuditLog.findMany({
    where: { id: { in: markedIds } },
    select: { id: true, recordId: true, entityId: true, contractId: true },
  }) : [];
  const rejectedIds: string[] = [];
  const ownerByAudit = new Map<string, string>();
  for (const row of headers) {
    const owners = [row.recordId, row.entityId].filter((id): id is string => Boolean(id))
      .map(id => invoiceByEntity.get(id));
    const invoiceId = owners[0];
    if (!invoiceId || owners.some(owner => owner !== invoiceId) || row.contractId) rejectedIds.push(row.id);
    else ownerByAudit.set(row.id, invoiceId);
  }
  const witnesses = ownerByAudit.size ? await database.accountingAuditLog.findMany({
    where: { id: { in: [...ownerByAudit.keys()] } },
    select: { id: true, beforeState: true, afterState: true },
  }) : [];
  return { rejectedIds, witnesses: witnesses.map(row => ({ ...row, invoiceId: ownerByAudit.get(row.id)! })) };
}
