import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { configureDispatchDocumentsRuntime } from '../dispatchDocuments/runtime';
import { getStatementAdjustmentArtifactPreparer } from '../statementAdjustmentRuntime';

const run = async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'issue262-adjustment-runtime-'));
  try {
    configureDispatchDocumentsRuntime({
      prisma: {} as PrismaClient,
      publisher: { publish: async () => ({
        bytes: new TextEncoder().encode('durable statement adjustment PDF'),
        mediaType: 'application/pdf',
      }) },
      templateVersion: 'statement-adjustment-v1',
      generatorVersion: 'issue264-renderer-v1',
      storageRoot,
    });
    const configured = getStatementAdjustmentArtifactPreparer();
    assert.ok(configured, 'dispatchDocuments runtime must install the Accounting adjustment preparer');
    const artifact = await configured.preparer.prepare({
      schemaVersion: 1,
      kind: 'STATEMENT_ADJUSTMENT',
      documentId: 'adjustment-runtime-1',
      waybillNumber: '7001',
      issuedAt: '2026-08-09T12:00:00.000Z',
      customerName: 'مشتری',
      projectOrDestination: 'مقصد',
      vehiclePlate: '11الف111',
      templateVersion: configured.templateVersion,
      payload: {
        sequence: 1,
        originalStatementDocumentId: 'statement-1',
        reason: 'اصلاح',
        currency: 'IRR',
        lines: [],
        grossAmountDelta: '0.000000000000',
        discountDelta: '0.000000000000',
        netAmountDelta: '0.000000000000',
      },
    });
    const stored = await readFile(path.join(storageRoot, artifact.storageKey));
    assert.equal(stored.byteLength, artifact.byteLength);
    assert.equal(artifact.generatorVersion, 'issue264-renderer-v1');
    assert.deepEqual(artifact.sourceVersionIdentities, {
      generatorVersion: 'issue264-renderer-v1',
      templateVersion: 'statement-adjustment-v1',
    });
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
};

run().then(() => console.log('statement adjustment runtime composition tests passed'));
