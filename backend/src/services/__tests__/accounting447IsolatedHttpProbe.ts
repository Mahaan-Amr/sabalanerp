import assert from 'node:assert/strict';
import express from 'express';
import accountingRouter from '../../routes/accounting';
import { prisma } from '../../lib/prisma';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';
import { createAccountingRequestObserver } from '../../middleware/accountingRequestObserver';
import type { AccountingReadTimings } from '../accountingReadTiming';

const measuredStages = ['lockWait', 'authorization', 'population', 'rowHydration'] as const;
const p95 = (samples: number[]) => samples.sort((a, b) => a - b)[Math.ceil(0.95 * samples.length) - 1];

async function main() {
  const actorId = process.env.ACCOUNTING_447_ACTOR_ID;
  assert.ok(actorId);
  const customerId = process.env.ACCOUNTING_447_CUSTOMER_ID;
  const departmentId = process.env.ACCOUNTING_447_DEPARTMENT_ID;
  assert.ok(customerId && departmentId);
  const partnerRows = JSON.parse(process.env.ACCOUNTING_447_PARTNER_ROWS || '[]') as
    { caseId: string; contractId: string }[];
  assert.equal(partnerRows.length, 30);
  const { token, session } = await createAuthoritativeSession(prisma, actorId, { ipAddress: '127.0.0.1' });
  const app = express();
  const stagesByRequest = new Map<string, AccountingReadTimings>();
  app.use(createAccountingRequestObserver(process.env.APP_COMMIT, record => {
    if (record.stagesMs) stagesByRequest.set(record.requestId, record.stagesMs);
  }));
  app.use('/api/accounting', accountingRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/accounting`;
    const headers = { Cookie: `${SESSION_COOKIE}=${token}`, 'x-sabalan-expected-user': actorId,
      'x-sabalan-expected-session': session.id };
    const get = async (route: string) => {
      const response = await fetch(`${base}${route}`, { headers });
      const body = await response.json() as { success?: boolean; data?: any; error?: string };
      assert.equal(response.status, 200, `${route}: ${JSON.stringify(body).slice(0, 500)}`);
      assert.equal(body.success, true, route);
      return body.data;
    };
    for (const [name, path] of [['dashboard', '/dashboard?range=3m'],
      ['reviewable', '/contracts?view=reviewable&page=1&pageSize=12']] as const) {
      const samples: number[] = [];
      const stageSamples = measuredStages.map(stage => ({ stage, samples: [] as number[] }));
      for (let index = 0; index < 20; index++) {
        const started = performance.now();
        const response = await fetch(`${base}${path}`, { headers });
        const body = await response.json() as { success?: boolean; data?: any; code?: string };
        samples.push(Math.round(performance.now() - started));
        assert.equal(response.status, 200, `${name}: ${JSON.stringify(body).slice(0, 300)}`);
        assert.equal(body.success, true);
        const requestId = response.headers.get('x-accounting-request-id');
        assert.ok(requestId, `${name}: request correlation`);
        const observedStages = stagesByRequest.get(requestId);
        for (const sample of stageSamples) {
          const duration = observedStages?.[sample.stage];
          assert.ok(typeof duration === 'number' && Number.isFinite(duration) && duration >= 0, `${name}: ${sample.stage}`);
          sample.samples.push(duration);
        }
        stagesByRequest.delete(requestId);
        if (name === 'reviewable') assert.equal(body.data?.total, 965);
        else assert.equal(body.data?.workspace?.commandCenter?.reviewableContracts?.count, 965);
      }
      const durationP95 = p95(samples);
      const stageP95Ms = Object.fromEntries(stageSamples.map(sample => [sample.stage, p95(sample.samples)]));
      console.log(JSON.stringify({ name, samples, p95: durationP95, stageP95Ms }));
    }
    for (const [sourceKind, expected] of [['SALES_CONTRACT', 935], ['PARTNER_INTERNAL_RECORD', 30]] as const) {
      const response = await fetch(`${base}/contracts?view=reviewable&sourceKind=${sourceKind}&page=1&pageSize=100`, {
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      });
      const body = await response.json() as { data?: { total: number; items: { sourceKind: string }[] } };
      assert.equal(response.status, 200);
      assert.equal(body.data?.total, expected, sourceKind);
      assert.ok(body.data?.items.every(item => sourceKind === 'SALES_CONTRACT'
        ? item.sourceKind !== 'PARTNER_INTERNAL_RECORD' : item.sourceKind === sourceKind));
    }
    const expectedOrdinary = Array.from({ length: 935 }, (_, index) => `accounting-447-ordinary-${index}`);
    const expectedPartner = partnerRows.map(row => row.contractId);
    const allIds: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await get(`/contracts?view=reviewable&page=${page}&pageSize=100`);
      assert.equal(data.total, 965);
      assert.equal(data.page, page);
      assert.equal(data.items.length, page === 10 ? 65 : 100);
      allIds.push(...data.items.map((item: { contractId: string }) => item.contractId));
    }
    assert.equal(new Set(allIds).size, 965, 'pages do not duplicate or omit records');
    assert.deepEqual(new Set(allIds), new Set([...expectedOrdinary, ...expectedPartner]),
      'complete authorized population is exactly the fixture population');
    const ordinaryFirst = await get('/contracts?view=reviewable&sourceKind=SALES_CONTRACT&page=1&pageSize=100');
    const ordinaryAgain = await get('/contracts?view=reviewable&sourceKind=SALES_CONTRACT&page=1&pageSize=100');
    assert.deepEqual(ordinaryAgain.items.map((item: { contractId: string }) => item.contractId),
      ordinaryFirst.items.map((item: { contractId: string }) => item.contractId), 'tie ordering is stable');
    assert.deepEqual(ordinaryFirst.items.map((item: { contractId: string }) => item.contractId),
      [...expectedOrdinary].sort().slice(0, 100), 'equal-date ordinary rows use the ID tie breaker');
    const partnerOnly = await get('/contracts?view=reviewable&sourceKind=PARTNER_INTERNAL_RECORD&page=1&pageSize=100');
    assert.deepEqual(new Set(partnerOnly.items.map((item: { contractId: string }) => item.contractId)),
      new Set(expectedPartner));
    for (const row of partnerOnly.items) {
      assert.equal(row.sourceKind, 'PARTNER_INTERNAL_RECORD');
      assert.ok(row.partnerContext?.caseNumber);
      assert.ok(row.partnerContext?.internalRecordNumber);
      assert.equal(row.preparationOnly, true);
      assert.equal(row.accounting?.invoiceStatus, 'NONE');
      assert.ok(row.nextBestActions?.some((action: { kind: string }) => action.kind === 'CREATE_INVOICE'));
    }
    const searched = await get('/contracts?view=reviewable&search=accounting-447-ordinary-42&page=1&pageSize=100');
    assert.ok(searched.items.some((item: { contractId: string }) => item.contractId === 'accounting-447-ordinary-42'));
    assert.ok(searched.items.every((item: { sourceKind: string }) => item.sourceKind !== 'PARTNER_INTERNAL_RECORD'));
    const draftOnly = await get('/contracts?view=reviewable&status=DRAFT&page=1&pageSize=100');
    assert.equal(draftOnly.total, 935);
    assert.ok(draftOnly.items.every((item: { status: string }) => item.status === 'DRAFT'));
    const signedOnly = await get('/contracts?view=reviewable&status=SIGNED&page=1&pageSize=100');
    assert.equal(signedOnly.total, 30);
    assert.deepEqual(new Set(signedOnly.items.map((item: { contractId: string }) => item.contractId)),
      new Set(expectedPartner));
    const customerList = await get('/ledger/customer-accounts?page=1&pageSize=50');
    assert.ok(customerList.items.some((item: { customerId: string }) => item.customerId === customerId));
    const customer = await get(`/ledger/customer-accounts/customer:${encodeURIComponent(customerId)}`);
    assert.equal(customer.contracts?.length, 935);
    assert.deepEqual(new Set(customer.contracts.map((item: { id: string }) => item.id)), new Set(expectedOrdinary));
    for (const row of partnerRows.slice(0, 3)) {
      const document = await get(`/contracts/partner/${encodeURIComponent(row.caseId)}/internal`);
      assert.equal(document.caseState, 'COMMITTED');
      assert.ok(document.partnerContext?.internalRecordNumber);
      assert.equal(typeof document.actions?.canRequestCorrection, 'boolean');
    }
    for (const route of ['/financial-records', '/receivables', '/payments', '/tax',
      '/correction-requests', '/audit', '/performance']) {
      const response = await fetch(`${base}${route}`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
      const body = await response.json() as { success?: boolean; error?: string };
      assert.equal(response.status, 200, `${route}: ${JSON.stringify(body).slice(0, 300)}`);
      assert.equal(body.success, true, route);
    }
    const concurrentReads = [get('/contracts?view=reviewable&page=1&pageSize=100'),
      get('/dashboard?range=3m')];
    await prisma.salesContract.create({ data: { id: 'accounting-447-mutation', contractNumber: 'accounting-447-mutation',
      title: 'Qualification mutation', titlePersian: 'تغییر آزمون', content: 'Qualification mutation',
      customerId, departmentId, createdBy: actorId, responsibleSellerId: actorId } });
    await Promise.all(concurrentReads);
    const afterMutation = await get('/contracts?view=reviewable&page=1&pageSize=100');
    assert.equal(afterMutation.total, 966);
    const simultaneous = [fetch(`${base}/contracts?view=reviewable&page=1&pageSize=12`, { headers }),
      fetch(`${base}/dashboard?range=3m`, { headers })];
    await prisma.user.update({ where: { id: actorId }, data: { isActive: false } });
    const inFlight = await Promise.all(simultaneous);
    for (const response of inFlight) {
      const body = await response.json() as { success?: boolean; error?: string };
      assert.ok(response.status === 200 || response.status === 401,
        `in-flight revocation read failed: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
      assert.equal(body.success, response.status === 200);
    }
    for (const route of ['/dashboard?range=3m', '/contracts?view=reviewable&page=1&pageSize=12',
      '/ledger/customer-accounts?page=1&pageSize=10', `/contracts/partner/${partnerRows[0].caseId}/internal`]) {
      const denied = await fetch(`${base}${route}`, { headers });
      assert.equal(denied.status, 401, `revoked actor retained ${route}`);
    }
    console.log(JSON.stringify({ parityIds: allIds.length, mutationTotal: afterMutation.total,
      inFlightStatuses: inFlight.map(response => response.status), revocationStatus: 401 }));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
