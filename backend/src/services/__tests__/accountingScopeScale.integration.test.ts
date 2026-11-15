import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { seedHistoricalAccountingRead } from './partnerAccountingHistoricalReadSeed';

for (const role of ['ADMIN', 'USER'] as const) test(`Accounting scope keeps per-case decisions with 43 Partner cases for ${role}`, async () => {
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
      for (let index = 0; index < 42; index++) {
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
      await tx.salesContract.createMany({ data: Array.from({ length: 935 }, (_, index) => ({
        id: `ordinary-scale-${index}`, contractNumber: `ordinary-scale-number-${index}`,
        title: 'Fixture', titlePersian: 'آزمون', content: 'Fixture', customerId: 'historical-customer',
        departmentId: 'historical-department', createdBy: 'historical-admin',
        responsibleSellerId: 'historical-admin',
      })) });
      if (role === 'USER') await tx.contractLifecycleRequest.create({ data: {
        contractId: 'contract-scale-0', contractNumberSnapshot: 'number-scale-0',
        kind: 'DELETE', status: 'EXECUTED', reason: 'Fixture deletion',
        requestedBy: 'historical-admin', decidedBy: 'historical-admin', executedAt: new Date(),
      } });
      await tx.accountingAuditLog.createMany({ data: Array.from({ length: 30 }, (_, index) => ({
        id: `heavy-audit-${index}`, action: 'SCALE_AUDIT_FIXTURE', actorId: 'historical-admin',
        recordId: 'historical-invoice', afterState: { partnerCaseId: fixture.row.id, unrelated: 'x'.repeat(100_000) },
      })) });
    });
    const script = `
      import assert from 'node:assert/strict';
      import { prisma } from './backend/src/lib/prisma';
      import { PrismaClient } from './backend/node_modules/@prisma/client/index.js';
      import { withAccountingReadScope } from './backend/src/services/partnerSales/accounting/readScope';
      import { readPartnerInternalDocument } from './backend/src/services/partnerSales/accounting/internalDocument';
      import { readCustomerWorkspace } from './backend/src/services/accountingCustomerWorkspace';
      (async () => { try {
        const expectedIds = new Set([${JSON.stringify(fixture.row.id)}, ...Array.from({ length: 42 }, (_, index) => 'scale-' + index)]);
        const deletedId = '${role}' === 'USER' ? 'scale-0' : null;
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
            if (event.rootId === deletedId) {
              assert.equal(event.action, 'ACCOUNTING_READ'); assert.equal(event.allowed, false);
            } else {
              assert.equal(event.allowed, true); assert.equal(event.code, 'ALLOWED');
            }
            assert.ok(event.authorizationRevision > 0 && event.evaluatedAt instanceof Date);
            const group = groups.get(event.correlationId) ?? []; group.push(event); groups.set(event.correlationId, group);
          }
          assert.equal(groups.size, expectedGroups);
          for (const group of groups.values()) {
            assert.equal(group.length, deletedId ? 85 : 86);
            for (const action of ['ACCOUNTING_READ', 'ACCOUNTING_WRITE']) {
              const ids = group.filter(event => event.action === action).map(event => event.rootId);
              assert.equal(ids.length, action === 'ACCOUNTING_WRITE' && deletedId ? 42 : 43);
              assert.deepEqual(new Set(ids), action === 'ACCOUNTING_WRITE' && deletedId
                ? new Set([...expectedIds].filter(id => id !== deletedId)) : expectedIds);
            }
          }
        };
        const started = performance.now();
        await read();
        const singleMs = Math.round(performance.now() - started);
        assert.ok(singleMs < 1000, '43-Case Accounting scope should finish within the local read budget; took ' + singleMs + ' ms');
        await checkAudits(1);
        const concurrentStarted = performance.now();
        await Promise.all([read(), read()]);
        const twoConcurrentMs = Math.round(performance.now() - concurrentStarted);
        await checkAudits(3);
        const document = await readPartnerInternalDocument('historical-case', 'historical-admin');
        assert.ok(document?.financialRecords.some(row => row.id === 'historical-invoice'));
        const documentAudits = await prisma.$queryRaw\`SELECT "rootId", action FROM effective_authorization_audit WHERE purpose = 'ACCOUNTING' AND channel = 'LIST' ORDER BY "evaluatedAt" DESC LIMIT 2\`;
        assert.deepEqual(new Set(documentAudits.map(row => row.rootId)), new Set(['historical-case']),
          'single-Case document read must not authorize unrelated Cases');
        const beforeCustomer = await prisma.effectiveAuthorizationAudit.count({ where: { purpose: 'ACCOUNTING', channel: 'LIST' } });
        const customer = await readCustomerWorkspace(prisma, { id: 'customer:historical-customer', asOf: new Date(), userId: 'historical-admin' });
        assert.equal(customer.customerId, 'historical-customer');
        const afterCustomer = await prisma.effectiveAuthorizationAudit.count({ where: { purpose: 'ACCOUNTING', channel: 'LIST' } });
        assert.equal(afterCustomer, beforeCustomer, 'ordinary customer statement must not authorize unrelated Partner Cases');
        if ('${role}' === 'USER') {
          const writer = new PrismaClient();
          try {
            let releaseCaseRead;
            let enteredCaseRead;
            const caseEntered = new Promise(resolve => { enteredCaseRead = resolve; });
            const caseRelease = new Promise(resolve => { releaseCaseRead = resolve; });
            const caseRead = withAccountingReadScope(prisma, { userId: 'historical-admin' }, async scope => {
              const current = await scope.database.partnerProfile.findUnique({ where: { id: '${fixture.row.profileId}' },
                select: { state: true } });
              enteredCaseRead(); await caseRelease; return current?.state;
            });
            await caseEntered;
            let mutated = false;
            const mutate = writer.partnerProfile.update({ where: { id: '${fixture.row.profileId}' },
              data: { state: 'SUSPENDED', revision: { increment: 1 } } }).then(() => { mutated = true; });
            await new Promise(resolve => setTimeout(resolve, 40));
            assert.equal(mutated, false, 'profile mutation must wait for the authorized snapshot');
            releaseCaseRead();
            assert.equal(await caseRead, 'ACTIVE');
            await mutate;
            assert.equal(await withAccountingReadScope(prisma, { userId: 'historical-admin' }, async scope =>
              (await scope.database.partnerProfile.findUnique({ where: { id: '${fixture.row.profileId}' },
                select: { state: true } }))?.state), 'SUSPENDED');
            let releaseRead;
            let enteredRead;
            const entered = new Promise(resolve => { enteredRead = resolve; });
            const release = new Promise(resolve => { releaseRead = resolve; });
            const inFlight = withAccountingReadScope(prisma, { userId: 'historical-admin' }, async scope => {
              const visible = await scope.database.accountingFinancialRecord.count({ where: scope.financial() });
              enteredRead(); await release; return visible;
            });
            await entered;
            let revoked = false;
            const revoke = writer.user.update({ where: { id: 'historical-admin' }, data: { isActive: false } })
              .then(() => { revoked = true; });
            await new Promise(resolve => setTimeout(resolve, 40));
            assert.equal(revoked, false, 'actor revocation must wait for the authorized snapshot');
            releaseRead();
            assert.ok(await inFlight > 0);
            await revoke;
            await withAccountingReadScope(prisma, { userId: 'historical-admin' }, async scope => {
              assert.equal(await scope.database.accountingFinancialRecord.count({ where: scope.financial({
                sourceKind: 'PARTNER_INTERNAL_RECORD',
              }) }), 0, 'new snapshot must exclude revoked Partner evidence');
            });
            const denied = await prisma.effectiveAuthorizationAudit.findMany({ where: {
              actorId: 'historical-admin', purpose: 'ACCOUNTING', channel: 'LIST', allowed: false,
            }, orderBy: { evaluatedAt: 'desc' }, take: 44 });
            assert.ok(denied.length >= 43);
            assert.ok(denied.some(event => event.rootId === 'historical-case'));
          } finally { await writer.$disconnect(); }
        }
        console.log(JSON.stringify({ role: '${role}', cases: 43, ordinary: 935, singleMs, twoConcurrentMs }));
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
