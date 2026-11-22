import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { assertPartnerCommercialAvailable, isPartnerCommercialFlow } from '../cases/commercialLifecycle';
import { readPartnerCommercialAccountingCapabilities } from './capabilities';

/** Used by both the preparation document and the registered Accounting document. */
export async function readPartnerCustomerSignature(tx: Prisma.TransactionClient, caseId: string, actorId: string) {
  const root = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, include: { customerContract: true,
    head: { select: { retailEnvelope: true } } } });
  const contract = root?.customerContract;
  if (!contract || !isPartnerCommercialFlow(contract)) return undefined;
  const capabilities = await readPartnerCommercialAccountingCapabilities(tx, actorId);
  let available = !['CANCELLED', 'VOIDED'].includes(root.state);
  try { assertPartnerCommercialAvailable(contract); } catch { available = false; }
  const prepared = (root.head?.retailEnvelope as Prisma.JsonObject | undefined)?.preparationCompleted !== false;
  const write = available && prepared && capabilities.paper && contract.customerAcceptanceRevision !== contract.commercialRevision
    && (await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'ACCOUNTING', channel: 'API' },
      { correlationId: randomUUID(), reason: 'بررسی امکان ثبت امضای کاغذی مشتری قرارداد همکار' })
      .authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId })).ok;
  return { showActions: capabilities.view, contractId: contract.id, revision: contract.commercialRevision, updatedAt: contract.updatedAt.toISOString(), canRecordPaperSignature: write };
}
