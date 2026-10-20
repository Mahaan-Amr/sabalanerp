import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {assertPrivateLinuxPrismaController,privateLinuxPrismaIdentity as identity} from '../../scripts/lib/private-linux-prisma-receipt.mjs';
import {backendBaseIdentity} from '../../scripts/lib/production-backend-base-artifacts.mjs';
import {schemaTokenDigest} from '../../scripts/lib/prisma-schema-tokens.mjs';
// Historical548 metadata fixtures intentionally remain independent of today's merged schema.
const source=Buffer.from('generator client {\n  provider      = \"prisma-client-js\"\n  binaryTargets = [\"native\", \"debian-openssl-3.0.x\"]\n}\n'+Array.from({length:548},(_,i)=>'model Historical'+i+' { id String @id }\n').join('')),sha=b=>createHash('sha256').update(b).digest('hex');
// Pure synthetic controller metadata only. No files are extracted, generated
// clients executed, containers started, or official provenance receipts minted.
function fixture(){
 const operation=identity.operation,suffix=operation.slice('private-linux-prisma-generation-'.length),root='/root/sabalan-recovery-private/native-qa/'+operation;
 const image=backendBaseIdentity.configIdentity,id='a'.repeat(64),name='sabalan-prisma-codegen-'+suffix,layers=Array(21).fill('sha256:'+'b'.repeat(64));
 const config={Labels:{'sabalan.codegen.operation':operation},Entrypoint:['node'],Cmd:['/qa-input/generate.cjs'],WorkingDir:'/qa-generation',User:'0:0'};
 const host={NetworkMode:'none',ReadonlyRootfs:true,Memory:1536*1024**2,MemorySwap:1536*1024**2,NanoCpus:1e9,PidsLimit:128,PortBindings:{},CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],OomKillDisable:false};
 const mounts=[{Type:'bind',Source:root+'/inputs',Destination:'/qa-input',RW:false},{Type:'bind',Source:root+'/output',Destination:'/qa-generation',RW:true}];
 const created={Id:id,Image:image,Config:config,HostConfig:host,Mounts:mounts,State:{Status:'created'}};
 const closed={...created,State:{Status:'exited',ExitCode:0,Pid:0,OOMKilled:false,Running:false}};
 let pid=100;const command=(args,stdout='')=>({args,stdout,stderr:'',originalPid:pid++,code:0});
 const commands=[command(['image','inspect',image],JSON.stringify([{Id:image,RootFS:{Layers:layers},Config:{}}])),
  command(['ps','-aq','--filter','name=^/'+name+'$']),
  command(['create','--name',name,'--label','com.docker.compose.project=sabalanerp-backup-codegen','--label','sabalan.codegen.operation='+operation,
   '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','1','--memory','1536m','--memory-swap','1536m',
   '--pids-limit','128','--log-opt','max-size=2m','--log-opt','max-file=2','--init','--user','0:0','--workdir','/qa-generation',
   '--mount','type=bind,src='+root+'/inputs,dst=/qa-input,readonly','--mount','type=bind,src='+root+'/output,dst=/qa-generation',
   '--tmpfs','/tmp:uid=0,gid=0,mode=0700,size=64m,noexec,nosuid','--entrypoint','node',image,'/qa-input/generate.cjs'],id),
  command(['inspect',id],JSON.stringify([created])),command(['start','--attach',id]),command(['inspect',id],JSON.stringify([closed])),
  command(['inspect',id],JSON.stringify([closed])),command(['rm',id]),command(['ps','-aq','--no-trunc','--filter','label=sabalan.codegen.operation='+operation])];
 const generator='/app/node_modules/@prisma/client/generator-build/index.js',engine='/app/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node';
 const block=/^generator client \{[\s\S]*?^\}/m;
 const transformed=Buffer.from(source.toString().replace(block,'generator client {\n  provider = "node '+generator+'"\n  binaryTargets = ["debian-openssl-3.0.x"]\n  output = "/qa-generation/client"\n}'));
 const files=Object.fromEntries(['schema.prisma','index.js','package.json','runtime/library.js','runtime/library.d.ts','libquery_engine-debian-openssl-3.0.x.so.node'].map(name=>[name,{bytes:1,sha256:name==='schema.prisma'?sha(transformed):name.endsWith('.node')?identity.linuxEngineSha256:'c'.repeat(64)}]));
 const toolchain={node:backendBaseIdentity.node,cliVersion:'5.22.0',clientVersion:'5.22.0',files:Object.fromEntries(['/app/node_modules/prisma/build/index.js',generator,engine,'/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x'].map(name=>[name,{bytes:1,sha256:name===engine?identity.linuxEngineSha256:'c'.repeat(64)}]))};
 return {format:'sabalan-private-linux-prisma-generation-controller/v1',operation,pass:true,generationOnly:true,databaseConnected:false,runtimeStarted:false,productionAdmission:false,
  interrupted:[],ownContainerRemoved:true,allOriginalChildrenClosed:true,sourceSchemaSha256:sha(source),helperSha256:identity.helperSha256,image,imageLayers:layers,containerId:id,root,originalCommands:commands,
  containerClosure:{exitCode:0,pid:0,oomKilled:false,originalAttachCode:0,originalAttachPid:commands[4].originalPid},
  generation:{format:'sabalan-private-linux-prisma-code-generation/v1',operation,sourceSchemaSha256:sha(source),generatorOnlyTransform:true,output:'/qa-generation/client',
   databaseConnected:false,runtimeStarted:false,sharedClientModified:false,productionAdmission:false,generation:{code:0,signal:null},version:{client:'5.22.0',engine:'605197351a3c8bdd595af2d2a9bc3025bca48ea2'},
   toolchain,transformedSchemaSha256:sha(transformed),generatedSchemaSha256:sha(transformed),transformedSchemaTokensSha256:schemaTokenDigest(transformed.toString()),generatedSchemaTokensSha256:schemaTokenDigest(transformed.toString()),models:548,dmmfSha256:'d'.repeat(64),files,totalBytes:6},
  archive:{rawBytes:10240,compressedBytes:1000,rawSha256:'e'.repeat(64),compressedSha256:'f'.repeat(64)}};
}
test('Linux metadata cannot substitute a running/OOM/unremoved container for normal original closure',()=>{
 assert.equal(assertPrivateLinuxPrismaController(fixture(),source).generation.models,548);
 for(const change of [c=>{c.containerClosure.pid=321;},c=>{c.containerClosure.oomKilled=true;},c=>{c.ownContainerRemoved=false;},c=>{c.allOriginalChildrenClosed=false;},c=>{c.originalCommands[4].code=1;}]){
  const c=fixture();change(c);assert.throws(()=>assertPrivateLinuxPrismaController(c,source));
 }
});
test('Linux pure generation requires exact no-network readonly owned topology and known source image',()=>{
 const normalized=fixture();for(const index of [5,6]){const rows=JSON.parse(normalized.originalCommands[index].stdout);rows[0].HostConfig.OomKillDisable=null;normalized.originalCommands[index].stdout=JSON.stringify(rows);}assert.equal(assertPrivateLinuxPrismaController(normalized,source).generation.models,548);
 for(const change of [c=>{c.originalCommands[2].args[c.originalCommands[2].args.indexOf('--network')+1]='bridge';},c=>{c.image='sha256:'+'0'.repeat(64);},
  c=>{const rows=JSON.parse(c.originalCommands[3].stdout);rows[0].Mounts[0].RW=true;c.originalCommands[3].stdout=JSON.stringify(rows);},
  c=>{const rows=JSON.parse(c.originalCommands[5].stdout);rows[0].HostConfig.OomKillDisable=true;c.originalCommands[5].stdout=JSON.stringify(rows);}]){
  const c=fixture();change(c);assert.throws(()=>assertPrivateLinuxPrismaController(c,source));
 }
});
test('Linux metadata refuses stale schema, different helper/engine, and unsafe output names',()=>{
 assert.throws(()=>assertPrivateLinuxPrismaController(fixture(),Buffer.concat([source,Buffer.from('\nmodel Extra { id String @id }')])));
 for(const change of [c=>{c.helperSha256='0'.repeat(64);},c=>{c.generation.files['schema.prisma'].sha256='0'.repeat(64);},
  c=>{c.generation.toolchain.files['/app/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node'].sha256='0'.repeat(64);},
  c=>{c.generation.files['../escape.js']={bytes:1,sha256:'a'.repeat(64)};c.generation.totalBytes++;}]){
  const c=fixture();change(c);assert.throws(()=>assertPrivateLinuxPrismaController(c,source));
 }
});
