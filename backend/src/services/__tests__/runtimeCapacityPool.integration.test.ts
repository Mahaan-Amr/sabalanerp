import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Prisma, PrismaClient as ApplicationPrismaClient } from '@prisma/client';
import { startRuntimeCapacityObservation } from '../runtimeCapacityObservation';

const fixtureModule = process.env.RUNTIME_CAPACITY_TEST_CLIENT;
const connection = process.env.RUNTIME_CAPACITY_TEST_DATABASE_URL;

test('native Prisma histogram sees a queued checkout in an isolated one-connection read fixture', {
  skip: !fixtureModule || !connection,
  timeout: 10_000,
}, async () => {
  assert.ok(fixtureModule && connection);
  const url = new URL(connection);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '5');
  type MeasuredClient = ApplicationPrismaClient & { $metrics: { json(): Promise<Prisma.Metrics> } };
  const { PrismaClient } = require(fixtureModule) as {
    PrismaClient: new (options: Prisma.PrismaClientOptions) => MeasuredClient;
  };
  const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });

  try {
    await prisma.$queryRaw`SELECT 1`;
    const sample = async (exercise: () => Promise<unknown>) => {
      type Window = Parameters<NonNullable<Parameters<typeof startRuntimeCapacityObservation>[0]['emit']>>[0];
      let baselineReady!: () => void;
      const baseline = new Promise<void>(resolve => { baselineReady = resolve; });
      let receiveWindow!: (value: Window) => void;
      const nextWindow = new Promise<Window>(resolve => { receiveWindow = resolve; });
      const stop = startRuntimeCapacityObservation({
        commit: 'local', intervalMs: 750, emit: receiveWindow,
        poolMetrics: async () => {
          try {
            const metrics = await prisma.$metrics.json();
            console.info(JSON.stringify({ nativePoolWait: metrics.histograms.find(metric => metric.key === 'prisma_client_queries_wait_histogram_ms')?.value,
              histogramKeys: metrics.histograms.map(metric => metric.key) }));
            return metrics;
          }
          finally { baselineReady(); }
        },
      });
      const keepAlive = setTimeout(() => {}, 5_000);
      try {
        await baseline;
        await exercise();
        return await nextWindow;
      } finally { clearTimeout(keepAlive); await stop(); }
    };

    const quiet = await sample(() => prisma.$queryRaw`SELECT 1`);
    const contended = await sample(async () => {
      let acquired!: () => void;
      const held = new Promise<void>(resolve => { acquired = resolve; });
      const transaction = prisma.$transaction(async tx => {
        acquired();
        await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.2)`;
      });
      await Promise.race([held, transaction]);
      await Promise.all([transaction, prisma.$queryRaw`SELECT 1`]);
    });

    console.info(JSON.stringify({ quiet, contended }));
    assert.ok(quiet.poolWait && quiet.poolWait.samples >= 1);
    assert.ok(contended.poolWait && contended.poolWait.samples >= 1);
    assert.ok(contended.poolWait.totalMs - quiet.poolWait.totalMs >= 100);
    assert.ok(contended.poolWait.p95UpperMs !== null && contended.poolWait.p95UpperMs >= 100);
  } finally { await prisma.$disconnect(); }
});
