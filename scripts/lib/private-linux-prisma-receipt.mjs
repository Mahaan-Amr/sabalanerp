import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {backendBaseIdentity,stableBackendBaseFile} from './production-backend-base-artifacts.mjs';
import {schemaTokens,schemaTokenDigest} from './prisma-schema-tokens.mjs';
import {readCurrentLocalLinuxPrismaGeneration} from './current-linux-prisma-receipt.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const privateLinuxPrismaIdentity=Object.freeze({operation:'private-linux-prisma-generation-e380da106b5e41789f02b9e986f83d37',
 remoteEnvelopeSha256:'284e18fdf8052ca401b29603cac95ed19e0f852f505d35668812f4365e7e6e1b',
 helperSha256:'ae98cea5aaaf0e19c8cb2b7a62e1e2ce9baaf637dda637ca82048c241d025e17',
 linuxEngineSha256:'35860a5c0fb2f79e7b38c40747c4d212318d97e1910ca528b133c802716de0b8'});
const engine='/app/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node';

/** Validate the separate pure Linux code-generation chain. It grants no native
 * application ownership, serving admission or SQL/capture completion. */
export function assertPrivateLinuxPrismaController(controller,source){
 const expected=privateLinuxPrismaIdentity,operation=expected.operation;
 assert.equal(controller.format,'sabalan-private-linux-prisma-generation-controller/v1');
 assert.equal(controller.operation,operation);assert.equal(controller.pass,true);assert.equal(controller.generationOnly,true);
 for(const key of ['databaseConnected','runtimeStarted','productionAdmission'])assert.equal(controller[key],false);
 assert.deepEqual(controller.interrupted,[]);assert.equal(controller.ownContainerRemoved,true);assert.equal(controller.allOriginalChildrenClosed,true);
 assert.equal(controller.sourceSchemaSha256,sha(source));assert.equal(controller.helperSha256,expected.helperSha256);
 assert.equal(controller.image,backendBaseIdentity.configIdentity);assert.equal(controller.imageLayers.length,21);
 for(const layer of controller.imageLayers)assert.match(layer,/^sha256:[a-f0-9]{64}$/);
 assert.match(controller.containerId,/^[a-f0-9]{64}$/);
 const root='/root/sabalan-recovery-private/native-qa/'+operation;assert.equal(controller.root,root);
 const commands=controller.originalCommands;assert.equal(commands.length,9);
 for(const command of commands){assert.equal(command.code,0);assert.ok(Number.isSafeInteger(command.originalPid)&&command.originalPid>0);}
 assert.deepEqual(commands[0].args,['image','inspect',controller.image]);
 const image=JSON.parse(commands[0].stdout);assert.equal(image.length,1);assert.equal(image[0].Id,controller.image);
 assert.deepEqual(image[0].RootFS.Layers,controller.imageLayers);assert.ok(image[0].Config.Volumes==null||Object.keys(image[0].Config.Volumes).length===0);
 const suffix=operation.slice('private-linux-prisma-generation-'.length),name='sabalan-prisma-codegen-'+suffix;
 assert.deepEqual(commands[1].args,['ps','-aq','--filter','name=^/'+name+'$']);assert.equal(commands[1].stdout.trim(),'');
 assert.deepEqual(commands[2].args,['create','--name',name,'--label','com.docker.compose.project=sabalanerp-backup-codegen',
  '--label','sabalan.codegen.operation='+operation,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
  '--cpus','1','--memory','1536m','--memory-swap','1536m','--pids-limit','128','--log-opt','max-size=2m','--log-opt','max-file=2',
  '--init','--user','0:0','--workdir','/qa-generation','--mount','type=bind,src='+root+'/inputs,dst=/qa-input,readonly',
  '--mount','type=bind,src='+root+'/output,dst=/qa-generation','--tmpfs','/tmp:uid=0,gid=0,mode=0700,size=64m,noexec,nosuid',
  '--entrypoint','node',controller.image,'/qa-input/generate.cjs']);
 assert.equal(commands[2].stdout.trim(),controller.containerId);
 assert.deepEqual(commands[4].args,['start','--attach',controller.containerId]);
 assert.deepEqual(controller.containerClosure,{exitCode:0,pid:0,oomKilled:false,originalAttachCode:0,originalAttachPid:commands[4].originalPid});
 const inspected=[];
 for(const index of [3,5,6]){
  assert.deepEqual(commands[index].args,['inspect',controller.containerId]);const rows=JSON.parse(commands[index].stdout);assert.equal(rows.length,1);
  const row=rows[0];assert.equal(row.Id,controller.containerId);assert.equal(row.Image,controller.image);inspected.push(row);
 }
 const created=inspected[0],host=created.HostConfig;
 const hostConfiguration=value=>{assert.ok(value.OomKillDisable===false||value.OomKillDisable===null);return {...value,OomKillDisable:null};};
 hostConfiguration(host);
 assert.equal(created.State.Status,'created');assert.equal(created.Config.Labels['sabalan.codegen.operation'],operation);
 assert.deepEqual(created.Config.Entrypoint,['node']);assert.deepEqual(created.Config.Cmd,['/qa-input/generate.cjs']);
 assert.equal(created.Config.WorkingDir,'/qa-generation');assert.equal(created.Config.User,'0:0');
 assert.equal(host.NetworkMode,'none');assert.equal(host.ReadonlyRootfs,true);assert.equal(host.Memory,1536*1024**2);
 assert.equal(host.MemorySwap,1536*1024**2);assert.equal(host.NanoCpus,1e9);assert.equal(host.PidsLimit,128);assert.ok(!host.PortBindings||Object.keys(host.PortBindings).length===0);
 assert.deepEqual(host.CapDrop,['ALL']);assert.ok(host.SecurityOpt.includes('no-new-privileges'));
 assert.deepEqual(created.Mounts.filter(m=>m.Type==='bind').map(m=>[m.Source,m.Destination,m.RW]).sort(),[[root+'/inputs','/qa-input',false],[root+'/output','/qa-generation',true]].sort());
 assert.equal(created.Mounts.filter(m=>m.Type==='volume').length,0);
 for(const row of inspected.slice(1)){
  assert.deepEqual(row.Config,created.Config);assert.deepEqual(hostConfiguration(row.HostConfig),hostConfiguration(host));assert.deepEqual(row.Mounts,created.Mounts);
  assert.equal(row.State.Status,'exited');assert.equal(row.State.ExitCode,0);assert.equal(row.State.Pid,0);assert.equal(row.State.OOMKilled,false);assert.equal(row.State.Running,false);
 }
 assert.deepEqual(commands[7].args,['rm',controller.containerId]);
 assert.deepEqual(commands[8].args,['ps','-aq','--no-trunc','--filter','label=sabalan.codegen.operation='+operation]);assert.equal(commands[8].stdout.trim(),'');
 const generation=controller.generation;assert.equal(generation.format,'sabalan-private-linux-prisma-code-generation/v1');assert.equal(generation.operation,operation);
 assert.equal(generation.sourceSchemaSha256,sha(source));assert.equal(generation.generatorOnlyTransform,true);assert.equal(generation.output,'/qa-generation/client');
 for(const key of ['databaseConnected','runtimeStarted','sharedClientModified','productionAdmission'])assert.equal(generation[key],false);
 assert.deepEqual(generation.generation,{code:0,signal:null});
 assert.deepEqual(generation.version,{client:'5.22.0',engine:'605197351a3c8bdd595af2d2a9bc3025bca48ea2'});
 assert.equal(generation.toolchain.cliVersion,'5.22.0');assert.equal(generation.toolchain.clientVersion,'5.22.0');assert.equal(generation.toolchain.node,backendBaseIdentity.node);
 const toolNames=['/app/node_modules/prisma/build/index.js','/app/node_modules/@prisma/client/generator-build/index.js',engine,'/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x'];
 assert.deepEqual(Object.keys(generation.toolchain.files).sort(),toolNames.sort());
 for(const file of Object.values(generation.toolchain.files)){assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>0);}
 assert.equal(generation.toolchain.files[engine].sha256,expected.linuxEngineSha256);
 const original=source.toString('utf8'),blocks=[...original.matchAll(/^generator client \{[\s\S]*?^\}/gm)];assert.equal(blocks.length,1);
 assert.equal(blocks[0][0].replace(/\r/g,''),'generator client {\n  provider      = "prisma-client-js"\n  binaryTargets = ["native", "debian-openssl-3.0.x"]\n}');
 const replacement='generator client {\n  provider = "node /app/node_modules/@prisma/client/generator-build/index.js"\n  binaryTargets = ["debian-openssl-3.0.x"]\n  output = "/qa-generation/client"\n}';
 const transformed=Buffer.from(original.slice(0,blocks[0].index)+replacement+original.slice(blocks[0].index+blocks[0][0].length));
 assert.equal(generation.transformedSchemaSha256,sha(transformed));assert.equal(generation.models,548);
 assert.equal(generation.transformedSchemaTokensSha256,schemaTokenDigest(transformed.toString('utf8')));
 assert.equal(generation.generatedSchemaTokensSha256,generation.transformedSchemaTokensSha256);assert.match(generation.generatedSchemaSha256,/^[a-f0-9]{64}$/);
 assert.equal([...original.matchAll(/^model\s+(\w+)\s*\{/gm)].length,548);assert.match(generation.dmmfSha256,/^[a-f0-9]{64}$/);
 let bytes=0;const entries=Object.entries(generation.files);assert.ok(entries.length>0&&entries.length<=2000);
 for(const [relative,file] of entries){assert.match(relative,/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?$/);assert.ok(!relative.split('/').some(part=>part==='.'||part==='..'));assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>=0);assert.match(file.sha256,/^[a-f0-9]{64}$/);bytes+=file.bytes;}
 assert.equal(bytes,generation.totalBytes);assert.ok(bytes<=256*1024**2);
 assert.equal(generation.files['schema.prisma'].sha256,generation.generatedSchemaSha256);assert.equal(generation.files[path.posix.basename(engine)].sha256,expected.linuxEngineSha256);
 for(const name of ['schema.prisma','index.js','package.json','runtime/library.js','runtime/library.d.ts'])assert.ok(generation.files[name]);
 for(const key of ['rawBytes','compressedBytes'])assert.ok(Number.isSafeInteger(controller.archive[key])&&controller.archive[key]>0);
 assert.ok(controller.archive.rawBytes<=260*1024**2&&controller.archive.compressedBytes<=64*1024**2);
 for(const key of ['rawSha256','compressedSha256'])assert.match(controller.archive[key],/^[a-f0-9]{64}$/);
 return {generation,transformed};
}

export function readPrivateLinuxPrismaGeneration({repositoryRoot,extractionReceiptFile,captureExternalSource}){
 assert.equal(typeof captureExternalSource,'function');
 const selected=JSON.parse(captureExternalSource(path.resolve(extractionReceiptFile)));
 if(selected.format==='sabalan-private-local-linux-prisma-extraction/v1')return readCurrentLocalLinuxPrismaGeneration({repositoryRoot,extractionReceiptFile,captureExternalSource});
 const expected=privateLinuxPrismaIdentity;
 const root=path.resolve('D:/sabalanerp-online-qa',expected.operation),output=path.join(root,'client');
 const read=file=>captureExternalSource(path.resolve(file));
 const extractionBytes=read(extractionReceiptFile),extraction=JSON.parse(extractionBytes);
 assert.equal(extraction.format,'sabalan-private-linux-prisma-local-extraction/v1');assert.equal(extraction.operation,expected.operation);
 assert.equal(path.resolve(extraction.root),root);assert.equal(path.resolve(extraction.client),output);assert.equal(fs.realpathSync(output),output);
 for(const key of ['generationOnly','pass'])assert.equal(extraction[key],true);
 for(const key of ['databaseConnected','runtimeStarted','productionAdmission'])assert.equal(extraction[key],false);
 assert.equal(extraction.originalSSHExitCode,0);assert.equal(extraction.remoteEnvelopeSha256,expected.remoteEnvelopeSha256);
 const rawReceiptFile=path.join(path.resolve(repositoryRoot),'reports/qa',expected.operation+'.json');
 assert.deepEqual(stableBackendBaseFile(rawReceiptFile),extraction.rawReceiptFile);
 const rawBytes=read(rawReceiptFile),raw=JSON.parse(rawBytes);assert.equal(raw.sshExitCode,0);assert.equal(raw.remoteEnvelopeSha256,expected.remoteEnvelopeSha256);
 const envelope=path.resolve('D:/sabalanerp-online-qa',expected.operation+'-remote.py');assert.equal(sha(read(envelope)),expected.remoteEnvelopeSha256);
 const source=fs.readFileSync(path.join(repositoryRoot,'backend/prisma/schema.prisma'));
 const controller=JSON.parse(raw.stdout),{generation,transformed}=assertPrivateLinuxPrismaController(controller,source);
 for(const [kind,filename,byteKey,shaKey]of [['compressed','client.tar.gz','compressedBytes','compressedSha256'],['raw','client.tar','rawBytes','rawSha256']]){
  const archive=extraction.archives[kind];assert.equal(path.resolve(archive.path),path.join(root,filename));
  const {path:ignored,...pinned}=archive;assert.deepEqual(stableBackendBaseFile(archive.path),pinned);
  assert.equal(pinned.bytes,controller.archive[byteKey]);assert.equal(pinned.sha256,controller.archive[shaKey]);
  const bytes=read(archive.path);assert.equal(bytes.length,pinned.bytes);assert.equal(sha(bytes),pinned.sha256);
 }
 // The raw original SSH stdout still owns the original archive bytes; its
 // immutable compressed digest must agree with the separate extraction chain.
 assert.equal(typeof controller.archiveBase64,'string');assert.ok(controller.archiveBase64.length<=Math.ceil(64*1024**2/3)*4);
 const compressed=Buffer.from(controller.archiveBase64,'base64');assert.equal(compressed.length,controller.archive.compressedBytes);assert.equal(sha(compressed),controller.archive.compressedSha256);
 const actual=[];function visit(folder,prefix=''){
  assert.equal(fs.realpathSync(folder),folder);for(const name of fs.readdirSync(folder).sort()){
   const file=path.join(folder,name),relative=prefix+name,stat=fs.lstatSync(file);assert.ok(!stat.isSymbolicLink());
   if(stat.isDirectory())visit(file,relative+'/');else{
    assert.ok(stat.isFile()&&stat.nlink===1);actual.push(relative);assert.ok(actual.length<=2000);
    const pinned=extraction.outputs[relative],remote=generation.files[relative];assert.ok(pinned&&remote);
    assert.deepEqual(stableBackendBaseFile(file),pinned);assert.equal(pinned.bytes,remote.bytes);assert.equal(pinned.sha256,remote.sha256);
    const bytes=read(file);assert.equal(bytes.length,pinned.bytes);assert.equal(sha(bytes),pinned.sha256);
   }
  }
 }
 visit(output);assert.deepEqual(actual.sort(),Object.keys(extraction.outputs).sort());assert.deepEqual(actual.sort(),Object.keys(generation.files).sort());
 const generatedSchema=read(path.join(output,'schema.prisma'));
 assert.deepEqual(schemaTokens(generatedSchema.toString('utf8')),schemaTokens(transformed.toString('utf8')));
 assert.equal(schemaTokenDigest(generatedSchema.toString('utf8')),generation.generatedSchemaTokensSha256);
 return {root,output,generation,controller,transformed,remoteEnvelopeSha256:expected.remoteEnvelopeSha256,receiptSha256:sha(rawBytes),extractionReceiptSha256:sha(extractionBytes)};
}
