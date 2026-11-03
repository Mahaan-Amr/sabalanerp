import { Client } from 'pg';
import { writeFile } from 'node:fs/promises';
const db = new Client({ connectionString: 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp' });
await db.connect();
try {
  const counts = (await db.query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE "commercialFlowVersion"=0)::int AS legacy,
    count(*) FILTER (WHERE "commercialFlowVersion"=1)::int AS new_flow,
    count(*) FILTER (WHERE "commercialFlowVersion"=1 AND status='SIGNED' AND
      ("salesApprovalRevision" IS DISTINCT FROM "commercialRevision" OR "customerAcceptanceRevision" IS DISTINCT FROM "commercialRevision"))::int AS invalid_finality
    FROM sales_contracts`)).rows[0];
  const authority = (await db.query(`SELECT count(*)::int AS active_canonical_authority FROM accounting_replacement_cutover_runs
    WHERE "authorityTransferredAt" IS NOT NULL AND "sabalanAuthoritative"=true`)).rows[0];
  const migrations = (await db.query(`SELECT migration_name, finished_at IS NOT NULL AS applied FROM _prisma_migrations
    WHERE migration_name='20261002000100_ordinary_commercial_contract_lifecycle'`)).rows;
  const fixture = (await db.query(`SELECT c.id,c.status,c."commercialFlowVersion",c."commercialRevision",
    c."firstFinancialRecordAt" IS NOT NULL AS financial_started,c."realizedAt" IS NOT NULL AS realized,
    (SELECT count(*)::int FROM accounting_financial_records r WHERE r."contractId"=c.id) AS records,
    (SELECT COALESCE(sum(amount),0)::text FROM sales_reporting_events e WHERE e."contractId"=c.id) AS net_sales
    FROM sales_contracts c WHERE c.id LIKE 'qa-ordinary-commercial-%'`)).rows;
  const result = { capturedAt: new Date().toISOString(), environment: 'sabalanerp-local / 127.0.0.1:55432 / sabalanerp', counts, authority, migrations, fixture };
  await writeFile('reports/qa/ordinary-contract-lifecycle/data-audit.json', JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally { await db.end(); }
