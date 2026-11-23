import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { disconnectDatabase, prisma } from '../lib/prisma';
import salesReports from '../routes/salesReports';
import { createAuthoritativeSession, SESSION_COOKIE } from '../services/identitySessionService';

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
    await tx.department.create({ data: { id, name: id, namePersian: 'آزمون خروجی فروش' } });
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
  return { cookie: SESSION_COOKIE + '=' + session.token, id, sessionId: session.session.id };
}

async function measure(base: string, reader: string, exporter: string, mode: 'quiet' | 'export') {
  const loop = monitorEventLoopDelay({ resolution: 5 });
  const reads: number[] = [];
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
      const response = await fetch(base + '/overview?period=all', { headers: { cookie: reader } });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
      reads.push(performance.now() - scheduled);
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
      eventLoopP95Ms: loop.percentile(95) / 1e6, eventLoopMaxMs: loop.max / 1e6,
      peakRssMiB: peakRss / mib, rssAboveStartMiB: (peakRss - before.rss) / mib,
      peakMainHeapMiB: peakHeap / mib, mainHeapAboveStartMiB: (peakHeap - before.heapUsed) / mib, workbook }));
  } finally {
    clearInterval(memory);
    loop.disable();
  }
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
    await warmup.arrayBuffer();
    for (const mode of ['quiet', 'export', 'quiet', 'export', 'quiet', 'export'] as const) {
      global.gc?.();
      await measure(base, reader.cookie, exporter.cookie, mode);
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