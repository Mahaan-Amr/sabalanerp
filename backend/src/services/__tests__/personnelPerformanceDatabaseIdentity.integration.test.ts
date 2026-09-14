import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { disconnectDatabase, prisma } from '../../lib/prisma';
import { measurePerformanceDatabaseIdentity } from '../personnelPerformanceDatabaseIdentity';
import { canonicalPerformanceHash } from '../personnelPerformancePolicy';

const rollback = Symbol('identity-test-rollback');
const main = async () => {
  const before = await measurePerformanceDatabaseIdentity(prisma);
  const [legacy] = await prisma.$queryRaw<Array<{ metadata: { migrations: unknown; policies: unknown } }>>`
    SELECT json_build_object(
      'migrations', (SELECT json_agg(row_to_json(m) ORDER BY m.migration_name) FROM
        (SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
          rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations) m),
      'policies', (SELECT json_agg(row_to_json(p) ORDER BY p."policyKind", p.version) FROM
        (SELECT "policyKind", version, lifecycle, "effectiveFrom", "contentHash" FROM performance_policy_versions) p)
    ) AS metadata`;
  assert.deepEqual(before, { schemaHash: canonicalPerformanceHash(legacy.metadata.migrations),
    policyHash: canonicalPerformanceHash(legacy.metadata.policies) }, 'deployment must preserve the existing promotion identity protocol');
  assert.match(before.schemaHash, /^[a-f0-9]{64}$/);
  assert.match(before.policyHash, /^[a-f0-9]{64}$/);
  const id = randomUUID();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
        VALUES (${id}, ${'a'.repeat(64)}, ${`identity_test_${id}`}, now(), 1)`;
      const changed = await measurePerformanceDatabaseIdentity(tx);
      assert.notEqual(changed.schemaHash, before.schemaHash, 'the applied migration ledger must change release identity');
      assert.equal(changed.policyHash, before.policyHash);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  assert.deepEqual(await measurePerformanceDatabaseIdentity(prisma), before, 'the isolated test must leave the real ledger unchanged');
  console.log('performance database identity integration tests passed');
};
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(disconnectDatabase);
