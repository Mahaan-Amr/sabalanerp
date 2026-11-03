import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const packages = { 'graph-dist': 'contract-product-graph', 'partner-dist': 'partner-sales-contracts' };

/** Project already authenticated workspace outputs for relative backend imports.
 * Existing bytes must match; this never recompiles or replaces an output.
 * The caller authenticates metadata with prepareWorkspaceComponentReuse first.
 */
export function projectBackendWorkspaceInputs(repository, compiledRoot, metadata) {
  assert.equal(metadata.format, 'sabalan-original-workspace-components-reused/v1');
  const entries = metadata.outputs.map(row => {
    const parts = row.path.split('/');
    const name = packages[parts.shift()];
    assert.ok(name && parts.length && parts.every(p => p && p !== '.' && p !== '..' && !p.includes('\\')));
    const source = path.join(compiledRoot, row.path);
    const target = path.join(repository, 'packages', name, 'dist', ...parts);
    return { ...row, source, target };
  });
  assert.equal(new Set(entries.map(row => row.target)).size, entries.length);
  for (const name of Object.values(packages)) {
    assert.ok(entries.some(row => row.target === path.join(repository, 'packages', name, 'dist/index.d.ts')));
  }
  function verify(file, row) {
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
    assert.equal(fs.realpathSync(file), path.resolve(file));
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, row.bytes);
    assert.equal(digest(bytes), row.sha256);
    return bytes;
  }
  // Validate all inputs and existing targets before writing any missing output.
  for (const row of entries) {
    verify(row.source, row);
    if (fs.existsSync(row.target)) verify(row.target, row);
    let parent = path.dirname(row.target);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    assert.equal(fs.realpathSync(parent), path.resolve(parent));
  }
  for (const row of entries) {
    if (!fs.existsSync(row.target)) {
      fs.mkdirSync(path.dirname(row.target), { recursive: true });
      fs.writeFileSync(row.target, verify(row.source, row), { flag: 'wx', mode: 0o600 });
    }
    verify(row.target, row);
  }
  return Object.freeze({ files: entries.length, recompiled: false,
    revalidate() { for (const row of entries) { verify(row.source, row); verify(row.target, row); } } });
}
