import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const helper=fileURLToPath(new URL('../../deploy/scripts/previous-environment-custody.mjs',import.meta.url));
const operation='deploy-20261116-role-split';
const original=Buffer.from('POSTGRES_PASSWORD=old-private\r\nDATABASE_URL=postgresql://old:old-private@postgres/db\r\n# exact bytes\r\n');

function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'previous-env-'));
 const custody=path.join(directory,'host-only-secrets');
 const env=path.join(directory,'.env.prod');
 fs.mkdirSync(custody,{mode:0o700});fs.chmodSync(custody,0o700);
 fs.writeFileSync(env,original,{mode:0o600});fs.chmodSync(env,0o600);
 return {directory,custody,env,run(command,...extra){return spawnSync(process.execPath,[helper,command,custody,operation,...extra],{encoding:'utf8'});},close(){fs.rmSync(directory,{recursive:true,force:true});}};
}

test('host-only custody preserves exact previous bytes and never emits credentials',()=>{
 const x=fixture();try{
  const prepared=x.run('preserve',x.env);assert.equal(prepared.status,0,prepared.stderr);
  assert.equal(prepared.stdout,'');assert.ok(!prepared.stderr.includes('old-private'));
  fs.writeFileSync(x.env,'POSTGRES_PASSWORD=new-private\n');
  const selected=x.run('select');assert.equal(selected.status,0,selected.stderr);
  const selectedPath=selected.stdout.trim();assert.deepEqual(fs.readFileSync(selectedPath),original);
  assert.ok(!selected.stdout.includes('old-private'));
  assert.notEqual(selectedPath,x.env);
 }finally{x.close();}
});

test('missing or corrupt prior environment refuses selection without revealing secrets',()=>{
 const x=fixture();try{
  assert.notEqual(x.run('select').status,0);
  assert.equal(x.run('preserve',x.env).status,0);
  const selectedPath=x.run('select').stdout.trim();
  fs.writeFileSync(selectedPath,'POSTGRES_PASSWORD=corrupt-private\n');
  const result=x.run('select');assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  assert.ok(!result.stderr.includes('corrupt-private'));
 }finally{x.close();}
});

test('preservation is single-use for an operation and keeps custody after failed retries',()=>{
 const x=fixture();try{
  assert.equal(x.run('preserve',x.env).status,0);
  fs.writeFileSync(x.env,'POSTGRES_PASSWORD=new-private\n');
  assert.notEqual(x.run('preserve',x.env).status,0);
  assert.deepEqual(fs.readFileSync(x.run('select').stdout.trim()),original);
 }finally{x.close();}
});

test('changed binding or missing metadata refuses the retained snapshot',()=>{
 const x=fixture();try{
  assert.equal(x.run('preserve',x.env).status,0);
  assert.notEqual(spawnSync(process.execPath,[helper,'select',x.custody,'different-operation'],{encoding:'utf8'}).status,0);
  const metadata=path.join(x.custody,`${operation}.previous-env.json`);
  const record=JSON.parse(fs.readFileSync(metadata,'utf8'));
  fs.writeFileSync(metadata,JSON.stringify({...record,operation:'different-operation'}));
  const changed=x.run('select');assert.notEqual(changed.status,0);assert.equal(changed.stdout,'');
  fs.rmSync(metadata);
  assert.notEqual(x.run('select').status,0);
  assert.ok(fs.existsSync(path.join(x.custody,`${operation}.previous-env`)));
 }finally{x.close();}
});

test('host-only custody rejects a directory visible to other users',()=>{
 if(process.platform==='win32')return;
 const x=fixture();try{
  fs.chmodSync(x.custody,0o755);
  const result=x.run('preserve',x.env);assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  assert.ok(!result.stderr.includes('old-private'));
 }finally{x.close();}
});
