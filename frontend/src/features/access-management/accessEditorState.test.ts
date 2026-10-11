import assert from 'node:assert/strict';
import {
  createAccessDraft,
  deselectAllInWorkspace,
  selectAllInWorkspace,
  setFeatureSelection,
  type AccessFeatureDefinition,
} from './accessEditorState';

const definitions: AccessFeatureDefinition[] = [
  { key: 'RECRUITMENT_CASES', workspace: 'hr', label: 'پرونده‌های استخدام', requiredLevel: 'view', prerequisites: [] },
  { key: 'VIEW_INITIAL_INTERVIEW_CRITERIA', workspace: 'hr', label: 'مشاهده معیارهای مصاحبه اولیه', requiredLevel: 'view', prerequisites: ['RECRUITMENT_CASES'] },
  { key: 'RECORD_INITIAL_INTERVIEW', workspace: 'hr', label: 'ثبت و تکمیل مصاحبه اولیه', requiredLevel: 'edit', prerequisites: ['RECRUITMENT_CASES', 'VIEW_INITIAL_INTERVIEW_CRITERIA'] },
  { key: 'sales_contracts_view', workspace: 'sales', label: 'مشاهده قراردادها', requiredLevel: 'view', prerequisites: [] },
  { key: 'sales_contracts_edit', workspace: 'sales', label: 'ویرایش قراردادها', requiredLevel: 'edit', prerequisites: ['sales_contracts_view'] },
];

let draft = createAccessDraft({
  workspaceLevels: { hr: 'edit', sales: 'view' },
  explicitlySelectedFeatures: ['RECRUITMENT_CASES'],
}, definitions);

const loaded = createAccessDraft({
  explicitlySelectedFeatures: ['RECORD_INITIAL_INTERVIEW'],
}, definitions);
assert.ok(loaded.selectedFeatures.has('VIEW_INITIAL_INTERVIEW_CRITERIA'));
assert.ok(loaded.automaticallyAddedFeatures.has('VIEW_INITIAL_INTERVIEW_CRITERIA'));

draft = setFeatureSelection(draft, definitions, 'RECORD_INITIAL_INTERVIEW', true);
assert.deepEqual(Array.from(draft.selectedFeatures).sort(), [
  'RECORD_INITIAL_INTERVIEW',
  'RECRUITMENT_CASES',
  'VIEW_INITIAL_INTERVIEW_CRITERIA',
].sort());
assert.deepEqual(Array.from(draft.automaticallyAddedFeatures).sort(), ['VIEW_INITIAL_INTERVIEW_CRITERIA']);

const protectedPrerequisite = setFeatureSelection(draft, definitions, 'VIEW_INITIAL_INTERVIEW_CRITERIA', false);
assert.ok(!protectedPrerequisite.selectedFeatures.has('VIEW_INITIAL_INTERVIEW_CRITERIA'));
assert.ok(!protectedPrerequisite.selectedFeatures.has('RECORD_INITIAL_INTERVIEW'), 'unchecking a prerequisite disables dependent operations');
assert.equal(protectedPrerequisite.workspaceLevels.hr, 'edit', 'operation changes preserve workspace level');

let crossWorkspaceDraft = createAccessDraft({}, definitions);
crossWorkspaceDraft = setFeatureSelection(crossWorkspaceDraft, definitions, 'RECORD_INITIAL_INTERVIEW', true);
crossWorkspaceDraft = selectAllInWorkspace(crossWorkspaceDraft, definitions, 'sales', 'admin');
assert.ok(crossWorkspaceDraft.selectedFeatures.has('VIEW_INITIAL_INTERVIEW_CRITERIA'), 'select all preserves automatic prerequisites in another workspace');
assert.ok(crossWorkspaceDraft.automaticallyAddedFeatures.has('VIEW_INITIAL_INTERVIEW_CRITERIA'));
crossWorkspaceDraft = deselectAllInWorkspace(crossWorkspaceDraft, definitions, 'sales');
assert.ok(crossWorkspaceDraft.selectedFeatures.has('VIEW_INITIAL_INTERVIEW_CRITERIA'), 'deselect all preserves automatic prerequisites in another workspace');

draft = setFeatureSelection(draft, definitions, 'RECORD_INITIAL_INTERVIEW', false);
assert.deepEqual(Array.from(draft.selectedFeatures), ['RECRUITMENT_CASES'], 'persisted explicit access is not removed with its dependent');

draft = selectAllInWorkspace(draft, definitions, 'sales', 'admin');
assert.equal(draft.workspaceLevels.sales, 'view');
assert.ok(draft.selectedFeatures.has('sales_contracts_view'));
assert.ok(draft.selectedFeatures.has('sales_contracts_edit'));
assert.ok(draft.selectedFeatures.has('RECRUITMENT_CASES'), 'select all does not alter another workspace');

draft = deselectAllInWorkspace(draft, definitions, 'sales');
assert.equal(draft.workspaceLevels.sales, 'view', 'unchecking all operations preserves manager level');
assert.ok(!draft.selectedFeatures.has('sales_contracts_view'));
assert.ok(!draft.selectedFeatures.has('sales_contracts_edit'));
assert.ok(draft.selectedFeatures.has('RECRUITMENT_CASES'), 'deselect all is scoped to one workspace');

console.log('Access editor state tests passed.');
