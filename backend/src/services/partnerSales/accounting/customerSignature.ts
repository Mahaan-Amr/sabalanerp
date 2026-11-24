import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import type { PartnerActionV2 } from '@sabalanerp/partner-sales-contracts';
import type { AuthorizationSource } from '../authorization/contracts';
import type { AuthorizationDecisionAudit } from '../../effectiveAuthorization/audit';
import { assertPartnerCommercialAvailable, isPartnerCommercialFlow } from '../cases/commercialLifecycle';
import { readPartnerCommercialAccountingCapabilities } from './capabilities';
import type { PartnerPermissionReadClient } from '../authorization/fencedPermissionReads';

export const partnerCustomerSignatureContractSelect = {
  partnerKind: true, commercialFlowVersion: true, isInactive: true, status: true, commercialExpiresAt: true,
  firstFinancialRecordAt: true, dispatchExpiryExempt: true, customerAcceptanceRevision: true, commercialRevision: true,
} satisfies Prisma.SalesContractSelect;

type SignatureContract = Prisma.SalesContractGetPayload<{ select: typeof partnerCustomerSignatureContractSelect }>;

/** Used by both the preparation document and the registered Accounting document. */
export async function readPartnerCustomerSignature(tx: Prisma.TransactionClient, caseId: string, actorId: string) {
  const root = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, include: { customerContract: true,
    head: { select: { retailEnvelope: true } } } });
  const contract = root?.customerContract;
  if (!contract) return undefined;
  const availability = await readPartnerPaperSignatureAvailability(tx, caseId, actorId, root.state, contract,
    (root.head?.retailEnvelope as Prisma.JsonObject | undefined)?.preparationCompleted !== false);
  if (!availability) return undefined;
  return { showActions: availability.showActions, contractId: contract.id, revision: contract.commercialRevision,
    updatedAt: contract.updatedAt.toISOString(), canRecordPaperSignature: availability.canRecordPaperSignature };
}

/** The list already owns the fenced Case and has selected these current facts. */
export async function readPartnerPaperSignatureAvailability(tx: Prisma.TransactionClient, caseId: string, actorId: string,
  caseState: string, contract: SignatureContract, prepared: boolean, options?: {
    caseAuthority: AuthorizationSource<PartnerActionV2>;
    permissionClient: PartnerPermissionReadClient;
    recordDecision: (decision: AuthorizationDecisionAudit) => Promise<unknown>;
  }) {
  if (!isPartnerCommercialFlow(contract)) return undefined;
  const capabilities = await readPartnerCommercialAccountingCapabilities(options?.permissionClient ?? tx, actorId);
  let available = !['CANCELLED', 'VOIDED'].includes(caseState);
  try { assertPartnerCommercialAvailable(contract); } catch { available = false; }
  const write = available && prepared && capabilities.paper && contract.customerAcceptanceRevision !== contract.commercialRevision
    && (await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'ACCOUNTING', channel: 'API' },
      { correlationId: randomUUID(), reason: 'بررسی امکان ثبت امضای کاغذی مشتری قرارداد همکار' },
      undefined, undefined, options?.recordDecision, options?.caseAuthority)
      .authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId })).ok;
  return { showActions: capabilities.view, canRecordPaperSignature: write };
}
