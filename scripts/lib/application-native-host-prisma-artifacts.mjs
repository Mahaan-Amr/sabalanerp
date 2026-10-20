import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readPrivateHostPrismaGeneration,privateHostPrismaInputs} from './private-host-prisma-receipt.mjs';
import {readPrivateLinuxPrismaGeneration} from './private-linux-prisma-receipt.mjs';
import {schemaTokens,schemaTokenDigest} from './prisma-schema-tokens.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function collectHostPrismaArtifacts({repositoryRoot,captureSource,privateHostReceipt,linuxGenerationReceipt,captureExternalSource}){
  assert.ok(!(privateHostReceipt&&linuxGenerationReceipt),'Choose one actual generation provenance');
  const privateGeneration=privateHostReceipt?readPrivateHostPrismaGeneration({repositoryRoot,receiptFile:privateHostReceipt,captureExternalSource}):undefined;
  const linuxGeneration=linuxGenerationReceipt?readPrivateLinuxPrismaGeneration({repositoryRoot,extractionReceiptFile:linuxGenerationReceipt,captureExternalSource}):undefined;
  const externalGeneration=privateGeneration??linuxGeneration;
  if(privateGeneration)for(const relative of Object.values(privateHostPrismaInputs))captureSource(relative);
  const generated='backend/node_modules/.prisma/client',directory=externalGeneration?.output??path.join(repositoryRoot,generated),files={},entries=[];
  const source=captureSource('backend/prisma/schema.prisma');
  const read=name=>externalGeneration?captureExternalSource(path.join(directory,name)):captureSource(generated+'/'+name);
  const schema=read('schema.prisma');
  const semantics=value=>schemaTokens(externalGeneration?value.replace(/^generator client \{[\s\S]*?^\}/gm,''):value);
  assert.deepEqual(semantics(source.toString('utf8')),semantics(schema.toString('utf8')),'HOST_CLIENT_SCHEMA_NOT_CURRENT');
  const index=read('index.js');
  const inline=index.toString('utf8').split(/\r?\n/).find(line=>line.trimStart().startsWith('"inlineSchema":'));
  assert.ok(inline);assert.equal(JSON.parse(inline.trim().slice('"inlineSchema":'.length).replace(/,$/,'')),schema.toString('utf8'));
  const require=createRequire(import.meta.url),client=require(directory);
  assert.equal(client.Prisma.prismaVersion.client,'5.22.0');assert.equal(client.Prisma.prismaVersion.engine,'605197351a3c8bdd595af2d2a9bc3025bca48ea2');
  for(const name of ['deploymentOperation','onlineRelease','onlineMigrationStep','onlineRuntimeSlot','onlineRealtimeBatch','onlineRealtimeCommand','onlineHrInvalidationIntent'])assert.ok(client.Prisma.dmmf.datamodel.models.some(model=>model.name[0].toLowerCase()+model.name.slice(1)===name));
  const modelNames=[...source.toString('utf8').matchAll(/^model\s+(\w+)\s*\{/gm)].map(match=>match[1]);
  assert.equal(modelNames.length,548);assert.deepEqual(client.Prisma.dmmf.datamodel.models.map(model=>model.name).sort(),modelNames.sort());
  if(privateGeneration)assert.equal(sha(JSON.stringify(client.Prisma.dmmf)),privateGeneration.report.generated.dmmfSha256);
  if(linuxGeneration)assert.equal(sha(JSON.stringify(client.Prisma.dmmf)),linuxGeneration.generation.dmmfSha256);
  const selected=privateGeneration?Object.keys(privateGeneration.report.outputs):linuxGeneration?Object.keys(linuxGeneration.generation.files):fs.readdirSync(directory).filter(name=>/\.(?:js|ts|json|prisma)$/.test(name));
  if(!externalGeneration)selected.push('libquery_engine-debian-openssl-3.0.x.so.node');
  for(const name of selected){
    const relative=externalGeneration?path.join(directory,name):generated+'/'+name,bytes=read(name);
    const staged='host-prisma-'+entries.length;files[staged]=bytes;
    entries.push({file:staged,target:name,source:relative,bytes:bytes.length,sha256:sha(bytes)});
  }
  for(const name of externalGeneration?[]:['library.js','library.d.ts']){
    const relative='backend/node_modules/@prisma/client/runtime/'+name,bytes=captureSource(relative);
    const staged='host-prisma-'+entries.length;files[staged]=bytes;entries.push({file:staged,target:'runtime/'+name,source:relative,bytes:bytes.length,sha256:sha(bytes)});
  }
  const proof={format:linuxGeneration?'sabalan-official-linux-prisma-artifact/v1':'sabalan-official-host-prisma-artifact/v1',linuxGenerated:Boolean(linuxGeneration),manualModelChanges:false,
    sourceSchemaSha256:sha(source),generatedSchemaSha256:sha(schema),schemaTokensSha256:schemaTokenDigest(source.toString('utf8')),
    inlineSchemaMatchesGeneratedSchema:true,version:client.Prisma.prismaVersion,models:client.Prisma.dmmf.datamodel.models.length,
    dmmfSha256:sha(JSON.stringify(client.Prisma.dmmf)),entries};
  if(privateGeneration)Object.assign(proof,{privateHostGeneration:{receiptSha256:privateGeneration.receiptSha256,
    operation:privateGeneration.report.operation,generatorOnlyTransform:true,transformedSchemaSha256:privateGeneration.report.transformedSchemaSha256,
    transformedSchemaTokensSha256:privateGeneration.transformedSchemaTokensSha256,generatedSchemaTokensSha256:privateGeneration.generatedSchemaTokensSha256},generatorOnlyTransform:true});
  if(linuxGeneration)Object.assign(proof,{privateLinuxGeneration:{receiptSha256:linuxGeneration.receiptSha256,
    extractionReceiptSha256:linuxGeneration.extractionReceiptSha256,operation:linuxGeneration.generation.operation,
    remoteEnvelopeSha256:linuxGeneration.remoteEnvelopeSha256,
    generatorOnlyTransform:true,transformedSchemaSha256:linuxGeneration.generation.transformedSchemaSha256,
    transformedSchemaTokensSha256:linuxGeneration.generation.transformedSchemaTokensSha256,generatedSchemaTokensSha256:linuxGeneration.generation.generatedSchemaTokensSha256},generatorOnlyTransform:true});
  if(externalGeneration){files['host-prisma-transform-source.prisma']=externalGeneration.transformed;proof.transformedSchemaFile='host-prisma-transform-source.prisma';}
  files['host-prisma-artifact.json']=Buffer.from(JSON.stringify(proof)+'\n');return files;
}
