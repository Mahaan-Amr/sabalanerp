import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { inspectSepidarOpeningChequeTargets, SepidarOpeningChequeApplicationError } from '../services/sepidarOpeningChequeApplication';
import { readSepidarOpeningChequeEvidence, SepidarOpeningChequePlanError } from '../services/sepidarOpeningChequePlan';

async function main() {
  const { values } = parseArgs({ options: {
    evidence: { type: 'string' }, custody: { type: 'string' },
  } });
  if (!values.evidence || !values.custody) throw new Error('REQUIRED_OPTIONS: --evidence --custody');
  const evidence = readSepidarOpeningChequeEvidence(await readFile(values.evidence, 'utf8'));
  const result = await inspectSepidarOpeningChequeTargets(prisma, {
    evidence, custodyFinancialAccountId: values.custody,
  });
  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((error: unknown) => {
  const code = error instanceof SepidarOpeningChequeApplicationError || error instanceof SepidarOpeningChequePlanError
    ? error.code : 'SEPIDAR_OPENING_CHEQUE_TARGET_INSPECTION_FAILED';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
}).finally(disconnectDatabase);
