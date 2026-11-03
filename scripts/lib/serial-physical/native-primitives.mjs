/** Fixed same-service commands. Invocation requires the coordinator's live
 * lease/census callback and private evidence custody; plans grant no admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {assertOriginalPrivateEvidenceDirectory} from '../original-private-evidence-directory.mjs';
import {retainSerialChild} from './retained-child.mjs';
import {assertSerialExistingPostgresPlan} from './serial-owner.mjs';
const commands=new WeakSet();
const configurations=new WeakMap();
const command=(phase,argv,configuration=null)=>{const c=Object.freeze({phase,argv:Object.freeze(argv)});commands.add(c);if(configuration)configurations.set(c,configuration);return c;};
const id=value=>assert.match(value,/^[a-f0-9]{64}$/);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
export function renderSerialSources(plan) {
 assertSerialExistingPostgresPlan(plan);
 assert.match(plan.operation,/^[a-f0-9]{32}$/);
 assert.equal(plan.root,'/var/lib/postgresql/data/serial-physical-'+plan.operation);
 return Object.fromEntries(['serial-wrapper.sh','inventory-original.sh'].map(name=>{
  const raw=fs.readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n').replaceAll('OPERATION',plan.operation);
  return [name,Object.freeze({raw,sha256:sha(raw)})];
 }));
}
export function compileNativePrimitives(plan,{originalPostgresId,overrideFile,restoreFile}) {
 assertSerialExistingPostgresPlan(plan);
 assert.equal(plan.project,'sabalanerp-local');assert.equal(plan.service,'postgres');id(originalPostgresId);
 for(const [file,name] of [[overrideFile,'serial-postgres-override.json'],[restoreFile,'serial-postgres-original.json']]){
  assert.equal(path.resolve(file),file);assert.equal(path.basename(file),name);
 }
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const base=['compose','--project-name','sabalanerp-local','-f',path.join(root,'docker-compose.local.yml')];
 const up=file=>[...base,'-f',file,'up','-d','--no-deps','--no-build','--pull','never','postgres'];
 const materialFor=containerId=>{
  const exec=['exec','--user','0:0',containerId,'/bin/sh'];
  const project=value=>value.replaceAll('/var/lib/postgresql/data',plan.root+'/data').replaceAll('/wal',plan.root+'/wal');
  return Object.freeze({
   toolsAndCapacity:command('TOOLS_CAPACITY',[...exec,'-ec',
    'set -eu; export LC_ALL=C; for tool in postgres pg_verifybackup pg_waldump pg_controldata; do printf "TOOL\\t%s\\t" "$tool"; "$tool" --version; done; printf "PG_VERSION\\t"; cat "$1/data/PG_VERSION"; printf "CAPACITY\\t"; df -Pk "$1" | tail -n 1; printf "CONTROL\\n"; pg_controldata "$1/data"','serial-tool-observation',plan.root]),
   verifyBackup:command('VERIFY_BACKUP',['exec','--user','70:70',containerId,...plan.canonicalReplay.verifyBackup.map(project)]),
   verifyWal:command('VERIFY_WAL',['exec','--user','70:70',containerId,...plan.canonicalReplay.verifyWal.map(project)])
  });
 };
 return Object.freeze({
  census:command('CENSUS',[...base,'ps','--all','--format','json']),
  inspectOriginal:command('INSPECT_ORIGINAL',['inspect',originalPostgresId]),
  originalShutdown:command('ORIGINAL_SMART_SHUTDOWN',['exec','--user','70:70',originalPostgresId,'/usr/local/bin/pg_ctl','-D','/var/lib/postgresql/data','-m','smart','-w','stop']),
  activateWrapper:command('SAME_SERVICE_IDLE_WRAPPER',up(overrideFile),{file:overrideFile,value:plan.override}),
  restoreOriginal:command('RESTORE_ORIGINAL_SERVICE',up(restoreFile),{file:restoreFile,value:{services:{postgres:{image:plan.originalImage}}}}),
  stagedMaterial:materialFor(originalPostgresId),
  forActualWrapper(wrapperId){
   id(wrapperId);assert.notEqual(wrapperId,originalPostgresId);
   const exec=['exec','--user','0:0',wrapperId,'/bin/sh'];
   const request=name=>command('REQUEST_'+name.toUpperCase(),[...exec,'-ec',
    'set -eu; umask 077; root="$1"; name="$2"; test "$(readlink -f "$root")" = "$root"; test "$(stat -c %u:%g:%a "$root")" = 0:70:710; test ! -e "$root/$name"; test ! -L "$root/$name"; (set -C; printf "1\\n" > "$root/$name"); sync',
    'serial-owned-request',plan.root,name]);
   return Object.freeze({
    inspect:command('INSPECT_WRAPPER',['inspect',wrapperId]),
    inventoryInitial:command('ORIGINAL_FROZEN_INITIAL',[...exec,plan.root+'/inventory-original.sh','initial']),
    inventoryFinal:command('ORIGINAL_FROZEN_FINAL',[...exec,plan.root+'/inventory-original.sh','final']),
    ...materialFor(wrapperId),
    stopReleasedWrapper:command('STOP_RELEASED_WRAPPER',['stop','--time=-1',wrapperId]),
    requestReplay:request('request-replay'),requestStopReplay:request('request-stop-replay'),requestRelease:request('request-release-wrapper')
   });
  }
 });
}

export function validateSerialToolObservation(plan,raw,{requiredFreeBytes}) {
 assertSerialExistingPostgresPlan(plan);
 assert.ok(Number.isSafeInteger(requiredFreeBytes)&&requiredFreeBytes>0);
 const lines=raw.split('\n');const versions=[];
 for(const tool of ['postgres','pg_verifybackup','pg_waldump','pg_controldata']){
  const line=lines.shift();assert.ok(line.startsWith('TOOL\t'+tool+'\t'));
  const match=/\(PostgreSQL\) (15\.[0-9]+)(?:\s.*)?$/.exec(line);assert.ok(match);versions.push(match[1]);
 }
 assert.equal(new Set(versions).size,1);assert.equal(lines.shift(),'PG_VERSION\t15');
 const disk=lines.shift();assert.ok(disk.startsWith('CAPACITY\t'));
 const fields=disk.slice(9).trim().split(/\s+/);assert.ok(fields.length>=6);
 assert.match(fields[3],/^[0-9]+$/);const freeBytes=Number(fields[3])*1024;
 assert.ok(Number.isSafeInteger(freeBytes)&&freeBytes>=requiredFreeBytes,'SERIAL_ACTUAL_CAPACITY_REFUSED');
 assert.equal(lines.shift(),'CONTROL');assert.equal(sha(lines.join('\n')),plan.canonicalReplay.controlDataSha256);
 return Object.freeze({postgresVersion:versions[0],freeBytes,requiredFreeBytes,physicalReplayQualified:false});
}

function pinnedExecutable(file,expected) {
 assert.equal(path.resolve(file),file);assert.match(expected,/^[a-f0-9]{64}$/);
 assert.equal(fs.realpathSync(file),file);
 const fd=fs.openSync(file,'r'),before=fs.fstatSync(fd,{bigint:true});
 try {
  assert.ok(before.isFile()&&before.nlink===1n&&!fs.lstatSync(file).isSymbolicLink());
  const h=createHash('sha256'),buffer=Buffer.alloc(524288);
  for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;h.update(buffer.subarray(0,n));}
  for(const k of ['dev','ino','size','mode','nlink','mtimeNs','ctimeNs']){
   assert.equal(fs.fstatSync(fd,{bigint:true})[k],before[k]);assert.equal(fs.lstatSync(file,{bigint:true})[k],before[k]);
  }
  assert.equal(h.digest('hex'),expected);
 } finally {fs.closeSync(fd);}
 return file;
}
export async function retainSerialNativePrimitive(c,{custody,directory,ordinal,beforeDocker,executable,executableSha256}) {
 assert.ok(commands.has(c),'FIXED_SERIAL_COMMAND_REQUIRED');
 assert.ok(Number.isSafeInteger(ordinal)&&ordinal>=0&&ordinal<128);
 assertOriginalPrivateEvidenceDirectory(custody,directory);
 // Must freshly verify the existing Compose project, full identities and live
 // exclusive resource lease before EVERY Docker action, including observers.
 await beforeDocker(c);
 const configuration=configurations.get(c);
 if(configuration){
  assert.equal(path.dirname(configuration.file),directory);
  const stat=fs.lstatSync(configuration.file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);
  assert.deepEqual(JSON.parse(fs.readFileSync(configuration.file,'utf8')),configuration.value);
 }
 assert.equal(executable,path.resolve('C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'));
 assert.equal(executableSha256,'f71e5a9fe6a8db10c7296ad6fdf0c1d7d79634e644d7ec1e8a2c18d7dcb52d21');
 pinnedExecutable(executable,executableSha256);
 const prefix=path.join(directory,String(ordinal).padStart(3,'0')+'-'+c.phase);
 const fds=[];let sinks;
 try {
  sinks=Object.fromEntries(['stdout','stderr'].map(name=>{
   const fd=fs.openSync(prefix+'.'+name+'.raw','wx',0o600);fds.push(fd);
   return [name,{write:bytes=>fs.writeSync(fd,bytes),sync:()=>fs.fsyncSync(fd),close:()=>fs.closeSync(fd)}];
  }));
 } catch(error) {for(const fd of fds)fs.closeSync(fd);throw error;}
 const receiptFile=prefix+'.receipt.json';
 // Reserve before spawning. After a write/finalization fault, the SAME file is
 // retried while ownership remains held. No second original is created.
 let receiptFd;
 try {receiptFd=fs.openSync(receiptFile,'wx',0o600);} catch(error){for(const fd of fds)fs.closeSync(fd);throw error;}
 const persistReceipt=row=>{
  const raw=Buffer.from(JSON.stringify({...row,stdoutFile:prefix+'.stdout.raw',stderrFile:prefix+'.stderr.raw'})+'\n');
  fs.ftruncateSync(receiptFd,0);let offset=0;
  while(offset<raw.length){const n=fs.writeSync(receiptFd,raw,offset,raw.length-offset,offset);assert.ok(n>0);offset+=n;}
  fs.fsyncSync(receiptFd);
 };
 const child=spawn(executable,c.argv,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
 const row=await retainSerialChild(child,{phase:c.phase,sinks,persistReceipt,finalizeReceipt:()=>fs.closeSync(receiptFd)});
 return Object.freeze({...row,stdoutFile:prefix+'.stdout.raw',stderrFile:prefix+'.stderr.raw'});
}
