import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BrowserRoutingPublicationLock} from './browser-routing-store.mjs';
import {readOriginalSocketStoppedEvidence} from './socket-release-proxy.mjs';

const channels=new WeakMap(),certificates=new WeakMap();
const fail=()=>{throw new Error('READONLY_TRANSPORT_ORIGINAL_CHANNEL_UNPROVEN');};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const encode=value=>Buffer.from(JSON.stringify(canonical(value))+'\n');
const same=(a,b)=>encode(a).equals(encode(b));
const hash=/^[a-f0-9]{64}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function birth(pid){
  const text=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),fields=text.slice(text.lastIndexOf(') ')+2).trim().split(/\s+/);
  if(fields[0]==='Z')fail();
  return {pid,startTicks:fields[19],bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),
    pidNamespace:fs.readlinkSync(`/proc/${pid}/ns/pid`)};
}
function access(file){
  const info=fs.readFileSync(file,'utf8'),flags=/^flags:\s+([0-7]+)$/m.exec(info);
  if(!flags)fail();return parseInt(flags[1],8)&3;
}
function sourceDigest(file){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
    const before=fs.fstatSync(fd,{bigint:true});if(!before.isFile()||before.nlink!==1n||before.size>64n*1024n*1024n)fail();
    const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let total=0n,count;
    while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0){total+=BigInt(count);if(total>before.size)fail();digest.update(buffer.subarray(0,count));}
    if(total!==before.size)fail();
    for(const current of [fs.fstatSync(fd,{bigint:true}),fs.lstatSync(file,{bigint:true})])
      for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink'])if(current[key]!==before[key])fail();
    return digest.digest('hex');
  }finally{fs.closeSync(fd);}
}
function assertCustody(state){
  const {enrollment:e,fd}=state;
  if(process.ppid!==e.controller.pid||!same(birth(process.ppid),e.controller))fail();
  const own=fs.fstatSync(fd,{bigint:true});
  if(!own.isFIFO()||String(own.dev)!==e.pipe.device||String(own.ino)!==e.pipe.inode
    ||own.uid!==BigInt(process.getuid())||access(`/proc/self/fdinfo/${fd}`)!==0)fail();
  const parentAliases=[];
  for(const name of fs.readdirSync(`/proc/${process.ppid}/fd`)){
    let stat;try{stat=fs.statSync(`/proc/${process.ppid}/fd/${name}`,{bigint:true});}
    catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(stat.dev===own.dev&&stat.ino===own.ino)parentAliases.push(Number(name));
  }
  if(parentAliases.length!==1||parentAliases[0]!==e.pipe.writerDescriptor
    ||access(`/proc/${process.ppid}/fdinfo/${e.pipe.writerDescriptor}`)!==1)fail();
  // A second local alias, including a writer, cannot be a reader capability.
  const localAliases=[];
  for(const name of fs.readdirSync('/proc/self/fd')){
    let stat;try{stat=fs.statSync(`/proc/self/fd/${name}`,{bigint:true});}
    catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(stat.dev===own.dev&&stat.ino===own.ino)localAliases.push(Number(name));
  }
  if(localAliases.length!==1||localAliases[0]!==fd)fail();
  state.lock.assertOwned();
  const parentLock=fs.statSync(`/proc/${process.ppid}/fd/20`,{bigint:true});
  if(String(parentLock.dev)!==e.publicationLock.device||String(parentLock.ino)!==e.publicationLock.inode
    ||!fs.readFileSync(`/proc/${process.ppid}/fdinfo/20`,'utf8').match(new RegExp(
      `FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+\\S+:${e.publicationLock.inode}\\s+0\\s+EOF`)))fail();
  for(const [name,digest]of Object.entries(e.sources)){
    if(path.basename(name)!==name||!hash.test(digest)
      ||sourceDigest(path.join(e.helperDirectory,name))!==digest)fail();
  }
}
const MAXIMUM_TRANSPORT_RECORD_BYTES=8*1024*1024;
async function frame(state,maximum=MAXIMUM_TRANSPORT_RECORD_BYTES){
  const chunks=[];let length=0,chunk=state.buffer;state.buffer=Buffer.alloc(0);
  for(;;){
    const end=chunk.indexOf(10);
    if(end>=0){
      if(length+end+1>maximum)fail();chunks.push(chunk.subarray(0,end+1));
      state.buffer=chunk.subarray(end+1);const raw=Buffer.concat(chunks,length+end+1);
      let value;try{value=JSON.parse(raw.toString('utf8'));}catch{fail();}
      if(!encode(value).equals(raw))fail();return {value,raw};
    }
    if(chunk.length){length+=chunk.length;if(length>=maximum)fail();chunks.push(chunk);}
    const buffer=Buffer.alloc(Math.min(65536,maximum-length));
    const count=await new Promise((resolve,reject)=>fs.read(state.fd,buffer,0,buffer.length,null,(error,bytes)=>
      error?.code==='EAGAIN'?resolve(-1):error?reject(error):resolve(bytes)));
    if(count===-1){await new Promise(resolve=>setTimeout(resolve,20));chunk=Buffer.alloc(0);continue;}
    if(!count)fail();chunk=buffer.subarray(0,count);
  }
}
/** Original parent's one-way Linux pipe and inherited native publication lock.
 * No constructor, path-loaded receipt, verifier callback or signing switch can
 * mint this capability. It admits no production work or operation completion. */
export async function openInheritedReadonlyTransportRetirementChannel(){
  if(process.platform!=='linux'||!/^([3-9][0-9]|[1-9][0-9]{2,3})$/.test(process.env.SABALAN_READONLY_RETIREMENT_FD||''))fail();
  const fd=Number(process.env.SABALAN_READONLY_RETIREMENT_FD);
  if(fd<30||fd>4096||access(`/proc/self/fdinfo/${fd}`)!==0||!fs.fstatSync(fd).isFIFO())fail();
  const state={fd,buffer:Buffer.alloc(0),consumed:false};
  const {value:e}=await frame(state,4096);
  if(!exact(e,['format','enrollmentId','instanceId','controller','helperDirectory','sources','pipe','publicationLock',
    'retirementDirectory','owners','remoteBrowser','productionAdmission','buildOrImageGcEligible'])
    ||e.format!=='sabalan-original-readonly-transport-channel/v1'||!hash.test(e.enrollmentId)||!hash.test(e.instanceId)
    ||e.productionAdmission!==false||e.buildOrImageGcEligible!==false||e.pipe.readerDescriptor!==fd
    ||e.publicationLock.descriptor!==20||!Array.isArray(e.owners)||!e.owners.length||e.owners.length>16)fail();
  if(!exact(e.sources,['readonly-transport-retirement.py','online-runtime-owner.py','backend-runtime-owner.py',
    'online-runtime-scope.py','online-backend-boundary.py','online-capture-admission.py','readonly-socket-protocol.json','application-worker.cjs','application-routing.mjs']))fail();
  for(const owner of e.owners)if(!exact(owner,['runtimeId','scopeSha256','image','manifestSha256','activeClaimSha256','guardian','namespace','database'])
    ||![owner.runtimeId,owner.scopeSha256,owner.manifestSha256,owner.activeClaimSha256].every(value=>hash.test(value))
    ||!/^sha256:[a-f0-9]{64}$/.test(owner.image)||owner.namespace!==`sabalan-rt-${sha(Buffer.from(owner.runtimeId)).slice(0,48)}`)fail();
  state.enrollment=e;state.lock=new BrowserRoutingPublicationLock({file:e.publicationLock.file,descriptor:20,
    identity:{device:e.publicationLock.device,inode:e.publicationLock.inode,ownerUid:e.publicationLock.ownerUid}});
  // Popen closes the parent's reader immediately on returning. Do not confuse
  // the brief exec race with permission to accept a second reader/writer.
  const deadline=Date.now()+1000;
  for(;;){try{assertCustody(state);break;}catch(error){if(Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,5));}}
  const root=fs.lstatSync(e.retirementDirectory);
  if(!root.isDirectory()||fs.realpathSync(e.retirementDirectory)!==e.retirementDirectory
    ||root.uid!==process.getuid()||(root.mode&0o777)!==0o700||fs.readdirSync(e.retirementDirectory).length)fail();
  state.root={device:root.dev,inode:root.ino};
  const capability=Object.freeze({});channels.set(capability,state);return capability;
}
/** Only the original Socket factory's branded stopped-evidence is accepted.
 * Raw UNKNOWN remains immutable. A certificate closes this notification-only
 * transport instance; it never completes requests or makes a build collectible. */
export async function consumeReadonlyTransportRetirement(channel,stoppedEvidence){
  const state=channels.get(channel);if(!state||state.consumed)fail();assertCustody(state);
  const stopped=await readOriginalSocketStoppedEvidence(stoppedEvidence);
  const pending=stopped.pendingEvidence;
  if(!Array.isArray(pending)||!pending.length||pending.length>1024||!hash.test(stopped.socketInstanceId)||stopped.journalInstanceId!==state.enrollment.instanceId
    ||pending.some(value=>value.intent.instanceId!==state.enrollment.instanceId||!['GET','POST'].includes(value.intent.method)))fail();
  const pendingIds=new Set(pending.map(value=>value.intent.id));
  if(pendingIds.size!==pending.length)fail();
  for(const entry of pending){
    const matches=stopped.closedOperations.filter(value=>value.intentId===entry.intent.id);
    if(entry.intent.method==='POST'){
      if(matches.length!==1)fail();const operation=matches[0],control=operation.control;
      if(operation.kind!=='polling'||operation.method!=='POST'||operation.clientSocketClosed!==true
        ||operation.upstreamSocketClosedOrNeverAcquired!==true
        ||!exact(control,['protocol','transport','path','sessionId','sessionIntentId','sessionSource'])
        ||control.protocol!=='EIO4'||control.transport!=='polling'||control.path!=='/socket.io/'
        ||control.sessionSource!=='UPSTREAM_ISSUED'||typeof control.sessionId!=='string'
        ||!stopped.closedSessions.some(value=>value.sid===control.sessionId&&value.intentId===control.sessionIntentId))fail();
    }else if(matches.some(value=>value.method!=='GET'||Object.hasOwn(value,'control')))fail();
  }
  for(const operation of stopped.closedOperations)if(operation.method==='POST'&&!pendingIds.has(operation.intentId))fail();
  const {value:certificate,raw}=await frame(state);assertCustody(state);
  if(!exact(certificate,['format','decision','enrollmentId','instanceId','socketInstanceId','pendingEvidence','originalNativeClosures',
    'productionAdmission','buildOrImageGcEligible','originalOperationOutcome','mutationReconciled'])
    ||certificate.format!=='sabalan-readonly-transport-reconciled/v1'||certificate.decision!=='READONLY_TRANSPORT_RECONCILED'
    ||certificate.enrollmentId!==state.enrollment.enrollmentId||certificate.instanceId!==state.enrollment.instanceId
    ||certificate.socketInstanceId!==stopped.socketInstanceId||!same(certificate.pendingEvidence,pending)
    ||certificate.productionAdmission!==false||certificate.buildOrImageGcEligible!==false
    ||certificate.originalOperationOutcome!=='UNKNOWN'||certificate.mutationReconciled!==false
    ||!Array.isArray(certificate.originalNativeClosures)||certificate.originalNativeClosures.length!==state.enrollment.owners.length)fail();
  for(const owner of state.enrollment.owners){
    const matches=certificate.originalNativeClosures.filter(value=>value.runtimeId===owner.runtimeId);
    if(matches.length!==1)fail();const closure=matches[0];
    if(closure.scopeSha256!==owner.scopeSha256||closure.activeClaimSha256!==owner.activeClaimSha256
      ||!same(closure.guardian,owner.guardian)||closure.originalPopenStatus!==0||closure.namespace!==owner.namespace
      ||!hash.test(closure.nativeClosureSha256)||closure.database.visible!==true||closure.database.sessions!==0
      ||closure.database.prepared!==0||closure.database.system!==owner.database.systemIdentifier
      ||closure.database.oid!==owner.database.oid)fail();
  }
  const current=await readOriginalSocketStoppedEvidence(stoppedEvidence);
  if(!same(current,stopped))fail();
  const root=await fsp.lstat(state.enrollment.retirementDirectory);
  if(!root.isDirectory()||root.dev!==state.root.device||root.ino!==state.root.inode
    ||root.uid!==process.getuid()||(root.mode&0o777)!==0o700
    ||await fsp.realpath(state.enrollment.retirementDirectory)!==state.enrollment.retirementDirectory)fail();
  const file=path.join(state.enrollment.retirementDirectory,'READONLY_TRANSPORT_RECONCILED.json');
  const handle=await fsp.open(file,'wx',0o600);
  try{await handle.writeFile(raw);await handle.sync();
    const original=await handle.stat({bigint:true}),named=await fsp.lstat(file,{bigint:true});
    if(!original.isFile()||original.nlink!==1n||original.uid!==BigInt(process.getuid())||(original.mode&0o777n)!==0o600n
      ||original.size!==BigInt(raw.length))fail();
    for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink'])if(original[key]!==named[key])fail();
  }finally{await handle.close();}
  const directory=await fsp.open(state.enrollment.retirementDirectory,'r');
  try{await directory.sync();}finally{await directory.close();}
  const finalRoot=await fsp.lstat(state.enrollment.retirementDirectory);
  if(finalRoot.dev!==state.root.device||finalRoot.ino!==state.root.inode
    ||await fsp.realpath(state.enrollment.retirementDirectory)!==state.enrollment.retirementDirectory)fail();
  assertCustody(state);if(!same(await readOriginalSocketStoppedEvidence(stoppedEvidence),stopped))fail();
  state.consumed=true;
  const receipt=Object.freeze({});certificates.set(receipt,Object.freeze({decision:certificate.decision,
    instanceId:certificate.instanceId,socketInstanceId:certificate.socketInstanceId,certificateSha256:sha(raw),file,
    originalOperationOutcome:'UNKNOWN',mutationReconciled:false,productionAdmission:false,buildOrImageGcEligible:false}));
  return receipt;
}
export function readReadonlyTransportRetirementCertificate(certificate){
  const facts=certificates.get(certificate);if(!facts)fail();return facts;
}

/** Read-only identity for the diagnostic parent/child stage handshake. */
export function readOriginalReadonlyTransportChannelIdentity(channel){
  const state=channels.get(channel);if(!state||state.consumed)fail();assertCustody(state);
  return Object.freeze({enrollmentId:state.enrollment.enrollmentId,instanceId:state.enrollment.instanceId,
    originalControllerPid:state.enrollment.controller.pid});
}

/** Negative-only original parent control; no file/JSON caller can finish a cut. */
export function readOriginalCaptureAbortControl(channel,readySha256){
  const state=channels.get(channel);if(!state||state.consumed||!hash.test(readySha256))fail();assertCustody(state);
  const bytes=Buffer.alloc(4096);let count;
  try{count=fs.readSync(state.fd,bytes,0,bytes.length,null);}catch(error){if(error.code==='EAGAIN')return null;throw error;}
  if(count<=0)fail();const raw=bytes.subarray(0,count);let value;try{value=JSON.parse(raw);}catch{fail();}
  if(!encode(value).equals(raw)||value.format!=='sabalan-original-browser-capture-abort/v1'||value.decision!=='CAPTURE_ABORT'
    ||value.enrollmentId!==state.enrollment.enrollmentId||value.readySha256!==readySha256
    ||value.operation!==path.basename(state.enrollment.helperDirectory)||value.productionAdmission!==false
    ||value.captureFailure?.originalPass!==false||value.captureFailure.root!==state.enrollment.helperDirectory)fail();
  assertCustody(state);return Object.freeze(value);
}

/** Only the original parent's enrolled extra pipe can deliver browser facts.
 * This does not expose the channel state or accept a caller verifier. */
export async function readOriginalRemoteBrowserEnvelope(channel){
  const state=channels.get(channel);if(!state||state.consumed||state.browserRead)fail();assertCustody(state);
  const pipe=state.enrollment.remoteBrowser;if(!pipe||!hash.test(pipe.sha256)||!hash.test(pipe.publicKeySha256)
    ||!Number.isSafeInteger(pipe.readerDescriptor)||pipe.readerDescriptor<34||pipe.readerDescriptor>4096)fail();
  const fd=pipe.readerDescriptor;
  const check=()=>{
    assertCustody(state);const own=fs.fstatSync(fd,{bigint:true});
    if(!own.isFIFO()||String(own.dev)!==pipe.device||String(own.ino)!==pipe.inode||access(`/proc/self/fdinfo/${fd}`)!==0)fail();
    for(const [pid,expected,mode]of [[process.pid,fd,0],[process.ppid,pipe.writerDescriptor,1]]){
      const aliases=[];
      for(const name of fs.readdirSync(`/proc/${pid}/fd`)){
        let fact;try{fact=fs.statSync(`/proc/${pid}/fd/${name}`,{bigint:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
        if(fact.dev===own.dev&&fact.ino===own.ino)aliases.push(Number(name));
      }
      if(aliases.length!==1||aliases[0]!==expected||access(`/proc/${pid}/fdinfo/${expected}`)!==mode)fail();
    }
  };
  check();const result=await frame({fd,buffer:Buffer.alloc(0)},4096);check();
  if(sha(result.raw)!==pipe.sha256)fail();state.browserRead=true;
  return Object.freeze({envelope:result.value,publicKeySha256:pipe.publicKeySha256});
}
