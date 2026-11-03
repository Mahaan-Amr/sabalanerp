import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { projectBackendWorkspaceInputs } from './backend-workspace-projection.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backend-workspace-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'repo'), compiled = path.join(root, 'compiled');
  fs.mkdirSync(repository); fs.mkdirSync(compiled);
  const outputs = ['graph-dist/index.d.ts', 'partner-dist/index.d.ts'].map(file => {
    const bytes = Buffer.from('export interface WorkspaceValue { id: string }\n');
    fs.mkdirSync(path.dirname(path.join(compiled, file)), { recursive: true });
    fs.writeFileSync(path.join(compiled, file), bytes);
    return { path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  return { repository, compiled, metadata: { format: 'sabalan-original-workspace-components-reused/v1', outputs } };
}

test('projects authenticated outputs for real relative package resolution without recompilation', t => {
  const f = fixture(t), args = [f.repository, f.compiled, f.metadata];
  const result = projectBackendWorkspaceInputs(...args);
  assert.equal(result.files, 2); assert.equal(result.recompiled, false); result.revalidate();
  projectBackendWorkspaceInputs(...args).revalidate(); // Identical existing outputs are reusable.
  fs.appendFileSync(path.join(f.repository, 'packages/partner-sales-contracts/dist/index.d.ts'), 'bad');
  assert.throws(() => result.revalidate());
  assert.throws(() => projectBackendWorkspaceInputs(...args));
});

test('bad final input fails before any projection is written', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.compiled, 'partner-dist/index.d.ts'), 'bad');
  assert.throws(() => projectBackendWorkspaceInputs(f.repository, f.compiled, f.metadata));
  assert.equal(fs.existsSync(path.join(f.repository, 'packages')), false);
});

test('rejects traversal, duplicates and missing package entry', t => {
  for (const mutate of [m => m.outputs[0].path = 'graph-dist/../escape',
    m => m.outputs.push(m.outputs[0]), m => m.outputs.pop()]) {
    const f = fixture(t); mutate(f.metadata);
    assert.throws(() => projectBackendWorkspaceInputs(f.repository, f.compiled, f.metadata));
    assert.equal(fs.existsSync(path.join(f.repository, 'packages')), false);
  }
});
