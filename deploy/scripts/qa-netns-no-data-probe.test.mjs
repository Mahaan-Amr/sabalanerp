import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(here, 'qa-netns-no-data-probe.sh');
const stopper = path.join(here, 'qa-netns-stop.sh');
const signal = path.join(here, 'qa-owned-pid-signal.pl');
const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
const unavailable = bash.error || bash.status !== 0 ? 'bash unavailable' : false;

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

test('pidfd helper refuses a changed birth without signalling another process',
  { skip: process.platform !== 'linux' }, async () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    try {
      const stat = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8').replace(/^.*\) /, '').trim().split(/\s+/);
      const birth = stat[19];
      const exe = fs.readlinkSync(`/proc/${child.pid}/exe`);
      const ns = fs.readlinkSync(`/proc/${child.pid}/ns/net`);
      const wrong = spawnSync('perl', [signal, String(child.pid), String(Number(birth) + 1), exe, ns, '15'], { encoding: 'utf8' });
      assert.notEqual(wrong.status, 0);
      assert.equal(child.exitCode, null);
      const correct = spawnSync('perl', [signal, String(child.pid), birth, exe, ns, '15'], { encoding: 'utf8' });
      assert.equal(correct.status, 0, correct.stderr);
      await new Promise(resolve => child.once('exit', resolve));
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });
