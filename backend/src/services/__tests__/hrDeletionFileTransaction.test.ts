import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitStagedHiringFiles, restoreStagedHiringFiles, stageHiringFilesForDeletion } from '../hrDeletionFileTransaction';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-hr-delete-'));
fs.writeFileSync(path.join(root, 'one.pdf'), 'one');
fs.writeFileSync(path.join(root, 'two.jpg'), 'two');
fs.writeFileSync(path.join(root, 'three.png'), 'three');

const staged = stageHiringFilesForDeletion(['one.pdf', 'missing.pdf', 'two.jpg', 'one.pdf'], 'operation-1', root);
assert.equal(staged.length, 2);
assert.equal(fs.existsSync(path.join(root, 'one.pdf')), false);
assert.throws(() => stageHiringFilesForDeletion(['../unsafe.pdf'], 'operation-2', root), /ناامن/);
assert.throws(() => stageHiringFilesForDeletion(['three.png', '../unsafe.pdf'], 'operation-rollback', root), /ناامن/);
assert.equal(fs.readFileSync(path.join(root, 'three.png'), 'utf8'), 'three');

restoreStagedHiringFiles(staged);
assert.equal(fs.readFileSync(path.join(root, 'one.pdf'), 'utf8'), 'one');

const stagedAgain = stageHiringFilesForDeletion(['one.pdf', 'two.jpg'], 'operation-3', root);
assert.deepEqual(commitStagedHiringFiles(stagedAgain), []);
assert.equal(fs.existsSync(path.join(root, 'one.pdf')), false);

fs.rmSync(root, { recursive: true, force: true });
console.log('HR deletion file transaction tests passed.');
