import assert from 'node:assert/strict';
import { buildDeletionRelationIndex, deletionModelOrder } from '../hrPersonnelErasureGraph';

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
  { name: 'Session', fields: [
    { name: 'id', kind: 'scalar' },
    { name: 'userId', kind: 'scalar' },
    { name: 'user', kind: 'object', type: 'User', relationFromFields: ['userId'], relationToFields: ['id'] },
  ] },
  { name: 'OperationalAudit', fields: [
    { name: 'id', kind: 'scalar', type: 'String' },
    { name: 'approvedBy', kind: 'scalar', type: 'String' },
  ] },
];

const relations = buildDeletionRelationIndex(models as any);
assert.deepEqual(relations.map((item) => `${item.childModel}.${item.childField}->${item.parentModel}`).sort(), [
  'Attendance.personnelId->Personnel',
  'OperationalAudit.approvedBy->User',
  'Session.userId->User',
  'User.personnelId->Personnel',
]);
assert.deepEqual(deletionModelOrder(new Set(['Personnel', 'User', 'Attendance', 'Session']), relations), ['Attendance', 'Session', 'User', 'Personnel']);
assert.throws(() => deletionModelOrder(new Set(['A', 'B']), [
  { childModel: 'A', childField: 'bId', parentModel: 'B' },
  { childModel: 'B', childField: 'aId', parentModel: 'A' },
]), /چرخه/);

console.log('HR Personnel erasure graph tests passed.');
