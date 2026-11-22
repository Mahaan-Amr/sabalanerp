import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RecoveryCoordinationState } from '../recoveryCoordinationState';

test('missing, torn and semantically invalid coordination never retain stale NORMAL permission', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-state-'));
  const store = new RecoveryCoordinationState(root);
  try {
    assert.equal(store.read().mode, 'MAINTENANCE');
    store.initialize();
    assert.equal(store.read().mode, 'NORMAL');
    store.write('READ_ONLY', 'snapshot');
    assert.equal(store.read().mode, 'READ_ONLY');
    for (const payload of ['{', '{}', '{"mode":"NORMAL","updatedAt":"invalid"}', '{"mode":"MAYBE","updatedAt":"2026-10-14T12:00:00Z"}']) {
      fs.writeFileSync(path.join(root, 'state.json'), payload);
      assert.equal(store.read().mode, 'MAINTENANCE');
      assert.throws(() => store.initialize(), /RECOVERY_COORDINATION_INVALID/);
      assert.equal(fs.readFileSync(path.join(root, 'state.json'), 'utf8'), payload, 'startup must not repair unknown state into NORMAL');
    }
    fs.unlinkSync(path.join(root, 'state.json'));
    assert.equal(store.read().mode, 'MAINTENANCE');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('atomic publication replaces the old inode, validates mode and preserves an existing maintenance boundary on initialization', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-state-'));
  const store = new RecoveryCoordinationState(root);
  try {
    store.initialize();
    const old = process.platform === 'linux' ? fs.openSync(path.join(root, 'state.json'), 'r') : undefined;
    try {
      store.write('MAINTENANCE', 'restore');
      if (old !== undefined) assert.equal(JSON.parse(fs.readFileSync(old, 'utf8')).mode, 'NORMAL');
      store.initialize();
      assert.equal(store.read().mode, 'MAINTENANCE');
      assert.equal(store.read().operationId, 'restore');
      assert.throws(() => store.write('INVALID' as any), /RECOVERY_COORDINATION_INVALID/);
      assert.equal(store.read().mode, 'MAINTENANCE');
      assert.deepEqual(fs.readdirSync(root), ['state.json']);
    } finally { if (old !== undefined) fs.closeSync(old); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
