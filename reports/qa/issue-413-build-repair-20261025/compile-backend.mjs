import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
const repo=path.resolve(process.argv[4]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const {originalBackendBaseCommands}=await import(pathToFileURL(path.join(repo,'scripts/lib/production-backend-base-process.mjs')));
const [mode='--inspect',linuxReceipt]=process.argv.slice(2);assert.ok(['--inspect','--compile'].includes(mode)&&linuxReceipt&&process.argv.length===5);
const codegenRepository='C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp';
assert.deepEqual(fs.readFileSync(path.join(repo,'backend/prisma/schema.prisma')),fs.readFileSync(path.join(codegenRepository,'backend/prisma/schema.prisma')),'QUALIFIED_CODEGEN_SCHEMA_CHANGED');
const {readPrivateLinuxPrismaGeneration}=await import(pathToFileURL(path.join(codegenRepository,'scripts/lib/private-linux-prisma-receipt.mjs')));
const externalSources={};
function external(file){const st=fs.lstatSync(file);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1);const bytes=fs.readFileSync(file);const after=fs.lstatSync(file);for(const key of ['dev','ino','size','mtimeMs','ctimeMs','mode','nlink'])assert.equal(after[key],st[key]);externalSources[path.resolve(file)]={bytes:bytes.length,sha256:sha(bytes)};return bytes;}
const linux=readPrivateLinuxPrismaGeneration({repositoryRoot:codegenRepository,extractionReceiptFile:linuxReceipt,captureExternalSource:external});
const schemaModels=[...fs.readFileSync(path.join(repo,'backend/prisma/schema.prisma'),'utf8').matchAll(/^model\s+(\w+)\s*\{/gm)].map(m=>m[1]).sort();assert.ok(schemaModels.length>0);assert.equal(linux.generation.models,schemaModels.length);
for(const relative of ['scripts/lib/private-linux-prisma-receipt.mjs','scripts/lib/prisma-schema-tokens.mjs'])external(path.join(repo,relative));
external(import.meta.filename);
const migrations=fs.readdirSync(path.join(repo,'backend/prisma/migrations'),{withFileTypes:true}).filter(v=>v.isDirectory());assert.ok(migrations.length>0);const migrationNames=migrations.map(row=>row.name).sort();
const compilerHeapMiB=3072; // Explicit ceiling, not a historical85832 measured heap/RSS claim.
const selectedClient=path.join(linux.output,'index.d.ts');assert.ok(fs.statSync(selectedClient).isFile());
const verifyExternal=()=>{for(const [file,row]of Object.entries(externalSources)){const bytes=fs.readFileSync(file);assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);}};

function inventory(){const result={};
 const visit=relative=>{const file=path.join(repo,relative),st=fs.lstatSync(file);assert.ok(!st.isSymbolicLink());
  if(st.isDirectory()){for(const name of fs.readdirSync(file).sort())visit(relative+'/'+name);}
  else{assert.ok(st.isFile()&&st.nlink===1);result[relative]=sha(fs.readFileSync(file));}};
 for(const root of ['backend/src','backend/prisma','backend/scripts','backend/public','backend/excel',
   'packages/contract-product-graph/src','packages/partner-sales-contracts/src'])visit(root);
 for(const base of ['backend','packages/contract-product-graph','packages/partner-sales-contracts']){
  for(const name of fs.readdirSync(path.join(repo,base)).filter(n=>/^(?:package(?:-lock)?\.json|tsconfig.*\.json)$/.test(n)))visit(base+'/'+name);}
 for(const name of ['tsc.js','_tsc.js'])if(fs.existsSync(path.join(repo,'backend/node_modules/typescript/lib',name)))visit('backend/node_modules/typescript/lib/'+name);
 visit('docs/qa/partner-sales/release/release-package.mjs');
 // Host scripts and container configuration are pinned separately during materialization; tsc does not read them.

 return result;
}
const sources=inventory(),receiptName=path.resolve(linuxReceipt);
const reuseModule='D:/sabalanerp-online-qa/C30-changed-backend-compile-reuse-source-r1-20261025/workspace-component-reuse.mjs';external(reuseModule);const {prepareWorkspaceComponentReuse}=await import(pathToFileURL(reuseModule));
const {projectBackendWorkspaceInputs}=await import(pathToFileURL(path.join(repo,'scripts/lib/backend-workspace-projection.mjs')));external(path.join(repo,'scripts/lib/backend-workspace-projection.mjs'));
const reuse=prepareWorkspaceComponentReuse('D:/sabalanerp-online-qa/current-backend-compiled-27444b318a9d9c1c819aa02029edaa1f/compiled-receipt.json','bd92a6206be29a42140c7a34ae601fe709f5a165bd46e4482e2a3de7e6e6a566',sources,sha(fs.readFileSync(receiptName)));
const linuxClient={extractionReceipt:receiptName,output:linux.output,generation:linux.generation,externalSources,nativeQualification:false};
if(mode==='--inspect'){console.log(JSON.stringify({sourceFiles:Object.keys(sources).length,sourceInventorySha256:sha(JSON.stringify(sources)),
 officialCapsuleReceipt:receiptName,linuxClient,compileExecuted:false,dockerExecuted:false,productionAdmission:false}));}
else{
 const root=path.resolve('D:/sabalanerp-online-qa','current-backend-compiled-'+randomBytes(16).toString('hex'));
 fs.mkdirSync(root,{mode:0o700});const commands=originalBackendBaseCommands();
 const result={format:'sabalan-current-backend-compiled/v1',root,pass:false,sources,officialCapsuleReceipt:receiptName,
   qualifiedReceiptSha256:sha(fs.readFileSync(receiptName)),linuxClient,schemaModels,migrationNames,compilerHeapMiB,commands:[],reusedComponents:reuse.metadata,productionAdmission:false};
 const tsc=path.join(repo,'backend/node_modules/typescript/lib/tsc.js');
 function config(name,extendsFile,output,paths){const file=path.join(root,name+'.json');
  fs.writeFileSync(file,JSON.stringify({extends:path.join(repo,extendsFile),compilerOptions:{outDir:path.join(root,output),noEmit:false,incremental:false,composite:false,...(paths?{paths}:{})}},null,2)+'\n',{flag:'wx'});return file;}
 const graph=path.join(root,'graph-dist/index.d.ts'),partner=path.join(root,'partner-dist/index.d.ts');
 const prismaMappings={'@prisma/client':[selectedClient],'@prisma/client/*':[path.join(linux.output,'*')]};
 const mappings={...prismaMappings,'zod':[path.join(repo,'backend/node_modules/zod/index.d.ts')],'@sabalanerp/contract-product-graph':[graph],'@sabalanerp/partner-sales-contracts':[partner],
 '@sabalanerp/partner-sales-contracts/testing':[path.join(root,'partner-dist/testing.d.ts')],'@/*':[path.join(repo,'backend/src/*')]};
 const configs=[config('backend','backend/tsconfig.json','dist',mappings),config('cutover','backend/tsconfig.cutover.json','dist-cutover',mappings)];
 let error;
 try{reuse.copyInto(root);const projection=projectBackendWorkspaceInputs(repo,root,reuse.metadata);result.workspaceProjection={files:projection.files,recompiled:projection.recompiled};for(const file of configs){const outcome=await commands.run(process.execPath,['--max-old-space-size='+compilerHeapMiB,tsc,'-p',file]);result.commands.push(outcome);commands.assertSuccessful(outcome);}
  verifyExternal();reuse.revalidate();projection.revalidate();assert.deepEqual(inventory(),sources);result.sourceUnchanged=true;
  for(const file of ['dist/index.js','dist/online.js','dist/onlinePrivateQualification.js','dist/application.js','dist-cutover/scripts/shipment-statement-cutover.js','graph-dist/index.js','partner-dist/index.js'])assert.ok(fs.statSync(path.join(root,file)).isFile(),file);
  result.outputs={};const collect=(directory,prefix)=>{for(const name of fs.readdirSync(directory).sort()){const file=path.join(directory,name),relative=prefix+'/'+name,st=fs.lstatSync(file);assert.ok(!st.isSymbolicLink());if(st.isDirectory())collect(file,relative);else{assert.ok(st.isFile());result.outputs[relative]={bytes:st.size,sha256:sha(fs.readFileSync(file))};}}};
  for(const name of ['graph-dist','partner-dist','dist','dist-cutover'])collect(path.join(root,name),name);
  result.nodeVersion=process.version;result.platform=process.platform;result.pass=true;
 }catch(cause){error=cause;result.error=cause instanceof Error?cause.message:'COMPILE_UNPROVEN';}
 finally{result.originalChildren=await commands.close();if(result.originalChildren.interrupted){result.pass=false;error??=Error('ORIGINAL_CONTROLLER_INTERRUPTED');}
  const fd=fs.openSync(path.join(root,'compiled-receipt.json'),'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(result,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 console.log(JSON.stringify({root,pass:result.pass,receipt:path.join(root,'compiled-receipt.json')}));if(error)throw error;
}
