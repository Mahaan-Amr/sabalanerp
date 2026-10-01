import assert from 'node:assert/strict';
import { Client } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';

const prefix = 'qa-ordinary-commercial-';
const ids = { customer: `${prefix}customer`, note: `${prefix}note`, legacy: `${prefix}legacy` };
const db = new Client({ connectionString: 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp' });
const directory = 'reports/qa/ordinary-contract-lifecycle';
await db.connect();
try {
  if (process.argv.includes('--cleanup')) {
    await db.query('BEGIN');
    const contractIds = [ids.note, ids.legacy];
    await db.query('DELETE FROM security_notifications WHERE "referenceId" = ANY($1) OR "eventId" IN (SELECT id FROM notification_events WHERE "resourceId" = ANY($1) OR "resourceId" IN (SELECT id FROM accounting_financial_records WHERE "contractId" = ANY($1)))', [contractIds]);
    await db.query('DELETE FROM notification_events WHERE "resourceId" = ANY($1) OR "resourceId" IN (SELECT id FROM accounting_financial_records WHERE "contractId" = ANY($1))', [contractIds]);
    await db.query('DELETE FROM accounting_audit_logs WHERE "contractId" = ANY($1)', [contractIds]);
    await db.query('DELETE FROM accounting_tax_records WHERE "contractId" = ANY($1)', [contractIds]);
    await db.query('DELETE FROM accounting_financial_records WHERE "contractId" = ANY($1)', [contractIds]);
    await db.query('DELETE FROM sales_contracts WHERE id = ANY($1)', [contractIds]);
    await db.query('DELETE FROM crm_customers WHERE id = $1', [ids.customer]);
    await db.query('COMMIT');
    console.log('Removed only namespaced ordinary-contract QA fixtures.');
  } else {
    const admin = (await db.query("SELECT id FROM users WHERE username='admin' AND \"isActive\"=true")).rows[0];
    const source = (await db.query('SELECT "departmentId" FROM sales_contracts WHERE "partnerKind" IS NULL LIMIT 1')).rows[0];
    assert.ok(admin && source, 'Existing local seed identities required');
    await db.query('BEGIN');
    await db.query(`INSERT INTO crm_customers (id,"firstName","lastName","updatedAt") VALUES ($1,'مشتری','آزمون گردش',now()) ON CONFLICT(id) DO NOTHING`, [ids.customer]);
    for (const [key, id] of Object.entries(ids).filter(([key]) => key !== 'customer')) {
      await db.query(`INSERT INTO sales_contracts (id,"contractNumber",title,"titlePersian",content,"customerId","departmentId","createdBy","responsibleSellerId","totalAmount",currency,"updatedAt","commercialFlowVersion","commercialRevision","commercialStartedAt","commercialExpiresAt","commercialExpiryDays")
        VALUES ($1,$2,'QA lifecycle','آزمون گردش قرارداد','قرارداد آزمایشی فاقد اثر تجاری',$3,$4,$5,$5,10000,'ریال',now(),$6,$6,now(),now()+interval '10 days',10) ON CONFLICT(id) DO NOTHING`,
      [id, `QA-${key.toUpperCase()}`, ids.customer, source.departmentId, admin.id, key === 'note' ? 1 : 0]);
    }
    await db.query('COMMIT');
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/fixtures.json`, JSON.stringify(ids, null, 2));
    console.log(JSON.stringify(ids));
  }
} finally { await db.end(); }
