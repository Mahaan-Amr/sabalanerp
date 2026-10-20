import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stableBackendBaseFile} from './production-backend-base-artifacts.mjs';
import {schemaTokens,schemaTokenDigest} from './prisma-schema-tokens.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const privateHostPrismaInputs=Object.freeze({schema:'backend/prisma/schema.prisma',cli:'backend/node_modules/prisma/build/index.js',
 generator:'backend/node_modules/@prisma/client/generator-build/index.js',schemaEngine:'backend/node_modules/@prisma/engines/schema-engine-windows.exe',
 linuxEngine:'backend/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node',helper:'scripts/generate-private-host-prisma.mjs'});

/** Code-generation provenance only: never runtime, SQL or release authority. */
export function readPrivateHostPrismaGeneration({repositoryRoot,receiptFile,captureExternalSource}){
 assert.equal(typeof captureExternalSource,'function');
 receiptFile=path.resolve(receiptFile);
 const match=/^private-host-prisma-([a-f0-9]{32})\.json$/.exec(path.basename(receiptFile));assert.ok(match,'PRIVATE_HOST_RECEIPT_NAME');
 assert.equal(receiptFile,path.join(path.resolve(repositoryRoot),'reports/qa',path.basename(receiptFile)),'PRIVATE_HOST_RECEIPT_LOCATION');
 const receiptBytes=captureExternalSource(receiptFile),report=JSON.parse(receiptBytes);
 assert.equal(report.format,'sabalan-private-official-host-prisma-generation/v1');
 const operation='private-host-prisma-'+match[1],root=path.resolve('D:/sabalanerp-online-qa',operation),output=path.join(root,'client');
 assert.equal(report.operation,operation);assert.equal(path.resolve(report.root),root);assert.equal(path.resolve(report.output),output);
 assert.equal(fs.realpathSync(root),root);assert.equal(fs.realpathSync(output),output);
 for(const key of ['pass','generatorOnlyTransform','sharedClientUnchanged'])assert.equal(report[key],true,'PRIVATE_HOST_RECEIPT_'+key);
 for(const key of ['sharedClientModified','databaseConnected','dockerExecuted','productionAdmission'])assert.equal(report[key],false);
 const child=report.generation;assert.ok(child&&Number.isSafeInteger(child.originalPid)&&child.originalPid>0);
 assert.equal(child.code,0);assert.equal(child.signal,null);assert.equal(child.naturalChildClosure,true);assert.equal(child.outputBoundExceeded,false);
 assert.equal(child.spawnError,undefined);assert.equal(child.streamError,undefined);
 assert.deepEqual(report.originalChildren,{allOriginalChildrenClosed:true,childCount:1,interrupted:false});
 for(const [key,relative] of Object.entries(privateHostPrismaInputs))
  assert.deepEqual(stableBackendBaseFile(path.join(repositoryRoot,relative)),report.inputs[key],'PRIVATE_HOST_INPUT_CHANGED_'+key);
 const source=fs.readFileSync(path.join(repositoryRoot,privateHostPrismaInputs.schema));
 assert.equal(sha(source),report.sourceSchemaSha256);
 const transformed=captureExternalSource(path.join(root,'schema.prisma'));
 assert.equal(sha(transformed),report.transformedSchemaSha256);
 const expected='generator client {\n  provider      = "prisma-client-js"\n  binaryTargets = ["native", "debian-openssl-3.0.x"]\n}';
 const original=source.toString('utf8'),blocks=[...original.matchAll(/^generator client \{[\s\S]*?^\}/gm)];
 assert.equal(blocks.length,1);assert.equal(blocks[0][0].replace(/\r/g,''),expected);
 const generator=path.join(repositoryRoot,privateHostPrismaInputs.generator).replaceAll('\\','/');
 const replacement='generator client {\n  provider = '+JSON.stringify('node '+generator)+'\n  binaryTargets = ["debian-openssl-3.0.x"]\n  output = '+JSON.stringify(output.replaceAll('\\','/'))+'\n}';
 assert.equal(transformed.toString('utf8'),original.slice(0,blocks[0].index)+replacement+original.slice(blocks[0].index+blocks[0][0].length),'PRIVATE_HOST_NON_GENERATOR_CHANGE');
 assert.deepEqual(JSON.parse(captureExternalSource(path.join(root,'package.json'))),{name:operation,private:true});
 assert.equal(report.generated.version.client,'5.22.0');assert.equal(report.generated.version.engine,'605197351a3c8bdd595af2d2a9bc3025bca48ea2');
 const models=[...original.matchAll(/^model\s+(\w+)\s*\{/gm)].map(match=>match[1]);assert.equal(models.length,548);assert.equal(report.generated.models,models.length);
 assert.match(report.generated.dmmfSha256,/^[a-f0-9]{64}$/);
 const actual=[];let total=0;
 function visit(folder,prefix=''){
  assert.equal(fs.realpathSync(folder),folder);assert.ok(!fs.lstatSync(folder).isSymbolicLink());
  for(const name of fs.readdirSync(folder).sort()){
   const file=path.join(folder,name),relative=prefix+name,stat=fs.lstatSync(file);assert.ok(!stat.isSymbolicLink());
   if(stat.isDirectory())visit(file,relative+'/');else{
    assert.ok(stat.isFile()&&stat.nlink===1);assert.ok(actual.length<2000);total+=stat.size;assert.ok(total<=256*1024**2);
    actual.push(relative);const expected=report.outputs[relative];assert.ok(expected,'PRIVATE_HOST_UNREPORTED_OUTPUT');
    assert.deepEqual(stableBackendBaseFile(file),expected,'PRIVATE_HOST_OUTPUT_CHANGED');
    const bytes=captureExternalSource(file);assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256);
   }
  }
 }
 visit(output);assert.deepEqual(actual.sort(),Object.keys(report.outputs).sort());
 for(const name of ['schema.prisma','index.js','package.json','runtime/library.js','runtime/library.d.ts','libquery_engine-debian-openssl-3.0.x.so.node'])assert.ok(actual.includes(name));
 const generatedSchema=captureExternalSource(path.join(output,'schema.prisma'));
 assert.deepEqual(schemaTokens(generatedSchema.toString('utf8')),schemaTokens(transformed.toString('utf8')),'PRIVATE_HOST_GENERATED_SCHEMA_SEMANTICS_CHANGED');
 assert.equal(report.outputs['libquery_engine-debian-openssl-3.0.x.so.node'].sha256,report.inputs.linuxEngine.sha256);
 assert.equal(JSON.parse(captureExternalSource(path.join(repositoryRoot,'backend/node_modules/prisma/package.json'))).version,'5.22.0');
 assert.equal(JSON.parse(captureExternalSource(path.join(repositoryRoot,'backend/node_modules/@prisma/client/package.json'))).version,'5.22.0');
 return {report,receiptSha256:sha(receiptBytes),root,output,models,transformed,
  transformedSchemaTokensSha256:schemaTokenDigest(transformed.toString('utf8')),generatedSchemaTokensSha256:schemaTokenDigest(generatedSchema.toString('utf8'))};
}
