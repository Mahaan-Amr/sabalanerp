import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSubmitPartnerTechnicalAction,
  showPartnerContractConfigurationWarning,
  partnerTechnicalSaveIssue,
} from '../../contract-creation/partner/partnerCreationFlow';

test('independent inquiry can submit with optional dimensions and no contract quantity', () => {
  assert.equal(canSubmitPartnerTechnicalAction({
    mode: 'inquiry',
    pending: false,
    technicalReady: true,
    contractConfigurationReady: false,
    quickDimensionsValid: true,
    hasDraftAccess: true,
  }), true);
  assert.equal(showPartnerContractConfigurationWarning('inquiry', false), false);
});

test('a dependent calculation failure names the actual issue before a validated save', () => {
  const preview = { ok: true as const, value: { conflicts: [], rows: [{ calculation: { ok: true } }],
    dependents: [{ calculation: { ok: false, conflicts: [{ message: 'تعداد قطعهٔ وابسته را وارد کنید.' }] } }] } };
  assert.equal(partnerTechnicalSaveIssue(preview), 'تعداد قطعهٔ وابسته را وارد کنید.');
});

test('an operation identity conflict gives a Persian correction message', () => {
  const preview = { ok: true as const, value: { conflicts: [], rows: [{ calculation: { ok: true },
    operations: { ok: false, conflicts: [{ code: 'duplicate-operation-identity',
      message: 'The automatic no-operation group requires an independent identity.' }] } }], dependents: [] } };
  assert.match(partnerTechnicalSaveIssue(preview) ?? '', /شناسهٔ گروه عملیات تکراری/);
});

test('partner sale product step still requires a complete canonical contract configuration', () => {
  assert.equal(canSubmitPartnerTechnicalAction({
    mode: 'sale',
    pending: false,
    technicalReady: true,
    contractConfigurationReady: false,
    quickDimensionsValid: true,
    hasDraftAccess: true,
  }), false);
  assert.equal(showPartnerContractConfigurationWarning('sale', false), true);
});
