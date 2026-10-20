import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const builder=new URL('../../scripts/build-production-inquiry-legacy-augmentation-local.mjs',import.meta.url),repository=path.resolve(import.meta.dirname,'../..');
const marker={format:'sabalan-host-backup-retention-prerequisites/v1',inspected:true,sshStarted:false,mutation:false};
const clean=[{project:'sabalanerp',ok:true},{project:'sabalanerp-backup',ok:true}];
test('actual augmentation consumer accepts canonical three-row preflight and stops on deliberately invalid material before Docker',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'inquiry-preflight-'));
 try{
  const material=path.join(directory,'material.json'),preflight=path.join(directory,'preflight.json');fs.writeFileSync(material,JSON.stringify({format:'deliberately-invalid-no-runtime-material'}));
  const receipt=rows=>({observedAt:new Date().toISOString(),sshExitCode:0,stdout:JSON.stringify({exitCode:0,lockHeldThroughBothHostPreflight:true,
   productionCommitBefore:'a'.repeat(40),productionCommitAfter:'a'.repeat(40),stdout:rows.map(JSON.stringify).join('\n')})});
  for(const rows of [clean,[marker,...clean]]){
   fs.writeFileSync(preflight,JSON.stringify(receipt(rows)));const result=spawnSync(process.execPath,[builder.pathname.replace(/^\/(?=[A-Za-z]:)/,''),'--build',material,'--preflight',preflight],{cwd:repository,encoding:'utf8'});
   assert.ifError(result.error);assert.equal(result.status,1);assert.match(result.stderr,/deliberately-invalid-no-runtime-material/);assert.match(result.stderr,/sabalan-actual-inquiry-legacy-augmentation-material/);
  }
  for(const rows of [[marker,marker,...clean],[{...marker,mutation:true},...clean],[marker,clean[0]],[marker,...clean.map(row=>({...row,ok:false}))]]){
   fs.writeFileSync(preflight,JSON.stringify(receipt(rows)));const result=spawnSync(process.execPath,[builder.pathname.replace(/^\/(?=[A-Za-z]:)/,''),'--build',material,'--preflight',preflight],{cwd:repository,encoding:'utf8'});
   assert.ifError(result.error);assert.equal(result.status,1);assert.doesNotMatch(result.stderr,/deliberately-invalid-no-runtime-material/);
  }
 }finally{assert.equal(path.dirname(fs.realpathSync(directory)),fs.realpathSync(os.tmpdir()));fs.rmSync(directory,{recursive:true});}
});
test('augmentation pins its actual qualified preflight consumer and preserves frozen original frontend recipe bytes',()=>{
 const source=fs.readFileSync(builder,'utf8');assert.ok(source.includes("from'./replace-qualified-application-native-candidate-local.mjs'"));
 assert.ok(source.includes("'scripts/replace-qualified-application-native-candidate-local.mjs'"));assert.ok(!source.includes("'scripts/replace-application-native-candidate-local.mjs'"));
 const original=fs.readFileSync(new URL('../../scripts/replace-application-native-candidate-local.mjs',import.meta.url));
 assert.equal(createHash('sha256').update(original).digest('hex'),'1a40c61f6cd963364cb1d8da6fe04907d1019c799a094357ae99f31e7b85f006');
 const preparation=fs.readFileSync(new URL('../../scripts/prepare-production-inquiry-legacy-augmentation.mjs',import.meta.url),'utf8');
 assert.ok(preparation.includes("'scripts/replace-qualified-application-native-candidate-local.mjs'"));assert.ok(!preparation.includes("'scripts/replace-application-native-candidate-local.mjs'"));
});

test('retained-browser and current frontend replacement consumers use the same canonical three-row reader and pin its source',async()=>{
 const observedAt=new Date().toISOString(),receipt={observedAt,sshExitCode:0,stdout:JSON.stringify({exitCode:0,lockHeldThroughBothHostPreflight:true,
  productionCommitBefore:'a'.repeat(40),productionCommitAfter:'a'.repeat(40),stdout:[marker,...clean].map(JSON.stringify).join('\n')})};
 for(const relative of ['scripts/lib/original-retained-browser-qualification.mjs','scripts/replace-current-frontend-candidate-local.mjs']){
  const consumer=new URL('../../'+relative,import.meta.url),source=fs.readFileSync(consumer,'utf8'),match=source.match(/import\s*\{validateCandidatePreflight\}\s*from\s*'([^']+)'/);
  assert.ok(match);const imported=new URL(match[1],consumer);assert.equal(imported.pathname,new URL('../../scripts/replace-qualified-application-native-candidate-local.mjs',import.meta.url).pathname);
  const {validateCandidatePreflight}=await import(imported.href);assert.doesNotThrow(()=>validateCandidatePreflight(receipt));
  const failed=structuredClone(receipt),remote=JSON.parse(failed.stdout);remote.stdout=[marker,clean[0]].map(JSON.stringify).join('\n');failed.stdout=JSON.stringify(remote);assert.throws(()=>validateCandidatePreflight(failed));
  assert.ok(source.includes("path.join(root,'scripts/replace-qualified-application-native-candidate-local.mjs')"));
 }
});
