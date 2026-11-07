import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { seedHistoricalAccountingRead } from './partnerAccountingHistoricalReadSeed';

for (const role of ['ADMIN', 'USER'] as const) test(`Accounting scope keeps per-case decisions with 35 Partner cases for ${role}`, async () => {
  const source = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  assert.equal(source.hostname, '127.0.0.1');
  assert.equal(source.port, '55432');
  assert.equal(source.pathname, '/sabalanerp');
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: process.cwd(), sourceDatabaseUrl: source.toString() });
  const database = temporary.client();
  try {
    const { fixture } = await seedHistoricalAccountingRead(database);
    if (role === 'USER') {
      await database.user.update({ where: { id: 'historical-admin' }, data: { role } });
      await database.workspacePermission.create({ data: { userId: 'historical-admin', workspace: 'accounting', permissionLevel: 'admin' } });
    }
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (let index = 0; index < 34; index++) {
        const suffix = `scale-${index}`;
        await tx.partnerSaleCase.create({ data: { id: suffix, caseNumber: suffix,
          profileId: fixture.row.profileId, customerId: 'historical-customer', internalRecordId: `internal-${suffix}`,
          customerContractId: `contract-${suffix}`, headRevision: 1, integrityHash: fixture.row.integrityHash,
          state: 'COMMITTED', committedAt: new Date('2026-10-01'), commitmentTrigger: 'SIGNED',
          committedRevision: 1, commitmentEventId: `event-${suffix}` } });
        await tx.sabalanToPartnerSaleRecord.create({ data: { id: `internal-${suffix}`, recordNumber: `record-${suffix}`,
          caseId: suffix, commercialAccountId: 'historical-account', expectedRevision: 1, integrityHash: fixture.row.integrityHash } });
        await tx.salesContract.create({ data: { id: `contract-${suffix}`, contractNumber: `number-${suffix}`,
          title: 'Fixture', titlePersian: 'آزمون', content: 'Fixture', customerId: 'historical-customer',
          departmentId: 'historical-department', createdBy: 'historical-partner', responsibleSellerId: 'historical-partner',
          partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: suffix, partnerRevision: 1,
          partnerIntegrityHash: fixture.row.integrityHash } });
      }
      await tx.accountingAuditLog.createMany({ data: Array.from({ length: 30 }, (_, index) => ({
        id: `heavy-audit-${index}`, action: 'SCALE_AUDIT_FIXTURE', actorId: 'historical-admin',
        recordId: 'historical-invoice', afterState: { partnerCaseId: fixture.row.id, unrelated: 'x'.repeat(100_000) },
      })) });
    });
    const script = `
      import assert from 'node:assert/strict';
      import { prisma } from './backend/src/lib/prisma';
      import { withAccountingReadScope } from './backend/src/services/partnerSales/accounting/readScope';
      (async () => { try {
        const expectedIds = new Set([${JSON.stringify(fixture.row.id)}, ...Array.from({ length: 34 }, (_, index) => 'scale-' + index)]);
        const read = () => withAccountingReadScope(prisma, { userId: 'historical-admin' }, async scope => {
          const visible = await scope.database.accountingFinancialRecord.findMany({ where: scope.financial(), select: { id: true } });
          assert.ok(visible.some(row => row.id === 'historical-invoice'));
          const visibleAudits = await scope.database.accountingAuditLog.count({ where: scope.audit({ action: 'SCALE_AUDIT_FIXTURE' }) });
          assert.equal(visibleAudits, 30);
        });
        const checkAudits = async expectedGroups => {
          const events = await prisma.$queryRaw\`SELECT action, "rootId", "rootKind", "actorId", allowed, code, "correlationId", "authorizationRevision", "evaluatedAt" FROM effective_authorization_audit WHERE purpose = 'ACCOUNTING' AND channel = 'LIST'\`;
          const groups = new Map();
          for (const event of events) {
            assert.equal(event.actorId, 'historical-admin'); assert.equal(event.rootKind, 'CASE');
            assert.equal(event.allowed, true); assert.equal(event.code, 'ALLOWED');
            assert.ok(event.authorizationRevision > 0 && event.evaluatedAt instanceof Date);
            const group = groups.get(event.correlationId) ?? []; group.push(event); groups.set(event.correlationId, group);
          }
          assert.equal(groups.size, expectedGroups);
          for (const group of groups.values()) {
            assert.equal(group.length, 70);
            for (const action of ['ACCOUNTING_READ', 'ACCOUNTING_WRITE']) {
              const ids = group.filter(event => event.action === action).map(event => event.rootId);
              assert.equal(ids.length, 35); assert.deepEqual(new Set(ids), expectedIds);
            }
          }
        };
        const started = performance.now();
        await read();
        const singleMs = Math.round(performance.now() - started);
        await checkAudits(1);
        const concurrentStarted = performance.now();
        await Promise.all([read(), read()]);
        const twoConcurrentMs = Math.round(performance.now() - concurrentStarted);
        await checkAudits(3);
        console.log(JSON.stringify({ role: '${role}', cases: 35, singleMs, twoConcurrentMs }));
      } finally { await prisma.$disconnect(); } })().catch(error => { console.error(error); process.exitCode = 1; });`;
    const output = execFileSync(process.execPath, [path.resolve('backend/node_modules/tsx/dist/cli.mjs'), '-e', script], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 90_000, env: { ...process.env, DATABASE_URL: temporary.databaseUrl },
    });
    console.log(output.trim());
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
