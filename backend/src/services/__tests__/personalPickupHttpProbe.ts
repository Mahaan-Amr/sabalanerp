import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

async function run() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.match(url.pathname, /^\/sabalanerp_(concurrency|dispatchdocs)_[a-f0-9]{16}$/);
  const ordinary = process.env.PERSONAL_ORDINARY_FIXTURE
    ? JSON.parse(process.env.PERSONAL_ORDINARY_FIXTURE) as {
      actorId: string; contractNumber: string; loadingId: string; itemId: string; unrelatedNumber: string;
    } : null;
  const logisticsId = ordinary?.actorId || process.env.PARTNER_TEST_ACTOR_ID!;
  const accountantId = ordinary ? randomUUID() : process.env.PARTNER_TEST_ACCOUNTANT_ID!;
  const expected = ordinary ? undefined : JSON.parse(process.env.PARTNER_TEST_OWNER!);
  const sandbox = await mkdtemp(path.join(tmpdir(), 'partner-personal-pickup-'));
  const originalCwd = process.cwd();
  await symlink(path.resolve(__dirname, '../../../public'), path.join(sandbox, 'public'), 'dir');
  process.chdir(sandbox);
  process.env.BIOMETRIC_TEMPLATE_KEY_BASE64 = randomBytes(32).toString('base64');
  process.env.DISPATCH_CONFIRMATION_OTP_SECRET = randomUUID();
  delete process.env.SMS_IR_API_KEY;
  const { prisma } = await import('../../lib/prisma');
  try {
    const [{ default: logistics }, { default: guard }, { default: accounting }, { default: confirmation }, { default: partnerAccounting },
      { createAuthoritativeSession, SESSION_COOKIE }] = await Promise.all([
      import('../../routes/logistics'), import('../../routes/canonical-guard-queue'), import('../../routes/accounting'),
      import('../../routes/dispatch-confirmation'), import('../../routes/partner-accounting'), import('../identitySessionService'),
    ]);
    if (ordinary) {
      await prisma.effectiveAuthorizationState.upsert({ where: { id: 1 }, create: { id: 1, revision: 1 }, update: {} });
      await prisma.user.create({ data: { id: accountantId, username: accountantId, email: `${accountantId}@example.invalid`,
        firstName: 'آزمون', lastName: 'حسابداری', password: 'not-a-login' } });
    }
    await prisma.workspacePermission.upsert({ where: { userId_workspace: { userId: accountantId, workspace: 'accounting' } },
      create: { userId: accountantId, workspace: 'accounting', permissionLevel: 'admin', grantedBy: logisticsId },
      update: { permissionLevel: 'admin' } });
    const guardId = randomUUID();
    await prisma.user.create({ data: { id: guardId, username: guardId, email: `${guardId}@example.invalid`,
      firstName: 'آزمون', lastName: 'گارد', password: 'not-a-login' } });
    await prisma.workspacePermission.create({ data: { userId: guardId, workspace: 'security', permissionLevel: 'edit', grantedBy: logisticsId } });
    const features = ordinary
      ? ['accounting_dispatch_candidates_view', 'accounting_dispatch_candidates_manage', 'accounting_dispatch_confirmation_manage']
      : ['accounting_dispatch_confirmation_manage', 'accounting_records_approve_void', 'accounting_receivables_manage'];
    for (const feature of features) {
      await prisma.featurePermission.upsert({ where: { userId_workspace_feature: { userId: accountantId, workspace: 'accounting', feature } },
        create: { userId: accountantId, workspace: 'accounting', feature, permissionLevel: 'edit', grantedBy: logisticsId },
        update: { permissionLevel: 'edit' } });
    }
    const [loader, accountant, officer] = await Promise.all([logisticsId, accountantId, guardId].map(id =>
      createAuthoritativeSession(prisma, id, { ipAddress: '127.0.0.1', userAgent: 'personal-pickup-local-acceptance' })));
    const app = express();
    app.use(express.json());
    app.use('/logistics', logistics);
    app.use('/accounting', accounting);
    app.use('/confirmation', confirmation);
    app.use('/partner-accounting', partnerAccounting);
    app.use('/security', guard);
    if (process.env.PERSONAL_PICKUP_BROWSER === '1') {
      // The schema-only clone omits these singleton rows inserted by migrations.
      const id = 'customer-shipment-statements';
      await prisma.shipmentStatementCutover.create({ data: { id, enabled: false } });
      await prisma.shipmentStatementOperationsControl.create({ data: { id, paused: true,
        reason: 'Paused safely until an administrator starts the activated flow.' } });
      for (const [prefix, router] of Object.entries({
        '/logistics': logistics,
        '/accounting': accounting,
        '/dispatch-confirmation': confirmation,
        '/system-recovery': (await import('../../routes/system-recovery')).default,
        '/duties': (await import('../../routes/hr-duties')).default,
        '/auth': (await import('../../routes/auth')).default,
        '/dashboard': (await import('../../routes/dashboard')).default,
        '/workspace-permissions': (await import('../../routes/workspace-permissions')).default,
        '/dispatch-cases': (await import('../../routes/dispatch-cases')).default,
        '/security': (await import('../../routes/security')).default,
        '/notifications': (await import('../../routes/notifications')).default,
        '/permissions': (await import('../../routes/permissions')).default,
      })) app.use(`/api${prefix}`, router);
    }
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const request = async (token: string, urlPath: string, status: number, payload?: unknown, method = payload ? 'POST' : 'GET') => {
        const id = randomUUID();
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${urlPath}`, {
          method, headers: { cookie: `${SESSION_COOKIE}=${token}`, 'Content-Type': 'application/json',
            'Idempotency-Key': id, 'X-Correlation-ID': id }, body: payload ? JSON.stringify(payload) : undefined,
        });
        const body = await response.json() as any;
        assert.equal(response.status, status, `${method} ${urlPath}: ${JSON.stringify(body)}`);
        return body;
      };
      const reason = 'آزمون محلی تحویل با سواری شخصی';
      let contractNumber: string;
      let partnerName: string | undefined;
      let loadingId: string;
      if (ordinary) {
        ({ contractNumber, loadingId } = ordinary);
      } else {
        const selectedCase = await prisma.partnerSaleCase.findUniqueOrThrow({ where: { id: expected.caseId },
          include: { customerContract: true, profile: { include: { user: true } } } });
        assert.ok(selectedCase.customerContract);
        const invoice = await prisma.accountingFinancialRecord.findFirstOrThrow({ where: { sourceId: selectedCase.internalRecordId! } });
        if (!invoice.financiallyApprovedAt) await request(accountant.token, '/accounting/actions', 200, { kind: 'APPROVE_FINANCIAL_INVOICE',
          invoiceId: invoice.id, systemInvoiceNumber: `${invoice.id}-qa`, systemInvoiceDate: new Date().toISOString(),
          sepidarAmount: '1600', note: 'تأیید مالی آزمایشی فروش همکار' });
        await request(accountant.token, '/partner-accounting/receivables', 200, { expected, invoiceRecordId: invoice.id });
        contractNumber = selectedCase.customerContract.contractNumber;
        partnerName = [selectedCase.profile.user.firstName, selectedCase.profile.user.lastName].filter(Boolean).join(' ');
        if (process.env.PERSONAL_PICKUP_BROWSER === '1') {
          const { runPartnerPersonalPickupBrowser } = await import('./partnerPersonalPickupBrowser');
          const before = await prisma.accountingFinancialRecord.count();
          const { createPartnerFixtures } = await import('@sabalanerp/partner-sales-contracts/testing');
          const customerName = createPartnerFixtures().customer.customer.displayName;
          const password = randomUUID();
          const { default: bcrypt } = await import('bcryptjs');
          const users = await Promise.all([logisticsId, accountantId, guardId].map(async id => {
            const hash = await bcrypt.hash(password, 10);
            return prisma.user.update({ where: { id }, data: { password: hash, mustChangePassword: false }, select: { username: true } });
          }));
          const customer = await prisma.crmCustomer.findUniqueOrThrow({ where: { id: selectedCase.customerId } });
          const customerLookupName = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
          const { admitGuardDriverQueueTurn, makeGuardQueueTurnAvailable } = await import('../guardDriverQueue');
          const readyDriver = await admitGuardDriverQueueTurn(prisma, {
            source: 'CUSTOMER_PICKUP', plate: '12ب34567', vehicleType: 'وانت', phone: '09120000001', actorId: guardId,
          });
          await makeGuardQueueTurnAvailable(prisma, readyDriver.id, guardId);
          const result = await runPartnerPersonalPickupBrowser({
            apiOrigin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
            logisticsUser: users[0].username, accountingUser: users[1].username, guardUser: users[2].username, password,
            contractNumber, partnerName, customerName, customerLookupName,
          });
          assert.equal(await prisma.accountingFinancialRecord.count(), before);
          assert.equal(await prisma.dispatchOtpChallenge.count({ where: { sessionId: result.authorization.id } }), 0);
          assert.equal(await prisma.dispatchBiometricAttempt.count({ where: { sessionId: result.authorization.id } }), 0);
          const authorizationId = result.authorization.authorization.id;
          assert.equal(await prisma.guardPhysicalExit.count({ where: { authorizationId } }), 1);
          assert.equal((await prisma.dispatchExitAuthorization.findUniqueOrThrow({ where: { id: authorizationId } })).status, 'CONSUMED');
          const evidence = await prisma.shipmentQuantityEvidence.findFirstOrThrow({
            where: { kind: 'PHYSICAL_EXIT', metadata: { path: ['physicalExitId'], equals: result.exit.id } },
          });
          assert.equal(evidence.partnerCaseId, expected.caseId);
          assert.equal(evidence.quantity.toString(), '0.75');
          assert.equal(result.exit.smsIntent.status, 'PENDING');
          console.log(`Partner personal pickup browser PASS: contract ${contractNumber}, loading ${result.loadingId}, exit ${result.exit.id}.`);
          return;
        }
        loadingId = (await request(loader.token, '/logistics/loadings', 201, {
          sourceKind: 'PARTNER_CASE', expected, deliveryId: 'second-delivery', reason,
        })).data.loadingId;
      }
      const loadingPath = `/logistics/loadings/${loadingId}`;
      const loading = (await request(loader.token, loadingPath, 200)).data;
      const turn = (await request(loader.token, `${loadingPath}/transport`, 200, { mode: 'PERSONAL', expected }, 'PUT')).data.turn;
      assert.equal(turn.driverSource, 'PERSONAL_PICKUP');
      assert.equal(await prisma.guardDriverQueueEvent.count({ where: { turnId: turn.id, eventType: 'ADMITTED' } }), 0);
      const lines = ordinary ? [{ sourceContractItemId: ordinary.itemId, quantity: '1', unit: 'count' }]
        : [{ sourceKind: 'PARTNER_CASE', productRowId: loading.source.rows[0].productRowId, quantity: '0.250', unit: loading.source.rows[0].unit }];
      await request(loader.token, `${loadingPath}/canonical-allocations/${turn.id}`, 200, { expected, reason, lines }, 'PUT');
      const candidate = (await request(loader.token, `${loadingPath}/finalize`, 200, { expected, reason })).data.revisions[0].candidate;
      const candidates = (await request(accountant.token, '/accounting/dispatch-candidates', 200)).data;
      const summary = candidates.find((row: any) => row.id === candidate.id)?.summary;
      const checkSummary = (item: any) => {
        assert.equal(item.customerName, ordinary ? 'آزمون شخصی' : loading.source.recipient.displayName);
        assert.deepEqual(item.personalPickup.contracts.map((row: any) => row.number), [contractNumber]);
        assert.deepEqual(item.personalPickup.partners.map((row: any) => row.name), partnerName ? [partnerName] : []);
        if (ordinary) assert.ok(!JSON.stringify(item).includes(ordinary.unrelatedNumber));
      };
      checkSummary(summary);
      const accepted = await request(accountant.token, `/accounting/dispatch-candidates/${candidate.id}/decision`, 200, { action: 'ACCEPT' });
      const waybillId = accepted.data.waybill.id;
      const authorizationPath = `/confirmation/waybills/${waybillId}/sessions`;
      await request(accountant.token, authorizationPath, 409, { workstationId: 'ACCOUNTING-WEB' });
      await request(accountant.token, `/accounting/loadings/${loadingId}/sales-invoices`, 200, {});
      const financialCount = await prisma.accountingFinancialRecord.count();
      const authorized = (await request(accountant.token, authorizationPath, 201, { workstationId: 'ACCOUNTING-WEB' })).data;
      assert.equal(authorized.method, 'PERSONAL_PICKUP_ACCOUNTING');
      assert.equal(authorized.status, 'CONFIRMED');
      assert.equal(await prisma.accountingFinancialRecord.count(), financialCount);
      assert.equal(await prisma.dispatchOtpChallenge.count({ where: { sessionId: authorized.id } }), 0);
      assert.equal(await prisma.dispatchBiometricAttempt.count({ where: { sessionId: authorized.id } }), 0);
      const authorizationId = authorized.authorization.id;
      const listPath = '/security/exit-desk/authorizations';
      const guardItem = (await request(officer.token, listPath, 200)).data.find((row: any) => row.id === authorizationId);
      checkSummary(guardItem.summary);
      const exitPath = `${listPath}/${authorizationId}/exit`;
      const exited = (await request(officer.token, exitPath, 201, { reasonDetail: reason })).data;
      assert.equal((await request(officer.token, exitPath, 201, { reasonDetail: reason })).data.id, exited.id);
      assert.equal(await prisma.guardPhysicalExit.count({ where: { authorizationId } }), 1);
      const evidence = await prisma.shipmentQuantityEvidence.findMany({ where: {
        kind: 'PHYSICAL_EXIT', metadata: { path: ['physicalExitId'], equals: exited.id },
      } });
      assert.equal(evidence.length, 1);
      assert.equal(evidence[0].quantity.toString(), ordinary ? '1' : '0.25');
      if (!ordinary) {
        assert.equal(evidence[0].partnerCaseId, expected.caseId);
        assert.equal(evidence[0].contractId, null);
      }
      assert.equal((await prisma.dispatchExitAuthorization.findUniqueOrThrow({ where: { id: authorizationId } })).status, 'CONSUMED');
      assert.equal((await request(officer.token, listPath, 200)).data.some((row: any) => row.id === authorizationId), false);
      assert.equal(exited.smsIntent.status, 'PENDING');
      console.log(`${ordinary ? 'Ordinary' : 'Partner'} personal pickup passed via HTTP: contract ${contractNumber}, loading ${loadingId}, exit ${exited.id}, SMS intent ${exited.smsIntent.status}.`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } finally {
    await prisma.$disconnect();
    process.chdir(originalCwd);
    await rm(sandbox, { recursive: true, force: true });
  }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
