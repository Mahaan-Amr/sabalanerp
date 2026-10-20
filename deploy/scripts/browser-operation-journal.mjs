import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const idPattern=/^[a-f0-9]{32}$/;
const digest=/^[a-f0-9]{64}$/;
const name=/^[a-z][a-z0-9_-]{7,95}$/;
const exact=(value,keys)=>value && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
const timestamp=value=>typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;

/** Durable transport ownership only: HTTP completion is not a declaration of
 * business success. Incomplete/unknown intent cannot expire or be cleared by
 * restarting the proxy. The controller must separately fence every instance
 * and prove actual application/control-task completion. */
export class BrowserOperationJournal {
  #directory;
  #instanceId;
  #rootIdentity;
  constructor({directory,instanceId}) {
    if(typeof directory!=='string' || !path.isAbsolute(directory) || !digest.test(instanceId)) fail('BROWSER_JOURNAL_CONFIGURATION_INVALID');
    this.#directory=path.resolve(directory);this.#instanceId=instanceId;
  }

  async initialize() {
    // Provisioning is a separate owned controller operation. Never recreate a
    // missing journal: it could contain unresolved work from an earlier instance.
    await this.#assertRoot();
    if(process.platform!=='win32') {
      // Publish every existing directory entry, including a newly provisioned
      // root and its ancestors, before any operation may be acknowledged.
      let directory=this.#directory;
      for(;;) {
        const handle=await fs.open(directory,'r');
        try{await handle.sync();}finally{await handle.close();}
        const parent=path.dirname(directory);if(parent===directory)break;directory=parent;
      }
    }
    const stat=await fs.lstat(this.#directory);
    this.#rootIdentity={dev:stat.dev,ino:stat.ino};
    await this.#assertRoot();
  }

  async #assertRoot() {
    const stat=await fs.lstat(this.#directory);
    if(this.#rootIdentity && (stat.dev!==this.#rootIdentity.dev || stat.ino!==this.#rootIdentity.ino))fail('BROWSER_JOURNAL_DIRECTORY_REPLACED');
    if(!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(this.#directory)!==this.#directory
      || (process.platform!=='win32' && ((stat.mode&0o077)!==0 || stat.uid!==process.getuid()))) fail('BROWSER_JOURNAL_DIRECTORY_UNSAFE');
  }

  async #writeExclusive(file,value) {
    if(!this.#rootIdentity)fail('BROWSER_JOURNAL_NOT_INITIALIZED');
    await this.#assertRoot();
    const handle=await fs.open(file,'wx',0o600);
    try {await handle.writeFile(`${JSON.stringify(value)}\n`);await handle.sync();}
    finally {await handle.close();}
    await this.#syncDirectory();
  }

  async #readStrict(file) {
    await this.#assertRoot();
    const stat=await fs.lstat(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.size>4096
      || (process.platform!=='win32' && ((stat.mode&0o077)!==0 || stat.uid!==process.getuid()))) fail('BROWSER_JOURNAL_RECORD_UNSAFE');
    const bytes=await fs.readFile(file,'utf8');
    let value;try{value=JSON.parse(bytes);}catch{fail('BROWSER_JOURNAL_RECORD_INVALID');}
    return {value,hash:sha256(bytes)};
  }

  #validateIntent(record,id) {
    if(!exact(record,['format','id','instanceId','registryIdentity','generation','buildId','slotId','image','manifestSha256','method','startedAt'])
      || record.format!=='sabalan-browser-operation/v1' || record.id!==id || !idPattern.test(id)
      || !digest.test(record.instanceId) || !digest.test(record.registryIdentity) || !digest.test(record.manifestSha256)
      || !Number.isSafeInteger(record.generation) || record.generation<1
      || !name.test(record.buildId) || !name.test(record.slotId) || !/^sha256:[a-f0-9]{64}$/.test(record.image)
      || !['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(record.method) || !timestamp(record.startedAt)) fail('BROWSER_JOURNAL_INTENT_INVALID');
  }

  async begin({registryIdentity,generation,buildId,slotId,image,manifestSha256,method}) {
    const id=randomBytes(16).toString('hex');
    const record={format:'sabalan-browser-operation/v1',id,instanceId:this.#instanceId,registryIdentity,generation,
      buildId,slotId,image,manifestSha256,method,startedAt:new Date().toISOString()};
    this.#validateIntent(record,id);
    await this.#writeExclusive(path.join(this.#directory,`${id}.intent.json`),record);
    return id;
  }

  async complete(id,outcome) {
    if(!idPattern.test(id) || !['UPSTREAM_ENDED','NOT_FORWARDED'].includes(outcome)) fail('BROWSER_JOURNAL_COMPLETION_INVALID');
    const intent=await this.#readStrict(path.join(this.#directory,`${id}.intent.json`));
    this.#validateIntent(intent.value,id);
    if(intent.value.instanceId!==this.#instanceId) fail('BROWSER_JOURNAL_NOT_OWNED');
    const record={format:'sabalan-browser-operation-completion/v1',id,instanceId:this.#instanceId,
      intentSha256:intent.hash,outcome,completedAt:new Date().toISOString()};
    const file=path.join(this.#directory,`${id}.complete.json`);
    try {await this.#writeExclusive(file,record);}
    catch(failure) {
      if(failure.code!=='EEXIST')throw failure;
      const existing=await this.#readStrict(file);
      this.#validateCompletion(existing.value,intent,id);
      if(existing.value.outcome!==outcome)fail('BROWSER_JOURNAL_COMPLETION_CONFLICT');
      // A prior attempt can have created this exact file but failed before its
      // directory fsync. EEXIST proves visibility, not durable completion.
      await this.#persistExistingCompletion(file,existing.hash);
    }
  }

  async #persistExistingCompletion(file,expectedHash) {
    await this.#assertRoot();
    const handle=await fs.open(file,(process.platform==='win32'?constants.O_RDWR:constants.O_RDONLY)
      | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const identity=value=>[value.dev,value.ino,value.size,value.mtimeNs,value.ctimeNs,value.mode,value.uid,value.nlink].map(String).join(':');
    try {
      const before=await handle.stat({bigint:true});
      if(!before.isFile() || before.nlink!==1n || before.size>4096n
        || (process.platform!=='win32' && ((before.mode&0o077n)!==0n || before.uid!==BigInt(process.getuid()))))fail('BROWSER_JOURNAL_RECORD_UNSAFE');
      if(sha256(await handle.readFile())!==expectedHash)fail('BROWSER_JOURNAL_COMPLETION_CONFLICT');
      await handle.sync();
      if(identity(before)!==identity(await handle.stat({bigint:true}))
        || identity(before)!==identity(await fs.lstat(file,{bigint:true})))fail('BROWSER_JOURNAL_COMPLETION_CONFLICT');
      await this.#syncDirectory();await this.#assertRoot();
      if(identity(before)!==identity(await fs.lstat(file,{bigint:true})))fail('BROWSER_JOURNAL_COMPLETION_CONFLICT');
    } finally {await handle.close();}
  }

  #validateCompletion(record,intent,id) {
    if(!exact(record,['format','id','instanceId','intentSha256','outcome','completedAt'])
      || record.format!=='sabalan-browser-operation-completion/v1' || record.id!==id
      || record.instanceId!==intent.value.instanceId || record.intentSha256!==intent.hash
      || !['UPSTREAM_ENDED','NOT_FORWARDED'].includes(record.outcome)
      || !timestamp(record.completedAt) || Date.parse(record.completedAt)<Date.parse(intent.value.startedAt)) fail('BROWSER_JOURNAL_COMPLETION_INVALID');
  }

  async pending() {
    if(!this.#rootIdentity)fail('BROWSER_JOURNAL_NOT_INITIALIZED');
    await this.#assertRoot();
    const files=await fs.readdir(this.#directory,{withFileTypes:true});
    const intents=new Map(),completions=new Map();
    for(const entry of files) {
      const match=/^([a-f0-9]{32})\.(intent|complete)\.json$/.exec(entry.name);
      if(!entry.isFile() || !match)fail('BROWSER_JOURNAL_INVENTORY_INVALID');
      const record=await this.#readStrict(path.join(this.#directory,entry.name));
      if(match[2]==='intent'){this.#validateIntent(record.value,match[1]);intents.set(match[1],record);}
      else completions.set(match[1],record);
    }
    for(const [id,record] of completions) {
      const intent=intents.get(id);if(!intent)fail('BROWSER_JOURNAL_ORPHAN_COMPLETION');
      this.#validateCompletion(record.value,intent,id);
    }
    return [...intents].filter(([id])=>!completions.has(id)).map(([,record])=>({...record.value}));
  }

  /** Original-instance read-only custody for controller reconciliation. These
   * are the exact durable intent bytes, not a reserialized semantic hash.
   * An old instance's UNKNOWN cannot be adopted by constructing a new journal. */
  async originalPendingEvidence() {
    const values=await this.pending(),result=[];
    for(const value of values) {
      if(value.instanceId!==this.#instanceId)fail('BROWSER_JOURNAL_NOT_OWNED');
      const record=await this.#readStrict(path.join(this.#directory,`${value.id}.intent.json`));
      this.#validateIntent(record.value,value.id);
      if(record.value.instanceId!==this.#instanceId || JSON.stringify(record.value)!==JSON.stringify(value))fail('BROWSER_JOURNAL_INTENT_CHANGED');
      result.push(Object.freeze({intent:Object.freeze({...record.value}),intentSha256:record.hash}));
    }
    return Object.freeze(result);
  }

  async #syncDirectory() {
    if(process.platform==='win32')return;
    const handle=await fs.open(this.#directory,'r');
    try{await handle.sync();}finally{await handle.close();}
  }
}
