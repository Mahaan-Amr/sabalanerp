import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSepidarSnapshots } from '../sepidarSnapshotDelta';

test('daily complete backups identify new, amended and missing source rows without overwriting evidence', () => {
  const before = [
    { sourceTable: 'ACC.Voucher', sourceKey: '1', sourceHash: 'a' },
    { sourceTable: 'ACC.Voucher', sourceKey: '2', sourceHash: 'b' },
    { sourceTable: 'INV.InventoryDelivery', sourceKey: '1', sourceHash: 'c' },
  ];
  const after = [
    { sourceTable: 'ACC.Voucher', sourceKey: '1', sourceHash: 'a' },
    { sourceTable: 'ACC.Voucher', sourceKey: '2', sourceHash: 'd' },
    { sourceTable: 'ACC.Voucher', sourceKey: '3', sourceHash: 'e' },
  ];
  const delta = compareSepidarSnapshots(before, after);
  assert.equal(delta.unchangedCount, 1);
  assert.deepEqual(delta.added, [after[2]]);
  assert.deepEqual(delta.changed, [{ before: before[1], after: after[1] }]);
  assert.deepEqual(delta.removed, [before[2]]);
  assert.deepEqual(before[1], { sourceTable: 'ACC.Voucher', sourceKey: '2', sourceHash: 'b' });
  assert.throws(() => compareSepidarSnapshots(before, [...after, after[0]]), /Duplicate source identity/);
});
