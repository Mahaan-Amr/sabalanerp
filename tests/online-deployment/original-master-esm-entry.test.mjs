import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'../..');
const cli=path.join(root,'scripts/run-original-online-qualification-master.mjs');
const owner=path.join(root,'scripts/lib/original-candidate-rollback-owner.mjs');

// Execute the real canonical CLI and its real ESM graph. Only the operational
// native-entry boundary is replaced: this test must create no runtime or lease.
// Its consumer uses the SAME literal master import selected by the Root source.
async function canonicalEntry(mode){
 const source=fs.readFileSync(owner,'utf8');
 const selected=source.match(/await import\('(\.\/|\.\.\/)([^']*qualification-master\.mjs)'\)/);
 assert.ok(selected,'Root master import must remain explicit');
 const target=pathToFileURL(path.resolve(path.dirname(owner),selected[1]+selected[2])).href;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-master-esm-'));
 const replacement=pathToFileURL(path.join(root,'scripts/lib/native-c3-master-entry.mjs')).href;
 const fixture=String.raw`
 export async function executeNativeC3MasterEntry(reference,options){
  const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
  const deadline=setTimeout(()=>emit({event:'IMPORT_STILL_PENDING'}),1000);
  const master=await import(${JSON.stringify(target)});
  clearTimeout(deadline);
  for(const name of ['runOriginalOnlineQualificationMaster','readOriginalMasterKnownNegative','isOriginalMasterKnownImageNegative','readOriginalMasterKnownImageNegative','isOriginalMasterKnownPreparationNegative','readOriginalMasterKnownPreparationNegative'])
   if(typeof master[name]!=='function')throw Error('MASTER_EXPORT_MISSING');
  emit({event:'SAME_MASTER_MODULE_READY',connectionOnly:options.connectionOnly,mode:${JSON.stringify(mode)}});
  if(${JSON.stringify(mode)}==='retained'){
   process.stdin.resume();await new Promise(resolve=>process.stdin.once('end',resolve));
   emit({event:'OWNED_FIXTURE_INPUT_DRAINED'});
  }
  if(${JSON.stringify(mode)}==='negative')process.exitCode=1;
 }
 `;
 const loader=path.join(directory,'loader.mjs');
 fs.writeFileSync(loader,`export async function load(url,context,nextLoad){if(url===${JSON.stringify(replacement)})return{format:'module',shortCircuit:true,source:${JSON.stringify(fixture)}};return nextLoad(url,context);}`);
 const child=spawn(process.execPath,['--no-warnings','--experimental-loader',pathToFileURL(loader).href,cli,'--native-c3-plan-file',path.join(directory,'unused-plan.json'),'--native-c3-plan-sha256','a'.repeat(64),...(mode==='connection'?['--connection-only']:[])],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const closed=once(child,'close');let stdout='',stderr='',ended=false;
 child.on('close',()=>{ended=true;});child.stdin.on('error',()=>{});
 child.stdout.on('data',raw=>{stdout+=raw;assert.ok(stdout.length<=65536);});
 child.stderr.on('data',raw=>{stderr+=raw;assert.ok(stderr.length<=65536);});
 try{
  if(mode==='retained'){
   for(let i=0;i<400&&!ended&&!stdout.includes('SAME_MASTER_MODULE_READY');i++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.match(stdout,/SAME_MASTER_MODULE_READY/);
   await new Promise(resolve=>setTimeout(resolve,100));assert.equal(ended,false);
  }
 }finally{child.stdin.end();await closed;}
 assert.equal(child.signalCode,null,stderr);
 assert.equal(child.exitCode,mode==='negative'?1:0,stdout+'\n'+stderr);
 assert.doesNotMatch(stdout,/IMPORT_STILL_PENDING/);
 assert.match(stdout,/SAME_MASTER_MODULE_READY/);
 if(mode==='retained')assert.match(stdout,/OWNED_FIXTURE_INPUT_DRAINED/);
 assert.equal(stderr,'');
}

test('canonical connection entry resolves the SAME master module during CLI evaluation',()=>canonicalEntry('connection'));
test('canonical native entry retains its own input after resolving the SAME master module',()=>canonicalEntry('retained'));
test('canonical negative entry naturally closes without an unresolved ESM evaluation',()=>canonicalEntry('negative'));

test('canonical exports and Root consumer share one implementation and private token readers',async()=>{
 const canonical=await import(pathToFileURL(cli).href);
 const implementation=await import('../../scripts/lib/original-online-qualification-master.mjs');
 for(const name of ['runOriginalOnlineQualificationMaster','readOriginalMasterKnownNegative','isOriginalMasterKnownImageNegative','readOriginalMasterKnownImageNegative','isOriginalMasterKnownPreparationNegative','readOriginalMasterKnownPreparationNegative'])
  assert.equal(canonical[name],implementation[name]);
 assert.equal(canonical.isOriginalMasterKnownImageNegative({},{}),false);assert.equal(canonical.isOriginalMasterKnownPreparationNegative({},{}),false);assert.throws(()=>canonical.readOriginalMasterKnownPreparationNegative({},{}),/ORIGINAL_MASTER_PREPARATION_NEGATIVE_REQUIRED/);
 assert.throws(()=>canonical.readOriginalMasterKnownNegative({},{}),/ORIGINAL_MASTER_KNOWN_NEGATIVE_REQUIRED/);
});
