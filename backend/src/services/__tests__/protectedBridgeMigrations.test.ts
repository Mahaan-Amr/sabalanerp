import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { compileProtectedBridgeMigration, compileProtectedCurrentRelease,
  assertProtectedCurrentReleaseRetryEvidence, protectedCurrentReleaseRuntimeAclProof } from '../protectedBridgeMigrations';

test('same-operation retry rejects changed quantity, duty, waybill, or pickup evidence', () => {
  const owner = { deploymentId: 'operation-1', releaseId: 'release-1', leaseToken: 'lease-1' };
  const receipt = { deploymentId: owner.deploymentId, releaseId: owner.releaseId,
    quantityProofSha256: 'q', dutyRows: '437', sequenceProofSha256: 's', pickupDispatchRows: '19:41',
    personalPickupDispatchRows: '19:41', sepidarSeedSha256: 'digest' };
  const { deploymentId, releaseId, ...observed } = receipt;
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
    '20261117120000_retire_attachment_scan_status',
    '20261116120000_customer_allocation_intents',
    '20261116121000_bind_allocation_intent_result',
    '20261116122000_serialize_customer_allocation_reservations',
    '20261116123000_cancel_unreceived_allocation_intents',
    '20261116124000_serialize_allocation_command_keys',
    '20261116130000_grouped_allocation_child_lineage',
    '20261116131000_customer_allocation_closed_control',
    '20261116132000_close_grouped_allocation_child_backstop',
    '20261116133000_customer_allocation_controller_transition',
    '20261117130000_store_dispatch_exit_otp_code',
    '20261117140000_customer_allocation_controller_closure',
    '20261117150000_customer_allocation_runtime_admission',
    '20261117160000_partner_release_readiness_completed_projection',
    '20261118100000_sepidar_loading_reference',
    '20261118120000_personal_pickup_source',
    '20261118120100_personal_pickup_dispatch',
    '20261120120000_grant_runtime_customer_card_insert',
    '20261120121000_protect_partner_number_reservation',
    '20261120122000_protect_runtime_disclosure_revision',
    '20261120123000_protect_runtime_reference_row_locks',
    '20261120124000_runtime_dispatch_permissions',
    '20261120125000_runtime_driver_assignment_permissions',
    '20261120126000_runtime_partner_receipt_permissions',
    '20261120127000_runtime_partner_inquiry_evidence_locks',
    '20261123110000_stone_return_receipts',
    '20261123111000_stone_return_allocation_drafts',
    '20261123130000_sepidar_dispatch_invoices',
    '20261123130000_stone_excess_shipment_return',
    '20261123140000_stone_return_finalizations',
    '20261125110000_accounting_neutral_normal_side',
    '20261125112000_sepidar_customer_opening_admission',
    '20261125142000_sepidar_opening_cheque_anchors',
    '20261127120000_sepidar_cheque_batch_admission',
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
  assert.deepEqual(release[29].functions, ['serialize_customer_command_key_within', 'serialize_customer_allocation_intent_insert']);
  assert.deepEqual(release[32].functions, ['require_active_grouped_allocation_child']);
  assert.equal(release[24].statements.length, 5);
  assert.ok(release[24].statements.every(sql => /^ALTER TABLE/.test(sql)));
  const [sepidarReference, personalPickupSource, personalPickupDispatch, customerCardInsert, partnerNumberReservation] = release.slice(38, 43);
  assert.equal(sepidarReference.statements.length, 2);
  assert.deepEqual(sepidarReference.tables, ['logistics_loadings']);
  assert.deepEqual(personalPickupSource.statements, [`ALTER TYPE "GuardDriverSource" ADD VALUE 'PERSONAL_PICKUP';`]);
  assert.equal(personalPickupDispatch.statements.length, 5);
  assert.deepEqual(personalPickupDispatch.tables.sort(), ['dispatch_confirmation_sessions', 'guard_driver_queue_turns']);
  assert.equal(customerCardInsert.statements.length, 1);
  assert.deepEqual(customerCardInsert.tables, ['crm_customer_cards', 'crm_customers']);
  assert.deepEqual(customerCardInsert.functions, ['guard_customer_card_membership', 'init_customer_card']);
  assert.equal(partnerNumberReservation.statements.length, 3);
  assert.deepEqual(partnerNumberReservation.tables, ['partner_commercial_numbers', 'partner_sale_cases',
    'sabalan_to_partner_sale_records', 'sales_contracts']);
  assert.deepEqual(partnerNumberReservation.functions, ['partner_reserve_number']);
  assert.equal(release[43].statements.length, 4);
  assert.deepEqual(release[43].tables, ['performance_disclosure_revision', 'performance_policy_versions',
    'performance_criterion_versions', 'performance_template_versions', 'performance_cycles', 'performance_evaluations',
    'performance_evaluation_sections', 'performance_drafts', 'performance_submissions', 'performance_reviews',
    'performance_accepted_results', 'performance_export_receipts', 'performance_consequence_handoffs', 'performance_privacy_cases']);
  assert.deepEqual(release[43].functions, ['performance_guard_canonical_write', 'performance_preserve_first_write']);
  assert.equal(release[44].statements.length, 2);
  assert.deepEqual(release[44].tables, ['external_driver_documents', 'external_vehicle_documents', 'partner_commercial_accounts', 'partner_commercial_numbers', 'partner_duplicate_customer_matches', 'partner_identity_evidence', 'partner_terms_policies', 'simple_performance_profiles']);
  assert.deepEqual(release[44].functions, ['protect_runtime_reference_row']);
  for (let migrationIndex = 22; migrationIndex < files.length; migrationIndex++) {
    const changedMigration = files.map(([name, bytes], index) => index === migrationIndex
      ? [name, Buffer.concat([bytes, Buffer.from('\n-- drift')])] as const : [name, bytes] as const);
    assert.throws(() => compileProtectedCurrentRelease(changedMigration), /SQL_IDENTITY_MISMATCH/);
  }
});

test('protected migration receipts verify exact ACLs across the dormant to restricted login cutover', async () => {
  const runtime = 'sabalan_application_runtime';
  const owner = 'postgres';
  const database = 'sabalan';
  const grant = (grantee: string, privilege: string) => ({ grantee, privilege, grantable: false, grantor: owner });
  const table = (name: string, runtimePrivileges: string[]) => {
    const ownerPrivileges = ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'];
    return { kind: 'table', name, owner, ownerPrivileges, securityDefiner: false, columnAcl: false,
      grants: [...ownerPrivileges.map(verb => grant(owner, verb)), ...runtimePrivileges.map(verb => grant(runtime, verb))] };
  };
  const routine = (name: string, securityDefiner: boolean) => ({ kind: 'function', name, owner, securityDefiner,
    columnAcl: false, ownerPrivileges: ['EXECUTE'],
    grants: [grant(owner, 'EXECUTE'), ...(securityDefiner ? [] : [grant('', 'EXECUTE')])] });
  type ObjectAcl = ReturnType<typeof table>;
  const query = (login: boolean, objects: ObjectAcl[], admitted = true) => ({
    async $queryRaw<T>(sql: TemplateStringsArray | Prisma.Sql): Promise<T> {
      const rows = 'strings' in sql ? objects : [{ admitted, owner, database, login }];
      return rows as T;
    },
  });
  const legacy = { DEPLOYMENT_CHECKPOINT_RUNTIME_USER: owner, BACKEND_RUNTIME_ROLE: 'control',
    DATABASE_URL: `postgresql://${owner}@localhost/${database}` };
  const split = { ...legacy, DEPLOYMENT_CHECKPOINT_RUNTIME_USER: runtime };
  const names = new Set(['20261120120000_grant_runtime_customer_card_insert',
    '20261120121000_protect_partner_number_reservation']);
  const routines = [routine('guard_customer_card_membership', false), routine('init_customer_card', false),
    routine('partner_reserve_number', true)];
  const stagedTables = [table('crm_customer_cards', ['DELETE', 'INSERT', 'SELECT']), table('partner_commercial_numbers', ['SELECT'])];
  const dormantTables = [table('crm_customer_cards', []), table('partner_commercial_numbers', [])];
  const dormant = await protectedCurrentReleaseRuntimeAclProof(query(false, [...dormantTables, ...routines]), names, legacy);
  assert.ok(dormant);
  const active = await protectedCurrentReleaseRuntimeAclProof(query(true, [...stagedTables, ...routines]), names, split);
  assert.deepEqual(active, dormant);

  assert.equal(await protectedCurrentReleaseRuntimeAclProof({ $queryRaw() {
    throw new Error('Historical receipts must have no ACL query or proof fields');
  } }, new Set(['20261118120100_personal_pickup_dispatch']), legacy), undefined);
  await assert.rejects(protectedCurrentReleaseRuntimeAclProof(query(false, [...dormantTables, ...routines]), names, split),
    /RUNTIME_ROLE_UNPROVEN/);
  await assert.rejects(protectedCurrentReleaseRuntimeAclProof(query(true, [...stagedTables, ...routines]), names, legacy),
    /RUNTIME_ROLE_UNPROVEN/);
  await assert.rejects(protectedCurrentReleaseRuntimeAclProof(query(true, [...stagedTables, ...routines], false), names, split),
    /RUNTIME_ROLE_UNPROVEN/);
  await assert.rejects(protectedCurrentReleaseRuntimeAclProof(query(false, [...stagedTables, ...routines]), names, legacy),
    /RUNTIME_ACL_DRIFT/);

  const [cards, registry] = stagedTables;
  const [membership, init, reserve] = routines;
  for (const changed of [
    [table(cards.name, ['DELETE', 'SELECT']), registry, ...routines],
    [cards, table(registry.name, ['SELECT', 'UPDATE']), ...routines],
    [{ ...cards, columnAcl: true }, registry, ...routines],
    [{ ...cards, grants: cards.grants.map(entry => ({ ...entry, grantable: entry.grantee === runtime })) }, registry, ...routines],
    [{ ...cards, grants: cards.grants.map(entry => ({ ...entry, grantor: runtime })) }, registry, ...routines],
    [cards, registry, { ...membership, grants: [grant(owner, 'EXECUTE')] }, init, reserve],
    ...['', runtime, 'sabalan_allocation_controller', 'foreign_role'].map(grantee => [
      ...stagedTables, membership, init, { ...reserve, grants: [...reserve.grants, grant(grantee, 'EXECUTE')] },
    ]),
  ]) {
    await assert.rejects(protectedCurrentReleaseRuntimeAclProof(query(true, changed), names, split), /RUNTIME_ACL_DRIFT/);
  }

  const fullNames = new Set([...names, '20261120122000_protect_runtime_disclosure_revision',
    '20261120123000_protect_runtime_reference_row_locks',
    '20261120124000_runtime_dispatch_permissions', '20261120125000_runtime_driver_assignment_permissions', '20261120126000_runtime_partner_receipt_permissions',
    '20261120127000_runtime_partner_inquiry_evidence_locks']);
  const fullTables = [cards, table(registry.name, ['SELECT', 'UPDATE']),
    ...['external_driver_documents', 'external_vehicle_documents', 'partner_commercial_accounts',
      'partner_duplicate_customer_matches', 'simple_performance_profiles'].map(name => table(name, ['INSERT', 'SELECT', 'UPDATE'])),
    ...['logistics_loading_lines', 'shipment_quantity_evidence']
      .map(name => table(name, ['DELETE', 'INSERT', 'SELECT', 'UPDATE'])),
    ...['driver_vehicle_assignments', 'external_driver_vehicle_assignments']
      .map(name => table(name, ['INSERT', 'SELECT', 'UPDATE'])),
    ...['partner_case_events', 'partner_payment_installments', 'partner_payment_plans', 'partner_retail_receipt_allocations', 'partner_retail_receipts']
      .map(name => table(name, ['INSERT', 'SELECT', 'UPDATE'])),
    ...['partner_conversion_dispositions', 'partner_inquiry_approvals', 'partner_inquiry_assignments',
      'partner_profile_responder_assignments', 'sales_contract_draft_audits', 'sales_contract_seller_audits']
      .map(name => table(name, ['INSERT', 'SELECT', 'UPDATE'])),
    ...['partner_identity_evidence', 'partner_terms_policies', 'performance_disclosure_revision']
      .map(name => table(name, ['SELECT', 'UPDATE']))];
  const fullRoutines = [...routines, routine('performance_guard_canonical_write', true),
    routine('performance_preserve_first_write', false), routine('protect_runtime_reference_row', false),
    routine('protect_runtime_loading_line_write', false),
    routine('prevent_shipment_quantity_evidence_mutation', false),
    routine('protect_runtime_driver_assignment_identity', false),
    routine('protect_runtime_partner_receipt_assembly', false)];
  assert.ok(await protectedCurrentReleaseRuntimeAclProof(query(true, [...fullTables, ...fullRoutines]), fullNames, split));
  const novemberNames = new Set([...fullNames,
    '20261123110000_stone_return_receipts', '20261123111000_stone_return_allocation_drafts',
    '20261123130000_sepidar_dispatch_invoices', '20261123140000_stone_return_finalizations']);
  const stone = ['stone_return_receipts', 'stone_return_allocation_drafts', 'stone_return_allocation_draft_rows',
    'stone_return_finalizations'].map(name => table(name, ['INSERT', 'SELECT']));
  const novemberObjects = [...fullTables, ...fullRoutines, ...stone];
  const invoices = (verbs: string[]) => table('sepidar_dispatch_invoices', verbs);
  assert.ok(await protectedCurrentReleaseRuntimeAclProof(query(true,
    [...novemberObjects, invoices(['INSERT', 'DELETE', 'SELECT'])]), novemberNames, split));
  await assert.rejects(protectedCurrentReleaseRuntimeAclProof(query(true,
    [...novemberObjects, invoices(['INSERT', 'DELETE', 'SELECT', 'UPDATE'])]), novemberNames, split), /RUNTIME_ACL_DRIFT/);
  await assert.rejects(protectedCurrentReleaseRuntimeAclProof(query(true, [registry, ...fullTables.filter(object => object.name !== registry.name),
    ...fullRoutines]), fullNames, split), /RUNTIME_ACL_DRIFT/);
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
