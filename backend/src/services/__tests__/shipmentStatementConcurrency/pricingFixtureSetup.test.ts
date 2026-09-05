import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { authorConcurrentPricingFixture } from './pricingFixture';

const run = async () => {
  const databaseUrl = process.env.DATABASE_URL || '';
  const runId = process.env.ISSUE260_PARENT_RUN_ID || '';
  assert.match(databaseUrl, /\/sabalanerp_concurrency_[a-f0-9]{16}(?:\?|$)/);
  assert.match(runId, /^[a-f0-9]{16}$/);
  const prisma = new PrismaClient();
  try {
    const fixture = await authorConcurrentPricingFixture(prisma, runId, {
      activateCutover: process.env.ISSUE260_ACTIVATE_CUTOVER !== 'false',
    });
    console.log(JSON.stringify({ kind: 'issue260-production-pricing-fixture', schemaVersion: 1, parentRunId: runId,
      databaseName: new URL(databaseUrl).pathname.slice(1), actorId: fixture.actorId,
      effectiveAuthority: fixture.effectiveAuthority, loadingIds: fixture.loadings.map(loading => loading.id),
      versionId: fixture.versionId, rowId: fixture.rowId, contractedQuantity: fixture.contractedQuantity,
      expectedGrossAmount: fixture.expectedGrossAmount, versionIntegrityHash: fixture.versionIntegrityHash,
      approvedVersionGrossAmount: fixture.approvedVersionGrossAmount,
      readinessEvidenceHash: fixture.readinessEvidenceHash }));
  } finally { await prisma.$disconnect(); }
};

run();
