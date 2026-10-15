import type { PrismaClient } from '@prisma/client';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { PARTNER_CREATION_TRANSACTION_OPTIONS } from '../creationTransactionBudget';
import { readCurrentPartnerCaseViews } from './lifecycle';

/** The ordinary Sales detail route must verify the same current Case and
 * actor authority as the Partner editor, within its bounded read budget. */
export function readPartnerSalesContractDetail(database: PrismaClient, input: {
  actorId: string;
  correlationId: string;
  contract: { id: string; partnerCaseId: string | null; partnerRevision: number | null; partnerIntegrityHash: string | null };
}) {
  const { contract } = input;
  return database.$transaction(async tx => {
    if (!contract.partnerCaseId || !contract.partnerRevision || !contract.partnerIntegrityHash) return null;
    const current = await readCurrentPartnerCaseViews(tx, contract.partnerCaseId);
    if (!current || current.row.customerContractId !== contract.id ||
        current.row.headRevision !== contract.partnerRevision ||
        current.row.integrityHash !== contract.partnerIntegrityHash) return null;
    const caseRead = await createAuditedPartnerAuthorization(tx, {
      actorId: input.actorId, purpose: 'PARTNER', channel: 'DETAIL',
    }, { correlationId: input.correlationId }).authorize('CASE_READ', { kind: 'CASE', id: contract.partnerCaseId });
    if (caseRead.ok === false) return { ok: false as const, error: caseRead.error };
    const output = await createAuditedPartnerAuthorization(tx, {
      actorId: input.actorId, purpose: 'CUSTOMER_OUTPUT', channel: 'API',
    }, { correlationId: input.correlationId }).authorize('CUSTOMER_OUTPUT', { kind: 'CASE', id: contract.partnerCaseId });
    return { ok: true as const, view: current.partner, output: output.ok };
  }, PARTNER_CREATION_TRANSACTION_OPTIONS);
}
