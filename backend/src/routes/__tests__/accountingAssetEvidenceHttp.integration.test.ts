import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import router from '../accountingPeriodEnd';
import { prisma } from '../../lib/prisma';

// This test uses a named, disposable database within the existing local PostgreSQL.
// A synthetic scanner accepts an existing file; no third-party scan is performed.
test('asset upload retries preserve one evidence row and audit on real PostgreSQL', async () => {
  const db = new URL(process.env.DATABASE_URL || '');
  assert(['127.0.0.1', 'localhost'].includes(db.hostname) && db.port === '55432');
  assert.equal(db.pathname, '/sabalanerp_qa_finance_clean_20261102');
  const suffix = randomUUID();
  const entity = await prisma.accountingLegalEntity.create({ data: { code: `qa-${suffix}`, namePersian: 'آزمون', activeFrom: new Date('2026-01-01'), createdBy: 'qa' } });
  const book = await prisma.accountingBook.create({ data: { legalEntityId: entity.id, code: `qa-${suffix}`, namePersian: 'آزمون', createdBy: 'qa' } });
  const scheme = await prisma.accountingCodeScheme.create({ data: { bookId: book.id, version: 1, effectiveFrom: new Date('2026-01-01'), groupLength: 1, kolLength: 2, moinLength: 3, createdBy: 'qa' } });
  const account = await prisma.accountingLedgerAccount.create({ data: { bookId: book.id, codeSchemeId: scheme.id, code: '110101', titlePersian: 'آزمون', level: 'MOIN', normalSide: 'DEBIT', statementRole: 'ASSET', effectiveFrom: new Date('2026-01-01'), createdBy: 'qa' } });
  const policy = await prisma.accountingAssetClassPolicy.create({ data: { bookId: book.id, classCode: `QA-${suffix}`, version: 1, titlePersian: 'آزمون', effectiveFrom: new Date('2026-01-01'), capitalizationThresholdRials: '1000', bookMethod: 'STRAIGHT_LINE', taxMethod: 'STRAIGHT_LINE', usefulLifeMonths: 60, assetAccountId: account.id, cipAccountId: account.id, depreciationExpenseAccountId: account.id, accumulatedDepreciationAccountId: account.id, impairmentExpenseAccountId: account.id, impairmentAllowanceAccountId: account.id, disposalGainAccountId: account.id, disposalLossAccountId: account.id, createdBy: 'qa' } });
  const asset = await prisma.accountingFixedAsset.create({ data: { bookId: book.id, registerNumber: `qa-${suffix}`, classPolicyId: policy.id, titlePersian: 'آزمون', acquisitionAt: new Date('2026-01-01'), status: 'UNDER_CONSTRUCTION', bookCostRials: '1000', taxCostRials: '1000', createdBy: 'qa' } });
  const initialCwd = process.cwd();
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-asset-http-'));
  process.chdir(scratch);
  const app = express();
  app.use((req, res, next) => {
    Object.assign(req, { user: { id: `qa-${suffix}`, role: 'ACCOUNTANT' }, workspacePermission: 'edit' });
    if (req.get('x-qa-drop-response') === '1') {
      // run() invokes response.json only AFTER the database transaction resolves.
      // Destroy the real socket at that boundary so the client actually loses the reply.
      res.end = function (this: typeof res) { this.socket?.destroy(); return this; } as typeof res.end;
    }
    next();
  });
  const layer = (router as any).stack.find((item: any) => item.route?.path === '/assets/:id/evidence' && item.route.methods.post);
  assert(layer, 'actual asset upload endpoint must be registered');
  app.post('/assets/:id/evidence', ...layer.route.stack.slice(-2).map((entry: any) => entry.handle));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const oldScanner = process.env.HR_HIRING_ANTIVIRUS_COMMAND;
  const key = `qa-key-${suffix}`;
  const send = (content: string, requestKey = key, dropResponse = false) => {
    const body = new FormData(); body.append('bookId', book.id); body.append('purpose', 'COST');
    body.append('file', new Blob([content], { type: 'application/pdf' }), 'evidence.pdf');
    return fetch(`${base}/assets/${asset.id}/evidence`, { method: 'POST', headers: { 'x-idempotency-key': requestKey, ...(dropResponse ? { 'x-qa-drop-response': '1' } : {}) }, body });
  };
  try {
    process.env.HR_HIRING_ANTIVIRUS_COMMAND = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'more.com');
    const responses = await Promise.all([send('%PDF-1.4\nqa-one'), send('%PDF-1.4\nqa-one')]);
    const json = await Promise.all(responses.map(response => response.json() as Promise<any>));
    assert.deepEqual(responses.map(response => response.status), [201, 201], JSON.stringify(json));
    assert.equal(json[0].data.id, json[1].data.id, 'concurrent identical command must replay its outcome');
    const evidence = await prisma.accountingArchiveEvidence.findMany({ where: { sourceEntityId: asset.id } });
    assert.equal(evidence.length, 1);
    const audits = await prisma.accountingLedgerAuditEntry.findMany({ where: { entityId: evidence[0].id, action: 'ASSET_EVIDENCE_UPLOADED' } });
    assert.equal(audits.length, 1, 'one durable audit accompanies the single evidence row');
    const conflict = await send('%PDF-1.4\nqa-two');
    assert.notEqual(conflict.status, 201, 'same key with other bytes must fail closed');
    await prisma.accountingFixedAsset.update({ where: { id: asset.id }, data: { status: 'ACTIVE' } });
    process.env.HR_HIRING_ANTIVIRUS_COMMAND = path.join(scratch, 'scanner-unavailable.exe');
    const recovered = await send('%PDF-1.4\nqa-one');
    const replay = await recovered.json() as any;
    assert.equal(recovered.status, 201, JSON.stringify(replay));
    assert.equal(replay.data.id, evidence[0].id, 'lost response replay succeeds even after state change and scanner failure');
    assert.equal(await prisma.accountingArchiveEvidence.count({ where: { sourceEntityId: asset.id } }), 1);
    assert.equal(await prisma.accountingLedgerAuditEntry.count({ where: { entityId: evidence[0].id, action: 'ASSET_EVIDENCE_UPLOADED' } }), 1);

    // Force an actual client transport failure after a fresh command commits.
    await prisma.accountingFixedAsset.update({ where: { id: asset.id }, data: { status: 'UNDER_CONSTRUCTION' } });
    process.env.HR_HIRING_ANTIVIRUS_COMMAND = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'more.com');
    const lostKey = `qa-response-loss-${suffix}`;
    await assert.rejects(send('%PDF-1.4\nqa-lost-response', lostKey, true), /fetch failed/i);
    const committed = await prisma.accountingArchiveEvidence.findMany({ where: { sourceEntityId: asset.id } });
    assert.equal(committed.length, 2, 'the disconnected response follows a committed write');
    const lostEvidence = committed.find(item => item.id !== evidence[0].id)!;
    assert(lostEvidence);
    await prisma.accountingFixedAsset.update({ where: { id: asset.id }, data: { status: 'ACTIVE' } });
    process.env.HR_HIRING_ANTIVIRUS_COMMAND = path.join(scratch, 'scanner-unavailable.exe');
    const recoveredLost = await send('%PDF-1.4\nqa-lost-response', lostKey);
    const recoveredBody = await recoveredLost.json() as any;
    assert.equal(recoveredLost.status, 201, JSON.stringify(recoveredBody));
    assert.equal(recoveredBody.data.id, lostEvidence.id);
    assert.equal(await prisma.accountingArchiveEvidence.count({ where: { sourceEntityId: asset.id } }), 2);
    assert.equal(await prisma.accountingLedgerAuditEntry.count({ where: { entityId: lostEvidence.id, action: 'ASSET_EVIDENCE_UPLOADED' } }), 1);
  } finally {
    if (oldScanner === undefined) delete process.env.HR_HIRING_ANTIVIRUS_COMMAND; else process.env.HR_HIRING_ANTIVIRUS_COMMAND = oldScanner;
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    process.chdir(initialCwd); await fs.rm(scratch, { recursive: true, force: true }); await prisma.$disconnect();
  }
});
