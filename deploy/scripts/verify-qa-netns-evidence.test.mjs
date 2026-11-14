import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const script = path.join(import.meta.dirname, 'verify-qa-netns-evidence.mjs');
const shared = [
  'initial-netns', 'initial-iptables-v4', 'initial-iptables-v6',
  'initial-routes-v4', 'initial-routes-v6', 'initial-links',
  'desktop-netns', 'desktop-docker-id', 'desktop-service-census',
  'local-service-census',
];

function withEvidence(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-netns-evidence-'));
  try {
    for (const name of shared) {
      for (const phase of ['before', 'after']) {
        fs.writeFileSync(path.join(root, `${name}.${phase}`),
          name.endsWith('netns') ? 'net:[4026531833]\n' : `${name}: stable\n`);
      }
    }
    fs.writeFileSync(path.join(root, 'qa-netns.after'), 'net:[4026532999]\n');
    fs.writeFileSync(path.join(root, 'qa-daemon-netns.after'), 'net:[4026532999]\n');
    return run(root, () => spawnSync(process.execPath, [script, root], { encoding: 'utf8' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('complete isolated evidence passes', () => withEvidence((_, check) => {
  const result = check();
  assert.equal(result.status, 0, result.stderr);
}));

test('shared route change refuses', () => withEvidence((root, check) => {
  fs.writeFileSync(path.join(root, 'initial-routes-v4.after'), 'changed\n');
  assert.notEqual(check().status, 0);
}));

test('missing Desktop census refuses', () => withEvidence((root, check) => {
  fs.unlinkSync(path.join(root, 'desktop-service-census.after'));
  assert.notEqual(check().status, 0);
}));

test('daemon in initial namespace refuses', () => withEvidence((root, check) => {
  fs.writeFileSync(path.join(root, 'qa-daemon-netns.after'), 'net:[4026531833]\n');
  assert.notEqual(check().status, 0);
}));

test('named probe and daemon inode mismatch refuses', () => withEvidence((root, check) => {
  fs.writeFileSync(path.join(root, 'qa-netns.after'), 'net:[4026533000]\n');
  assert.notEqual(check().status, 0);
}));

test('Desktop network namespace change refuses', () => withEvidence((root, check) => {
  fs.writeFileSync(path.join(root, 'desktop-netns.after'), 'net:[4026532999]\n');
  assert.notEqual(check().status, 0);
}));

test('empty evidence refuses', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-netns-empty-'));
  try {
    assert.notEqual(spawnSync(process.execPath, [script, root]).status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
