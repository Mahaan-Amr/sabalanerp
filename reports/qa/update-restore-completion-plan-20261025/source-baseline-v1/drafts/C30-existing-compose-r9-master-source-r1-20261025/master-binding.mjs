/** Literal binding is filled only by the reviewed post-build constructor. No CLI command/module/key selection. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash}from'node:crypto';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory}from'file:///C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp/scripts/lib/original-private-evidence-directory.mjs';
import {finalizeClosedExistingComposeComplete}from'./closed-complete.mjs';
const BOUND=null; // New changed backend graph, coherent source packet and actual unused execution refs do not exist yet.
const sha=b=>createHash('sha256').update(b).digest('hex');
const stamp=s=>['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');
function read(ref,max=8*1024*1024){const file=path.resolve(ref.file);assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,'r');try{const named=fs.lstatSync(file,{bigint:true}),held=fs.fstatSync(fd,{bigint:true});assert.ok(named.isFile()&&!named.isSymbolicLink()&&named.nlink===1n&&held.size>0n&&held.size<=BigInt(max));for(const k of['ino','mode','nlink','size','mtimeNs'])assert.equal(held[k],named[k]);if(process.platform!=='win32'){assert.equal(held.dev,named.dev);assert.equal(held.ctimeNs,named.ctimeNs);}const raw=fs.readFileSync(fd);assert.equal(raw.length,Number(held.size));assert.equal(sha(raw),ref.sha256);assert.equal(stamp(held),stamp(fs.fstatSync(fd,{bigint:true})));assert.equal(stamp(named),stamp(fs.lstatSync(file,{bigint:true})));return raw;}finally{fs.closeSync(fd);}}
function confined(root,file){const rel=path.relative(root,path.resolve(file));assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));}
export async function openFixedMasterBinding(file,digest){
 assert.ok(BOUND,'GENUINE_CHANGED_GRAPH_AND_MASTER_SOURCE_BINDING_REQUIRED');assert.equal(process.platform,'win32');
 assert.equal(path.resolve(file),path.resolve(BOUND.configuration.file));assert.equal(digest,BOUND.configuration.sha256);read(BOUND.configuration);
 const checks=()=>{for(const ref of BOUND.sourcePins)read(ref,ref.maximum??8*1024*1024);read(BOUND.owner,1024*1024);};checks();
 assert.match(BOUND.operation,/^[a-f0-9]{32}$/);assert.equal(BOUND.python.file,'C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe');read(BOUND.python,1024*1024);
 assert.equal(fs.existsSync(BOUND.runtimeDirectory),false,'USED_OR_EXISTING_R9_RUNTIME_REFUSED');
 const audit=path.resolve(BOUND.auditDirectory),custody=await prepareOriginalPrivateEvidenceDirectory(audit);
 const persist=(name,raw)=>{assertOriginalPrivateEvidenceDirectory(custody,audit);assert.equal(path.basename(name),name);const f=path.join(audit,name),fd=fs.openSync(f,'wx',0o400);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.deepEqual(fs.readFileSync(f),raw);return{file:f,sha256:sha(raw)};};
 return Object.freeze({operation:BOUND.operation,command:{executable:BOUND.python.file,argv:['-I','-B',BOUND.owner.file,'--execute-reviewed','yes','--master-private-credential-stdin','yes'],environment:Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','PATH','APPDATA','LOCALAPPDATA'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))},revalidate:checks,
  async beforeCredential(){checks();assertOriginalPrivateEvidenceDirectory(custody,audit);},
  async persistOwnerClosure(row,out,err,{persistAllowed}){assert.ok(persistAllowed,'CREDENTIAL_OR_SETUP_NEGATIVE_NO_RAW_PERSIST');persist('r9-owner.stdout.raw',out);persist('r9-owner.stderr.raw',err);persist('r9-owner.original.json',Buffer.from(JSON.stringify(row)+'\n'));},
  async verifyClosedComplete(closure){checks();confined(BOUND.runtimeDirectory,closure.resultReference.file);const ownerRaw=read(closure.resultReference),owner=JSON.parse(ownerRaw);assert.equal(owner.outerOriginalClosurePending,true);assert.ok(Array.isArray(owner.children)&&owner.children.length>0);
   const originalChildren=owner.children.map(ref=>{confined(BOUND.runtimeDirectory,ref.file);const raw=read(ref,1024*1024),row=JSON.parse(raw);assert.equal(row.format,'sabalan-secret-stdin-original-closure/v1');assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);assert.equal(row.observationFaultTotal,0);assert.equal(row.localInterrupted,false);assert.equal(row.stdinSecretStored,false);return{ref,raw,row};});
   const capture=read(BOUND.coherentCapture),financial=read(BOUND.financialSource);return finalizeClosedExistingComposeComplete({closure,ownerRaw,coherentRaw:capture,financialSourceRaw:financial,originalChildren,binding:BOUND,read,persist});}
 });
}
