/** Concrete fixed Docker primitives for the SAME Compose postgres service.
 * Returned commands grant no qualification; root native binding remains required. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';import{spawn}from'node:child_process';
import{assertOriginalPrivateEvidenceDirectory}from'file:///C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp/scripts/lib/original-private-evidence-directory.mjs';
const ROOT='C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp';
const DOCKER='C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe',PIN='f71e5a9fe6a8db10c7296ad6fdf0c1d7d79634e644d7ec1e8a2c18d7dcb52d21';
const commands=new WeakSet();
const command=(phase,argv)=>{const x=Object.freeze({phase,argv:Object.freeze(argv)});commands.add(x);return x;};
export function compileNativePrimitives(plan,{originalPostgresId,overrideFile}){
 assert.equal(plan.project,'sabalanerp-local');assert.equal(plan.service,'postgres');assert.match(originalPostgresId,/^[a-f0-9]{64}$/);
 assert.equal(path.resolve(overrideFile),overrideFile);assert.equal(path.basename(overrideFile),'serial-postgres-override.json');
 const base=['compose','--project-name','sabalanerp-local','-f',ROOT+'/docker-compose.local.yml'];
 const ordinary=[...base,'up','-d','--no-deps','--no-build','--pull','never','postgres'];
 return Object.freeze({
  census:command('CENSUS',[...base,'ps','--all','--format','json']),
  originalShutdown:command('ORIGINAL_SMART_SHUTDOWN',['exec','--user','70:70',originalPostgresId,'/usr/local/bin/pg_ctl','-D','/var/lib/postgresql/data','-m','smart','-w','stop']),
  activateWrapper:command('SAME_SERVICE_IDLE_WRAPPER',[...base,'-f',overrideFile,'up','-d','--no-deps','--no-build','--pull','never','postgres']),
  restoreOriginal:command('RESTORE_ORIGINAL_SERVICE',ordinary),
  forActualWrapper(wrapperId){
   assert.match(wrapperId,/^[a-f0-9]{64}$/);assert.notEqual(wrapperId,originalPostgresId);
   const exec=['exec','--user','0:0',wrapperId,'/bin/sh'];
   const request=name=>command('REQUEST_'+name.toUpperCase(),[...exec,'-ec','set -eu; umask 077; root="$1"; name="$2"; test "$(readlink -f "$root")" = "$root"; test "$(stat -c %u:%g:%a "$root")" = 0:70:710; test ! -e "$root/$name"; test ! -L "$root/$name"; (set -C; printf "1\\n" > "$root/$name"); sync','serial-owned-request',plan.root,name]);
   return Object.freeze({inventoryInitial:command('ORIGINAL_FROZEN_INITIAL',[...exec,plan.root+'/inventory-original.sh','initial']),inventoryFinal:command('ORIGINAL_FROZEN_FINAL',[...exec,plan.root+'/inventory-original.sh','final']),requestReplay:request('request-replay'),requestStopReplay:request('request-stop-replay'),requestRelease:request('request-release-wrapper')});
  }
 });
}
function tool(){
 const file=path.resolve(DOCKER);assert.equal(fs.realpathSync(file),file);const a=fs.lstatSync(file,{bigint:true});assert.ok(a.isFile()&&!a.isSymbolicLink()&&a.nlink===1n);
 const fd=fs.openSync(file,fs.constants.O_RDONLY),h=createHash('sha256'),chunk=Buffer.alloc(524288);try{const held=fs.fstatSync(fd,{bigint:true});for(const k of['ino','size','mode','nlink','mtimeNs'])assert.equal(a[k],held[k]);let bytes=0;for(;;){const n=fs.readSync(fd,chunk,0,chunk.length,null);if(!n)break;bytes+=n;h.update(chunk.subarray(0,n));}assert.equal(BigInt(bytes),held.size);for(const k of['dev','ino','size','mode','nlink','mtimeNs','ctimeNs']){assert.equal(fs.fstatSync(fd,{bigint:true})[k],held[k]);assert.equal(fs.lstatSync(file,{bigint:true})[k],a[k]);}assert.equal(h.digest('hex'),PIN);}finally{fs.closeSync(fd);}
 return file;
}
/** Only commands privately branded by the fixed compiler are executable.
 * beforeDocker is the later fixed full-census/config binding, NOT a caller
 * boolean. Raw output is private from its first write; actual handle is retained. */
export async function retainSerialNativePrimitive(c,{custody,directory,ordinal,beforeDocker}){
 assert.ok(commands.has(c));assert.ok(Number.isSafeInteger(ordinal)&&ordinal>=0&&ordinal<128);assertOriginalPrivateEvidenceDirectory(custody,directory);
 await beforeDocker(c);const executable=tool();const prefix=path.join(directory,String(ordinal).padStart(3,'0')+'-'+c.phase);
 const outFd=fs.openSync(prefix+'.stdout.raw','wx',0o600),errFd=fs.openSync(prefix+'.stderr.raw','wx',0o600);
 let fault=false;const bad=()=>{fault=true;};process.on('SIGINT',bad);process.on('SIGTERM',bad);
 let child,closed,stdout=[],stderr=[],n=0,m=0;const outHash=createHash('sha256'),errHash=createHash('sha256');
 const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
 const persist=async(fd,bytes)=>{let offset=0;while(offset<bytes.length){try{const written=fs.writeSync(fd,bytes,offset,bytes.length-offset,null);if(written<=0)throw Error('WRITE_REFUSED');offset+=written;}catch{bad();await pause();}}for(;;){try{fs.fsyncSync(fd);break;}catch{bad();await pause();}}for(;;){try{fs.closeSync(fd);break;}catch{bad();await pause();}}};
 try{
  child=spawn(executable,c.argv,{cwd:ROOT,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const done=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  const drain=(stream,list,h,max,count)=>{stream.on('error',bad);stream.on('data',b=>{h.update(b);const size=count(b.length);if(size<=max)list.push(b);else bad();});};
  try{child.on('error',bad);drain(child.stdout,stdout,outHash,8388608,x=>n+=x);drain(child.stderr,stderr,errHash,8388608,x=>m+=x);}catch{bad();for(const stream of[child.stdout,child.stderr]){try{stream.on('error',bad);stream.resume();}catch{bad();}}}
  closed=await done;
 }finally{
  // No setup/finalization failure releases an existing original. close is the
  // SAME handle observation, not PID disappearance or adoption.
  if(child&&!closed){closed=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));bad();}
  await persist(outFd,Buffer.concat(stdout));await persist(errFd,Buffer.concat(stderr));
  process.removeListener('SIGINT',bad);process.removeListener('SIGTERM',bad);
 }
 const row={phase:c.phase,argv:[...c.argv],originalPid:child?.pid??null,code:closed?.code??null,signal:closed?.signal??null,stdoutEof:true,stderrEof:true,stdoutBytes:n,stderrBytes:m,stdoutSha256:outHash.digest('hex'),stderrSha256:errHash.digest('hex'),observationFault:fault,stdoutFile:prefix+'.stdout.raw',stderrFile:prefix+'.stderr.raw'};
 assert.ok(row.originalPid>1&&row.code===0&&row.signal===null&&!row.observationFault,'SERIAL_NATIVE_ORIGINAL_FAILED');return Object.freeze(row);
}
