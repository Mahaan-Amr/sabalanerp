import type { Prisma, PrismaClient } from '@prisma/client';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';

export const measurePerformanceDatabaseIdentity = async (
  client: PrismaClient | Prisma.TransactionClient,
  options: { beforeMigrations?: boolean } = {},
) => {
  // Initial installation may have no ledger or performance tables yet. Their
  // measured absence is usable only before migrations, never for admission.
  const present = options.beforeMigrations ? (await client.$queryRaw<Array<{ migrations: boolean; policies: boolean }>>`
    SELECT to_regclass('_prisma_migrations') IS NOT NULL AS migrations,
      to_regclass('performance_policy_versions') IS NOT NULL AS policies`)[0]
    : { migrations: true, policies: true };
  const migrations = present.migrations ? (await client.$queryRaw<Array<{ metadata: unknown }>>`
    SELECT json_agg(row_to_json(m) ORDER BY m.migration_name) AS metadata FROM
      (SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
        rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations) m`)[0].metadata : null;
  const policies = present.policies ? (await client.$queryRaw<Array<{ metadata: unknown }>>`
    SELECT json_agg(row_to_json(p) ORDER BY p."policyKind", p.version) AS metadata FROM
      (SELECT "policyKind", version, lifecycle, "effectiveFrom", "contentHash" FROM performance_policy_versions) p`)[0].metadata : null;
  return {
    schemaHash: canonicalPerformanceHash(migrations),
    policyHash: canonicalPerformanceHash(policies),
  };
};
