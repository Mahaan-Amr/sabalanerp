import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const { localDatabaseUrl } = require('../../../scripts/partner-schema-audit');
const { Client } = require('pg');

test('late migration failure rolls back real DDL on the existing local schema', async () => {
  const db = new Client({ connectionString: localDatabaseUrl() });
  const migration = readFileSync(path.resolve(__dirname, '../../../prisma/migrations/20260827120600_partner_exact_decimal_evidence/migration.sql'), 'utf8');
  const fingerprint = async () => (await db.query(`SELECT md5(pg_get_functiondef('partner_check_approval_decision()'::regprocedure)) AS hash`)).rows[0].hash;
  try {
    await db.connect();
    const before = await fingerprint();
    const casesBefore = (await db.query('SELECT count(*)::int AS count FROM partner_sale_cases')).rows[0].count;
    // This actual migration is repeatable DDL; replace only its final COMMIT with a late failure.
    assert.match(migration, /COMMIT;\s*$/);
    assert.equal((await db.query("SELECT to_regclass('pg_temp.partner_schema_failure_witness') AS relation")).rows[0].relation, null);
    await assert.rejects(db.query(migration.replace(/COMMIT;\s*$/, `
      CREATE TEMP TABLE partner_schema_failure_witness (id integer) ON COMMIT PRESERVE ROWS;
      SELECT 1/0;`)), { code: '22012' });
    await db.query('ROLLBACK');
    assert.equal((await db.query("SELECT to_regclass('pg_temp.partner_schema_failure_witness') AS relation")).rows[0].relation, null);
    assert.equal(await fingerprint(), before);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM partner_sale_cases')).rows[0].count, casesBefore);
  } finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
});
