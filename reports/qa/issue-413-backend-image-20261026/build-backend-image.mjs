import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
const repo='C:/Users/mahan/.codex/worktrees/immutable-final-package-413/sabalanerp';
const proofRepository='C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp';
const frozenSource='c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14';
const sha=b=>createHash('sha256').update(b).digest('hex');
const {qualifiedBackendRuntimeBase,stableBackendBaseFile,freshBothHostBackendBasePreflight}=await import(pathToFileURL(path.join(repo,'scripts/lib/production-backend-base-artifacts.mjs')));
const {backendBaseLocalGuards,backendBaseLocalCapacity}=await import(pathToFileURL(path.join(repo,'scripts/lib/production-backend-base-local-guard.mjs')));
const {originalBackendBaseCommands}=await import(pathToFileURL(path.join(repo,'scripts/lib/production-backend-base-process.mjs')));
const {imageInspectionIdentity}=await import(pathToFileURL(path.join(repo,'scripts/lib/image-inspection-identity.mjs')));
const [mode,materialPath,baseReceipt,preflightPath]=process.argv.slice(2);
assert.ok(['--inspect','--build'].includes(mode)&&materialPath&&baseReceipt);
assert.equal(process.argv.length,mode==='--build'?6:5); // --build also requires fresh both-host preflight.
const materialFile=stableBackendBaseFile(materialPath),material=JSON.parse(fs.readFileSync(materialPath));
assert.equal(material.format,'sabalan-current-backend-material/v1');assert.equal(material.materialized,true);assert.equal(material.sourceUnchanged,true);
assert.equal(material.productionAdmission,false);const base=qualifiedBackendRuntimeBase(proofRepository,baseReceipt);
function verify(){
 assert.deepEqual(stableBackendBaseFile(materialPath),materialFile);
 assert.equal(stableBackendBaseFile(material.linuxCodegenReceipt).sha256,material.linuxCodegenReceiptSha256);
 const copied=JSON.parse(fs.readFileSync(material.linuxCodegenReceipt));assert.equal(copied.pass,true);assert.ok(['sabalan-private-linux-prisma-local-extraction/v1','sabalan-private-local-linux-prisma-extraction/v1'].includes(copied.format));assert.equal(material.nativeQualification,false);
 assert.equal(stableBackendBaseFile(material.compiledReceipt).sha256,material.compiledReceiptSha256);
 const compiled=JSON.parse(fs.readFileSync(material.compiledReceipt));
 const currentMigrations=fs.readdirSync(path.join(repo,'backend/prisma/migrations'),{withFileTypes:true}).filter(row=>row.isDirectory()).map(row=>row.name).sort();assert.deepEqual(currentMigrations,compiled.migrationNames,'MIGRATION_DIRECTORY_CHANGED');
 const currentModels=[...fs.readFileSync(path.join(repo,'backend/prisma/schema.prisma'),'utf8').matchAll(/^model\s+(\w+)\s*\{/gm)].map(m=>m[1]).sort();assert.deepEqual(currentModels,compiled.schemaModels,'MODEL_INVENTORY_CHANGED');assert.equal(compiled.pass,true);
 for(const [file,row]of Object.entries(compiled.linuxClient.externalSources)){const observed=stableBackendBaseFile(file);assert.equal(observed.bytes,row.bytes);assert.equal(observed.sha256,row.sha256);}
 for(const [relative,digest]of Object.entries(compiled.sources))assert.equal(stableBackendBaseFile(path.join(repo,relative)).sha256,digest,relative);
 for(const [relative,digest]of Object.entries(material.materialSources)){assert.ok(!relative.startsWith('/')&&!relative.split('/').includes('..'));assert.equal(stableBackendBaseFile(path.join(repo,relative)).sha256,digest,relative);}
 const actual=[];const visit=(directory,prefix='')=>{const st=fs.lstatSync(directory);assert.ok(st.isDirectory()&&!st.isSymbolicLink());
  for(const name of fs.readdirSync(directory).sort()){const file=path.join(directory,name),relative=prefix+name,stat=fs.lstatSync(file);assert.ok(!stat.isSymbolicLink());
   if(stat.isDirectory())visit(file,relative+'/');else{const value=stableBackendBaseFile(file);actual.push({path:relative,bytes:value.bytes,sha256:value.sha256});}}};
 visit(material.context);actual.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);assert.deepEqual(actual,material.files);
 return compiled;
}
verify();
if(mode==='--inspect'){console.log(JSON.stringify({sourceOnly:true,context:material.context,files:material.files.length,base:base.baseImage,dockerExecuted:false,productionAdmission:false}));}
else{
 const preflight=freshBothHostBackendBasePreflight(repo,preflightPath);
 backendBaseLocalCapacity({rawBytes:540220928});
 const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands),operation=randomBytes(16).toString('hex');
 const root=path.resolve('D:/sabalanerp-online-qa/current-backend-image-'+operation);fs.mkdirSync(root,{mode:0o700});
 const baseTag='sabalan-online-backend-build-base:'+operation,outputTag='sabalan-online-backend-current:'+operation,iidFile=path.join(root,'image.iid');
 const report={format:'sabalan-current-backend-image/v1',operation,pass:false,base,materialReceipt:materialPath,materialReceiptSha256:materialFile.sha256,
 context:material.context,root,baseTag,outputTag,tagIsBuildInputOnly:true,preflight,productionAdmission:false,producer:{file:import.meta.filename,sha256:sha(fs.readFileSync(import.meta.filename))},frozenSource};
 let failure;
 try{
  report.servicesBefore=await guards.protectedIdentities();report.aliasesBefore=await guards.aliases();
  const observed=imageInspectionIdentity(JSON.parse(await guards.docker(['image','inspect',base.baseImage])));
  assert.equal(observed.id,base.baseImage);assert.deepEqual(observed.layers,base.source.source.layers);
  const git=await commands.run('git',['-C',repo,'rev-parse',frozenSource+'^{tree}']);commands.assertSuccessful(git);assert.equal(git.stdout.trim(),'34db94fca59986498028ba463d340302eb484f75');const commit=frozenSource;
  const delta=await commands.run('git',['-C',repo,'diff','--name-only',frozenSource,'--']);commands.assertSuccessful(delta);assert.ok(delta.stdout.trim().split(/\r?\n/).every(name=>!name||name.startsWith('reports/qa/')),'NON_EVIDENCE_SOURCE_DRIFT');
  for(const name of ['package.json','package-lock.json'])assert.deepEqual(fs.readFileSync(path.join(repo,'backend',name)),fs.readFileSync(path.join(proofRepository,'backend',name)),'BASE_DEPENDENCY_INPUT_CHANGED');
  const sourceCommand=await commands.run(process.execPath,['--input-type=module','-e',`process.chdir(${JSON.stringify(repo)});const {performanceSourceHash}=await import(${JSON.stringify(pathToFileURL(path.join(repo,'scripts/performance-source-identity.mjs')).href)});console.log(await performanceSourceHash());`]);
  commands.assertSuccessful(sourceCommand);const performanceSourceHash=sourceCommand.stdout.trim();assert.match(performanceSourceHash,/^[a-f0-9]{64}$/);
  assert.ok(!report.aliasesBefore[baseTag]&&!report.aliasesBefore[outputTag]);
  await guards.docker(['tag',base.baseImage,baseTag]);
  const bound=imageInspectionIdentity(JSON.parse(await guards.docker(['image','inspect',baseTag])));assert.equal(bound.id,base.baseImage);assert.deepEqual(bound.layers,observed.layers);
  report.build=await guards.docker(['build','--network','none','--pull=false','--build-arg','BACKEND_BASE='+baseTag,
   '--build-arg','CURRENT_SOURCE_COMMIT='+commit,'--build-arg','CURRENT_SOURCE_INVENTORY_SHA256='+material.inventorySha256,
   '--build-arg','PERFORMANCE_SOURCE_HASH='+performanceSourceHash,'--iidfile',iidFile,'-t',outputTag,'-f',path.join(material.context,'Dockerfile'),material.context]);
  const image=imageInspectionIdentity(JSON.parse(await guards.docker(['image','inspect',outputTag])));
  const iid=fs.readFileSync(iidFile,'utf8').trim();assert.equal(image.id,iid);assert.notEqual(image.id,base.baseImage);
  assert.deepEqual(image.layers.slice(0,observed.layers.length),observed.layers);assert.ok(image.layers.length>observed.layers.length);
  assert.equal(image.labels['io.sabalan.performance.source-commit'],commit);
  assert.equal(image.labels['io.sabalan.performance.source-hash'],performanceSourceHash);
  assert.deepEqual(Object.keys(image.volumes??{}),[]);
  report.image=image;report.sourceCommit=commit;report.performanceSourceHash=performanceSourceHash;
  const again=await commands.run(process.execPath,['--input-type=module','-e',`process.chdir(${JSON.stringify(repo)});const {performanceSourceHash}=await import(${JSON.stringify(pathToFileURL(path.join(repo,'scripts/performance-source-identity.mjs')).href)});console.log(await performanceSourceHash());`]);commands.assertSuccessful(again);assert.equal(again.stdout.trim(),performanceSourceHash);
  verify();report.sourceUnchanged=true;
  report.aliasesAfter=await guards.aliases();const expected={...report.aliasesBefore,[baseTag]:imageInspectionIdentity(JSON.parse(await guards.docker(['image','inspect',baseTag]))).id,[outputTag]:image.id};
  assert.deepEqual(report.aliasesAfter,Object.fromEntries(Object.entries(expected).sort(([a],[b])=>a.localeCompare(b))));report.existingAliasesUnchanged=true;
  report.pass=true;
 }catch(error){failure=error;report.error=error instanceof Error?error.message:'IMAGE_BUILD_UNPROVEN';}
 finally{
  try{if(report.servicesBefore){report.servicesAfter=await guards.protectedIdentities();assert.deepEqual(report.servicesAfter,report.servicesBefore);report.protectedServicesUnchanged=true;}}
  catch(error){report.pass=false;failure??=error;}
  report.originalChildren=await commands.close();if(report.originalChildren.interrupted){report.pass=false;failure??=Error('ORIGINAL_CONTROLLER_INTERRUPTED');}
  const fd=fs.openSync(path.join(root,'image-receipt.json'),'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
 console.log(JSON.stringify({receipt:path.join(root,'image-receipt.json'),pass:report.pass,productionAdmission:false}));if(failure)throw failure;
}
