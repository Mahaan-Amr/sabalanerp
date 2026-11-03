import fs from 'node:fs';
import path from 'node:path';
import { AccountingFlagStatus, Prisma, PrismaClient } from '@prisma/client';
import { preflightApprovedPricingAtFinancialApproval, FinancialEvidenceConflictError } from '../services/approvedPricing';
import {
  ensureFinancialEvidenceSupportReferral,
  ensureUnresolvedFinancialEvidenceCaseAndSupportReferral,
  FINANCIAL_EVIDENCE_REVIEW_PREFIX,
} from '../services/financialEvidenceReviewCase';
import { RECOVERY_COORDINATION_DIR } from '../services/recoveryRuntime';

const apply = process.argv.includes('--apply');
const referUnresolved = process.argv.includes('--refer-unresolved');
const referFromArg = process.argv.find(argument => argument.startsWith('--refer-from='));
const referFromPath = referFromArg?.slice('--refer-from='.length);
const deploymentMode = process.argv.includes('--deployment-checkpoint');
const outputArg = process.argv.find(argument => argument.startsWith('--output='));
const outputPath = outputArg?.slice('--output='.length);
const databaseUrl = String(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');

const deploymentIdentity = () => {
  if (!deploymentMode) return {
    actorId: String(process.env.MIGRATION_ACTOR_ID || 'system-financial-evidence-recovery'),
    backupReference: String(process.env.CONTRACT_GRAPH_BACKUP_REFERENCE || ''),
  };
  const deploymentId = String(process.env.DEPLOYMENT_ID || '').trim();
  if (!deploymentId) throw new Error('DEPLOYMENT_ID is required in deployment-checkpoint mode');
  const checkpointPath = path.join(RECOVERY_COORDINATION_DIR, 'deployment-checkpoint.json');
  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as Record<string, unknown>;
  if (checkpoint.deploymentId !== deploymentId || checkpoint.localVerified !== true ||
    checkpoint.remoteVerified !== true || typeof checkpoint.checksum !== 'string') {
    throw new Error('Verified deployment checkpoint is required for financial evidence recovery');
  }
  return {
    actorId: `system-deployment:${deploymentId}`,
    backupReference: `deployment-checkpoint:${deploymentId}:${checkpoint.checksum}`,
  };
};

const identity = deploymentIdentity();
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const metadata = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stringValue = (value: unknown) => (
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''
);

class ApplyPreflightFailure extends Error {
  constructor(readonly financialRecordId: string, readonly cause: unknown) {
    super(`Transactional financial evidence preflight failed for ${financialRecordId}`);
  }
}

const recoveryMethods = (version: Awaited<ReturnType<typeof preflightApprovedPricingAtFinancialApproval>>) => {
  const sourceEvidence = metadata(version.sourceEvidence);
  const graph = metadata(sourceEvidence.graph);
  const compatibility = metadata(graph.compatibility);
  const methods = new Set<string>();
  const origin = String(compatibility.evidenceOrigin || '');
  if (origin === 'POST_SNAPSHOT_DETERMINISTIC_CANONICAL_GRAPH_BINDING') {
    methods.add('FROZEN_COMMERCIAL_TUPLE_TO_AUDITED_CANONICAL_GRAPH');
  }
  if (origin === 'POST_SNAPSHOT_DETERMINISTIC_LEGACY_GRAPH_MIGRATION') {
    methods.add('FROZEN_SNAPSHOT_TO_DETERMINISTIC_LEGACY_GRAPH');
  }
  if (compatibility.recoveredAccountingRows) methods.add('FROZEN_GRAPH_ACCOUNTING_ROW_RECOVERY');
  if (compatibility.recoveredInvoiceAmount) methods.add('ZERO_SENTINEL_FROM_FROZEN_CONTRACT_TOTAL');
  if (Array.isArray(sourceEvidence.quantityNormalizations) && sourceEvidence.quantityNormalizations.length > 0) {
    methods.add('VERSIONED_COMMERCIAL_PRECISION_RECONCILIATION');
  }
  if (methods.size === 0) methods.add('READ_ONLY_FINANCIAL_PREFLIGHT');
  return [...methods];
};

const referFromReport = async () => {
  if (!referFromPath) return false;
  const sourceReport = JSON.parse(fs.readFileSync(referFromPath, 'utf8')) as Record<string, unknown>;
  const sourceContracts = Array.isArray(sourceReport.contracts) ? sourceReport.contracts : [];
  const unresolvedResults = sourceContracts
    .map(metadata)
    .filter(result => result.result === 'UNRESOLVED');
  if (unresolvedResults.length === 0) throw new Error('Referral source report contains no unresolved result');
  const referrals: Array<Record<string, unknown>> = [];
  await prisma.$transaction(async tx => {
    for (const result of unresolvedResults) {
      const existingIds = Array.isArray(result.reviewCaseIds)
        ? result.reviewCaseIds.map(String).filter(Boolean)
        : [];
      if (existingIds.length > 0) {
        for (const caseId of existingIds) {
          const reviewCase = await tx.accountingContractFlag.findUnique({ where: { id: caseId } });
          if (!reviewCase) throw new Error(`Referral review case ${caseId} was not restored`);
          const ticket = await ensureFinancialEvidenceSupportReferral(tx, reviewCase, identity.actorId);
          referrals.push({ contractId: reviewCase.contractId, financialRecordId: reviewCase.sourceFinancialRecordId, reviewCaseId: reviewCase.id, supportTicketId: ticket.id });
        }
        continue;
      }
      const contractId = stringValue(result.contractId);
      const financialRecordId = stringValue(result.financialRecordId);
      if (!contractId || !financialRecordId) throw new Error('Unresolved referral result has no stable contract and financial-record identity');
      const referred = await ensureUnresolvedFinancialEvidenceCaseAndSupportReferral(tx, {
        contractId,
        financialRecordId,
        actorId: identity.actorId,
        technicalDetail: stringValue(result.reason) || 'No deterministic financial-evidence recovery is available',
      });
      referrals.push({ contractId, financialRecordId, reviewCaseId: referred.reviewCase.id, supportTicketId: referred.ticket.id });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'REFER_FROM_FAILED_DEPLOYMENT_REPORT',
    sourceReport: referFromPath,
    unresolved: unresolvedResults.length,
    supportReferrals: referrals.length,
    referrals,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
  return true;
};

const run = async () => {
  if (await referFromReport()) return;
  const records = await prisma.accountingFinancialRecord.findMany({
    where: {
      kind: 'INVOICE_CANDIDATE',
      contractId: { not: null },
      financiallyApprovedAt: null,
      status: { not: 'VOIDED' },
    },
    select: { id: true, contractId: true, createdAt: true },
    orderBy: [{ contractId: 'asc' }, { createdAt: 'desc' }],
  });
  const openCases = await prisma.accountingContractFlag.findMany({
    where: {
      status: AccountingFlagStatus.OPEN,
      trackingCode: { startsWith: FINANCIAL_EVIDENCE_REVIEW_PREFIX },
    },
  });
  const recordsById = new Map(records.map(record => [record.id, record]));
  const selectedByRecord = new Map<string, (typeof records)[number]>();
  const latestByContract = new Map<string, (typeof records)[number]>();
  for (const record of records) {
    if (record.contractId && !latestByContract.has(record.contractId)) latestByContract.set(record.contractId, record);
  }
  for (const record of latestByContract.values()) selectedByRecord.set(record.id, record);
  for (const reviewCase of openCases) {
    const source = reviewCase.sourceFinancialRecordId
      ? recordsById.get(reviewCase.sourceFinancialRecordId)
      : undefined;
    if (source) selectedByRecord.set(source.id, source);
  }
  const candidates = [...selectedByRecord.values()];
  const contractIds = new Set(candidates.flatMap(record => record.contractId ? [record.contractId] : []));
  openCases.forEach(reviewCase => contractIds.add(reviewCase.contractId));
  const contracts = await prisma.salesContract.findMany({
    where: { id: { in: [...contractIds] } },
    select: { id: true, contractNumber: true },
  });
  const contractNumbers = new Map(contracts.map(contract => [contract.id, contract.contractNumber]));
  const openCasesByRecord = new Map<string, typeof openCases>();
  for (const reviewCase of openCases) {
    if (!reviewCase.sourceFinancialRecordId) continue;
    const collection = openCasesByRecord.get(reviewCase.sourceFinancialRecordId) ?? [];
    collection.push(reviewCase);
    openCasesByRecord.set(reviewCase.sourceFinancialRecordId, collection);
  }

  const results: Array<Record<string, any>> = [];
  const successfulPreflights = new Map<
    string,
    Awaited<ReturnType<typeof preflightApprovedPricingAtFinancialApproval>>
  >();
  for (const reviewCase of openCases) {
    if (reviewCase.sourceFinancialRecordId && recordsById.has(reviewCase.sourceFinancialRecordId)) continue;
    results.push({
      contractId: reviewCase.contractId,
      contractNumber: contractNumbers.get(reviewCase.contractId),
      financialRecordId: reviewCase.sourceFinancialRecordId,
      reviewCaseId: reviewCase.id,
      reviewCaseIds: [reviewCase.id],
      recoveryMethods: ['NO_DETERMINISTIC_RECOVERY'],
      recoveryMethod: 'NO_DETERMINISTIC_RECOVERY',
      result: 'UNRESOLVED',
      reason: 'Open financial evidence review case has no active unapproved source record',
    });
  }
  for (const candidate of candidates) {
    const contractNumber = candidate.contractId ? contractNumbers.get(candidate.contractId) : undefined;
    const reviewCases = openCasesByRecord.get(candidate.id) ?? [];
    try {
      const version = await preflightApprovedPricingAtFinancialApproval(
        prisma as any,
        candidate.id,
        identity.actorId,
        candidate.createdAt,
      );
      successfulPreflights.set(candidate.id, version);
      const methods = recoveryMethods(version);
      results.push({
        contractId: candidate.contractId,
        contractNumber,
        financialRecordId: candidate.id,
        reviewCaseId: reviewCases[0]?.id ?? null,
        reviewCaseIds: reviewCases.map(reviewCase => reviewCase.id),
        recoveryMethods: methods,
        recoveryMethod: methods.join('+'),
        result: 'RECONCILED',
        approvedPricingIntegrityHash: version.integrityHash,
        quantityNormalizations: Array.isArray(version.sourceEvidence.quantityNormalizations)
          ? version.sourceEvidence.quantityNormalizations.length
          : 0,
      });
    } catch (error) {
      const reason = error instanceof FinancialEvidenceConflictError
        ? error.technicalDetail
        : error instanceof Error ? error.message : String(error);
      results.push({
        contractId: candidate.contractId,
        contractNumber,
        financialRecordId: candidate.id,
        reviewCaseId: reviewCases[0]?.id ?? null,
        reviewCaseIds: reviewCases.map(reviewCase => reviewCase.id),
        recoveryMethods: ['NO_DETERMINISTIC_RECOVERY'],
        recoveryMethod: 'NO_DETERMINISTIC_RECOVERY',
        result: 'UNRESOLVED',
        reason,
      });
    }
  }
  let unresolved = results.filter(result => result.result === 'UNRESOLVED').length;
  let supportReferrals = 0;
  if (referUnresolved && unresolved > 0) {
    await prisma.$transaction(async tx => {
      const openCasesById = new Map(openCases.map(reviewCase => [reviewCase.id, reviewCase]));
      for (const result of results.filter(entry => entry.result === 'UNRESOLVED')) {
        const caseIds = Array.isArray(result.reviewCaseIds) ? result.reviewCaseIds as string[] : [];
        if (caseIds.length > 0) {
          for (const caseId of caseIds) {
            const reviewCase = openCasesById.get(caseId);
            if (!reviewCase) throw new Error(`Open financial evidence review case ${caseId} is unavailable for referral`);
            await ensureFinancialEvidenceSupportReferral(tx, reviewCase, identity.actorId);
            supportReferrals += 1;
          }
          continue;
        }
        if (!result.contractId || !result.financialRecordId) {
          throw new Error('Unresolved result has no stable contract and financial-record identity for referral');
        }
        const referred = await ensureUnresolvedFinancialEvidenceCaseAndSupportReferral(tx, {
          contractId: result.contractId,
          financialRecordId: result.financialRecordId,
          actorId: identity.actorId,
          technicalDetail: result.reason || 'No deterministic financial-evidence recovery is available',
        });
        result.reviewCaseId = referred.reviewCase.id;
        result.reviewCaseIds = [referred.reviewCase.id];
        supportReferrals += 1;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  if (apply && unresolved === 0 && openCases.length > 0) {
    try {
      await prisma.$transaction(async tx => {
        const transactionPreflights = new Map<string, Awaited<ReturnType<typeof preflightApprovedPricingAtFinancialApproval>>>();
        for (const candidate of candidates) {
          try {
            transactionPreflights.set(candidate.id, await preflightApprovedPricingAtFinancialApproval(
              tx,
              candidate.id,
              identity.actorId,
              candidate.createdAt,
            ));
          } catch (error) {
            throw new ApplyPreflightFailure(candidate.id, error);
          }
        }
        for (const reviewCase of openCases) {
          const candidate = reviewCase.sourceFinancialRecordId
            ? recordsById.get(reviewCase.sourceFinancialRecordId)
            : undefined;
          if (!candidate) throw new ApplyPreflightFailure(reviewCase.sourceFinancialRecordId ?? '', new Error('Source record is missing'));
          const preflight = transactionPreflights.get(candidate.id);
          if (!preflight) throw new ApplyPreflightFailure(candidate.id, new Error('Transactional preflight evidence is missing'));
          const now = new Date();
          const updated = await tx.accountingContractFlag.update({
            where: { id: reviewCase.id },
            data: {
              status: AccountingFlagStatus.RESOLVED,
              resolvedBy: identity.actorId,
              resolvedAt: now,
              resolutionNote: 'بازآزمایی خودکار و قطعی شواهد با قانون نسخه‌دار با موفقیت انجام شد.',
              evidence: json({
                ...metadata(reviewCase.evidence),
                resolutionMode: 'RECONCILED_BY_EVIDENCE_RECHECK',
                recoveryMode: 'AUTOMATED_IDEMPOTENT_RELEASE_RECOVERY',
                recoveryBackupReference: identity.backupReference || null,
                lastRecheckedBy: identity.actorId,
                lastRecheckedAt: now.toISOString(),
                reconciledApprovedPricingVersionId: preflight.id,
                reconciledApprovedPricingIntegrityHash: preflight.integrityHash,
              }),
            },
          });
          await tx.accountingAuditLog.create({
            data: {
              action: 'AUTOMATED_FINANCIAL_EVIDENCE_RECOVERY_RESOLVED',
              actorId: identity.actorId,
              contractId: reviewCase.contractId,
              recordId: candidate.id,
              entityType: 'AccountingContractFlag',
              entityId: reviewCase.id,
              beforeState: json(reviewCase),
              afterState: json(updated),
              note: 'Frozen evidence reconciled under its recorded commercial precision; no contract or invoice source was rewritten.',
            },
          });
          const result = results.find(entry => entry.financialRecordId === candidate.id);
          if (result) result.result = 'RESOLVED_SYSTEMICALLY';
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof ApplyPreflightFailure)) throw error;
      const reason = error.cause instanceof FinancialEvidenceConflictError
        ? error.cause.technicalDetail
        : error.cause instanceof Error ? error.cause.message : String(error.cause);
      const result = results.find(entry => entry.financialRecordId === error.financialRecordId);
      if (result) {
        result.result = 'UNRESOLVED';
        result.recoveryMethods = ['NO_DETERMINISTIC_RECOVERY'];
        result.recoveryMethod = 'NO_DETERMINISTIC_RECOVERY';
        result.reason = `Transactional recheck failed: ${reason}`;
      } else {
        results.push({
          financialRecordId: error.financialRecordId || null,
          recoveryMethods: ['NO_DETERMINISTIC_RECOVERY'],
          recoveryMethod: 'NO_DETERMINISTIC_RECOVERY',
          result: 'UNRESOLVED',
          reason: `Transactional recheck failed: ${reason}`,
        });
      }
      unresolved = results.filter(entry => entry.result === 'UNRESOLVED').length;
    }
  }
  let remainingOpenReviewCases: number | null = null;
  if (apply && unresolved === 0) {
    remainingOpenReviewCases = await prisma.accountingContractFlag.count({
      where: {
        status: AccountingFlagStatus.OPEN,
        trackingCode: { startsWith: FINANCIAL_EVIDENCE_REVIEW_PREFIX },
      },
    });
    if (remainingOpenReviewCases > 0) {
      results.push({
        recoveryMethods: ['NO_DETERMINISTIC_RECOVERY'],
        recoveryMethod: 'NO_DETERMINISTIC_RECOVERY',
        result: 'UNRESOLVED',
        reason: `${remainingOpenReviewCases} open financial evidence review case(s) remained after apply`,
      });
      unresolved = results.filter(entry => entry.result === 'UNRESOLVED').length;
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    mode: referUnresolved ? 'REFER_UNRESOLVED' : apply ? 'APPLY' : 'READ_ONLY',
    backupReference: identity.backupReference || null,
    scannedCandidates: candidates.length,
    openReviewCases: openCases.length,
    remainingOpenReviewCases,
    reconciled: results.length - unresolved,
    unresolved,
    supportReferrals,
    applySkippedBecauseUnresolved: apply && unresolved > 0,
    contracts: results,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
  if (unresolved > 0 && !referUnresolved) process.exitCode = 2;
};

run()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
