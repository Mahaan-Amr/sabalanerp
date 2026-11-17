import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileProtectedBridgeMigration, compileProtectedCurrentRelease,
  assertProtectedCurrentReleaseRetryEvidence } from '../protectedBridgeMigrations';

test('same-operation retry rejects changed quantity, duty, waybill, or pickup evidence', () => {
  const owner = { deploymentId: 'operation-1', releaseId: 'release-1', leaseToken: 'lease-1' };
  const receipt = { deploymentId: owner.deploymentId, releaseId: owner.releaseId,
    quantityProofSha256: 'q', dutyRows: '437', sequenceProofSha256: 's', pickupDispatchRows: '19:41' };
  const observed = { quantityProofSha256: 'q', dutyRows: '437', sequenceProofSha256: 's', pickupDispatchRows: '19:41' };
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
    '20261108000100_start_new_waybill_numbers_at_one',
    '20261115120000_accounting_dashboard_change_versions',
    '20261115121000_accounting_dashboard_partner_sources',
    '20261115122000_accounting_dashboard_partner_revision_key',
    '20261115123000_accounting_dashboard_presentation_sources',
    '20261115124000_accounting_dashboard_private_owner_scope',
    '20261115125000_accounting_dashboard_mixed_financial_owner',
    '20261115130000_accounting_dashboard_user_name_scope',
    '20261115130000_loading_cancellation_duty',
    '20261115131000_accounting_private_marker_index',
    '20261116100000_customer_pickup_driver_source',
    '20261116100100_customer_pickup_dispatch',
    '20261116120000_customer_allocation_intents',
    '20261116121000_bind_allocation_intent_result',
    '20261116122000_serialize_customer_allocation_reservations',
    '20261116123000_cancel_unreceived_allocation_intents',
    '20261116124000_serialize_allocation_command_keys',
    '20261116130000_grouped_allocation_child_lineage',
    '20261116131000_customer_allocation_closed_control',
    '20261116132000_close_grouped_allocation_child_backstop',
    '20261117120000_retire_attachment_scan_status',
    '20261117130000_store_dispatch_exit_otp_code',
  ];
  const files = names.map(name => [name, fs.readFileSync(path.join(directory, name, 'migration.sql'))] as const);
  const release = compileProtectedCurrentRelease(files);
  assert.deepEqual(release.map(row => row.name), names);
  assert.ok(release.every(row => row.statements.length > 0));
  assert.ok(release.flatMap(row => row.statements).every(sql => !/^\s*(?:BEGIN|COMMIT)\s*;?\s*$/i.test(sql)));
  assert.equal(createHash('sha256').update(release.slice(0, 12).map(row => row.sha256).join('\n')).digest('hex'),
    'af48acb67350bc35b1ac156029d41011a9dc301cc605bce2729e978ae65e07e2');
  assert.ok(!release[10].statements.join(' ').includes('setval('));
  assert.equal(release[12].statements.length, 2);
  assert.match(release[12].statements[0], /^LOCK TABLE/);
  assert.ok(release[21].tables.includes('accounting_financial_records'));
  assert.deepEqual(release[22].statements, [`ALTER TYPE "GuardDriverSource" ADD VALUE 'CUSTOMER_PICKUP';`]);
  assert.equal(release[23].statements.length, 6);
  assert.deepEqual(release[23].tables.sort(), [
    'dispatch_confirmation_sessions', 'dispatch_pickup_verifications', 'guard_driver_queue_turns',
  ]);
  assert.throws(() => compileProtectedCurrentRelease(files.slice(1)), /CURRENT_RELEASE_SET_UNPROVEN/);
  const changed = files.map(([name, bytes], index) => index === 3 ? [name, Buffer.concat([bytes, Buffer.from('\n-- drift')])] as const : [name, bytes] as const);
  assert.throws(() => compileProtectedCurrentRelease(changed), /SQL_IDENTITY_MISMATCH/);
  assert.deepEqual(release[28].functions, ['serialize_customer_command_key_within', 'serialize_customer_allocation_intent_insert']);
  assert.deepEqual(release[31].functions, ['require_active_grouped_allocation_child']);
  assert.equal(release[32].statements.length, 5);
  assert.ok(release[32].statements.every(sql => /^ALTER TABLE/.test(sql)));
  for (let migrationIndex = 22; migrationIndex < files.length; migrationIndex++) {
    const changedMigration = files.map(([name, bytes], index) => index === migrationIndex
      ? [name, Buffer.concat([bytes, Buffer.from('\n-- drift')])] as const : [name, bytes] as const);
    assert.throws(() => compileProtectedCurrentRelease(changedMigration), /SQL_IDENTITY_MISMATCH/);
  }
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
