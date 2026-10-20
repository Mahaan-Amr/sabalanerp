import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceRoot='D:/sabalanerp-online-qa/compiled-support-catalog-preparation-71252b8661294649a91d36447cf8f246/full-catalog-e27cf134619ad7bbb550abd2994e11f7';
const manifestSha256='16b9a7b22822da6bf1b95e04646c75e65fc47c626e35aa12e5798b27ba20a9d3';
const qualificationReceipt='reports/qa/application-prisma-adc49c06e111ddb62501a67feceb6eca.json';
const preparationReceipt='reports/qa/full-catalog-source-e27cf134619ad7bbb550abd2994e11f7.json';
const listReceipt='reports/qa/full-catalog-list-inventory-e27cf134619ad7bbb550abd2994e11f7.json';
const statKeys=['dev','ino','size','mtimeNs','ctimeNs','nlink','mode'];
const regular=file=>{assert.equal(fs.realpathSync(file),path.resolve(file));const value=fs.lstatSync(file,{bigint:true});assert.ok(value.isFile()&&!value.isSymbolicLink()&&value.nlink===1n);return value;};
const same=(a,b)=>{for(const key of statKeys)assert.equal(a[key],b[key]);};

/** Discover actual relative backend runtime imports from every current catalog
 * source. Types are excluded; esbuild subsequently verifies the complete graph
 * has no shared application pool. No imported application module is executed. */
export function collectCatalogBackendImportEntries(repositoryRoot,compiler=createRequire(import.meta.url)(path.join(repositoryRoot,'backend/node_modules/typescript'))){
 const result=new Set(),files=[];function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file);else if(/\.[cm]?[jt]sx?$/.test(entry.name))files.push(file);}}walk(path.join(repositoryRoot,'tests/design-system-e2e'));assert.ok(files.length<=4096);
 for(const file of files){const tree=compiler.createSourceFile(file,fs.readFileSync(file,'utf8'),compiler.ScriptTarget.Latest,true);function add(specifier){if(!specifier.startsWith('.'))return;const resolved=path.resolve(path.dirname(file),specifier),relative=path.relative(repositoryRoot,resolved).split(path.sep).join('/');if(relative.startsWith('backend/src/')){const candidate=[resolved,resolved+'.ts',resolved+'.tsx',resolved+'.js',path.join(resolved,'index.ts')].find(name=>fs.existsSync(name)&&fs.statSync(name).isFile());assert.ok(candidate,'CATALOG_BACKEND_IMPORT_SOURCE_MISSING:'+relative);result.add(path.relative(repositoryRoot,candidate).split(path.sep).join('/'));}}
 function visit(node){if(compiler.isImportDeclaration(node)&&!node.importClause?.isTypeOnly&&compiler.isStringLiteral(node.moduleSpecifier))add(node.moduleSpecifier.text);if(compiler.isExportDeclaration(node)&&!node.isTypeOnly&&node.moduleSpecifier&&compiler.isStringLiteral(node.moduleSpecifier))add(node.moduleSpecifier.text);if(compiler.isCallExpression(node)&&node.expression.getText(tree)==='require'&&node.arguments.length===1&&compiler.isStringLiteral(node.arguments[0]))add(node.arguments[0].text);compiler.forEachChild(node,visit);}visit(tree);}
 return[...result].sort();
}

export const canonicalCatalogJson=value=>JSON.stringify(Array.isArray(value)?value.map(item=>JSON.parse(canonicalCatalogJson(item))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonicalCatalogJson(value[key]))])):value);
export function inventoryOriginalCatalogListing(data){
 assert.deepEqual(data.errors??[],[],'CATALOG_LIST_ERRORS');const cases=[];const specFiles=new Set();
 function visit(suite,parents=[]){for(const spec of suite.specs??[]){assert.equal(typeof spec.file,'string');const file=spec.file.replaceAll('\\','/').split('/tests/design-system-e2e/').at(-1);assert.ok(file&&!file.startsWith('/')&&file.split('/').every(p=>p&&p!=='.'&&p!=='..'));assert.ok(file.endsWith('.spec.ts'));assert.ok(Number.isSafeInteger(spec.line)&&spec.line>0);assert.ok(Array.isArray(spec.tests)&&spec.tests.length>0);specFiles.add(file);cases.push({file,line:spec.line,title:[...parents,spec.title],projects:spec.tests.map(t=>t.projectName)});}for(const child of suite.suites??[])visit(child,[...parents,child.title]);}
 for(const suite of data.suites??[])visit(suite);assert.ok(cases.length>0&&cases.length<=10000);return{caseInventory:cases,caseInventorySha256:sha(canonicalCatalogJson(cases)),specFileInventory:[...specFiles].sort(),tests:cases.length,specFiles:specFiles.size};
}
export function validateFullCatalogSelection(selection){assert.deepEqual(Object.keys(selection).sort(),['listReceipt','preparationReceipt']);for(const key of ['preparationReceipt','listReceipt']){const value=selection[key];assert.deepEqual(Object.keys(value).sort(),['file','sha256']);assert.ok(path.isAbsolute(value.file));assert.match(value.sha256,/^[a-f0-9]{64}$/);}return selection;}

export function collectApplicationFullCatalogArtifacts({root,capture,selection=null,prismaQualificationReceipt=null}){
 let selectedSourceRoot=sourceRoot,selectedManifestSha256=manifestSha256,selectedQualificationReceipt=qualificationReceipt,selectedPreparationReceipt=preparationReceipt,selectedListReceipt=listReceipt;
 const selectedCapture=(chosen,key)=>{const relative=path.relative(root,path.resolve(chosen.file)).split(path.sep).join('/');assert.match(relative,new RegExp('^reports/qa/full-catalog-'+(key==='preparationReceipt'?'source':'list-inventory')+'-[a-f0-9]{32}\\.json$'));const raw=capture(relative);assert.equal(sha(raw),chosen.sha256,'CATALOG_SELECTION_BYTES_CHANGED');return{relative,raw};};
 let selectedPreparationRaw,selectedListRaw;
 if(selection){validateFullCatalogSelection(selection);assert.equal(typeof prismaQualificationReceipt,'string','CURRENT_CATALOG_REQUIRES_EXPLICIT_PRISMA_QUALIFICATION');const prepared=selectedCapture(selection.preparationReceipt,'preparationReceipt'),listed=selectedCapture(selection.listReceipt,'listReceipt');selectedPreparationReceipt=prepared.relative;selectedListReceipt=listed.relative;selectedPreparationRaw=prepared.raw;selectedListRaw=listed.raw;const value=JSON.parse(prepared.raw);selectedSourceRoot=path.resolve(value.sourceRoot);assert.equal(fs.realpathSync(selectedSourceRoot),selectedSourceRoot);assert.ok(selectedSourceRoot.startsWith(path.resolve('D:/sabalanerp-online-qa')+path.sep));assert.equal(path.basename(selectedSourceRoot),'full-catalog-'+value.operation);selectedManifestSha256=value.manifestSha256;assert.match(selectedManifestSha256,/^[a-f0-9]{64}$/);selectedQualificationReceipt=path.relative(root,path.resolve(prismaQualificationReceipt)).split(path.sep).join('/');assert.match(selectedQualificationReceipt,/^reports\/qa\/application-prisma-[a-f0-9]{32}\.json$/);}

 capture('scripts/lib/application-native-full-catalog-artifacts.mjs');
 const preparation=JSON.parse(selectedPreparationRaw??capture(selectedPreparationReceipt));assert.equal(preparation.sourcePreparationComplete,true);
 assert.equal(preparation.originalToolSessionClosed,true);assert.equal(preparation.observedOriginalExitCode,0);
 assert.equal(preparation.format,'sabalan-full-catalog-source-preparation-receipt/v1');assert.equal(preparation.productionAdmission,false);assert.equal(preparation.nativeCatalogQualified,false);assert.equal(path.resolve(preparation.sourceRoot),path.resolve(selectedSourceRoot));assert.equal(preparation.manifestSha256,selectedManifestSha256);
 const listed=JSON.parse(selectedListRaw??capture(selectedListReceipt));assert.equal(listed.format,'sabalan-full-catalog-list-receipt/v1');assert.equal(listed.pass,true,'Actual full catalog --list qualification is required before staging');
 assert.equal(listed.observedOriginalExitCode,0);assert.equal(listed.originalToolSessionClosed,true);assert.equal(listed.manifestSha256,selectedManifestSha256);assert.equal(listed.caseInventory.length,listed.tests);
 if(selection){for(const child of [preparation.originalChild,listed.originalChild]){assert.equal(child.code,0);assert.equal(child.signal,null);assert.equal(child.naturalChildClosure,true);assert.equal(child.outputBoundExceeded,false);assert.ok(Number.isSafeInteger(child.originalPid)&&child.originalPid>0);}assert.equal(listed.originalChildPid,listed.originalChild.originalPid);const preparedOutput=JSON.parse(preparation.originalChild.stdout);assert.equal(path.resolve(preparedOutput.destination),selectedSourceRoot);assert.equal(preparedOutput.manifestSha256,selectedManifestSha256);assert.equal(listed.caseInventoryAlgorithm,'sha256-sorted-json-utf8/v1');assert.ok(Number.isSafeInteger(listed.originalChildPid)&&listed.originalChildPid>0);assert.equal(listed.browserStarted,false);assert.equal(listed.databaseConnected,false);assert.equal(listed.dockerExecuted,false);assert.equal(listed.sourceFilesUnchanged,true);const stdout=path.resolve(path.dirname(selectedSourceRoot),'catalog-list-'+preparation.operation+'.stdout.json');const before=regular(stdout),raw=fs.readFileSync(stdout);same(before,regular(stdout));assert.equal(sha(raw),listed.stdoutSha256);assert.equal(raw.toString(),listed.originalChild.stdout);const actual=inventoryOriginalCatalogListing(JSON.parse(raw));for(const key of ['caseInventory','caseInventorySha256','specFileInventory','tests','specFiles'])assert.deepEqual(listed[key],actual[key]);}else{assert.equal(listed.tests,288);assert.equal(listed.specFiles,67);assert.equal(listed.caseInventorySha256,'7e37aa8fbfed0b5983c847d1bd589c1dc0897b6d7ab7a92894f41ab290ae493f');}
 const raw=fs.readFileSync(path.join(selectedSourceRoot,'source-manifest.json'));assert.equal(sha(raw),selectedManifestSha256);
 const manifest=JSON.parse(raw);assert.equal(manifest.format,'sabalan-full-catalog-source/v1');assert.match(manifest.operation,/^[a-f0-9]{32}$/);
 const specFiles=Object.keys(manifest.files).filter(name=>name.startsWith('tests/design-system-e2e/')&&name.endsWith('.spec.ts')).map(name=>name.slice('tests/design-system-e2e/'.length)).sort();
 assert.deepEqual(specFiles,[...listed.specFileInventory].sort(),'Every canonical catalog spec must be listed');
 if(selection){const actual=[];function visit(folder,prefix=''){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);const name=prefix+entry.name;if(entry.isDirectory())visit(path.join(folder,entry.name),name+'/');else if(name.endsWith('.spec.ts'))actual.push(name);}}visit(path.join(root,'tests/design-system-e2e'));assert.deepEqual(specFiles,actual.sort(),'CURRENT_CANONICAL_CATALOG_SPEC_OMITTED');assert.equal(listed.operation,manifest.operation);assert.equal(preparation.operation,manifest.operation);}
 const qualification=capture(selectedQualificationReceipt);assert.equal(manifest.nativeQualificationReceiptSha256,sha(qualification));if(selection){const actual=JSON.parse(qualification);assert.equal(actual.pass,true);assert.equal(actual.identitiesUnchanged,true);assert.equal(actual.sourcesUnchanged,true);assert.equal(actual.result.databaseRetiredWithoutForce,true);assert.equal(actual.result.generated.schemaSha256,manifest.schemaSha256);assert.equal(preparation.actualQualifiedClient,selectedQualificationReceipt);assert.equal(actual.result.generated.linuxArtifact.privateLinuxGeneration.extractionReceiptSha256,manifest.qualifiedLinuxCapsuleSha256);const official=Object.fromEntries(actual.result.generated.linuxArtifact.entries.map(row=>['backend/node_modules/@prisma/client/'+row.target,{sha256:row.sha256,bytes:row.bytes}]));const frozen=Object.fromEntries(Object.entries(manifest.files).filter(([name])=>name.startsWith('backend/node_modules/@prisma/client/')));assert.deepEqual(frozen,official,'CURRENT_CATALOG_CAPSULE_BYTES_CHANGED');}
 assert.equal(manifest.schemaSha256,sha(capture('backend/prisma/schema.prisma')));
 if(selection){const compiledProof=manifest.compiledPackages;assert.equal(compiledProof.format,'sabalan-current-backend-compiled-catalog-packages/v1');assert.ok(path.isAbsolute(compiledProof.receiptFile));const pin=regular(compiledProof.receiptFile),rawCompiled=fs.readFileSync(compiledProof.receiptFile);same(pin,regular(compiledProof.receiptFile));assert.equal(sha(rawCompiled),compiledProof.receiptSha256);const compiled=JSON.parse(rawCompiled);assert.equal(compiled.format,'sabalan-current-backend-compiled/v1');assert.equal(compiled.pass,true);assert.equal(compiled.sourceUnchanged,true);assert.equal(compiled.originalChildren.allOriginalChildrenClosed,true);assert.equal(compiled.originalChildren.interrupted,false);assert.equal(compiled.commands.length,4);assert.ok(compiled.commands.every(c=>c.code===0&&c.signal===null));const expected={};for(const[name,folder]of [['contract-product-graph','graph-dist'],['partner-sales-contracts','partner-dist']]){let count=0;for(const[file,row]of Object.entries(compiled.outputs).filter(([file])=>file.startsWith(folder+'/'))){count++;for(const target of ['packages/'+name+'/dist/','node_modules/@sabalanerp/'+name+'/dist/'])expected[target+file.slice(folder.length+1)]={bytes:row.bytes,sha256:row.sha256};}assert.ok(count>0);}assert.deepEqual(compiledProof.entries,expected);for(const[file,row]of Object.entries(expected))assert.deepEqual(manifest.files[file],row,'CATALOG_COMPILED_PACKAGE_CHANGED');for(const[file,digest]of Object.entries(compiled.sources))assert.equal(sha(capture(file)),digest,'CATALOG_COMPILED_SOURCE_CHANGED');}
 const entries=[...manifest.entries].sort((a,b)=>a.relativePath<b.relativePath?-1:a.relativePath>b.relativePath?1:0);
 assert.ok(entries.length>0&&entries.length<=8192);assert.equal(entries.length,Object.keys(manifest.files).length);
 assert.equal(new Set(entries.map(row=>row.relativePath)).size,entries.length);
 let total=0;
 const prepared=entries.map(entry=>{
  const name=entry.relativePath;assert.ok(typeof name==='string'&&name&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'));
  assert.equal(entry.mode,0o400);assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0);assert.match(entry.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.files[name],{sha256:entry.sha256,bytes:entry.bytes});total+=entry.bytes;
  const file=path.join(selectedSourceRoot,name),before=regular(file),bytes=fs.readFileSync(file);same(before,regular(file));
  assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);
  // Repository-owned inputs must still be exactly current. Dependency files
  // are bound to the actual qualified Linux capsule and the frozen pack.
  if(!(selection&&/^packages\/(?:contract-product-graph|partner-sales-contracts)\/dist\//.test(name))&&(/^(?:frontend\/src\/|tests\/|backend\/src\/|packages\/)/.test(name)||['playwright.design-system.config.ts','frontend/tsconfig.json','backend/tsconfig.json'].includes(name)))assert.equal(sha(capture(name)),entry.sha256,'Catalog source changed: '+name);
  return {...entry,file,identity:before};
 });
 assert.ok(total<=256*1024**2);
 return {files:{'full-catalog-source-manifest.json':raw},catalog:{operation:manifest.operation,sourceManifestSha256:selectedManifestSha256},
  proof:{format:'sabalan-original-full-catalog-source/v1',sourceRoot:selectedSourceRoot,operation:manifest.operation,manifestSha256:selectedManifestSha256,files:entries.length,bytes:total,schemaSha256:manifest.schemaSha256,nativeQualificationReceiptSha256:manifest.nativeQualificationReceiptSha256},entries:prepared};
}

/** SAME original host owns the sole staging Dockerexec until actual close.
 * Failure can leave only a fresh partial source tree, never native/SQL work. */
export async function stageOriginalFullCatalog({prepared,directory,containerId,beforeDocker,onObservation}){
 beforeDocker();
 const child=spawn('docker',['exec','-i',containerId,'python3','-I','-B',directory+'/full-catalog-stage.py',directory,prepared.catalog.sourceManifestSha256],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='',failure;
 const closed=new Promise(resolve=>{child.on('error',error=>{failure=error;});child.on('close',(code,signal)=>resolve({code,signal}));});
 child.stdout.on('data',data=>{if(Buffer.byteLength(stdout)+data.length<=65536)stdout+=data;else failure??=Error('CATALOG_STAGE_STDOUT_BOUND');});
 child.stderr.on('data',data=>{if(Buffer.byteLength(stderr)+data.length<=65536)stderr+=data;else failure??=Error('CATALOG_STAGE_STDERR_BOUND');});
 child.stdin.on('error',error=>{failure??=error;});
 onObservation?.({phase:'SOURCE_STAGE_STARTED',originalPid:child.pid});
 try{
  for(const entry of prepared.entries){
   if(failure)throw failure;
   const fd=fs.openSync(entry.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),hash=createHash('sha256');
   try{
    same(fs.fstatSync(fd,{bigint:true}),entry.identity);let remaining=entry.bytes;
    while(remaining){const data=Buffer.allocUnsafe(Math.min(262144,remaining));const count=fs.readSync(fd,data,0,data.length,null);assert.ok(count>0);const bytes=data.subarray(0,count);hash.update(bytes);remaining-=count;if(!child.stdin.write(bytes))await Promise.race([once(child.stdin,'drain'),closed.then(()=>{throw Error('CATALOG_STAGE_CLOSED_DURING_INPUT');})]);if(failure)throw failure;}
    assert.equal(hash.digest('hex'),entry.sha256);same(fs.fstatSync(fd,{bigint:true}),entry.identity);same(regular(entry.file),entry.identity);
   }finally{fs.closeSync(fd);}
  }
 }catch(error){failure??=error;}finally{child.stdin.end();}
 const completion=await closed;
 onObservation?.({phase:'SOURCE_STAGE_CLOSED',originalPid:child.pid,...completion,stderr});
 if(failure)throw failure;
 assert.equal(completion.code,0);assert.equal(completion.signal,null);
 const result=JSON.parse(stdout);assert.equal(result.format,'sabalan-original-full-catalog-stage/v1');
 assert.equal(result.operation,prepared.catalog.operation);assert.equal(result.manifestSha256,prepared.catalog.sourceManifestSha256);
 assert.equal(result.files,prepared.proof.files);assert.equal(result.bytes,prepared.proof.bytes);assert.equal(result.databaseExecuted,false);
 return {...completion,result,stderr};
}
