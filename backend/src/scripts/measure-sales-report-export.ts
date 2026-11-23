import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { disconnectDatabase, prisma } from '../lib/prisma';
import salesReports from '../routes/salesReports';
import { createAuthoritativeSession, SESSION_COOKIE } from '../services/identitySessionService';
import { buildSalesReport } from '../services/salesReportingService';
import { encodeSalesReportWorkbook } from '../services/salesReportWorkbook';

const database = new URL(process.env.DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname) && database.pathname === '/sabalanerp',
  'Measurement requires the existing sabalanerp-local database');
const rows = Number(process.argv[2] || 12000);
assert.ok(Number.isInteger(rows) && rows >= 100 && rows <= 24000);
const runId = 'sales-export-measurement-' + randomUUID();
const startDate = new Date('2026-10-01T08:00:00Z');
const filters = { period: 'all' };

const percentile = (samples: number[], quantile: number) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * quantile) - 1];

async function seed(tag: string, count: number) {
  const id = runId + '-' + tag;
  const session = await prisma.$transaction(async (tx) => {
    await tx.department.create({ data: { id, name: id, namePersian: 'آزمون خروجی فروش ' + id } });
    await tx.user.create({ data: { id, username: id, email: id + '@example.invalid', firstName: 'Fixture',
      lastName: tag, password: 'not-a-login', role: 'MANAGER', departmentId: id } });
    await tx.workspacePermission.create({ data: { userId: id, workspace: 'sales', permissionLevel: 'admin', isActive: true } });
    await tx.crmCustomer.create({ data: { id, firstName: 'مشتری', lastName: 'آزمایشی', ownerUserId: id } });
    for (let offset = 0; offset < count; offset += 500) {
      const size = Math.min(500, count - offset);
      await tx.salesContract.createMany({ data: Array.from({ length: size }, (_, i) => ({
        id: id + '-' + (offset + i), contractNumber: id + '-' + (offset + i),
        title: 'Fixture', titlePersian: 'قرارداد آزمایشی', content: 'Fixture',
        customerId: id, departmentId: id, createdBy: id, responsibleSellerId: id,
        createdAt: new Date(startDate.getTime() + (offset + i) * 60_000),
        totalAmount: 100_000 + offset + i + 0.5,
      })) });
    }
    return createAuthoritativeSession(tx, id, { ipAddress: '127.0.0.1' });
  }, { timeout: 30_000 });
  return { cookie: SESSION_COOKIE + '=' + session.token, id };
}

async function measure(base: string, reader: string, exporter: string, mode: 'quiet' | 'export') {
  const loop = monitorEventLoopDelay({ resolution: 5 });
  const reads: number[] = [];
  const httpReads: number[] = [];
  const before = process.memoryUsage();
  let peakHeap = before.heapUsed;
  let peakRss = before.rss;
  const memory = setInterval(() => {
    const sample = process.memoryUsage();
    peakHeap = Math.max(peakHeap, sample.heapUsed);
    peakRss = Math.max(peakRss, sample.rss);
  }, 5);
  const startedAt = performance.now();
  loop.enable();
  const probeReads = async () => {
    for (let sample = 0; sample < 125; sample++) {
      const scheduled = startedAt + sample * 20;
      if (performance.now() < scheduled) await delay(scheduled - performance.now());
      const dispatched = performance.now();
      const response = await fetch(base + '/overview?period=all', { headers: { cookie: reader } });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
      const completed = performance.now();
      reads.push(completed - scheduled);
      httpReads.push(completed - dispatched);
    }
  };
  const exportFile = async () => {
    if (mode === 'quiet') return null;
    await delay(100);
    const t = performance.now();
    const response = await fetch(base + '/export.xlsx', {
      method: 'POST',
      headers: { cookie: exporter, 'content-type': 'application/json' },
      body: JSON.stringify({ filters }),
    });
    assert.equal(response.status, 200, await (response.ok ? Promise.resolve('') : response.text()));
    const bytes = (await response.arrayBuffer()).byteLength;
    return { elapsedMs: performance.now() - t, bytes };
  };
  try {
    const [, workbook] = await Promise.all([probeReads(), exportFile()]);
    const mib = 1024 * 1024;
    console.log(JSON.stringify({ mode, rows, reads: reads.length, readP95Ms: percentile(reads, 0.95), readMaxMs: Math.max(...reads),
      httpReadP95Ms: percentile(httpReads, 0.95), httpReadMaxMs: Math.max(...httpReads),
      eventLoopP95Ms: loop.percentile(95) / 1e6, eventLoopMaxMs: loop.max / 1e6,
      peakRssMiB: peakRss / mib, rssAboveStartMiB: (peakRss - before.rss) / mib,
      peakMainHeapMiB: peakHeap / mib, mainHeapAboveStartMiB: (peakHeap - before.heapUsed) / mib, workbook }));
  } finally {
    clearInterval(memory);
    loop.disable();
  }
}


const contractColumns = ['contractNumber', 'customer', 'project', 'status', 'statusDescription', 'amount', 'responsibleSeller', 'realizedSeller'];
const sections = ['overview', 'contracts', 'customers', 'products', 'finance', 'delivery', 'sellers', 'accountingRegistered'];
const configuration = { includeTables: true, sections, contractColumns };

async function verifyWorkerDownload(base: string, reader: string, exporter: Awaited<ReturnType<typeof seed>>) {
  const requestDownload = (cookie: string) => fetch(base + '/export.xlsx', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ filters, configuration }),
  });
  const unauthorized = await requestDownload('');
  assert.equal(unauthorized.status, 401);
  await unauthorized.arrayBuffer();

  const inProgress = requestDownload(exporter.cookie);
  try {
    await delay(60);
    const overlapping = await requestDownload(reader);
    assert.equal(overlapping.status, 429);
    assert.equal((await overlapping.json()).code, 'SALES_WORKBOOK_BUSY');

    await prisma.workspacePermission.update({
      where: { userId_workspace: { userId: exporter.id, workspace: 'sales' } },
      data: { permissionLevel: 'view' },
    });
    const revoked = await inProgress;
    assert.equal(revoked.status, 403);
    assert.equal(revoked.headers.get('content-disposition'), null);
    assert.equal((await revoked.json()).code, 'SALES_WORKBOOK_ACCESS_CHANGED');
  } finally {
    await inProgress.catch(() => undefined);
    await prisma.workspacePermission.update({
      where: { userId_workspace: { userId: exporter.id, workspace: 'sales' } },
      data: { permissionLevel: 'admin' },
    });
  }

  const response = await requestDownload(exporter.cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="sales-report.xlsx"');
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  const bytes = Buffer.from(await response.arrayBuffer());
  const snapshot = await buildSalesReport({ userId: exporter.id, departmentId: exporter.id, role: 'MANAGER',
    canManage: true, canCompany: false, canOpenSalesSource: true }, filters);
  const reference = encodeSalesReportWorkbook(snapshot, configuration);
  assert.deepEqual(bytes, reference);
  console.log(JSON.stringify({ verified: ['unauthenticated', 'busy', 'in-flight-downgrade', 'authorized-retry', 'byte-parity'], bytes: bytes.length }));
}

async function main() {
  const app = express();
  app.use(express.json(), salesReports);
  const server = app.listen(0, '127.0.0.1');
  try {
    const [reader, exporter] = [await seed('reader', 20), await seed('exporter', rows)];
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = 'http://127.0.0.1:' + address.port;
    const warmup = await fetch(base + '/overview?period=all', { headers: { cookie: reader.cookie } });
    assert.equal(warmup.status, 200);
    const warmupReport = (await warmup.json()).data;
    assert.equal(warmupReport.scope.departmentId, reader.id);
    assert.equal(warmupReport.contracts.length, 20);
    if (!process.argv.includes('--verify-only')) {
      for (const mode of ['quiet', 'export', 'quiet', 'export', 'quiet', 'export'] as const) {
        global.gc?.();
        await measure(base, reader.cookie, exporter.cookie, mode);
      }
    }
    if (process.argv.includes('--verify-worker') || process.argv.includes('--verify-only')) {
      await verifyWorkerDownload(base, reader.cookie, exporter);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$transaction(async (tx) => {
      const where = { startsWith: runId };
      await tx.salesContract.deleteMany({ where: { id: where } });
      await tx.crmCustomer.deleteMany({ where: { id: where } });
      await tx.user.deleteMany({ where: { id: where } });
      await tx.department.deleteMany({ where: { id: where } });
    });
  }
}

main().finally(disconnectDatabase).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});