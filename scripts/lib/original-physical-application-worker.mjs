/** Finite source-owned application worker. Parsed reports cannot reconstruct
 * this original-child capability. No Docker/service command is selected here. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import {validateOriginalIndependentApplicationClosures} from './independent-full-restore-ssh.mjs';
import {retainSerialChild,isClosedSerialNegative} from './serial-physical/retained-child.mjs';
import {assertOriginalPrivateEvidenceDirectory} from './original-private-evidence-directory.mjs';
import {fileURLToPath} from 'node:url';
const launches=new WeakMap(),workers=new WeakMap();
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const stamp=st=>['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(k=>String(st[k])).join(':');
/** Same live coordinator prepares files/ports under its existing resource lease.
 * It cannot replace the reviewed entry or return a preassembled worker token. */
export async function runOriginalSameComposeApplicationWorker({prepared,plan,replay,material}){
 const entryFile=fs.realpathSync(fileURLToPath(new URL('../run-same-compose-physical-applications.mjs',import.meta.url)));
 assert.equal(prepared.entry.file,entryFile);
 const raw=fs.readFileSync(prepared.configuration.file);assert.equal(sha(raw),prepared.configuration.sha256);
 const config=JSON.parse(raw);assert.equal(config.format,'sabalan-physical-applications-worker-binding/v1');
 assert.equal(config.input.operation,plan.operation);assert.deepEqual(config.input.replay,replay);
 assert.deepEqual(config.input.canonicalReplay,plan.canonicalReplay);
 for(const [key,role]of [['captured','coherent-cut'],['coverage','coverage-manifest'],['walClosure','wal-capture']])assert.deepEqual(config.input.ownedInputs[key],material.materialFacts[role]);
 const required=[entryFile,fileURLToPath(new URL('./same-compose-physical-applications.mjs',import.meta.url)),
  fileURLToPath(new URL('./restored-qa/application-lifecycle.mjs',import.meta.url)),
  fileURLToPath(new URL('./restored-qa/inquiry-carrier-observation.mjs',import.meta.url)),config.binding.file];
 const references=[prepared.entry,...prepared.sourceFiles];
 for(const file of required)assert.ok(references.some(ref=>ref.file===fs.realpathSync(file)),'PHYSICAL_APPLICATION_SOURCE_PIN_REQUIRED:'+path.basename(file));
 assert.ok(prepared.sourceFiles.some(ref=>ref.file===config.binding.file&&ref.sha256===config.binding.sha256));
 const launch=compileOriginalPhysicalApplicationLaunch(prepared);
 return retainOriginalPhysicalApplicationWorker({launch,operation:plan.operation,assertActive:prepared.assertActive,assertDrained:prepared.assertDrained,evidence:prepared.evidence});
}
/** File-only #413 seam. Source-owned coordinator code selects these pinned
 * existing resources; master commands never accept executables or argv. */
export function compileOriginalPhysicalApplicationLaunch({entry,configuration,executable,sourceFiles=[]}){
 assert.equal(path.resolve(executable.file),process.execPath);
 assert.match(entry.file,/\.(?:mjs|cjs|js)$/);
 const checks=[];
 for(const reference of [entry,configuration,executable,...sourceFiles]){
  assert.equal(fs.realpathSync(reference.file),reference.file);assert.match(reference.sha256,/^[a-f0-9]{64}$/);
  const before=fs.lstatSync(reference.file,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=256n*1024n**2n);
  assert.equal(sha(fs.readFileSync(reference.file)),reference.sha256);assert.equal(stamp(before),stamp(fs.lstatSync(reference.file,{bigint:true})));
  checks.push(()=>{assert.equal(stamp(before),stamp(fs.lstatSync(reference.file,{bigint:true})));assert.equal(sha(fs.readFileSync(reference.file)),reference.sha256);});
 }
 const launch=Object.freeze({});launches.set(launch,{executable:executable.file,argv:['--max-old-space-size=512',entry.file,configuration.file,configuration.sha256],
  used:false,revalidate(){for(const check of checks)check();}});return launch;
}
export function readOriginalPhysicalApplicationWorker(token){
 const held=workers.get(token);assert.ok(held,'ORIGINAL_PHYSICAL_APPLICATION_WORKER_REQUIRED');held.revalidate();return structuredClone(held.result);
}
export async function retainOriginalPhysicalApplicationWorker({launch,operation,assertActive,assertDrained,evidence}){
 const selected=launches.get(launch);assert.ok(selected&&!selected.used,'ORIGINAL_PHYSICAL_APPLICATION_LAUNCH_REQUIRED');
 assert.match(operation,/^[a-f0-9]{32}$/);assert.equal(typeof assertActive,'function');assert.equal(typeof assertDrained,'function');
 assertOriginalPrivateEvidenceDirectory(evidence?.custody,evidence?.directory);
 selected.revalidate();assert.equal(assertActive(),true);selected.used=true;
 const prefix=path.join(evidence.directory,operation+'-physical-applications');
 const fds={};try{for(const name of ['stdout','stderr','receipt'])fds[name]=fs.openSync(prefix+'.'+name,'wx',0o600);}
 catch(error){for(const fd of Object.values(fds))fs.closeSync(fd);throw error;}
 const chunks=[];let count=0,overflow=false,receipt,drained=false;
 const stored={stdout:0,stderr:0};
 const writeAll=(fd,raw,position=null)=>{let offset=0;while(offset<raw.length){const n=fs.writeSync(fd,raw,offset,raw.length-offset,position===null?null:position+offset);assert.ok(n>0);offset+=n;}};
 const heldTimer=setInterval(()=>{},1000);
 const child=spawn(selected.executable,selected.argv,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
 // Unknown/negative originals keep the same process owner retained. A failure
 // never issues the token or licenses restoration over unresolved descendants.
 try{
  const sinks=Object.fromEntries(['stdout','stderr'].map(name=>[name,{write:raw=>{
   const maximum=name==='stdout'?32*1024**2:65536,selected=raw.subarray(0,Math.max(0,maximum-stored[name]));
   if(name==='stdout'){count+=raw.length;chunks.push(Buffer.from(selected));}
   if(selected.length!==raw.length)overflow=true;
   writeAll(fds[name],selected);stored[name]+=selected.length;return raw.length;
  },sync:()=>fs.fsyncSync(fds[name]),close:()=>fs.closeSync(fds[name])}]));
  receipt=await retainSerialChild(child,{phase:'PHYSICAL_APPLICATIONS',sinks,persistReceipt:async row=>{
   assert.equal(await assertDrained(),true,'PHYSICAL_APPLICATION_CALLBACKS_NOT_DRAINED');drained=true;
   const raw=Buffer.from(JSON.stringify(row)+'\n');fs.ftruncateSync(fds.receipt,0);writeAll(fds.receipt,raw,0);fs.fsyncSync(fds.receipt);
  },finalizeReceipt:()=>fs.closeSync(fds.receipt)});
  clearInterval(heldTimer);assert.equal(overflow,false);assert.equal(receipt.stderrBytes,0);
  assert.equal(assertActive(),true);selected.revalidate();
  const raw=Buffer.concat(chunks);assert.equal(raw.length,count);const envelope=JSON.parse(raw);
  assert.equal(envelope.format,'sabalan-original-physical-applications-output/v1');assert.equal(envelope.operation,operation);assert.equal(envelope.productionAdmission,false);
  const result=envelope.applicationResult;assert.ok(result&&result.ownedOutputs&&Array.isArray(result.nativeClosures));
  for(const descriptor of Object.values(result.ownedOutputs)){
   const content=Buffer.from(descriptor.rawBase64,'base64');assert.equal(content.toString('base64'),descriptor.rawBase64);
   assert.equal(content.length,descriptor.bytes);assert.equal(sha(content),descriptor.sha256);
  }
  const report=JSON.parse(Buffer.from(result.ownedOutputs.report.rawBase64,'base64'));
  assert.deepEqual(validateOriginalIndependentApplicationClosures(report),result.nativeClosures);
  const original={...receipt,pid:child.pid};
  result.originalControllers=[original];
  const revalidate=()=>{selected.revalidate();assert.equal(sha(raw),original.stdoutSha256);};
  const token=Object.freeze({});workers.set(token,{result,revalidate,child,raw});clearInterval(heldTimer);
  return token;
 }catch(error){if(isClosedSerialNegative(error)&&drained)clearInterval(heldTimer);void child;void chunks;throw error;}
}
