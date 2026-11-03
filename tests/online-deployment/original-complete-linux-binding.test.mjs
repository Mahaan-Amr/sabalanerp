import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{createHash}from'node:crypto';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
import{renderOriginalCompleteLinuxBinding,originalCompleteRuntimeExports}from'../../scripts/lib/original-complete-linux-binding.mjs';
import{writeOriginalCompleteConnectionCapsule}from'../../scripts/lib/original-complete-connection-capsule.mjs';
import{originalCompleteStartupNames}from'../../scripts/lib/restored-qa/prepare-original-layout.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const mode of ['positive','owner','issuer'])test('physical staged Linux binding/factory/callback graph: '+mode,()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'complete-linux-loader-'));try{
  const capsule=writeOriginalCompleteConnectionCapsule({sourceRoot:path.resolve('.'),outputDirectory:path.join(root,'capsule')}),operation='a'.repeat(32),stage='/app/runtime-authority/application-native-'+operation+'/strict-complete-material',workingRoot='/app/runtime-authority/application-native-'+operation+'/restored-complete-app';
  fs.mkdirSync(path.join(root,'stage/complete-ops'),{recursive:true});fs.cpSync(capsule.manifest.sourceDirectory,path.join(root,'stage/complete-ops/source'),{recursive:true});
  const pins={},startup={},sourcePins={};for(const row of capsule.manifest.source.files)pins['complete-ops/source/'+row.file]=row.sha256;
  for(const name of originalCompleteStartupNames){const relative='startup/'+name,raw=Buffer.from('bounded startup input '+name);fs.mkdirSync(path.join(root,'stage/startup'),{recursive:true});fs.writeFileSync(path.join(root,'stage',relative),raw,{mode:0o400});pins[relative]=sha(raw);startup[name]=relative;sourcePins[name]=pins[relative];}
  const sourceCatalog=Object.fromEntries(Array.from({length:444},(_,i)=>['migration_'+i,'c'.repeat(64)]));
  const B={operation,stage,workingRoot,factory:'complete-ops/source/scripts/lib/restored-qa/create-complete-work.mjs',exports:originalCompleteRuntimeExports,pins,startup,input:{targetCommit:'d'.repeat(40),sourcePath:stage+'/source-complete.resealed',sourceCatalog},qa:{format:'sabalan-original-complete-linux-work/v1',operation,root:workingRoot,sourceCommit:'d'.repeat(40),productionAdmission:false,sourcePins},installedFiles:Array.from({length:1001},(_,i)=>({path:'app/dist/modeled-'+i,bytes:0,sha256:sha(Buffer.alloc(0))}))};
  fs.writeFileSync(path.join(root,'binding-input.json'),JSON.stringify(B));fs.writeFileSync(path.join(root,'linux-binding.cjs'),renderOriginalCompleteLinuxBinding(B));
  const result=spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings','--loader',new URL('./original-complete-linux-loader.fixture.mjs',import.meta.url).href,fileURLToPath(new URL('./original-complete-linux-loader.fixture.cjs',import.meta.url)),root],{env:{...process.env,COMPLETE_LINUX_TEST_MODE:mode},encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);const row=JSON.parse(result.stdout);assert.equal(row.pass,true);assert.equal(row.actualFactoryLoaded,true);assert.equal(row.actualCallbackGraphLoaded,true);assert.equal(row.closure,mode==='positive');assert.equal(row.nativeAcceptance,false);
 }finally{assert.equal(fs.realpathSync(root),root);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('complete-linux-loader-'));fs.rmSync(root,{recursive:true,force:true});}
});
