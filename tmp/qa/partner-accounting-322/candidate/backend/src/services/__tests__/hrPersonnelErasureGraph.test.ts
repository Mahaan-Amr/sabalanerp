import assert from 'node:assert/strict';
import { buildDeletionRelationIndex, deletionModelOrder, localUploadStorageName } from '../hrPersonnelErasureGraph';

const models = [
  { name: 'Personnel', fields: [{ name: 'id', kind: 'scalar' }] },
  { name: 'User', fields: [
    { name: 'id', kind: 'scalar' },
    { name: 'personnelId', kind: 'scalar' },
    { name: 'personnel', kind: 'object', type: 'Personnel', relationFromFields: ['personnelId'], relationToFields: ['id'] },
    { name: 'createdByUserId', kind: 'scalar', type: 'String' },
    { name: 'createdByUser', kind: 'object', type: 'User', relationFromFields: ['createdByUserId'], relationToFields: ['id'] },
  ] },
  { name: 'Attendance', fields: [
    { name: 'id', kind: 'scalar' },
    { name: 'personnelId', kind: 'scalar' },
    { name: 'personnel', kind: 'object', type: 'Personnel', relationFromFields: ['personnelId'], relationToFields: ['id'] },
  ] },
  { name: 'AssessmentSelection', fields: [
    { name: 'id', kind: 'scalar' },
    { name: 'planId', kind: 'scalar' },
    { name: 'kind', kind: 'scalar' },
  ] },
  { name: 'AssessmentResult', fields: [
    { name: 'id', kind: 'scalar' },
    { name: 'selectionId', kind: 'scalar', isRequired: true },
    { name: 'planId', kind: 'scalar', isRequired: true },
    { name: 'kind', kind: 'scalar', isRequired: true },
    { name: 'selection', kind: 'object', type: 'AssessmentSelection', relationFromFields: ['selectionId', 'planId', 'kind'], relationToFields: ['id', 'planId', 'kind'] },
  ] },
  { name: 'Session', fields: [
    { name: 'id', kind: 'scalar' },
    { name: 'userId', kind: 'scalar' },
    { name: 'user', kind: 'object', type: 'User', relationFromFields: ['userId'], relationToFields: ['id'] },
  ] },
  { name: 'OperationalAudit', fields: [
    { name: 'id', kind: 'scalar', type: 'String' },
    { name: 'approvedBy', kind: 'scalar', type: 'String' },
  ] },
  { name: 'AccountingFinancialRecord', fields: [
    { name: 'id', kind: 'scalar', type: 'String' },
    { name: 'createdBy', kind: 'scalar', type: 'String', isRequired: true },
  ] },
];

const relations = buildDeletionRelationIndex(models as any);
assert.deepEqual(relations.map((item) => `${item.childModel}.${item.childField}->${item.parentModel}`).sort(), [
  'AccountingFinancialRecord.createdBy->User',
  'AssessmentResult.selectionId->AssessmentSelection',
  'Attendance.personnelId->Personnel',
  'OperationalAudit.approvedBy->User',
  'Session.userId->User',
  'User.personnelId->Personnel',
]);
assert.deepEqual(
  deletionModelOrder(new Set(['AssessmentSelection', 'AssessmentResult']), relations),
  ['AssessmentResult', 'AssessmentSelection'],
);
assert.deepEqual(deletionModelOrder(new Set(['Personnel', 'User', 'Attendance', 'Session']), relations), ['Attendance', 'Session', 'User', 'Personnel']);
assert.throws(() => deletionModelOrder(new Set(['A', 'B']), [
  { childModel: 'A', childField: 'bId', parentModel: 'B', childRequired: true },
  { childModel: 'B', childField: 'aId', parentModel: 'A', childRequired: true },
]), /چرخه/);
assert.deepEqual(deletionModelOrder(new Set(['A', 'B']), [
  { childModel: 'A', childField: 'bId', parentModel: 'B', childRequired: true },
  { childModel: 'B', childField: 'aId', parentModel: 'A', childRequired: false },
]), ['A', 'B']);
assert.equal(localUploadStorageName('/files/uploads/images/evidence-1.jpg?download=1'), 'evidence-1.jpg');
assert.equal(localUploadStorageName('https://example.com/unmanaged.jpg'), null);

console.log('HR Personnel erasure graph tests passed.');
