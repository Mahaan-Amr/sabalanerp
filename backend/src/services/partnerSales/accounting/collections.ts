import { Prisma } from '@prisma/client';
import { InstantSchema, SignedDecimalSchema } from '@sabalanerp/partner-sales-contracts';
import { subtract, sum } from '../reporting/money';
import type { PartnerFinancialPreparation } from './source';
import { assertPartnerAccountingWitnesses } from './receivableEvidence';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export class PartnerCollectionIntegrityError extends Error {}

/** Read Accounting's dated collection ledger, never infer cash from cheque/status labels.
 * Missing historical evidence is an explicit coverage gap, not a zero balance.
 */
export async function readPartnerCollections(tx: Prisma.TransactionClient, input: {
  receivableId: string; currency: string; cutoff: Date; asOf: Date; preparation: PartnerFinancialPreparation;
}): Promise<string | null> {
  const payments = await tx.accountingPaymentStatus.findMany({ where: {
    receivableId: input.receivableId, createdAt: { lte: input.asOf } } });
  const amounts: string[] = [];
  for (const payment of payments) {
    if (payment.contractId || payment.currency !== input.currency) throw new PartnerCollectionIntegrityError('Partner collection currency/owner integrity conflict');
    assertPartnerAccountingWitnesses(payment.metadata, input.preparation);
    const movements = object(payment.metadata)?.collectionMovements;
    if (!Array.isArray(movements)) return null;
    let current = '0';
    for (const raw of movements) {
      const movement = object(raw);
      if (!movement || !InstantSchema.safeParse(movement.effectiveAt).success ||
          !SignedDecimalSchema.safeParse(movement.amount).success) throw new PartnerCollectionIntegrityError('Partner collection evidence integrity conflict');
      if (movement.confidence === 'legacy-fallback') return null;
      if (movement.confidence !== undefined && movement.confidence !== 'authoritative') return null;
      const positive = payment.method === 'CHECK' ? movement.kind === 'CHECK_CLEARED' : movement.kind === 'RECEIVED';
      const negative = movement.kind === 'REVERSED' || (payment.method === 'CHECK' &&
        ['CHECK_BOUNCED', 'CHECK_RETURNED'].includes(String(movement.kind)));
      const amount = sum([String(movement.amount)]);
      if ((!positive && !negative) || amount === '0' || positive === amount.startsWith('-')) {
        throw new PartnerCollectionIntegrityError('Partner collection movement integrity conflict');
      }
      // V1 writers omit a per-movement recordedAt; the repeatable-read snapshot
      // is its knowledge boundary. A supplied V2 instant must be valid and visible.
      if (movement.recordedAt !== undefined && (!InstantSchema.safeParse(movement.recordedAt).success ||
          Date.parse(String(movement.recordedAt)) > input.asOf.getTime())) return null;
      current = sum([current, amount]);
      const excess = subtract(current, payment.amount.toString());
      if (current.startsWith('-') || (excess !== '0' && !excess.startsWith('-'))) {
        throw new PartnerCollectionIntegrityError('Partner collection balance integrity conflict');
      }
      if (Date.parse(String(movement.effectiveAt)) <= input.cutoff.getTime()) amounts.push(amount);
    }
    // A mutable status contradicting its dated ledger cannot be silently repaired.
    if (payment.status === 'REVERSED' && current !== '0') return null;
    if (payment.method === 'CHECK' &&
        ((payment.checkStatus === 'CLEARED' && subtract(current, payment.amount.toString()) !== '0') ||
         (['BOUNCED', 'RETURNED', 'REPLACED', 'RECEIVED', 'DEPOSITED'].includes(String(payment.checkStatus)) && current !== '0'))) return null;
    if (payment.method !== 'CHECK' && ['RECEIVED', 'RECONCILED'].includes(payment.status) &&
        subtract(current, payment.amount.toString()) !== '0') return null;
  }
  const received = sum(amounts);
  if (received.startsWith('-')) throw new PartnerCollectionIntegrityError('Partner historical collection balance integrity conflict');
  return received;
}
