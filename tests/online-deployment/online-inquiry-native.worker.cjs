'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createScopedInquiryWork } = require('./services/onlineInquiryWork');
const { loadOnlineRuntimeScope } = require('./services/onlineRuntimeScope');

(async () => {
  const [root, name] = process.argv.slice(2);
  const input = loadOnlineRuntimeScope();
  const context = await createScopedInquiryWork({ registrySha256: input.scope.manifestSha256, generation: 1 });
  const before = fs.readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' ');
  fs.writeFileSync(path.join(root, name + '.node.json'), JSON.stringify({ pid: process.pid, startTicks: before[19] }), { flag: 'wx', mode: 0o600 });
  let nested;
  await context.run(async () => {
    nested = context.run(async () => {
      const stdio = Array.from({ length: 12 }, () => 'ignore'); stdio[9] = 9; stdio[11] = 11;
      const child = spawn('/usr/bin/python3', ['-I', '-B', path.join(root, 'sqlite-worker.py'), root, name], { stdio });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => code === 0 && !signal ? resolve() : reject(Error('SQLITE_CHILD_FAILED')));
      });
    });
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      const poll = () => {
        if (fs.existsSync(path.join(root, name + '.sql-ready'))) resolve();
        else if (performance.now() > deadline) reject(Error('SQLITE_READY_TIMEOUT'));
        else setTimeout(poll, 5);
      }; poll();
    });
    fs.writeFileSync(path.join(root, name + '.body-returned'), 'body-returned', { flag: 'wx', mode: 0o600 });
  });
  await nested;
  fs.writeFileSync(path.join(root, name + '.action-completed'), 'action-completed', { flag: 'wx', mode: 0o600 });
  await context.stopAndDrain(1000);
})().catch(() => { console.error('INQUIRY_NATIVE_FIXTURE_FAILED'); process.exitCode = 1; });
