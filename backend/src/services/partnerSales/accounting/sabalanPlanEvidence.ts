import { Prisma } from '@prisma/client';
import { PaymentPlanSchema, canonicalHash, type RevisionRef } from '@sabalanerp/partner-sales-contracts';

export class PartnerSabalanPlanIntegrityError extends Error {}

const planEvidenceSelect = {
  id: true, caseId: true, caseRevision: true, purpose: true, version: true,
  predecessorId: true, effectiveDate: true, evidence: true, integrityHash: true,
  predecessor: { select: { id: true, caseId: true, purpose: true, version: true } },
  installments: { orderBy: { id: 'asc' }, select: { id: true, dueDate: true,
    amount: true, currency: true, method: true, evidence: true } },
} satisfies Prisma.PartnerPaymentPlanSelect;

type PersistedPlan = Prisma.PartnerPaymentPlanGetPayload<{ select: typeof planEvidenceSelect }>;
type PaymentPlan = ReturnType<typeof PaymentPlanSchema.parse>;

async function verifyPersistedPlan(row: PersistedPlan, caseId: string): Promise<PaymentPlan> {
  const parsed = PaymentPlanSchema.safeParse(row.evidence);
  if (!parsed.success || row.caseId !== caseId || row.purpose !== 'SABALAN' ||
      row.caseRevision < 1 || parsed.data.planId !== row.id || parsed.data.version !== row.version ||
      (parsed.data.predecessorPlanId ?? null) !== row.predecessorId ||
      (row.version === 1 ? row.predecessor !== null : row.predecessor?.id !== row.predecessorId ||
        row.predecessor.caseId !== caseId || row.predecessor.purpose !== 'SABALAN' ||
        row.predecessor.version !== row.version - 1) ||
      parsed.data.effectiveDate !== row.effectiveDate.toISOString().slice(0, 10) ||
      parsed.data.installments.length !== row.installments.length ||
      await canonicalHash({ purpose: 'PARTNER_SABALAN_PAYMENT_PLAN', schemaVersion: 1,
        caseId: row.caseId, revision: row.caseRevision, plan: parsed.data }) !== row.integrityHash) {
    throw new PartnerSabalanPlanIntegrityError('Invalid Partner Sabalan payment plan evidence');
  }
  const persisted = new Map(row.installments.map(item => [item.id, item]));
  for (const item of parsed.data.installments) {
    const installment = persisted.get(item.installmentId);
    if (!installment || installment.dueDate.toISOString().slice(0, 10) !== item.dueDate ||
        installment.amount.toString() !== item.amount.amount || installment.currency !== item.amount.currency ||
        installment.method !== item.method || await canonicalHash(installment.evidence) !== await canonicalHash(item)) {
      throw new PartnerSabalanPlanIntegrityError('Invalid Partner Sabalan installment evidence');
    }
  }
  return parsed.data;
}

export async function resolveCurrentSabalanPlan(tx: Prisma.TransactionClient, caseId: string, fallback: PaymentPlan) {
  const latest = await tx.partnerPaymentPlan.findFirst({ where: { caseId, purpose: 'SABALAN' },
    orderBy: [{ version: 'desc' }, { id: 'desc' }], select: planEvidenceSelect });
  return latest ? verifyPersistedPlan(latest, caseId) : fallback;
}

/** The caller must verify the immutable Case revision and compare the complete
 * rebuilt financial preparation afterwards. Invoice snapshots select a plan;
 * they never supply authoritative terms. Accounting can persist a new plan
 * independently of the Case revision that originally embedded its terms. */
export async function resolveInvoiceSabalanPlan(tx: Prisma.TransactionClient, owner: RevisionRef,
  revisionPlan: PaymentPlan, invoicePlan: unknown): Promise<PaymentPlan> {
  const requested = PaymentPlanSchema.safeParse(invoicePlan);
  if (!requested.success) throw new PartnerSabalanPlanIntegrityError('Invalid Partner invoice payment plan');
  if (requested.data.planId === revisionPlan.planId && requested.data.version === revisionPlan.version) {
    return revisionPlan;
  }
  const persisted = await tx.partnerPaymentPlan.findUnique({ where: { id: requested.data.planId }, select: planEvidenceSelect });
  if (!persisted || persisted.caseRevision > owner.revision) {
    throw new PartnerSabalanPlanIntegrityError('Missing or future Partner invoice payment plan');
  }
  const verified = await verifyPersistedPlan(persisted, owner.caseId);
  if (verified.version !== requested.data.version) {
    throw new PartnerSabalanPlanIntegrityError('Invalid Partner invoice payment plan version');
  }
  return verified;
}
