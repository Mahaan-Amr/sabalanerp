import { Prisma, type PrismaClient, type ProjectReturnAllocationDraft } from '@prisma/client';
import type { StoneReturnCandidate } from './stoneReturnCandidates';
import type { FinancialProjectReturnCandidate } from './projectReturnFinancialCandidates';
import type { StoneReturnAllocationInput } from './stoneReturnAllocationRules';

type Tx = Prisma.TransactionClient;
type PhysicalDraftRow = StoneReturnAllocationInput & Pick<StoneReturnCandidate,
  'originalInvoiceNumber' | 'contractId' | 'contractNumber' | 'contractItemId' | 'productRowId' | 'originalTaxInvoiceId' | 'originalTaxLineId' | 'projectId'>;
export type ProjectReturnDraftRow = PhysicalDraftRow | Pick<FinancialProjectReturnCandidate,
  'financialRecordId' | 'financialLineId' | 'financialParty' | 'originalInvoiceNumber' | 'contractId' | 'contractNumber'
  | 'contractItemId' | 'productRowId' | 'projectId' | 'partnerCaseId' | 'dispatchEvidenceId'> & { quantity: string };
export type ProjectReturnRateBasis = 'RECEIPT_UNIT' | 'HEALTHY_SQUARE_METER';
type DraftItem = {
  itemId: string;
  agreedUnitRateRials: string | null;
  agreedRateBasis?: ProjectReturnRateBasis | null;
  rows: ProjectReturnDraftRow[];
};
type Draft = Omit<ProjectReturnAllocationDraft, 'items'> & { items: DraftItem[] };

export async function lockProjectReturnCase(tx: Tx, caseId: string) {
  // Logistics and Accounting acquire this before reading or changing the active version and its dependencies.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`PROJECT_RETURN_CASE:${caseId}`}))`;
}

export function presentDraft(draft: ProjectReturnAllocationDraft): Draft {
  const { items, ...metadata } = draft;
  return { ...metadata, items: items as unknown as DraftItem[] };
}

export async function readLatestProjectReturnAllocationDraft(tx: Tx, versionId: string) {
  const draft = await tx.projectReturnAllocationDraft.findFirst({ where: { versionId }, orderBy: { number: 'desc' } });
  return draft ? presentDraft(draft) : null;
}

export const projectReturnDraftHasAllocations = (draft: Pick<Draft, 'items'> | null) =>
  draft?.items.some(item => item.rows.length > 0) ?? false;

export async function withProjectReturnCaseTransaction<T>(db: PrismaClient, operation: (tx: Tx) => Promise<T>,
  isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel.Serializable,
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(operation, { isolationLevel, timeout: 30_000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)
        || (!['P2002', 'P2034'].includes(error.code) && !(error.code === 'P2010' && error.meta?.code === '40001'))) throw error;
      if (attempt === 3) return null;
    }
  }
  return null;
}
