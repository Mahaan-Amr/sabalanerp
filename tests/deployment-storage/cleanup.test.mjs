import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planStorageCleanup, executeStorageCleanup } from '../../scripts/deployment-storage.mjs';

test('cleanup removes obsolete owned artifacts while preserving recovery and other projects', () => {
  const image = id => `sha256:${id.repeat(64)}`;
  const plan = planStorageCleanup({
    project: 'sabalanerp', now: Date.parse('2026-10-14T00:00:00Z'),
    images: ['a', 'b', 'c', 'd'].map(id => ({ id: image(id), project: id === 'd' ? 'fintech-lab' : 'sabalanerp', createdAt: '2026-10-01T00:00:00Z' })),
    containers: [
      { id: 'active', project: 'sabalanerp', image: image('a'), state: 'running' },
      { id: 'old', project: 'sabalanerp', image: image('b'), state: 'exited', operationTerminal: true },
      { id: 'foreign', project: 'fintech-lab', image: image('d'), state: 'exited', operationTerminal: true },
    ],
    protectedImages: [image('c')], protectedContainers: [], evidenceComplete: true,
  });
  assert.deepEqual(plan.containers, ['old']);
  assert.deepEqual(plan.images, [image('b')]);
});

test('missing recovery evidence prevents all cleanup', () => {
  assert.throws(() => planStorageCleanup({ evidenceComplete: false }), /EVIDENCE_INCOMPLETE/);
});

test('a newly referenced image is preserved when ownership changes after planning', async () => {
  const id = `sha256:${'b'.repeat(64)}`;
  let snapshots = 0;
  const removed = [];
  const result = await executeStorageCleanup({
    snapshot: async () => ({
      project: 'sabalanerp', now: Date.parse('2026-10-14T00:00:00Z'), evidenceComplete: true, protectedImages: [], protectedContainers: [],
      images: [{ id, project: 'sabalanerp', createdAt: '2026-10-01T00:00:00Z' }],
      containers: snapshots++ ? [{ id: 'new-live', image: id, project: 'sabalanerp', state: 'running' }] : [],
    }),
    removeContainer: async value => removed.push(value),
    removeImage: async value => removed.push(value),
    availableBytes: async () => 1000,
    record: async () => {},
  });
  assert.deepEqual(removed, []);
  assert.equal(result.availableBytes, 1000);
});

test('new or unclassified build artifacts are retained for the browser compatibility window', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const plan = planStorageCleanup({ project: 'sabalanerp', now, evidenceComplete: true, protectedImages: [], protectedContainers: [], containers: [],
    images: [
      { id: `sha256:${'a'.repeat(64)}`, project: 'sabalanerp', createdAt: '2026-10-14T11:00:00Z' },
      { id: `sha256:${'b'.repeat(64)}`, project: 'sabalanerp' },
    ],
  });
  assert.deepEqual(plan.images, []);
});
