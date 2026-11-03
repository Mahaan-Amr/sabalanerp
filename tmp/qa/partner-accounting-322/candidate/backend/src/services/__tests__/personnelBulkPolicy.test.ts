import assert from 'node:assert/strict';
import { buildPersonnelBulkPreview, selectionVersionHash } from '../personnelBulkPolicy';

const records = [
  { id: 'p1', updatedAt: new Date('2026-07-21T08:00:00Z'), user: null },
  { id: 'p2', updatedAt: new Date('2026-07-21T08:00:00Z'), user: { id: 'u2', role: 'ADMIN', isActive: true, updatedAt: new Date('2026-07-21T08:00:00Z') } },
];
const preview = buildPersonnelBulkPreview(records, 'DEACTIVATE', 'MANAGER');
assert.deepEqual(preview.eligible.map((item) => item.id), ['p1']);
assert.deepEqual(preview.conflicting.map((item) => item.id), ['p2']);
assert.equal(preview.conflicting[0].reason, 'MANAGER_CANNOT_AFFECT_ADMIN');
assert.notEqual(selectionVersionHash(records), selectionVersionHash([{ ...records[0], updatedAt: new Date('2026-07-21T08:01:00Z') }, records[1]]));
assert.notEqual(selectionVersionHash(records), selectionVersionHash([records[0], { ...records[1], user: { ...records[1].user!, role: 'USER' } }]));
assert.notEqual(selectionVersionHash(records), selectionVersionHash([{ ...records[0], workSchedules: [{ id: 's1', updatedAt: new Date('2026-07-21T08:00:00Z') }] }, records[1]]));
assert.throws(() => buildPersonnelBulkPreview(records, 'DELETE', 'ADMIN'), /Unsupported bulk operation/);

console.log('personnel bulk policy tests passed');
