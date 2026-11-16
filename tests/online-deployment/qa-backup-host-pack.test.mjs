import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('QA backup host pack is separate and contains the required owner commands', () => {
  const raw = execFileSync(process.execPath, ['scripts/build-qa-backup-host-pack.mjs', '--inspect'], {encoding: 'utf8'});
  const plan = JSON.parse(raw);
  assert.equal(plan.format, 'sabalan-qa-backup-host-pack-plan/v1');
  assert.deepEqual(plan.files, [
    'deploy/scripts/provision-qa-backup-host.sh',
    'deploy/scripts/qa-backup-preflight-client.sh',
    'deploy/scripts/qa-backup-preflight-root.sh',
    'deploy/scripts/qa-backup-retention-root.sh',
    'deploy/scripts/storage-preflight.mjs',
    'scripts/deployment-storage.mjs',
    'deploy/scripts/backup-checkpoint-retention.cjs',
  ]);
  assert.equal(plan.productionAdmission, false);
});

test('QA backup host pack builds a pinned isolated bundle', () => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-qa-backup-pack-test-'));
  try{
    const output=path.join(base,'pack');
    const command=['scripts/build-qa-backup-host-pack.mjs','--build','--output',output];
    const selector=fs.readFileSync('backend/src/scripts/backup-checkpoint-retention.ts','utf8').includes('backupRetentionTarget(target).root');
    if(!selector){
      assert.throws(()=>execFileSync(process.execPath,command,{encoding:'utf8',stdio:['ignore','pipe','pipe']}),/QA_RETENTION_SELECTOR_REQUIRED/);
      assert.equal(fs.existsSync(output),false);
      return;
    }
    const result=JSON.parse(execFileSync(process.execPath,command,{encoding:'utf8'}));
    const receipt=JSON.parse(fs.readFileSync(result.receipt,'utf8'));
    assert.equal(receipt.format,'sabalan-qa-backup-host-pack/v1');
    assert.deepEqual(Object.keys(receipt.outputs),JSON.parse(execFileSync(process.execPath,['scripts/build-qa-backup-host-pack.mjs','--inspect'],{encoding:'utf8'})).files);
    for(const file of Object.keys(receipt.outputs))assert.equal(fs.statSync(path.join(output,file)).size,receipt.outputs[file].bytes);
    assert.equal(receipt.productionAdmission,false);
  }finally{
    assert.ok(base.startsWith(os.tmpdir()+path.sep));
    fs.rmSync(base,{recursive:true,force:true});
  }
});

test('QA backup host pack accepts a fresh output on another Windows volume', {skip:process.platform!=='win32'||!fs.existsSync('D:\\')}, () => {
  const base=fs.mkdtempSync('D:\\sabalan-qa-pack-cross-volume-test-');
  try{
    const output=path.join(base,'pack');
    const result=JSON.parse(execFileSync(process.execPath,['scripts/build-qa-backup-host-pack.mjs','--build','--output',output],{encoding:'utf8'}));
    assert.equal(path.resolve(result.output),path.resolve(output));
    assert.ok(fs.existsSync(path.join(output,'qa-backup-host-pack-receipt.json')));
  }finally{
    assert.ok(base.startsWith('D:\\sabalan-qa-pack-cross-volume-test-'));
    fs.rmSync(base,{recursive:true,force:true});
  }
});

test('QA backup host pack still refuses output inside the checkout', () => {
  const output=path.join(process.cwd(),'.qa-pack-refusal-test');
  assert.equal(fs.existsSync(output),false);
  assert.throws(()=>execFileSync(process.execPath,['scripts/build-qa-backup-host-pack.mjs','--build','--output',output],{encoding:'utf8',stdio:['ignore','pipe','pipe']}),/QA pack must be outside checkout/);
  assert.equal(fs.existsSync(output),false);
});
