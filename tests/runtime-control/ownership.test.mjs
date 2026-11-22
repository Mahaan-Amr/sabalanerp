import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const wrapper = path.join(root, 'deploy/scripts/with-backend-control-ownership.sh');
const modulePath = path.join(root, 'backend/dist/services/runtimeControlOwnership.js');
const probe = `
const { assertRuntimeControlOwnership } = require(process.argv[1]);
assertRuntimeControlOwnership();
const { BackgroundJobGroup } = require(require('path').join(require('path').dirname(process.argv[1]), 'backgroundJobLifecycle.js'));
const jobs = new BackgroundJobGroup(work => work());
jobs.start({name:'external-effect', intervalMs:60000, run:async()=>{
  assertRuntimeControlOwnership(); console.log('OWNED');
  await new Promise(resolve => process.stdin.once('data', resolve));
  await new Promise(resolve => setTimeout(resolve, 40)); console.log('WORK_DONE');
}});
process.once('SIGTERM', async()=>{console.log('DRAINING'); await jobs.stop(10000); console.log('DRAINED'); process.exit(0)});
`;

function startOwner(directory) {
  const child = spawn('sh', [wrapper, process.execPath, '-e', probe, modulePath], {
    env: { ...process.env, BACKEND_RUNTIME_ROLE: 'control', RECOVERY_COORDINATION_DIR: directory },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let output = '';
  let error = '';
  const listeners = new Set();
  child.stdout.on('data', chunk => { output += chunk; for (const notify of listeners) notify(); });
  child.stderr.on('data', chunk => { error += chunk; });
  const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const waitFor = async (text) => {
    let timer;
    let notify;
    try {
      await Promise.race([
        new Promise((resolve, reject) => {
          notify = () => { if (output.includes(text)) resolve(); };
          listeners.add(notify); notify();
          timer = setTimeout(() => reject(new Error(`Missing ${text}: ${error}`)), 15000);
        }),
        exited.then(({ code }) => { if (!output.includes(text)) throw new Error(`Owner exited ${code}: ${error}`); }),
      ]);
    } finally { clearTimeout(timer); listeners.delete(notify); }
  };
  return { child, exited, waitFor, output: () => output };
}

test('one kernel owner retains ownership throughout actual job drain and transfers only after completion',
  { skip: process.platform !== 'linux' }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-control-ownership-'));
    const owners = [];
    try {
      const first = startOwner(directory); owners.push(first);
      await first.waitFor('OWNED');
      const competing = startOwner(directory); owners.push(competing);
      assert.equal((await competing.exited).code, 75);
      first.child.kill('SIGTERM');
      await first.waitFor('DRAINING');
      const whileDraining = startOwner(directory); owners.push(whileDraining);
      assert.equal((await whileDraining.exited).code, 75, 'response/shutdown intent does not release a running effect');
      first.child.stdin.write('complete\n');
      assert.equal((await first.exited).code, 0);
      assert.match(first.output(), /WORK_DONE\nDRAINED/);
      const successor = startOwner(directory); owners.push(successor);
      await successor.waitFor('OWNED');
      successor.child.kill('SIGTERM');
      await successor.waitFor('DRAINING');
      successor.child.stdin.write('complete\n');
      assert.equal((await successor.exited).code, 0);
    } finally {
      for (const owner of owners) if (owner.child.exitCode === null) owner.child.kill('SIGKILL');
      await Promise.all(owners.map(owner => owner.exited));
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

test('an inherited matching descriptor without a held kernel lock cannot claim control ownership',
  { skip: process.platform !== 'linux' }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-unowned-descriptor-'));
    const file = path.join(directory, 'deployment-runtime-control.lock');
    const handle = await fs.open(file, 'wx', 0o600);
    try {
      const stdio = Array.from({ length: 10 }, () => 'ignore');
      stdio[1] = 'pipe'; stdio[2] = 'pipe'; stdio[9] = handle.fd;
      const child = spawn(process.execPath, ['-e', `
        const { assertRuntimeControlOwnership } = require(process.argv[1]);
        try { assertRuntimeControlOwnership(); process.exitCode=0; }
        catch(error) { console.log(error.code); process.exitCode=1; }
      `, modulePath], { stdio, env: { ...process.env, BACKEND_RUNTIME_ROLE: 'control',
        RECOVERY_COORDINATION_DIR: directory, BACKEND_CONTROL_LOCK_FILE: file, BACKEND_CONTROL_LOCK_FD: '9' } });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      const code = await new Promise(resolve => child.once('close', resolve));
      assert.equal(code, 1);
      assert.equal(output.trim(), 'RUNTIME_CONTROL_OWNERSHIP_REQUIRED');
    } finally { await handle.close(); await fs.rm(directory, { recursive: true, force: true }); }
  });
