import assert from 'node:assert/strict';
import test from 'node:test';
import { qaDatabaseUrl } from './qa-identities';

test('QA identity writes are restricted to the existing sabalanerp-local database', () => {
  assert.equal(
    qaDatabaseUrl('postgresql://postgres:sabalanerp-local-only@localhost:55432/sabalanerp'),
    'postgresql://postgres:sabalanerp-local-only@localhost:55432/sabalanerp',
  );
  assert.throws(() => qaDatabaseUrl('postgresql://postgres:sabalanerp-local-only@db.example.com:55432/sabalanerp'), /sabalanerp-local/);
  assert.throws(() => qaDatabaseUrl('postgresql://postgres:wrong@127.0.0.1:55432/sabalanerp'), /sabalanerp-local/);
  assert.throws(() => qaDatabaseUrl('postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/production'), /sabalanerp-local/);
});
