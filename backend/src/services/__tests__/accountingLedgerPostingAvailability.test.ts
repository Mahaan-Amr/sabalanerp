import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listLedgerVouchers } from '../accountingLedgerPrismaRepository';

test('voucher list gives the page a posting decision without returning source evidence', async () => {
  const rows = [
    { id: 'sepidar-draft', status: 'DRAFT', sourceType: 'SEPIDAR_ACC_VOUCHER', sourcePayload: { authority: 'SEPIDAR_UNTIL_CUTOVER', privateEvidence: 'hidden' } },
    { id: 'manual-draft', status: 'DRAFT', sourceType: 'سند دستی', sourcePayload: { privateEvidence: 'hidden' } },
  ];
  const database = { accountingLedgerVoucher: { findMany: async (query: { select: Record<string, unknown> }) => {
    assert.equal(query.select.sourcePayload, undefined);
    assert.equal(query.select.sourceType, true);
    return rows.map(({ sourcePayload: _sourcePayload, ...row }) => row);
  } } } as unknown as Parameters<typeof listLedgerVouchers>[0];
  const originalEnvironment = process.env.NODE_ENV;
  const originalUrl = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = 'postgresql://postgres:local@postgres:5432/sabalanerp?application_name=sabalanerp-backend-local';
    for (const nodeEnv of ['production', 'development']) {
      process.env.NODE_ENV = nodeEnv;
      const result = await listLedgerVouchers(database, { bookId: 'cmub2hd63007zrqlphrzi5eey', fiscalYearId: 'year-1', status: 'DRAFT' });
      if (nodeEnv === 'production') assert.match(result[0].postingBlockedReason!, /فقط در دفتر توسعه/);
      else assert.equal(result[0].postingBlockedReason, null);
      assert.equal(result[1].postingBlockedReason, null);
      assert.equal('sourcePayload' in result[0], false);
      assert.equal('sourcePayload' in result[1], false);
    }
    const wrongBook = await listLedgerVouchers(database, { bookId: 'another-book', fiscalYearId: 'year-1', status: 'DRAFT' });
    assert.match(wrongBook[0].postingBlockedReason!, /فقط در دفتر توسعه/);
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnvironment;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});

test('development migration mutators refuse production before any database connection', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sepidar-local-boundary-'));
  const proposalFile = path.join(directory, 'proposal.json');
  writeFileSync(proposalFile, '{}', { flag: 'wx' });
  try {
    for (const script of ['prepareSepidarLocalLedger', 'correctSepidarFiscalTimeZone', 'enrichSepidarLedgerDraftDimensions',
      'materializeSepidarMasterData', 'importSepidarLedgerDrafts']) {
      const result = spawnSync(process.execPath, [require.resolve('tsx/cli'),
        path.resolve(__dirname, `../../scripts/${script}.ts`), '--apply', '--year=1405'], {
        env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://postgres:local@127.0.0.1:1/sabalanerp',
          SEPIDAR_TARGET_BOOK_ID: 'cmub2hd63007zrqlphrzi5eey', SEPIDAR_SNAPSHOT_ID: 'test-snapshot', SEPIDAR_MAPPING_PROPOSAL: proposalFile },
        encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.status, 1, `${script} must refuse production`);
      assert.match(result.stderr, /SEPIDAR_LOCAL_HISTORY_ONLY/, `${script} must fail at local boundary`);
      assert.doesNotMatch(result.stderr, /Can't reach database|P1001/, `${script} must not connect`);
    }
  } finally {
    rmSync(proposalFile);
    rmdirSync(directory);
  }
});
