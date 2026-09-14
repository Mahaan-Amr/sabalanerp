import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scannerPath = path.join(repositoryRoot, 'scripts', 'text-corruption-inventory.mjs');

function scan(source) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-text-corruption-'));
  const targetDirectory = path.join(fixtureRoot, 'frontend/src/app/dashboard/inventory');
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.writeFileSync(path.join(targetDirectory, 'fixture.tsx'), source, 'utf8');

  try {
    execFileSync(process.execPath, [scannerPath], { cwd: fixtureRoot });
    return JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, 'reports/text-corruption-inventory.json'), 'utf8')
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test('does not report the TypeScript nullish-coalescing operator as corrupted text', () => {
  assert.deepEqual(scan('const price = unitPrice ?? fallbackPrice;'), []);
});

test('continues to report question marks that replaced user-facing text', () => {
  const records = scan('const label = "????";');

  assert.equal(records.length, 1);
  assert.equal(records[0].class, 'question-marks');
});

test('reports a two-question-mark JSX text node instead of treating it as an operator', () => {
  const records = scan('export const Label = () => <span>??</span>;');

  assert.equal(records.length, 1);
  assert.equal(records[0].class, 'question-marks');
});
