import assert from 'node:assert/strict';
import test from 'node:test';
import { CROSS_WORKSPACE_DUTY_DEFINITIONS } from '../crossWorkspaceDutyModule';

const expectedAccountability = {
  LEGACY_HR_WORK_ITEM_REVIEW: ['SHARED_DECISION', true],
  FINANCE_RECORDING: ['INDIVIDUAL_EXECUTION', true],
  FINANCE_APPROVAL: ['SHARED_DECISION', true],
  COMPANY_MANAGER_REVIEW: ['SHARED_DECISION', true],
  COMPANY_MANAGER_DECISION: ['SHARED_DECISION', true],
  RESPONSIBLE_SUPERVISOR_REVIEW: ['SHARED_DECISION', true],
  PAYROLL_PREPARATION: ['INDIVIDUAL_EXECUTION', true],
  PAYROLL_APPROVAL: ['SHARED_DECISION', true],
  ACCOUNTING_PROCESS_CONTRACT_CORRECTION: ['INDIVIDUAL_EXECUTION', false],
  ACCOUNTING_DECIDE_CONTRACT_CORRECTION: ['SHARED_DECISION', false],
  SALES_EDIT_CONTRACT_CORRECTION: ['INDIVIDUAL_EXECUTION', false],
  ACCOUNTING_VERIFY_CONTRACT_CORRECTION: ['SHARED_DECISION', false],
  HIRING_COLLATERAL_RECORD_RECEIPT: ['INDIVIDUAL_EXECUTION', true],
  HIRING_COLLATERAL_VERIFY_RECEIPT: ['SHARED_DECISION', true],
  HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN: ['INDIVIDUAL_EXECUTION', true],
  HIRING_COLLATERAL_VERIFY_ORIGINAL_RETURN: ['SHARED_DECISION', true],
} as const;

test('every registered duty declares one accountability model and its workspace override policy', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(CROSS_WORKSPACE_DUTY_DEFINITIONS).map(([code, definition]) => [
      code,
      [(definition as any).accountabilityModel, (definition as any).workspaceAdminOverrideDenied],
    ])),
    expectedAccountability,
  );
});

test('shared decisions expose at least one structured result action', () => {
  for (const [code, definition] of Object.entries(CROSS_WORKSPACE_DUTY_DEFINITIONS)) {
    if ((definition as any).accountabilityModel !== 'SHARED_DECISION') continue;
    assert.ok(definition.allowedActionCodes.length > 0, `${code} must expose a decision action`);
  }
});
