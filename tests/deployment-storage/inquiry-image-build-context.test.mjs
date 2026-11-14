import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');

test('Inquiry image can stage the complete private runtime bundle from committed sources', () => {
  const recipe = fs.readFileSync(path.join(root, 'deploy/docker/inquiry.Dockerfile'), 'utf8');
  const bundle = fs.readFileSync(path.join(root, 'scripts/build-inquiry-runtime-bundle.mjs'), 'utf8');
  const sourceCopy = recipe.split('\n').find(line => line.startsWith('COPY backend/src/services/onlineInquiryWork.ts '));
  assert.ok(sourceCopy, 'Inquiry recipe must stage its private runtime sources');
  const staged = sourceCopy.match(/backend\/src\/services\/[A-Za-z]+\.ts/g) ?? [];
  for (const source of staged) {
    assert.ok(fs.statSync(path.join(root, source)).isFile(), `${source} must exist for the Inquiry image build`);
    const name = path.basename(source, '.ts');
    assert.match(bundle, new RegExp(`['"]${name}['"]`), `${name} must be bundled from the staged source`);
  }
  assert.match(bundle, /createScopedInquiryWork/, 'the private bundle must retain its scoped owner');
});
