import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {readPrivateHostPrismaGeneration,privateHostPrismaInputs} from '../../scripts/lib/private-host-prisma-receipt.mjs';
import {stableBackendBaseFile} from '../../scripts/lib/production-backend-base-artifacts.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Synthetic provenance fixtures exercise rejection/integrity only. They are
// never loaded as generated JS, staged, or represented as real code generation.
function fixture(){
 const operation='private-host-prisma-'+randomBytes(16).toString('hex'),root=path.resolve('D:/sabalanerp-online-qa',operation);
 const repositoryRoot=path.join(root,'test-repository'),output=path.join(root,'client');fs.mkdirSync(output,{recursive:true});
 const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
 const canonical=fs.readFileSync(new URL('../../backend/prisma/schema.prisma',import.meta.url),'utf8');
 for(const [name,relative]of Object.entries(privateHostPrismaInputs))write(path.join(repositoryRoot,relative),name==='schema'?canonical:'synthetic '+name);
 for(const name of ['prisma','@prisma/client'])write(path.join(repositoryRoot,'backend/node_modules',name,'package.json'),JSON.stringify({version:'5.22.0'}));
 const block=/^generator client \{[\s\S]*?^\}/m;
 const replacement='generator client {\n  provider = '+JSON.stringify('node '+path.join(repositoryRoot,privateHostPrismaInputs.generator).replaceAll('\\','/'))+'\n  binaryTargets = ["debian-openssl-3.0.x"]\n  output = '+JSON.stringify(output.replaceAll('\\','/'))+'\n}';
 const transformed=canonical.replace(block,replacement);
 write(path.join(root,'schema.prisma'),transformed);write(path.join(root,'package.json'),JSON.stringify({name:operation,private:true}));
 const values={'schema.prisma':transformed,'index.js':'synthetic unexecuted JS','package.json':'{}','runtime/library.js':'synthetic runtime',
  'runtime/library.d.ts':'synthetic types','libquery_engine-debian-openssl-3.0.x.so.node':'synthetic linuxEngine'};
 for(const[name,bytes]of Object.entries(values))write(path.join(output,name),bytes);
 const report={format:'sabalan-private-official-host-prisma-generation/v1',operation,root,output,pass:true,generatorOnlyTransform:true,
  sharedClientUnchanged:true,sharedClientModified:false,databaseConnected:false,dockerExecuted:false,productionAdmission:false,
  generation:{originalPid:123,code:0,signal:null,naturalChildClosure:true,outputBoundExceeded:false},
  originalChildren:{allOriginalChildrenClosed:true,childCount:1,interrupted:false},
  inputs:Object.fromEntries(Object.entries(privateHostPrismaInputs).map(([key,relative])=>[key,stableBackendBaseFile(path.join(repositoryRoot,relative))])),
  sourceSchemaSha256:sha(canonical),transformedSchemaSha256:sha(transformed),
  generated:{version:{client:'5.22.0',engine:'605197351a3c8bdd595af2d2a9bc3025bca48ea2'},models:548,dmmfSha256:'a'.repeat(64)},
  outputs:Object.fromEntries(Object.keys(values).map(name=>[name,stableBackendBaseFile(path.join(output,name))]))};
 const receiptFile=path.join(repositoryRoot,'reports/qa',operation+'.json'),save=()=>write(receiptFile,JSON.stringify(report));save();
 const read=()=>readPrivateHostPrismaGeneration({repositoryRoot,receiptFile,captureExternalSource:file=>fs.readFileSync(file)});
 return {root,repositoryRoot,output,report,receiptFile,save,read,close(){assert.equal(path.dirname(root),path.resolve('D:/sabalanerp-online-qa'));assert.match(path.basename(root),/^private-host-prisma-[a-f0-9]{32}$/);fs.rmSync(root,{recursive:true});}};
}
test('receipt Boolean cannot replace original natural child closure or closed owner',()=>{
 const f=fixture();try{assert.equal(f.read().report.generated.models,548);
  f.report.generation.code=1;f.save();assert.throws(f.read);
  f.report.generation.code=0;f.report.originalChildren.allOriginalChildrenClosed=false;f.save();assert.throws(f.read);
 }finally{f.close();}
});
test('stale source and modified generated output are independently refused',()=>{
 const f=fixture();try{
  const source=path.join(f.repositoryRoot,privateHostPrismaInputs.schema),bytes=fs.readFileSync(source);
  fs.appendFileSync(source,'\nmodel Unexpected { id String @id }');assert.throws(f.read);
  fs.writeFileSync(source,bytes);f.report.inputs.schema=stableBackendBaseFile(source);f.save();assert.equal(f.read().report.generated.models,548);
  fs.appendFileSync(path.join(f.output,'index.js'),' changed');assert.throws(f.read);
 }finally{f.close();}
});
test('recognized generator transformation cannot conceal model changes or another output root',()=>{
 const f=fixture();try{
  const file=path.join(f.root,'schema.prisma');fs.appendFileSync(file,'\nmodel Unexpected { id String @id }');
  f.report.transformedSchemaSha256=sha(fs.readFileSync(file));f.save();assert.throws(f.read,/PRIVATE_HOST_NON_GENERATOR_CHANGE/);
  f.report.output=path.join(f.root,'another-client');f.save();assert.throws(f.read);
 }finally{f.close();}
});
