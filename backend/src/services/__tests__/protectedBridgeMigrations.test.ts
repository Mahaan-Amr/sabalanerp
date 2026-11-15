import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { compileProtectedBridgeMigration, compileProtectedCurrentRelease,
  assertProtectedCurrentReleaseRetryEvidence } from '../protectedBridgeMigrations';

test('same-operation retry rejects changed quantity, duty, or waybill evidence', () => {
  const owner = { deploymentId: 'operation-1', releaseId: 'release-1', leaseToken: 'lease-1' };
  const receipt = { deploymentId: owner.deploymentId, releaseId: owner.releaseId,
    quantityProofSha256: 'q', dutyRows: '437', sequenceProofSha256: 's' };
  const observed = { quantityProofSha256: 'q', dutyRows: '437', sequenceProofSha256: 's' };
  assert.doesNotThrow(() => assertProtectedCurrentReleaseRetryEvidence(receipt, owner, observed));
  for (const key of Object.keys(observed) as Array<keyof typeof observed>) {
    assert.throws(() => assertProtectedCurrentReleaseRetryEvidence(receipt, owner,
      { ...observed, [key]: 'changed' }), /RETRY_DATA_DRIFT/);
  }
  assert.throws(() => assertProtectedCurrentReleaseRetryEvidence({ ...receipt, deploymentId: '' }, owner, observed),
    /HISTORY_UNPROVEN/);
  assert.doesNotThrow(() => assertProtectedCurrentReleaseRetryEvidence(receipt,
    { ...owner, deploymentId: 'later-operation' }, observed));
});

test('the complete current release is admitted only with its reviewed ordered SQL bytes', () => {
  const directory = path.resolve(__dirname, '../../../prisma/migrations');
  const names = [
    '20261021120000_attendance_effective_rest_windows',
    '20261025120000_preserve_exact_fulfillment_quantities',
    '20261028090000_sales_dispatch_invoices',
    '20261028093000_sales_invoice_evidence_constraints',
    '20261028100000_sales_invoice_correction_evidence',
    '20261031130000_purchasing_operational_workspace',
    '20261101160000_supply_chain_exact_purchase_quantities',
    '20261101170000_purchasing_private_attachments',
    '20261102120000_accounting_financial_approval_receipts',
    '20261104150000_purchasing_duty_optional_deadline',
    '20261107000100_restart_dispatch_waybill_sequence_at_zero',
    '20261107120000_legacy_waybill_reconstructions',
    '20261115131000_accounting_private_marker_index',
  ];
  const files = names.map(name => [name, fs.readFileSync(path.join(directory, name, 'migration.sql'))] as const);
  const release = compileProtectedCurrentRelease(files);
  assert.deepEqual(release.map(row => row.name), names);
  assert.ok(release.every(row => row.statements.length > 0));
  assert.ok(release.flatMap(row => row.statements).every(sql => !/^\s*(?:BEGIN|COMMIT)\s*;?\s*$/i.test(sql)));
  assert.ok(!release.at(-3)!.statements.join(' ').includes('setval('));
  assert.throws(() => compileProtectedCurrentRelease(files.slice(1)), /CURRENT_RELEASE_SET_UNPROVEN/);
  const changed = files.map(([name, bytes], index) => index === 3 ? [name, Buffer.concat([bytes, Buffer.from('\n-- drift')])] as const : [name, bytes] as const);
  assert.throws(() => compileProtectedCurrentRelease(changed), /SQL_IDENTITY_MISMATCH/);
});

test('protected bootstrap accepts only the reviewed complete SQL bytes, including original comments and line endings', () => {
  for (const name of ['20261014120000_hr_vehicle_assignment_plans']) {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'));
    assert.equal(compileProtectedBridgeMigration(name, bytes).name, name);
    for (const position of [0, Math.floor(bytes.length / 2), bytes.length - 1]) {
      const changed = Buffer.from(bytes); changed[position] ^= 1;
      assert.throws(() => compileProtectedBridgeMigration(name, changed), /SQL_IDENTITY_MISMATCH/);
    }
    for (const changed of [Buffer.concat([bytes, Buffer.from('\nDROP TABLE users;')]), bytes.subarray(0, bytes.length - 1),
      Buffer.from(bytes.toString().replace(/\n/g, '\r\n'))]) {
      assert.throws(() => compileProtectedBridgeMigration(name, changed), /SQL_IDENTITY_MISMATCH/);
    }
  }
  for (const name of ['toString', '__proto__', '20261014140000_online_deployment_control', '../20261014140000_online_deployment_control']) {
    assert.throws(() => compileProtectedBridgeMigration(name, Buffer.from('CREATE TABLE arbitrary (id text)')), /MIGRATION_UNSUPPORTED/);
  }
});

test('the seven new accounting migrations have no implicit protected bridge authority', () => {
  const names = [
    '20261014150000_customer_opening_review',
    '20261014151000_customer_credit_settlement_source',
    '20261014152000_customer_receipt_components',
    '20261014153000_customer_receipt_adjustments',
    '20261014154000_customer_check_bank_outcomes',
    '20261014155000_customer_command_and_attribution',
    '20261014160000_customer_legacy_receipt_resolution',
  ];
  for (const name of names) {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'));
    assert.throws(() => compileProtectedBridgeMigration(name, bytes), /MIGRATION_UNSUPPORTED/);
  }
});
