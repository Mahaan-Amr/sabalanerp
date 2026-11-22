import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const artifact = process.env.LEGACY_E407_INDEX_ARTIFACT;
const expectedHash = '6ef91091d24e43798cd704cf66889f8e16155eae0ef91006bb7bfe7308dffe0c';

test('measured e407 shutdown handler exits zero while admitted work remains unfinished', {skip: !artifact}, async () => {
  const original = fs.readFileSync(artifact);
  assert.equal(createHash('sha256').update(original).digest('hex'), expectedHash);
  const source = original.toString();
  const start = source.indexOf('const shutdown = async (signal) => {');
  const end = source.indexOf('process.once("SIGINT", () => void shutdown("SIGINT"));', start);
  assert.ok(start > 0 && end > start);
  const handler = source.slice(start, end);
  const childSource = `
    let isShuttingDown=false;
    let stopBiometricStagedCaptureMaintenance,stopHrVehicleAssignmentMaintenance;
    const server={listening:false};
    const io={close:()=>{throw Error('unexpected HTTP close')}};
    const prisma_1={disconnectDatabase:async()=>{}};
    let completed=false;
    const admittedWork=new Promise(()=>{});
    void admittedWork.then(()=>{completed=true});
    ${handler}
    process.once('SIGTERM',()=>void shutdown('SIGTERM'));
    setImmediate(()=>process.emit('SIGTERM'));
    process.on('exit',()=>process.stdout.write('WORK_COMPLETED='+completed+'\\n'));
  `;
  const child = spawn(process.execPath, ['-e', childSource], {stdio: ['ignore', 'pipe', 'pipe']});
  let output = '', error = '';
  child.stdout.on('data', chunk => {output += chunk;});
  child.stderr.on('data', chunk => {error += chunk;});
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('legacy rehearsal timed out')), 5000);
    child.once('exit', (code, signal) => {clearTimeout(timeout); resolve({code, signal});});
    child.once('error', reject);
  });
  assert.deepEqual(result, {code: 0, signal: null}, error);
  assert.match(output, /WORK_COMPLETED=false/);
});
