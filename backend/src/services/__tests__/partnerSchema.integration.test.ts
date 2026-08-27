import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { PartnerSaleCaseSchema } from '@sabalanerp/partner-sales-contracts';

// The public seam is SQL commit validation, not a mocked application repository.
// Constraint checks run in the real local schema; fixture transactions always roll back.
const { localDatabaseUrl } = require('../../../scripts/partner-schema-audit');
const { Client } = require('pg');
const namespace = `partner-schema-${randomUUID()}`;
async function transaction(run: (db: any, id: string) => Promise<void>) {
  const db = new Client({ connectionString: localDatabaseUrl() });
  try {
    await db.connect();
    await db.query("BEGIN; SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '10s'");
    await run(db, namespace);
  } finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
}

test('new Partner profiles and rollout cohorts default closed', () => transaction(async (db, id) => {
  await db.query(`INSERT INTO users (id,email,username,password,"firstName","lastName",role,"updatedAt")
    VALUES ($1,$2,$1,'!disabled','Schema','Fixture','USER',now())`, [id, `${id}@example.invalid`]);
  await db.query('INSERT INTO partner_profiles (id,"userId") VALUES ($1,$1)', [id]);
  await db.query('INSERT INTO partner_release_cohorts (id,name) VALUES ($1,$1)', [id]);
  assert.equal((await db.query('SELECT state FROM partner_profiles WHERE id=$1', [id])).rows[0].state, 'PENDING');
  const cohort = (await db.query('SELECT "activationEnabled","enrollmentPaused","operationalPaused" FROM partner_release_cohorts WHERE id=$1', [id])).rows[0];
  assert.deepEqual(cohort, { activationEnabled: false, enrollmentPaused: true, operationalPaused: true });
}));

test('approved inquiry evidence gets an exact database-clock 48-hour window', () => transaction(async (db, id) => {
  await seedProfile(db, id);
  await db.query('INSERT INTO partner_inquiries (id,"profileId") VALUES ($1,$1)', [id]);
  await db.query(`INSERT INTO partner_inquiry_assignments (id,"inquiryId",revision,"responderId","actorId",reason,"eligibilityEvidence")
    VALUES ($1,$1,1,$1,$1,'انتساب آزمون','{}')`, [id]);
  await db.query(`INSERT INTO partner_inquiry_rows (id,"inquiryId",version,"configurationHash",definition)
    VALUES ($1,$1,1,$2,'{}')`, [id, hash]);
  await db.query(`INSERT INTO partner_inquiry_approvals (id,"rowId","assignmentId","actorId","commandId","authorizationEvidenceId",
    "wholesaleUnitPrice",currency,"evidenceHash") VALUES ($1,$1,$1,$1,$1,$1,100,'IRT',$2)`, [id, hash]);
  const clock = (await db.query(`SELECT "approvedAt" = transaction_timestamp()::timestamptz(3) AS server,
    "expiresAt" - "approvedAt" = interval '48 hours' AS exact FROM partner_inquiry_approvals WHERE id=$1`, [id])).rows[0];
  assert.deepEqual(clock, { server: true, exact: true });
  await db.query('UPDATE partner_inquiry_rows SET outcome=\'APPROVED\',revision=2 WHERE id=$1', [id]);
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  await assert.rejects(db.query('UPDATE partner_inquiry_approvals SET "wholesaleUnitPrice"=101 WHERE id=$1', [id]), { code: '23514' });
}));

const hash = `sha256-v1:${'a'.repeat(64)}`;
test('a partial Case pair cannot pass the database commit boundary', () => transaction(async (db, id) => {
  await seedProfile(db, id);
  await db.query('INSERT INTO partner_commercial_accounts (id,"profileId") VALUES ($1,$1)', [id]);
  await assert.rejects(async () => {
    await db.query(`INSERT INTO partner_sale_cases (id,"caseNumber","profileId","customerId","internalRecordId","customerContractId","headRevision","integrityHash")
      VALUES ($1,$2,$1,$1,$3,$4,1,$5)`, [id, `${id}-case`, `${id}-internal`, `${id}-customer`, hash]);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  }, (error: any) => ['23503','23514'].includes(error.code));
}));
async function seedProfile(db: any, id: string) {
  await db.query(`INSERT INTO users (id,email,username,password,"firstName","lastName",role,"updatedAt")
    VALUES ($1,$2,$1,'!disabled','Schema','Fixture','USER',now())`, [id, `${id}@example.invalid`]);
  await db.query('INSERT INTO partner_profiles (id,"userId") VALUES ($1,$1)', [id]);
}

async function seedPair(db: any, id: string) {
  await seedProfile(db, id);
  await db.query('INSERT INTO partner_commercial_accounts (id,"profileId") VALUES ($1,$1)', [id]);
  await db.query(`INSERT INTO crm_customers (id,"firstName","lastName","ownerUserId","updatedAt") VALUES ($1,'Schema','Fixture',$1,now());`, [id]);
  await db.query(`INSERT INTO departments (id,name,"namePersian","updatedAt") VALUES ($1,$1,$1,now())`, [id]);
  await db.query(`INSERT INTO partner_sale_cases (id,"caseNumber","profileId","customerId","internalRecordId","customerContractId","headRevision","integrityHash")
    VALUES ($1,$2,$1,$1,$3,$4,1,$5)`, [id, `${id}-case`, `${id}-internal`, `${id}-customer`, hash]);
  await db.query(`INSERT INTO partner_case_revisions ("caseId",revision,"integrityHash","graphHash",graph,"partySnapshots","wholesaleEnvelope",
    "retailEnvelope","paymentEvidence","customerContent","internalProjection","customerProjection","actorId","commandId")
    VALUES ($1,1,$2,$2,'{}','{}','{}','{}','{}','{}','{}','{}',$1,$1)`, [id, hash]);
  await db.query(`INSERT INTO sabalan_to_partner_sale_records (id,"recordNumber","caseId","commercialAccountId","expectedRevision","integrityHash")
    VALUES ($2,$3,$1,$1,1,$4)`, [id, `${id}-internal`, `${id}-internal-number`, hash]);
  await db.query(`INSERT INTO sales_contracts (id,"contractNumber",title,"titlePersian",content,"customerId","departmentId","createdBy","responsibleSellerId",
    "partnerKind","partnerCaseId","partnerRevision","partnerIntegrityHash","updatedAt")
    VALUES ($2,$3,'Schema','آزمون','Fixture',$1,$1,$1,$1,'PARTNER_CUSTOMER',$1,1,$4,now())`, [id, `${id}-customer`, `${id}-customer-number`, hash]);
  await db.query('INSERT INTO partner_product_rows (id,"caseId") VALUES ($2,$1)', [id, `${id}-row`]);
  await db.query(`INSERT INTO partner_case_row_bindings ("caseId",revision,"productRowId","configurationHash",quantity,unit,"precisionPolicyVersion")
    VALUES ($1,1,$2,$3,2,'m','measured-v1')`, [id, `${id}-row`, hash]);
  await db.query(`INSERT INTO partner_case_events (id,"caseId","caseRevision","integrityHash",sequence,"stateRevision",type,"toState","actorId","commandId","correlationId","effectiveDate",evidence)
    VALUES ($2,$1,1,$3,1,1,'CASE_CREATED','DRAFT',$1,$1,$1,CURRENT_DATE,'{}')`, [id, `${id}-event`, hash]);
}

test('a complete reciprocal pair validates and cannot replace its immutable links', () => transaction(async (db, id) => {
  await seedPair(db, id);
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  const fixture = createPartnerFixtures().case;
  const c = (await db.query('SELECT * FROM partner_sale_cases WHERE id=$1',[id])).rows[0];
  const internal = (await db.query('SELECT * FROM sabalan_to_partner_sale_records WHERE "caseId"=$1',[id])).rows[0];
  const customer = (await db.query('SELECT * FROM sales_contracts WHERE "partnerCaseId"=$1',[id])).rows[0];
  const owner = { caseId: c.id, revision: c.headRevision, integrityHash: c.integrityHash };
  assert.equal(PartnerSaleCaseSchema.parse({ ...fixture, caseId: c.id, caseNumber: c.caseNumber,
    partnerSellerId: id, creatorId: customer.createdBy, responsibleSellerId: customer.responsibleSellerId,
    salesCreditOwnerId: id, customerId: c.customerId, state: c.state, head: owner,
    graph: { ...fixture.graph, owner, productRowIds: [`${id}-row`] },
    internalRecord: { kind: internal.kind, recordId: internal.id, recordNumber: internal.recordNumber,
      owner: { ...owner, revision: internal.expectedRevision, integrityHash: internal.integrityHash }, commercialAccountId: internal.commercialAccountId },
    customerContract: { kind: customer.partnerKind, contractId: customer.id, contractNumber: customer.contractNumber,
      owner: { ...owner, revision: customer.partnerRevision, integrityHash: customer.partnerIntegrityHash } },
  }).schemaVersion, 1);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM partner_commercial_numbers WHERE "caseId"=$1',[id])).rows[0].count, 3);
  await assert.rejects(db.query('UPDATE partner_sale_cases SET "internalRecordId"=$2,"stateRevision"=2 WHERE id=$1', [id, `${id}-other`]), { code: '23514' });
}));

test('retail receipt evidence cannot reference a Sabalan payment plan', () => transaction(async (db, id) => {
  await seedPair(db, id);
  await db.query(`INSERT INTO partner_payment_plans (id,"caseId","caseRevision",purpose,version,"effectiveDate",evidence,"integrityHash")
    VALUES ($1,$1,1,'SABALAN',1,CURRENT_DATE,'{}',$2)`, [id, hash]);
  await assert.rejects(db.query(`INSERT INTO partner_retail_receipts (id,"caseId","planId",kind,amount,currency,"effectiveDate","actorId","commandId",evidence)
    VALUES ($1,$1,$1,'RECEIPT',10,'IRT',CURRENT_DATE,$1,$1,'{}')`, [id]), { code: '23514' });
}));

test('direct SQL cannot create wrong kind, orphan, duplicate number, drift or secondary writable collections', () => transaction(async (db, id) => {
  await seedPair(db, id);
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  const attempts: Array<[string, unknown[], string[]]> = [
    ['UPDATE sales_contracts SET "partnerKind"=\'COLLABORATION\' WHERE id=$1', [`${id}-customer`], ['23514']],
    ['UPDATE sales_contracts SET "partnerCaseId"=NULL WHERE id=$1', [`${id}-customer`], ['23514']],
    ['UPDATE sales_contracts SET "contractNumber"=\'replacement\' WHERE id=$1', [`${id}-customer`], ['23514']],
    ['DELETE FROM sales_contracts WHERE id=$1', [`${id}-customer`], ['23514']],
    ['DELETE FROM partner_sale_cases WHERE id=$1', [id], ['23514']],
    ['UPDATE sabalan_to_partner_sale_records SET "integrityHash"=$2 WHERE "caseId"=$1', [id, `sha256-v1:${'b'.repeat(64)}`], ['23514']],
    ['INSERT INTO partner_commercial_numbers VALUES ($1,$2,\'CASE\')', [`${id}-case`, id], ['23505']],
    ['UPDATE partner_case_revisions SET graph=\'{"changed":true}\' WHERE "caseId"=$1', [id], ['23514']],
    ['UPDATE partner_sale_cases SET "stateRevision"=1 WHERE id=$1', [id], ['23514']],
    [`INSERT INTO deliveries (id,"contractId","deliveryDate","deliveryAddress","updatedAt") VALUES ($1,$2,now(),'Fixture',now())`, [id, `${id}-customer`], ['23514']],
    [`INSERT INTO sabalan_to_partner_sale_records (id,"recordNumber","caseId","commercialAccountId","expectedRevision","integrityHash") VALUES ($1,$1,'absent',$2,1,$3)`, [`${id}-orphan`, id, hash], ['23503','23514']],
  ];
  for (const [sql, parameters, codes] of attempts) {
    await db.query('SAVEPOINT rejected_write');
    await assert.rejects(db.query(sql, parameters), (error: any) => codes.includes(error.code), sql);
    await db.query('ROLLBACK TO SAVEPOINT rejected_write');
  }
}));

test('a failpoint rolls back the complete pair and its reserved numbers; same command replays one outcome', () => transaction(async (db, id) => {
  await db.query('SAVEPOINT submit_attempt');
  await seedPair(db, id);
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  await db.query('ROLLBACK TO SAVEPOINT submit_attempt');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM partner_sale_cases WHERE id=$1', [id])).rows[0].count, 0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM partner_commercial_numbers WHERE "caseId"=$1', [id])).rows[0].count, 0);
  await seedPair(db, id);
  const outcome = { caseId: id };
  await db.query(`INSERT INTO partner_command_outcomes (id,"actorId",operation,"targetScope",key,"payloadHash",outcome)
    VALUES ($1,$1,'CASE_SUBMIT',$1,'retry-key',$2,$3)`, [id, hash, outcome]);
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  assert.deepEqual((await db.query('SELECT outcome FROM partner_command_outcomes WHERE "actorId"=$1 AND key=\'retry-key\'', [id])).rows[0].outcome, outcome);
  await assert.rejects(db.query(`INSERT INTO partner_command_outcomes (id,"actorId",operation,"targetScope",key,"payloadHash",outcome)
    VALUES ($2,$1,'CASE_SUBMIT',$1,'retry-key',$3,'{}')`, [id, `${id}-retry`, `sha256-v1:${'b'.repeat(64)}`]), { code: '23505' });
}));

test('customer commercial content cannot change without a coherent successor revision', () => transaction(async (db, id) => {
  await seedPair(db, id);
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  await assert.rejects(db.query('UPDATE sales_contracts SET "totalAmount"=9 WHERE id=$1', [`${id}-customer`]), { code: '23514' });
}));

test('commercial decimal evidence is preserved exactly, not rounded by database column scale', () => transaction(async (db, id) => {
  await seedPair(db, id);
  await db.query('INSERT INTO partner_product_rows (id,"caseId") VALUES ($2,$1)', [id,`${id}-precise-row`]);
  const quantity = '1.000000000000000000123';
  await db.query(`INSERT INTO partner_case_row_bindings ("caseId",revision,"productRowId","configurationHash",quantity,unit,"precisionPolicyVersion")
    VALUES ($1,1,$2,$3,$4,'m','measured-v1')`, [id,`${id}-precise-row`,hash,quantity]);
  assert.equal((await db.query('SELECT quantity::text AS quantity FROM partner_case_row_bindings WHERE "productRowId"=$1',[`${id}-precise-row`])).rows[0].quantity,quantity);
}));

test('concurrent command writers serialize at the unique idempotency key without leaving fixtures', async () => {
  const connectionString = localDatabaseUrl();
  const first = new Client({ connectionString });
  const second = new Client({ connectionString });
  const id = `${namespace}-concurrent`;
  const sql = `INSERT INTO partner_command_outcomes (id,"actorId",operation,"targetScope",key,"payloadHash",outcome)
    VALUES ($1,$2,'CASE_SUBMIT',$2,'concurrent-key',$3,'{}')`;
  try {
    await first.connect(); await second.connect();
    await first.query('BEGIN'); await second.query("BEGIN; SET LOCAL lock_timeout='150ms'");
    await first.query(sql, [`${id}-first`, id, hash]);
    await assert.rejects(second.query(sql, [`${id}-second`, id, hash]), { code: '55P03' });
    await second.query('ROLLBACK');
    assert.equal((await second.query('SELECT count(*)::int AS count FROM partner_command_outcomes WHERE "actorId"=$1',[id])).rows[0].count, 0);
    await first.query('ROLLBACK');
    await second.query('BEGIN');
    await second.query(sql, [`${id}-second`, id, hash]);
    await assert.rejects(second.query(sql, [`${id}-third`, id, hash]), { code: '23505' });
  } finally {
    await first.query('ROLLBACK').catch(() => {}); await second.query('ROLLBACK').catch(() => {});
    await first.end(); await second.end();
  }
});

test('an actual COMMIT rejects a partial pair and leaves no durable Case or reserved number', async () => {
  const db = new Client({ connectionString: localDatabaseUrl() });
  const id = `${namespace}-commit-failure`;
  try {
    await db.connect(); await db.query('BEGIN');
    await seedProfile(db, id);
    await db.query(`INSERT INTO crm_customers (id,"firstName","lastName","updatedAt") VALUES ($1,'Schema','Fixture',now())`,[id]);
    await db.query(`INSERT INTO partner_sale_cases (id,"caseNumber","profileId","customerId","internalRecordId","customerContractId","headRevision","integrityHash")
      VALUES ($1,$1,$1,$1,$2,$3,1,$4)`,[id,`${id}-internal`,`${id}-customer`,hash]);
    await assert.rejects(db.query('COMMIT'), (error: any) => ['23503','23514'].includes(error.code));
    await db.query('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM partner_sale_cases WHERE id=$1',[id])).rows[0].count,0);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM partner_commercial_numbers WHERE "caseId"=$1',[id])).rows[0].count,0);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM users WHERE id=$1',[id])).rows[0].count,0);
  } finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
});
