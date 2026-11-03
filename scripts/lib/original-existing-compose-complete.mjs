/** Distinct same-process COMPLETE authority. Input pins select reviewed source;
 * neither those pins nor persisted output JSON are completion authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {collectOriginalCompleteOwner,readOriginalCompleteOwner} from './original-existing-compose-owner.mjs';
import {joinOriginalCompleteArtifacts} from './original-complete-join.mjs';
import {originalOnlineEvidenceReader} from './original-online-evidence-reader.mjs';
import {readOriginalRoleQualificationCompletion} from './application-native-role-coordinator.mjs';
import {readSourceOwnedCompleteBinding} from './original-complete-source-binding.mjs';

const completed=new WeakMap();
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const identity=st=>['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(key=>String(st[key])).join(':');
const PYTHON=path.resolve('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe');
export function isOriginalExistingComposeComplete(token){return !!token&&typeof token==='object'&&completed.has(token);}
export function readOriginalExistingComposeComplete(token){
  const value=completed.get(token);assert.ok(value,'ORIGINAL_EXISTING_COMPOSE_COMPLETE_REQUIRED');
  value.revalidate();return structuredClone(value.record);
}
function pinnedReader(){
  const checks=[];
  return {read(reference,maximum=8*1024**2){
    const file=reference.file;assert.equal(path.resolve(file),file);assert.equal(fs.realpathSync(file),file);
    assert.match(reference.sha256,/^[a-f0-9]{64}$/);
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try{
      const held=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
      assert.ok(held.isFile()&&held.nlink===1n&&held.size>0n&&held.size<=BigInt(maximum));
      for(const key of ['ino','mode','nlink','size','mtimeNs','ctimeNs'])assert.equal(held[key],named[key]);
      if(process.platform!=='win32')assert.equal(held.dev,named.dev);
      const raw=fs.readFileSync(fd);assert.equal(raw.length,Number(held.size));assert.equal(sha(raw),reference.sha256);
      assert.equal(identity(held),identity(fs.fstatSync(fd,{bigint:true})));assert.equal(identity(named),identity(fs.lstatSync(file,{bigint:true})));
      checks.push(()=>{assert.equal(fs.realpathSync(file),file);assert.equal(identity(fs.lstatSync(file,{bigint:true})),identity(named));assert.equal(sha(fs.readFileSync(file)),reference.sha256);});
      return raw;
    }finally{fs.closeSync(fd);}
  },revalidate(){for(const check of checks)check();}};
}
function confined(root,file){
  assert.equal(fs.realpathSync(root),root);const relative=path.relative(root,file);
  assert.ok(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'COMPLETE_OUTPUT_OUTSIDE_OWNED_AUDIT');
}

/** Fixed Windows owner entry: no CLI argv, executable, module, verifier or key
 * selector. The configuration and all source pins are frozen before credentials.
 * It must describe a newly rendered unused owner, not a historical used plan.
 * Runtime implementation of that reviewed owner remains responsible for the
 * existing Compose/resource lease, original transfer and physical reader ports. */
export async function runOriginalExistingComposeComplete({configurationFile,configurationSha256,localCompletion,acquireCredential,onClosed=async()=>{},signal}){
  assert.equal(process.platform,'win32','ORIGINAL_COMPLETE_WINDOWS_REQUIRED');
  const local=readOriginalRoleQualificationCompletion(localCompletion);
  assert.ok(local.originalControllers.length>0&&local.originalControllers.every(row=>row.code===0&&row.signal===null));
  const source=readSourceOwnedCompleteBinding();
  assert.deepEqual(source.value.configuration,{file:configurationFile,sha256:configurationSha256},'COMPLETE_SOURCE_OWNED_CONFIGURATION_REQUIRED');
  const reader=pinnedReader(),configuration={file:configurationFile,sha256:configurationSha256};
  const config=JSON.parse(reader.read(configuration).toString('utf8'));
  assert.equal(config.format,'sabalan-original-existing-compose-complete-input/v1');
  assert.equal(config.productionAdmission,false);assert.equal(config.project,'sabalanerp-local');
  for(const key of ['sources','python','operation','targetCommit','auditDirectory'])assert.deepEqual(config[key],source.value[key],'COMPLETE_SOURCE_BINDING_CHANGED');
  assert.equal(Object.hasOwn(config,'session'),false,'COMPLETE_HR_SESSION_MUST_BE_ORIGINAL');
  assert.match(config.operation,/^[a-f0-9]{32}$/);assert.match(config.targetCommit,/^[a-f0-9]{40}$/);
  assert.deepEqual(Object.keys(config.sources).sort(),['callback','controller','owner','worker']);
  for(const ref of Object.values(config.sources))reader.read(ref,2*1024**2);
  assert.equal(config.python.file,PYTHON);reader.read(config.python,32*1024**2);
  assert.equal(path.resolve(config.auditDirectory),config.auditDirectory);assert.equal(fs.existsSync(config.auditDirectory),false,'COMPLETE_USED_AUDIT_REFUSED');
  // Acquire no key and perform no mutation here. The one source-bound owner
  // creates its exclusive audit directory only inside its own lease.
  const beforeCredential=async()=>{source.revalidate();reader.revalidate();};
  const ownerToken=await collectOriginalCompleteOwner({operation:config.operation,signal,beforeCredential,acquireCredential,onClosed,
    command:{executable:PYTHON,argv:['-I','-B',config.sources.owner.file,'--execute-reviewed','yes','--master-private-credential-stdin','yes'],
      environment:Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','PATH','APPDATA','LOCALAPPDATA'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]))}});
  source.revalidate();reader.revalidate();
  const owner=readOriginalCompleteOwner(ownerToken);confined(config.auditDirectory,owner.resultReference.file);
  const ownerRaw=reader.read(owner.resultReference),result=JSON.parse(ownerRaw.toString('utf8'));
  assert.equal(result.operation,config.operation);confined(config.auditDirectory,result.completeCapture.file);
  const captureRaw=reader.read(result.completeCapture),capture=JSON.parse(captureRaw.toString('utf8'));
  assert.equal(capture.request.operation,config.operation);assert.equal(capture.request.sourceCommit,config.targetCommit);
  const joined=joinOriginalCompleteArtifacts({owner,ownerRaw,captureRaw,completedAt:new Date().toISOString()});
  assert.equal(joined.record.controllerSourceSha256,config.sources.controller.sha256);
  const worker=JSON.parse(Buffer.from(capture.workerOriginal.rawBase64,'base64').toString('utf8'));
  assert.equal(worker.workerSourceSha256,config.sources.worker.sha256);
  originalOnlineEvidenceReader().assertOnlineQualificationProof('coherent-independent-restore',joined.proof,joined.expected);
  reader.revalidate();
  const token=Object.freeze({});completed.set(token,{record:joined.record,revalidate:()=>{
    source.revalidate();reader.revalidate();originalOnlineEvidenceReader().assertOnlineQualificationProof('coherent-independent-restore',joined.proof,joined.expected);
  }});return token;
}
