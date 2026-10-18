import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('temporary database cleanup preserves an outstanding transaction and its later exact commit', {
  skip: !process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL,
  timeout: 240_000,
}, async () => {
  const temporary = await createTemporaryConcurrencyDatabase({
    repositoryRoot: path.resolve(process.cwd(), '..'),
    sourceDatabaseUrl: process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL!,
    migrateEmptySchema: true,
  });
  const observer = temporary.client(), writer = temporary.client();
  const entered = deferred(), release = deferred();
  let writing: Promise<unknown> | undefined;
  try {
    await observer.$executeRawUnsafe('CREATE TABLE cleanup_completion_probe (id text PRIMARY KEY, amount numeric(24,8) NOT NULL)');
    writing = writer.$transaction(async tx => {
      await tx.$executeRawUnsafe("INSERT INTO cleanup_completion_probe VALUES ('pending-commit', 123456789.12345678)");
      entered.resolve();
      await release.promise;
    }, { timeout: 30_000 });
    // Deliberately observe an old destructive implementation's rejection too;
    // the original transaction promise is still awaited below/in finally.
    void writing.catch(() => undefined);
    await entered.promise;
    await assert.rejects(temporary.cleanup(), /sessions or prepared transactions/);
    release.resolve();
    await writing;
    const rows = await observer.$queryRawUnsafe<Array<{ amount: string }>>(
      "SELECT amount::text FROM cleanup_completion_probe WHERE id='pending-commit'",
    );
    assert.deepEqual(rows, [{ amount: '123456789.12345678' }]);
    // Even an idle, still-owned pool is not cleanup authority.
    await assert.rejects(temporary.cleanup(), /sessions or prepared transactions/);
  } finally {
    release.resolve();
    if (writing) await writing.catch(() => undefined);
    await Promise.all([writer.$disconnect(), observer.$disconnect()]);
    await temporary.cleanup();
  }
});
