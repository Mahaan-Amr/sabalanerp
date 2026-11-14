import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(here, 'qa-netns-no-data-probe.sh');
const stopper = path.join(here, 'qa-netns-stop.sh');
const signal = path.join(here, 'qa-owned-pid-signal.pl');
const resolverParent = path.join(here, 'qa-netns-resolver-parent.sh');
const ownedSocket = path.join(here, 'qa-netns-owned-socket.sh');
const cgroupChild = path.join(here, 'qa-netns-cgroup-child.sh');
const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
const unavailable = bash.error || bash.status !== 0 ? 'bash unavailable' : false;

test('the network owner scripts have valid Bash syntax', { skip: unavailable }, () => {
  for (const script of [launcher, stopper, resolverParent, ownedSocket, cgroupChild]) {
    const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('cgroup wrapper refuses the initial mount namespace before any mount',
  { skip: process.platform !== 'linux' || process.getuid?.() !== 0 || process.env.WSL_DISTRO_NAME !== 'sabalanerp-qa-debian' }, () => {
    const evidence = fs.mkdtempSync('/srv/sabalanerp-qa/qa-cgroup-guard-test-');
    try {
      const netns = fs.readlinkSync('/proc/self/ns/net');
      const mntns = fs.readlinkSync('/proc/self/ns/mnt');
      const cgroupns = fs.readlinkSync('/proc/self/ns/cgroup');
      const statfs = spawnSync('stat', ['-fc', '%T:%t', '/sys/fs/cgroup'], { encoding: 'utf8' }).stdout;
      fs.writeFileSync(path.join(evidence, 'initial-cgroup-membership.before'), fs.readFileSync('/proc/self/cgroup'));
      const result = spawnSync('bash', [cgroupChild, evidence, netns, mntns, cgroupns], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /mount namespace is not private/);
      assert.equal(spawnSync('stat', ['-fc', '%T:%t', '/sys/fs/cgroup'], { encoding: 'utf8' }).stdout, statfs);
    } finally {
      fs.rmSync(evidence, { recursive: true, force: true });
    }
  });

test('a live or changed Unix socket is preserved; only the owned stale inode is removed',
  { skip: process.platform !== 'linux' || process.getuid?.() !== 0 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-owned-socket-'));
    const socket = path.join(root, 'daemon.sock');
    const server = spawn(process.execPath, ['-e',
      'const fs=require("fs"),net=require("net");net.createServer().listen(process.argv[1],()=>{fs.chmodSync(process.argv[1],0o660);console.log("READY")})', socket],
    { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      await new Promise((resolve, reject) => {
        server.stdout.once('data', resolve);
        server.once('error', reject);
      });
      const run = (body, ...args) => spawnSync('bash', ['-c', `set -euo pipefail; source "$1"; ${body}`, '--', ownedSocket, ...args], { encoding: 'utf8' });
      const captured = run('qa_owned_socket_capture "$2" "$3"; printf "%s" "$QA_OWNED_SOCKET_IDENTITY"', socket, String(process.getgid()));
      assert.equal(captured.status, 0, captured.stderr);
      const identity = captured.stdout;
      const live = run('qa_owned_socket_cleanup "$2" "$3"', socket, identity);
      assert.notEqual(live.status, 0);
      assert.ok(fs.existsSync(socket));
      server.kill('SIGKILL');
      await new Promise(resolve => server.once('exit', resolve));
      const changed = run('qa_owned_socket_cleanup "$2" "$3"', socket, `${identity}0`);
      assert.notEqual(changed.status, 0);
      assert.ok(fs.existsSync(socket));
      const stale = run('qa_owned_socket_cleanup "$2" "$3"', socket, identity);
      assert.equal(stale.status, 0, stale.stderr);
      assert.equal(fs.existsSync(socket), false);
    } finally {
      if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

test('resolver parent is removed only when this run created it and it is empty',
  { skip: process.platform !== 'linux' || process.getuid?.() !== 0 }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-resolver-parent-'));
    const absent = path.join(root, 'absent');
    const existing = path.join(root, 'existing');
    try {
      const run = (body, dir) => spawnSync('bash', ['-c', `set -euo pipefail; source "$1"; ${body}`, '--', resolverParent, dir], { encoding: 'utf8' });
      const created = run('qa_resolver_parent_prepare "$2"; test -d "$2"; qa_resolver_parent_cleanup "$2"; test ! -e "$2"', absent);
      assert.equal(created.status, 0, created.stderr);
      const occupied = run('qa_resolver_parent_prepare "$2"; touch "$2/foreign"; if qa_resolver_parent_cleanup "$2"; then exit 1; fi; test -e "$2/foreign"; rm "$2/foreign"; qa_resolver_parent_cleanup "$2"; test ! -e "$2"', absent);
      assert.equal(occupied.status, 0, occupied.stderr);
      fs.mkdirSync(existing, { mode: 0o700 });
      const preserved = run('qa_resolver_parent_prepare "$2"; qa_resolver_parent_cleanup "$2"; test -d "$2"', existing);
      assert.equal(preserved.status, 0, preserved.stderr);
      fs.writeFileSync(path.join(existing, 'foreign'), 'x');
      const nonEmpty = run('qa_resolver_parent_prepare "$2"; test "$QA_RESOLVER_PARENT_OWNED" = 0', existing);
      assert.equal(nonEmpty.status, 0, nonEmpty.stderr);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
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
