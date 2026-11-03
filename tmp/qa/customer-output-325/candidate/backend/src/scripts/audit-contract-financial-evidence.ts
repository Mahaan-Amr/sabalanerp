import { PrismaClient } from '@prisma/client';
import { buildApprovedPricingVersion } from '../services/approvedPricing/domain';
import { PrismaApprovedPricingRepository } from '../services/approvedPricing/prismaRepository';

const databaseUrl = process.env.AUDIT_DATABASE_URL;
if (!databaseUrl) throw new Error('AUDIT_DATABASE_URL is required');

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const eligibleStatuses = new Set(['APPROVED', 'SIGNED', 'PRINTED']);

const run = async () => {
  const contracts = await prisma.salesContract.findMany({
    select: {
      id: true,
      contractNumber: true,
      status: true,
      isInactive: true,
      items: { select: { id: true, productRowId: true, productType: true, quantity: true } },
      productGraphState: { select: { schemaVersion: true, revision: true, policySnapshot: true } },
    },
    orderBy: { contractNumber: 'asc' },
  });
  const financialRecords = await prisma.accountingFinancialRecord.findMany({
    where: { kind: 'INVOICE_CANDIDATE', contractId: { not: null } },
    select: { id: true, contractId: true, status: true, financiallyApprovedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const recordsByContract = new Map<string, typeof financialRecords>();
  for (const record of financialRecords) {
    if (!record.contractId) continue;
    recordsByContract.set(record.contractId, [...(recordsByContract.get(record.contractId) || []), record]);
  }
  const rows: Array<Record<string, unknown>> = [];
  const summary = {
    scanned: contracts.length,
    eligible: 0,
    withoutInvoiceCandidate: 0,
    withoutFinancialApproval: 0,
    missingCanonicalGraph: 0,
    duplicateOrMissingProductRowIdentity: 0,
    candidatesReconciled: 0,
    candidatesBlocked: 0,
  };
  const repository = new PrismaApprovedPricingRepository(prisma as any);
  for (const contract of contracts) {
    const accountingRecords = recordsByContract.get(contract.id) || [];
    const eligible = eligibleStatuses.has(contract.status) && !contract.isInactive;
    if (eligible) {
      summary.eligible += 1;
      if (accountingRecords.length === 0) summary.withoutInvoiceCandidate += 1;
      if (!accountingRecords.some(record => record.financiallyApprovedAt)) summary.withoutFinancialApproval += 1;
    }
    if (!contract.productGraphState) summary.missingCanonicalGraph += 1;
    const identities = contract.items.map(item => item.productRowId).filter(Boolean);
    const identityConflict = identities.length !== contract.items.length || new Set(identities).size !== identities.length;
    if (identityConflict) summary.duplicateOrMissingProductRowIdentity += 1;

    const hasFinancialApproval = accountingRecords.some(record => record.financiallyApprovedAt);
    const candidate = hasFinancialApproval
      ? undefined
      : accountingRecords.find(record => !record.financiallyApprovedAt && record.status !== 'VOIDED');
    let candidateEvidence: Record<string, unknown> | undefined;
    if (candidate) {
      try {
        const source = await repository.loadSource(candidate.id);
        if (!source) throw new Error('منبع فریز‌شده‌ی صورتحساب پیدا نشد');
        const simulatedSource = {
          ...source,
          leaf: {
            ...source.leaf,
            status: 'ISSUED',
            financiallyApprovedAt: new Date('2026-08-19T00:00:00.000Z'),
            financiallyApprovedBy: 'read-only-audit',
          },
        } as typeof source;
        const version = buildApprovedPricingVersion(simulatedSource, 1, `audit:${candidate.id}`);
        summary.candidatesReconciled += 1;
        candidateEvidence = {
          status: 'RECONCILED',
          financialRecordId: candidate.id,
          quantityNormalizations: Array.isArray(version.sourceEvidence.quantityNormalizations)
            ? version.sourceEvidence.quantityNormalizations.length
            : 0,
        };
      } catch (error) {
        summary.candidatesBlocked += 1;
        candidateEvidence = {
          status: 'BLOCKED',
          financialRecordId: candidate.id,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    rows.push({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      eligible,
      invoiceCandidates: accountingRecords.length,
      financiallyApproved: hasFinancialApproval,
      graph: contract.productGraphState
        ? { schemaVersion: contract.productGraphState.schemaVersion, revision: contract.productGraphState.revision,
            policySnapshot: contract.productGraphState.policySnapshot }
        : null,
      identityConflict,
      optimizerZeroSentinels: contract.items.filter(item =>
        item.productType?.toLowerCase() === 'longitudinal' && item.quantity.eq(0)).length,
      ...(candidateEvidence ? { candidateEvidence } : {}),
    });
  }
  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), mode: 'READ_ONLY', summary, contracts: rows }, null, 2)}\n`);
};

run().finally(() => prisma.$disconnect());
