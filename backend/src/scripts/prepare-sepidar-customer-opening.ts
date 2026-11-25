import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { readReconciledSepidarCustomerEvidence, readSepidarCustomerOpeningPreparation } from '../services/prepareSepidarCustomerOpening';
import { AccountingCustomerTreasuryError } from '../services/accountingCustomerTreasury';

const basisAt = new Date('2026-03-21T00:00:00.000Z');
type Preparation = Awaited<ReturnType<typeof readSepidarCustomerOpeningPreparation>>;

async function main() {
  const { values: options } = parseArgs({ options: {
    source: { type: 'string' }, output: { type: 'string' }, book: { type: 'string' }, period: { type: 'string' },
    rule: { type: 'string' }, clearing: { type: 'string' }, actor: { type: 'string' },
  } });
  const { source, output, book, period, rule, clearing, actor } = options;
  if (!source || !output || !book || !period || !rule || !clearing || !actor) {
    throw new Error('REQUIRED_OPTIONS: --source --output --book --period --rule --clearing --actor');
  }
  const { rows, sourcePackageHash } = readReconciledSepidarCustomerEvidence(await readFile(source));
  const target = { basisAt, bookId: book, periodId: period, postingRuleId: rule, counterAccountId: clearing,
    actor: { id: actor, profile: 'ACCOUNTANT' as const } };
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const prepared: Array<{ manifestLine: Preparation['manifestLine']; requestBody: Omit<Preparation['command'], 'actor'> }> = [];
    const excluded: Array<{ sourceCustomerId: string; sourceVoucherItemId: string; code: string }> = [];
    for (const row of rows) {
      try {
        const { command, manifestLine } = await readSepidarCustomerOpeningPreparation(tx, row, target);
        const { actor: _actor, ...requestBody } = command;
        prepared.push({ manifestLine, requestBody });
      } catch (error) {
        if (!(error instanceof AccountingCustomerTreasuryError)) throw error;
        excluded.push({ sourceCustomerId: row.sourceCustomerId, sourceVoucherItemId: row.sourceVoucherItemId, code: error.code });
      }
    }
    return { prepared, excluded };
  }, { isolationLevel: 'RepeatableRead', timeout: 60_000 });
  const preparedNetRials = result.prepared.reduce((sum, row) => sum + BigInt(row.manifestLine.totalRials), 0n);
  const report = { format: 'sepidar-customer-opening-preparation-v1', sourcePackageHash, bookId: book,
    counterAccountId: clearing, basisAt, preparedNetRials, clearingNetRials: -preparedNetRials, ...result };
  await writeFile(output, JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(`Prepared ${result.prepared.length} customer openings. ${result.excluded.length} require review.\n`);
  if (result.excluded.length) process.exitCode = 2;
}

main().catch(error => {
  process.stderr.write(`${error instanceof AccountingCustomerTreasuryError ? error.code : 'SEPIDAR_OPENING_PREPARATION_FAILED'}\n`);
  process.exitCode = 1;
}).finally(disconnectDatabase);
