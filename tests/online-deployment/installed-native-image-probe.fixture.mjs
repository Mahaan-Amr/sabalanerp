/** Read-only installed bytes/export/tool probe; never calls an application entry. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fileDigest(file){
 assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n);const buffer=Buffer.alloc(262144),hash=createHash('sha256');let bytes=0;
  for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;hash.update(buffer.subarray(0,count));bytes+=count;}
  const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','nlink']){assert.equal(before[key],after[key]);assert.equal(before[key],named[key]);}
  assert.equal(bytes,Number(before.size));return{bytes,sha256:hash.digest('hex')};
 }finally{fs.closeSync(fd);}
}
function inventory(root){
 assert.equal(fs.realpathSync(root),root);const entries=[];
 const walk=folder=>{const own=fs.lstatSync(folder);assert.ok(own.isDirectory()&&!own.isSymbolicLink());
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){assert.ok(!entry.isSymbolicLink());const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file);else{assert.ok(entry.isFile());entries.push({bytes:0,path:path.relative(root,file).split(path.sep).join('/'),sha256:'',...fileDigest(file)});}}
 };walk(root);entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const canonical=entries.map(entry=>({bytes:entry.bytes,path:entry.path,sha256:entry.sha256}));
 return{relativeTo:root,algorithm:'sha256-json-array-bytes-path-sha256-codepoint-noLF/v1',sha256:sha(JSON.stringify(canonical)),files:entries.length,bytes:entries.reduce((sum,row)=>sum+row.bytes,0),entries:canonical};
}
const dist=inventory('/app/dist'),client=inventory('/app/node_modules/@prisma/client');
const installed=createRequire('/app/package.json'),entry='/app/dist/onlinePrivateQualification.js';
assert.equal(typeof installed(entry).mainPrivateQualificationRuntime,'function');
const generated=installed('@prisma/client');assert.equal(generated.Prisma.prismaVersion.client,'5.22.0');
const schemaModels=[...fs.readFileSync('/app/prisma/schema.prisma','utf8').matchAll(/^model\s+(\w+)\s*\{/gm)].map(match=>match[1]).sort();
const generatedModels=generated.Prisma.dmmf.datamodel.models.map(model=>model.name).sort();
assert.ok(schemaModels.length>0);assert.deepEqual(generatedModels,schemaModels);
const tools={};for(const [name,program,args]of [['python','/usr/bin/python3',['--version']],['psql','/usr/bin/psql',['--version']],['chromium','/usr/bin/chromium',['--version']]]){
 const actual=spawnSync(program,args,{stdin:'ignore',stdio:['ignore','pipe','pipe'],maxBuffer:65536,encoding:'utf8'});assert.equal(actual.error,undefined);assert.equal(actual.status,0);assert.equal(actual.signal,null);tools[name]={originalPid:actual.pid,code:actual.status,signal:actual.signal,version:(actual.stdout+actual.stderr).trim()};
}
process.stdout.write(JSON.stringify({format:'sabalan-actual-installed-native-image/v1',entryPath:entry,entrySha256:fileDigest(entry).sha256,
 schemaSha256:fileDigest('/app/prisma/schema.prisma').sha256,dist,client,models:schemaModels.length,tools,entryExportPresent:true,
 applicationStarted:false,databaseConnected:false,productionAdmission:false})+'\n');
