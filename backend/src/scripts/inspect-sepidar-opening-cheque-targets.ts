import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { inspectSepidarOpeningChequeTargets, SepidarOpeningChequeApplicationError } from '../services/sepidarOpeningChequeApplication';
import { SepidarOpeningChequePlanError, type SepidarOpeningChequeEvidence } from '../services/sepidarOpeningChequePlan';

function readEvidence(text: string): SepidarOpeningChequeEvidence {
  return JSON.parse(text.replace(/^\uFEFF/, ''), (key, value: unknown) => {
    if (key !== 'amountRials' && key !== 'signedRials') return value;
    if (typeof value !== 'string' || !/^(0|-?[1-9][0-9]{0,19})$/.test(value)) {
      throw new Error('INVALID_RIAL_AMOUNT');
    }
    return BigInt(value);
  }) as SepidarOpeningChequeEvidence;
}

async function main() {
  const { values } = parseArgs({ options: {
    evidence: { type: 'string' }, custody: { type: 'string' },
  } });
  if (!values.evidence || !values.custody) throw new Error('REQUIRED_OPTIONS: --evidence --custody');
  const evidence = readEvidence(await readFile(values.evidence, 'utf8'));
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
