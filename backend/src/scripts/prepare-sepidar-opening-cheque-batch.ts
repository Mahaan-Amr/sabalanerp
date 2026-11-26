import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { sepidarOpeningChequeBatchDigest } from '../services/sepidarOpeningChequeApplication';
import { readSepidarOpeningChequeEvidence } from '../services/sepidarOpeningChequePlan';

async function main() {
  const { values } = parseArgs({ options: {
    evidence: { type: 'string' }, output: { type: 'string' }, actor: { type: 'string' },
    custody: { type: 'string' }, clearing: { type: 'string' }, fiscalYear: { type: 'string' },
    period: { type: 'string' }, recipientDimension: { type: 'string' },
  } });
  const { evidence: sourcePath, output, actor: actorId, custody: custodyFinancialAccountId,
    clearing: clearingAccountId, fiscalYear: fiscalYearId, period: periodId, recipientDimension: recipientDimensionTypeId } = values;
  if (!sourcePath || !output || !actorId || !custodyFinancialAccountId || !clearingAccountId || !fiscalYearId || !periodId) {
    throw new Error('REQUIRED_OPTIONS: --evidence --output --actor --custody --clearing --fiscalYear --period');
  }
  const bytes = await readFile(sourcePath);
  const evidence = readSepidarOpeningChequeEvidence(bytes.toString('utf8'));
  const planSha256 = sepidarOpeningChequeBatchDigest({
    evidence, custodyFinancialAccountId, clearingAccountId, fiscalYearId, periodId, recipientDimensionTypeId,
  });
  const manifest = {
    format: 'sepidar-opening-cheque-batch-preparation-v1', bookId: evidence.bookId,
    basisAt: evidence.basisAt, sourceSha256: createHash('sha256').update(bytes).digest('hex'), planSha256,
    actorId, custodyFinancialAccountId, clearingAccountId, fiscalYearId, periodId, recipientDimensionTypeId,
    instrumentCount: evidence.instruments.length, eventCount: evidence.events.length,
    openingRials: evidence.openingLines.reduce((sum, line) => sum + line.amountRials, 0n).toString(),
  };
  await writeFile(output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(`Prepared ${manifest.instrumentCount} cheque histories with ${manifest.eventCount} events.\n`);
}

main().catch(() => {
  process.stderr.write('SEPIDAR_OPENING_CHEQUE_BATCH_PREPARATION_FAILED\n');
  process.exitCode = 1;
});
