import { open, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { applySepidarOpeningChequeBatch, describeSepidarOpeningChequeBatch, inspectSepidarOpeningChequeBatchAdmission,
  SepidarOpeningChequeApplicationError } from '../services/sepidarOpeningChequeApplication';
import { readSepidarOpeningChequeEvidence, SepidarOpeningChequePlanError } from '../services/sepidarOpeningChequePlan';

async function main() {
  const { values: options } = parseArgs({ options: {
    source: { type: 'string' }, preparation: { type: 'string' }, receipt: { type: 'string' }, apply: { type: 'boolean' },
  } });
  const { source, preparation, receipt, apply = false } = options;
  if (!source || !preparation || (apply && !receipt) || (!apply && receipt)) {
    throw new Error('INVALID_OPTIONS');
  }
  const [bytes, reviewed] = await Promise.all([readFile(source), readFile(preparation)]);
  const target = JSON.parse(reviewed.toString('utf8'));
  const manifest = describeSepidarOpeningChequeBatch(bytes, target);
  if (!reviewed.equals(Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))) throw new Error('PREPARATION_MISMATCH');
  const input = {
    actor: { id: manifest.actorId, profile: 'ACCOUNTANT' as const },
    evidence: readSepidarOpeningChequeEvidence(bytes.toString('utf8')),
    clearingAccountId: manifest.clearingAccountId,
    custodyFinancialAccountId: manifest.custodyFinancialAccountId,
    recipientDimensionTypeId: manifest.recipientDimensionTypeId,
    fiscalYearId: manifest.fiscalYearId,
    periodId: manifest.periodId,
  };
  const admitted = await inspectSepidarOpeningChequeBatchAdmission(prisma, input);
  if (!apply) {
    process.stdout.write(JSON.stringify({ ...admitted, applied: false }) + '\n');
    return;
  }

  // Reserve a fresh private receipt before committing the database changes.
  const handle = await open(receipt!, 'wx', 0o600);
  try {
    const result = await applySepidarOpeningChequeBatch(prisma, input);
    await handle.writeFile(JSON.stringify({ format: 'sepidar-opening-cheque-batch-receipt-v1',
      releaseId: process.env.DEPLOYMENT_RELEASE_ID, ...result }, null, 2) + '\n');
    await handle.sync();
    process.stdout.write(JSON.stringify({ applied: true, instruments: result.instruments.length,
      eventVouchers: result.eventVouchers, replayed: result.instruments.filter(row => row.replayed).length }) + '\n');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  const known = error instanceof SepidarOpeningChequeApplicationError || error instanceof SepidarOpeningChequePlanError;
  process.stderr.write((known ? error.code : 'SEPIDAR_OPENING_CHEQUE_BATCH_FAILED') + '\n');
  process.exitCode = 1;
}).finally(disconnectDatabase);
