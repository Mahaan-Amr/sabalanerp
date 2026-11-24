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
type CurrentPlanEvidence = {
  byCase: Map<string, PersistedPlan>;
  verifiedById: Map<string, Promise<PaymentPlan>>;
};

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

function verifySelectedPlan(row: PersistedPlan, caseId: string, currentEvidence?: CurrentPlanEvidence) {
  if (!currentEvidence || row.caseId !== caseId) return verifyPersistedPlan(row, caseId);
  const known = currentEvidence.verifiedById.get(row.id);
  if (known) return known;
  const verified = verifyPersistedPlan(row, caseId);
  currentEvidence.verifiedById.set(row.id, verified);
  return verified;
}

/** Read the latest persisted terms for each authorized Case in this snapshot.
 * Only the selected versions need their predecessor and installment evidence. */
export async function readCurrentSabalanPlanEvidence(tx: Prisma.TransactionClient, caseIds: string[]): Promise<CurrentPlanEvidence> {
  const byCase = new Map<string, PersistedPlan>();
  const snapshot = { byCase, verifiedById: new Map<string, Promise<PaymentPlan>>() };
  if (!caseIds.length) return snapshot;
  const latest = await tx.$queryRaw<Array<{ id: string }>>`SELECT DISTINCT ON ("caseId") id
    FROM partner_payment_plans WHERE "caseId" = ANY(${caseIds}::text[]) AND purpose = 'SABALAN'
    ORDER BY "caseId", version DESC, id DESC`;
  if (latest.length) {
    const plans = await tx.partnerPaymentPlan.findMany({ where: { id: { in: latest.map(row => row.id) } }, select: planEvidenceSelect });
    if (plans.length !== latest.length) throw new PartnerSabalanPlanIntegrityError('Missing current Partner Sabalan plan');
    for (const plan of plans) byCase.set(plan.caseId, plan);
  }
  return snapshot;
}

export async function resolveCurrentSabalanPlan(tx: Prisma.TransactionClient, caseId: string, fallback: PaymentPlan,
  currentEvidence?: CurrentPlanEvidence) {
  const latest = currentEvidence ? currentEvidence.byCase.get(caseId) : await tx.partnerPaymentPlan.findFirst({ where: { caseId, purpose: 'SABALAN' },
    orderBy: [{ version: 'desc' }, { id: 'desc' }], select: planEvidenceSelect });
  return latest ? verifySelectedPlan(latest, caseId, currentEvidence) : fallback;
}

/** The caller must verify the immutable Case revision and compare the complete
 * rebuilt financial preparation afterwards. Invoice snapshots select a plan;
 * they never supply authoritative terms. Accounting can persist a new plan
 * independently of the Case revision that originally embedded its terms. */
export async function resolveInvoiceSabalanPlan(tx: Prisma.TransactionClient, owner: RevisionRef,
  revisionPlan: PaymentPlan, invoicePlan: unknown, currentEvidence?: CurrentPlanEvidence): Promise<PaymentPlan> {
  const requested = PaymentPlanSchema.safeParse(invoicePlan);
  if (!requested.success) throw new PartnerSabalanPlanIntegrityError('Invalid Partner invoice payment plan');
  if (requested.data.planId === revisionPlan.planId && requested.data.version === revisionPlan.version) {
    return revisionPlan;
  }
  const current = currentEvidence?.byCase.get(owner.caseId);
  const persisted = current?.id === requested.data.planId ? current
    : await tx.partnerPaymentPlan.findUnique({ where: { id: requested.data.planId }, select: planEvidenceSelect });
  if (!persisted || persisted.caseRevision > owner.revision) {
    throw new PartnerSabalanPlanIntegrityError('Missing or future Partner invoice payment plan');
  }
  const verified = await verifySelectedPlan(persisted, owner.caseId, currentEvidence);
  if (verified.version !== requested.data.version) {
    throw new PartnerSabalanPlanIntegrityError('Invalid Partner invoice payment plan version');
  }
  return verified;
}
