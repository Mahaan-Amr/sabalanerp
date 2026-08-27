import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createFixture, removeFixture, withFixture, fixtureFootprint, unrelatedFingerprint, fixtureCleanupSql } from './harness/fixtures.mjs';
import { localSql } from './harness/safety.mjs';

test('fixture failure cleans only its own rows, preserving a concurrent namespace and existing data', async () => {
  const sentinel = await createFixture(`partner-qa-${randomUUID()}`);
  const run = `partner-qa-${randomUUID()}`;
  try {
    const before = await unrelatedFingerprint([sentinel.namespace, run]);
    await assert.rejects(withFixture(run, async (fixture) => {
      assert.equal(await fixtureFootprint(fixture.namespace), 4);
      throw new Error('simulated failed test');
    }), /simulated failed test/);
    assert.equal(await fixtureFootprint(run), 0);
    assert.equal(await fixtureFootprint(sentinel.namespace), 4);
    assert.equal(await unrelatedFingerprint([sentinel.namespace, run]), before);
    await removeFixture(run); // Repeat cleanup is safe.
  } finally { await removeFixture(sentinel.namespace); }
});

test('duplicate seed fails atomically without replacing another run owner', async () => {
  const fixture = await createFixture(`partner-qa-${randomUUID()}`);
  try {
    await assert.rejects(createFixture(fixture.namespace), /database operation/);
    assert.equal(await fixtureFootprint(fixture.namespace), 4);
  } finally { await removeFixture(fixture.namespace); }
});

test('cleanup refuses an unexpected foreign reference and rolls back its own deletions', async (t) => {
  const fixture = await createFixture(`partner-qa-${randomUUID()}`);
  t.after(() => removeFixture(fixture.namespace));
  const sentinel = await createFixture(`partner-qa-${randomUUID()}`);
  t.after(() => removeFixture(sentinel.namespace));
  try {
    await localSql(`UPDATE workspace_permissions SET "grantedBy" = '${fixture.namespace}' WHERE id = '${sentinel.namespace}-workspace';`);
    await assert.rejects(removeFixture(fixture.namespace), /database operation/);
    assert.equal(await fixtureFootprint(fixture.namespace), 4);
    assert.equal(await fixtureFootprint(sentinel.namespace), 4);
  } finally {
    await localSql(`UPDATE workspace_permissions SET "grantedBy" = NULL WHERE id = '${sentinel.namespace}-workspace' AND "userId" = '${sentinel.namespace}';`);
  }
});

test('cleanup refuses a future cascading FK to a unique non-ID key', async () => {
  await withFixture(`partner-qa-${randomUUID()}`, async (fixture) => {
    // A namespaced table is created and rolled back in this one transaction, never committed.
    // Setup is outside the expected-error handler so setup failures cannot produce a false pass.
    await localSql(`
      BEGIN;
      SET LOCAL lock_timeout = '3s';
      CREATE TABLE public."${fixture.namespace}-fk" (email text REFERENCES public.users(email) ON DELETE CASCADE);
      INSERT INTO public."${fixture.namespace}-fk" VALUES ('${fixture.namespace}@example.invalid');
      DO $assert$
      BEGIN
        BEGIN
          EXECUTE $cleanup_sql$ ${fixtureCleanupSql(fixture.namespace, { transaction: false })} $cleanup_sql$;
          RAISE EXCEPTION 'Expected alternate-key refusal did not occur';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM <> 'Unsupported foreign-key shape; cleanup requires owner review' THEN RAISE; END IF;
        END;
      END $assert$;
      ROLLBACK;
    `);
    assert.equal(await fixtureFootprint(fixture.namespace), 4);
  });
});
