/** Real filesystem provenance checks with a modeled immutable package. This
 * never grants a live owner, restore, application or UP admission. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import Module,{createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {originalCompleteStartupNames} from '../../scripts/lib/restored-qa/prepare-original-layout.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),require=createRequire(import.meta.url),esbuild=require('../../backend/node_modules/esbuild');
for(const mode of ['complete-files','missing-startup','changed-startup','reused-audit'])test('pre-UP immutable file prerequisite '+mode,()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'complete-pre-up-'));
 try{
  const save=(name,raw)=>{const file=path.join(root,name);fs.writeFileSync(file,raw);return{file,sha256:sha(raw)};};
  const startupSources=Object.fromEntries(originalCompleteStartupNames.map(name=>[name,save(name,Buffer.from('modeled-startup-input:'+name))]));
  const python=path.resolve('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe'),sources=Object.fromEntries(['worker','callback','owner','controller'].map(name=>[name,save(name+'.txt',Buffer.from('modeled-only:'+name))]));
  const c={format:'sabalan-original-existing-compose-complete-input/v1',project:'sabalanerp-local',productionAdmission:false,sources,python:{file:python,sha256:sha(fs.readFileSync(python))},operation:'a'.repeat(32),targetCommit:'b'.repeat(40),auditDirectory:path.join(root,'unused-audit'),startupSources,
   originalIssuer:{port:12345,observerSha256:startupSources['private-qualification-observer.py'].sha256,expectedManifestSha256:'c'.repeat(64)}};
  const config=save('configuration.json',Buffer.from(JSON.stringify(c))),value={...c,configuration:config};
  if(mode==='missing-startup')fs.unlinkSync(startupSources['online-runtime-scope.py'].file);
  if(mode==='changed-startup')fs.appendFileSync(startupSources['private-qualification-observer.py'].file,'changed');
  if(mode==='reused-audit')fs.mkdirSync(c.auditDirectory);
  const file=path.resolve('scripts/lib/original-complete-pre-up.mjs'),m=new Module(file);m.filename=file;const nativeRequire=createRequire(file);
  m.require=id=>id==='./original-complete-source-binding.mjs'?{readSourceOwnedCompleteBinding:()=>({value,revalidate:()=>assert.equal(sha(fs.readFileSync(config.file)),config.sha256)})}:nativeRequire(id);
  m._compile(esbuild.transformSync(fs.readFileSync(file,'utf8'),{format:'cjs',target:'node22'}).code,file);
  if(mode==='complete-files'){const result=m.exports.inspectOriginalCompletePreUpInputs();assert.equal(result.startupDependencies,11);assert.equal(result.productionAdmission,false);}else assert.throws(()=>m.exports.inspectOriginalCompletePreUpInputs());
 }finally{assert.equal(fs.realpathSync(root),root);fs.rmSync(root,{recursive:true,force:true});}
});
