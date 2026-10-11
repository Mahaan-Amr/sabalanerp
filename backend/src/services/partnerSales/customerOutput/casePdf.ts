import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import * as contracts from '@sabalanerp/partner-sales-contracts';
import { readCurrentPartnerCaseViews } from '../cases/lifecycle';
import { createCustomerOutputSnapshots } from './snapshots';
import { CustomerOutputError } from './contracts';

const snapshots = createCustomerOutputSnapshots(contracts);

/** PDF availability depends on authorized frozen Case content, not an SMS session. */
export function casePdfAvailability(input: { authorized: boolean; state: string; hasContent: boolean; hasSnapshot: boolean; commercialFlow?: boolean }) {
  return { canPreview: input.authorized && (input.hasSnapshot || ((input.state === 'COMMITTED' || input.commercialFlow === true) && input.hasContent)),
    canIssue: input.authorized && (input.state === 'COMMITTED' || input.commercialFlow === true) && input.hasContent };
}

/** Caller owns the Case lock and has authorized CUSTOMER_OUTPUT. Never changes
 * the Case revision, agreement, confirmation sessions, or commercial commitment. */
export async function resolveCasePdfSnapshot(tx: Prisma.TransactionClient, caseId: string, expected: contracts.RevisionRef, mode: 'PREVIEW' | 'FINAL') {
  const current = await readCurrentPartnerCaseViews(tx, caseId);
  if (!current) throw new CustomerOutputError('INTEGRITY_CONFLICT');
  if (contracts.checkExpectedRevision(expected, current.partner.owner)) throw new CustomerOutputError('ROW_STALE');
  if (current.row.state !== 'COMMITTED' && current.row.commercialFlowVersion !== 1) throw new CustomerOutputError('STATE_CONFLICT');
  const frozen = contracts.CustomerContractOutputSchema.parse(current.row.head.customerProjection);
  const confirmation = await readCasePdfConfirmation(tx, caseId, expected.revision);
  const content = await casePdfContent(frozen, 'PREVIEW', confirmation);
  const digits = content.customer.phone.replace(/\D/g, '');
  const recipient = digits.startsWith('0098') ? `+${digits.slice(2)}` : digits.startsWith('98') ? `+${digits}`
    : digits.startsWith('0') ? `+98${digits.slice(1)}` : `+98${digits}`;
  const purpose = mode === 'FINAL' ? 'PDF_FINAL' as const : 'PDF_PREVIEW' as const;
  const existing = await tx.partnerCustomerOutputSnapshot.findUnique({ where: {
    caseId_caseRevision_recipient_purpose: { caseId, caseRevision: expected.revision, recipient, purpose },
  } });
  if (existing) {
    const sealed = await snapshots.read(existing.content);
    if (contracts.checkExpectedRevision(sealed.owner, expected) || existing.contentHash !== sealed.content.outputHash ||
        existing.integrityHash !== expected.integrityHash || existing.caseRevision !== expected.revision ||
        existing.contractNumber !== sealed.content.contractNumber || sealed.normalizedRecipient !== recipient)
      throw new CustomerOutputError('INTEGRITY_CONFLICT');
    return mode === 'PREVIEW' ? { ...sealed, content: await casePdfContent(sealed.content, mode, confirmation) } : sealed;
  }
  const { seller, outputHash: _outputHash, ...retail } = content;
  const now = new Date();
  const minted = await snapshots.mint({ snapshotId: randomUUID(), owner: expected, normalizedRecipient: recipient,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60 * 86_400_000).toISOString(),
    business: { legalName: seller.displayName, businessPhone: seller.phone, businessAddress: seller.address }, retail });
  const sealed = { ...minted, content: await casePdfContent(minted.content, mode) };
  await tx.partnerCustomerOutputSnapshot.create({ data: { id: sealed.snapshotId, caseId,
    caseRevision: expected.revision, integrityHash: expected.integrityHash, contentHash: sealed.content.outputHash,
    contractNumber: sealed.content.contractNumber, recipient, purpose, expiresAt: new Date(sealed.expiresAt),
    commandId: randomUUID(), content: JSON.parse(JSON.stringify(sealed)) as Prisma.InputJsonValue } });
  return sealed;
}

/** Final printing is independent of customer OTP. Never invent a signature. */
export async function casePdfContent(content: contracts.CustomerContractOutput, mode: 'PREVIEW' | 'FINAL' | 'DOWNLOAD_EXISTING', confirmation?: contracts.CustomerContractOutput['confirmation']) {
  if (mode === 'PREVIEW' && confirmation === undefined) return content;
  const { outputHash: _outputHash, ...evidence } = content;
  const status = mode === 'PREVIEW' ? (confirmation === 'VERIFIED' ? 'APPROVED' as const : content.status)
    : content.status === 'SIGNED' ? 'SIGNED' as const : 'PRINTED' as const;
  const final = { ...evidence, status, ...(confirmation !== undefined ? { confirmation } : {}) };
  return snapshots.content({ ...final, outputHash: await contracts.canonicalHash(final) });
}

/** Resolve only current revision evidence. Archived snapshot bytes remain immutable. */
export async function readCasePdfConfirmation(tx: Prisma.TransactionClient, caseId: string, revision: number): Promise<contracts.CustomerContractOutput['confirmation']> {
  const root = await tx.partnerSaleCase.findUnique({ where: { id: caseId },
    select: { headRevision: true, commercialFlowVersion: true, customerConfirmationState: true, state: true, customerContractId: true } });
  if (!root || root.headRevision !== revision || ['CANCELLED', 'VOIDED'].includes(root.state)) return 'INVALIDATED';
  if (root.commercialFlowVersion === 1) {
    const sale = root.customerContractId ? await tx.salesContract.findUnique({ where: { id: root.customerContractId },
      select: { commercialRevision: true, customerAcceptanceRevision: true, customerAcceptanceMethod: true } }) : null;
    if (sale && sale.customerAcceptanceRevision === sale.commercialRevision && sale.customerAcceptanceMethod === 'DIGITAL') return 'VERIFIED';
    const pending = sale && await tx.contractPublicConfirmation.findFirst({ where: { contractId: root.customerContractId!,
      commercialRevision: sale.commercialRevision, status: 'PENDING', cancelledAt: null }, select: { id: true } });
    return pending ? 'PENDING' : 'NOT_SENT';
  }
  return root.customerConfirmationState === 'APPROVED' ? 'VERIFIED'
    : root.customerConfirmationState === 'SENT' ? 'PENDING' : 'NOT_SENT';
}
