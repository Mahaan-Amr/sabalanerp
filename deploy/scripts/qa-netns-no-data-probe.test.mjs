import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(here, 'qa-netns-no-data-probe.sh');
const stopper = path.join(here, 'qa-netns-stop.sh');
const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
const unavailable = bash.error ? 'bash unavailable' : false;

test('the network owner scripts have valid Bash syntax', { skip: unavailable }, () => {
  for (const script of [launcher, stopper]) {
    const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('the launcher refuses an unreviewed invocation before any network action', { skip: unavailable }, () => {
  const result = spawnSync('bash', [launcher], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REFUSE: usage: qa-netns-no-data-probe\.sh/);
});

test('the launcher refuses an unexpected third argument', { skip: unavailable }, () => {
  const result = spawnSync('bash', [launcher, '/tmp/manifest', '/tmp/evidence', '--unsafe'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REFUSE: usage: qa-netns-no-data-probe\.sh/);
});
