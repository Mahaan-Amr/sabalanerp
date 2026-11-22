'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomBytes}=require('node:crypto'),{spawnSync}=require('node:child_process'),{test}=require('node:test');
const {KernelWriteAdmission}=require('./kernelWriteAdmission');
const {RuntimeBoundaryJournal,runtimeBoundaryProvisionBytes,runtimeNativePostgresApplicationName}=require('./runtimeBoundaryJournal');
const {RuntimeTaskAdmission}=require('./runtimeTaskAdmission'),{RuntimeWorkContext}=require('./runtimeWorkContext');
const {VersionedFilePublication}=require('./versionedFilePublication');
async function fixture(){
 const root=path.join(__dirname,randomBytes(16).toString('hex'));fs.mkdirSync(root,{mode:0o700});
 const gate=path.join(root,'deployment-write-admission.lock');fs.writeFileSync(gate,'',{flag:'wx',mode:0o600});
 const stat=fs.statSync(gate,{bigint:true}),identity={device:String(stat.dev),inode:String(stat.ino),ownerUid:Number(stat.uid)};
 const runtimeId=randomBytes(32).toString('hex'),journalRoot=path.join(root,runtimeId);fs.mkdirSync(journalRoot,{mode:0o700});
 const value={runtimeId,image:'sha256:'+'a'.repeat(64),registrySha256:'b'.repeat(64),generation:1,gate:identity,postgresApplicationName:runtimeNativePostgresApplicationName(runtimeId)};
 fs.writeFileSync(path.join(journalRoot,'scope.json'),runtimeBoundaryProvisionBytes(value),{flag:'wx',mode:0o600});
 const journal=new RuntimeBoundaryJournal(journalRoot,value);await journal.initialize();
 const work=new RuntimeWorkContext(new RuntimeTaskAdmission(new KernelWriteAdmission(gate,identity,()=>{}),journal,()=>{}),()=>{});
 const store=path.join(root,'versions'),live=path.join(root,'live');for(const p of [store,live])fs.mkdirSync(p,{mode:0o700});
 const publication=await VersionedFilePublication.open(store,live,work),roots={};
 for(const name of ['artifacts','quarantine','cleanup','state']){roots[name]=path.join(live,name);fs.mkdirSync(roots[name],{mode:0o700});}
 const {createVersionedDispatchOrphanStorage}=require('./dispatchVersionedOrphanStorage');
 const create=operationId=>createVersionedDispatchOrphanStorage({publication,roots,operationId});
 return {root,store,live,roots,publication,create,work,async close(){await work.stopAndDrain(1000);}};
}

test('Dispatch orphan lifecycle retains durable move receipts across adapter reconstruction and exact cleanup',async()=>{
 const v=await fixture();try{
  const a=await v.publication.bindRoot(v.roots.artifacts),q=await v.publication.bindRoot(v.roots.quarantine);
  const original=await a.publish('dispatch-documents/orphan.pdf',Buffer.from('ORIGINAL ORPHAN'));
  const first=await v.create('a'.repeat(64));await first.read('dispatch-documents/orphan.pdf');const evidence=await first.quarantine('dispatch-documents/orphan.pdf');
  assert.equal(await a.read('dispatch-documents/orphan.pdf'),null);
  await (await v.create('a'.repeat(64))).quarantine('dispatch-documents/orphan.pdf');
  assert.equal((await q.read('dispatch-documents/orphan.pdf')).toString(),'ORIGINAL ORPHAN');
  const cleanup=await v.create('b'.repeat(64));await cleanup.stageCleanup('dispatch-documents/orphan.pdf',evidence);
  await (await v.create('b'.repeat(64))).finalizeCleanup('dispatch-documents/orphan.pdf');
  await (await v.create('b'.repeat(64))).finalizeCleanup('dispatch-documents/orphan.pdf');
  const c=await v.publication.bindRoot(v.roots.cleanup);assert.equal(await c.read('dispatch-documents/orphan.pdf'),null);
  assert.equal((await a.readVersion('dispatch-documents/orphan.pdf',original)).toString(),'ORIGINAL ORPHAN');
  assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
 }finally{await v.close();}
});

test('stale quarantine compensation refuses a newer deletion instead of resurrecting old bytes',async()=>{
 const v=await fixture();try{
  const a=await v.publication.bindRoot(v.roots.artifacts);await a.publish('file.pdf',Buffer.from('OLD'));
  const files=await v.create('c'.repeat(64));await files.read('file.pdf');await files.quarantine('file.pdf');
  const newer=await a.publish('file.pdf',Buffer.from('NEW USER FILE'));await a.removeUpload('file.pdf',newer);
  await assert.rejects((await v.create('c'.repeat(64))).restoreQuarantined('file.pdf'),/FILE_VERSION_MOVE_DESTINATION_CHANGED/);
  assert.equal(await a.read('file.pdf'),null);const q=await v.publication.bindRoot(v.roots.quarantine);
  assert.equal((await q.read('file.pdf')).toString(),'OLD');assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
 }finally{await v.close();}
});

test('lost acknowledgement after actual relocation leaves an unresolved durable intent and cannot be retried blindly',async()=>{
 const v=await fixture();const move=v.publication.move;try{
  const a=await v.publication.bindRoot(v.roots.artifacts);await a.publish('file.pdf',Buffer.from('PRESERVE'));
  v.publication.move=async function(...args){await move.apply(this,args);throw Error('LOST_MOVE_ACK');};
  const files=await v.create('d'.repeat(64));await files.read('file.pdf');
  await assert.rejects(files.quarantine('file.pdf'),/LOST_MOVE_ACK/);v.publication.move=move;
  await assert.rejects((await v.create('d'.repeat(64))).quarantine('file.pdf'),/DISPATCH_FILE_OPERATION_UNRESOLVED/);
  await assert.rejects((await v.create('d'.repeat(64))).restoreQuarantined('file.pdf'),/DISPATCH_FILE_OPERATION_UNRESOLVED/);
  const q=await v.publication.bindRoot(v.roots.quarantine);assert.equal((await q.read('file.pdf')).toString(),'PRESERVE');
  assert.equal(await a.read('file.pdf'),null);
 }finally{v.publication.move=move;await v.close();}
});

test('cleanup compensation survives adapter reconstruction and stale finalizers cannot delete later staged files',async()=>{
 const v=await fixture();try{
  const a=await v.publication.bindRoot(v.roots.artifacts),q=await v.publication.bindRoot(v.roots.quarantine);
  await a.publish('file.pdf',Buffer.from('RESTORE AFTER AUDIT FAILURE'));
  const first=await v.create('e'.repeat(64));await first.read('file.pdf');const evidence=await first.quarantine('file.pdf');
  await (await v.create('f'.repeat(64))).stageCleanup('file.pdf',evidence);
  await (await v.create('f'.repeat(64))).restoreStagedCleanup('file.pdf');
  assert.equal((await q.read('file.pdf')).toString(),'RESTORE AFTER AUDIT FAILURE');
  await assert.rejects((await v.create('1'.repeat(64))).stageCleanup('file.pdf',evidence),/FILE_VERSION_MOVE_SOURCE_CHANGED/);
  const c=await v.publication.bindRoot(v.roots.cleanup);
  const from=await q.inspect('file.pdf'),to=await c.inspect('file.pdf');
  await q.moveTo(c,'file.pdf','file.pdf',from.versionSha256,to.versionSha256);
  await assert.rejects((await v.create('f'.repeat(64))).finalizeCleanup('file.pdf'),/DISPATCH_FILE_OPERATION_UNRESOLVED/);
  assert.equal((await c.read('file.pdf')).toString(),'RESTORE AFTER AUDIT FAILURE');
  assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
 }finally{await v.close();}
});

test('existing falsy state is unknown evidence and refuses before quarantine, compensation or finalization',async()=>{
 const {createHash}=require('node:crypto');
 for(const action of ['quarantine','restoreQuarantined','finalizeCleanup']){
  const v=await fixture();try{
   const a=await v.publication.bindRoot(v.roots.artifacts),state=await v.publication.bindRoot(v.roots.state);
   const operationId='2'.repeat(64),files=await v.create(operationId);
   for(const [index,value] of [null,false,0,'',{tombstone:true}].entries()){
    const key='case-'+index+'.pdf';await a.publish(key,Buffer.from('PRESERVE ALL GENERATIONS'));
    await files.read(key);let evidence;if(action!=='quarantine')evidence=await files.quarantine(key);
    if(action==='finalizeCleanup')await files.stageCleanup(key,evidence);
    const phase=action==='finalizeCleanup'?'cleanup':'quarantine',kind=action==='finalizeCleanup'?'finalized':'undo';
    const record=operationId+'/'+createHash('sha256').update(key).digest('hex')+'/'+phase+'-'+kind+'.json';
    const stateVersion=await state.publish(record,Buffer.from(JSON.stringify(value)));
    if(index===4)await state.removeUpload(record,stateVersion);
    const snapshot=()=>fs.readdirSync(path.join(v.store,'heads')).sort().map(name=>[name,fs.readFileSync(path.join(v.store,'heads',name),'hex')]);
    const before=snapshot();await assert.rejects(files[action](key),/DISPATCH_FILE_OPERATION_UNRESOLVED/);
    assert.deepEqual(snapshot(),before);assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
   }
  }finally{await v.close();}
 }
});

test('deleted selection, intent and result evidence cannot authorize a fresh command',async()=>{
 const {createHash}=require('node:crypto');const v=await fixture();try{
  const a=await v.publication.bindRoot(v.roots.artifacts),state=await v.publication.bindRoot(v.roots.state);
  const operationId='8'.repeat(64),files=await v.create(operationId);
  for(const kind of ['selection','intent','result']){
   const key=kind+'.pdf';await a.publish(key,Buffer.from('KEEP LIVE FILE'));
   if(kind!=='selection')await files.read(key);
   const record=operationId+'/'+createHash('sha256').update(key).digest('hex')+'/quarantine-'+kind+'.json';
   const version=await state.publish(record,Buffer.from('{}'));await state.removeUpload(record,version);
   const snapshot=()=>fs.readdirSync(path.join(v.store,'heads')).sort().map(name=>[name,fs.readFileSync(path.join(v.store,'heads',name),'hex')]);
   const before=snapshot();await assert.rejects(kind==='selection'?files.read(key):files.quarantine(key),/DISPATCH_FILE_OPERATION_UNRESOLVED/);
   assert.deepEqual(snapshot(),before);assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
  }
 }finally{await v.close();}
});

test('quarantine moves only the generation whose bytes were read for reconciliation',async()=>{
 const v=await fixture();try{
  const a=await v.publication.bindRoot(v.roots.artifacts),q=await v.publication.bindRoot(v.roots.quarantine);
  await a.publish('file.pdf',Buffer.from('OBSERVED ORPHAN'));
  const files=await v.create('3'.repeat(64));assert.equal((await files.read('file.pdf')).toString(),'OBSERVED ORPHAN');
  await a.publish('file.pdf',Buffer.from('LATER USER FILE'),{replace:true});
  await assert.rejects(files.quarantine('file.pdf'),/FILE_VERSION_MOVE_SOURCE_CHANGED/);
  assert.equal((await a.read('file.pdf')).toString(),'LATER USER FILE');assert.equal(await q.read('file.pdf'),null);
  assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
 }finally{await v.close();}
});

test('cleanup cannot give replacement quarantine bytes an older generations safety window',async()=>{
 const {createHash}=require('node:crypto');const v=await fixture();try{
  const a=await v.publication.bindRoot(v.roots.artifacts),q=await v.publication.bindRoot(v.roots.quarantine),state=await v.publication.bindRoot(v.roots.state);
  const key='file.pdf',operationId='4'.repeat(64),files=await v.create(operationId);
  await a.publish(key,Buffer.from('IDENTICAL BYTES'));await files.read(key);await files.quarantine(key);
  const result=JSON.parse((await state.read(operationId+'/'+createHash('sha256').update(key).digest('hex')+'/quarantine-result.json')).toString());
  const evidence={format:'sabalan-dispatch-quarantine/v1',operationId,versionSha256:result.move.destinationVersionSha256,moveReceiptSha256:result.move.receiptSha256};
  await q.publish(key,Buffer.from('IDENTICAL BYTES'),{replace:true});
  await assert.rejects((await v.create('5'.repeat(64))).stageCleanup(key,evidence),/FILE_VERSION_MOVE_SOURCE_CHANGED/);
  assert.equal((await q.read(key)).toString(),'IDENTICAL BYTES');const c=await v.publication.bindRoot(v.roots.cleanup);assert.equal(await c.read(key),null);
  assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
 }finally{await v.close();}
});

test('versioned cleanup requires valid persisted generation evidence before any staging',async()=>{
 const v=await fixture();try{
  const a=await v.publication.bindRoot(v.roots.artifacts),q=await v.publication.bindRoot(v.roots.quarantine);
  const key='file.pdf',files=await v.create('6'.repeat(64));await a.publish(key,Buffer.from('PRESERVE'));
  await files.read(key);await files.quarantine(key);
  const cleanup=await v.create('7'.repeat(64));
  for(const missing of [undefined,null,{}, {versionSha256:'bad'}]){
   await assert.rejects(cleanup.stageCleanup(key,missing),/DISPATCH_QUARANTINE_VERSION_REQUIRED/);
   assert.equal((await q.read(key)).toString(),'PRESERVE');
  }
  assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
 }finally{await v.close();}
});

test('reconstructed orphan owners cannot consume unresolved state publications with or without a durable head',async()=>{
 const {createHash}=require('node:crypto'),durable=require('./durableFilePublication'),publish=durable.publishDurableFile;
 for(const phase of ['intent-before-head','result-after-head']){
  const v=await fixture();try{
   const key='file.pdf',operationId='9'.repeat(64),a=await v.publication.bindRoot(v.roots.artifacts);
   await a.publish(key,Buffer.from('KEEP ORIGINAL OWNERSHIP'));
   const files=await v.create(operationId);await files.read(key);
   const kind=phase==='intent-before-head'?'intent':'result';
   const stateKey='state/'+operationId+'/'+createHash('sha256').update(key).digest('hex')+'/quarantine-'+kind+'.json';
   const id=createHash('sha256').update(stateKey).digest('hex'),pending=path.join(v.store,'pending',id+'.json');
   durable.publishDurableFile=async(...args)=>{
    const result=await publish(...args);
    if((phase==='result-after-head'&&args[0]===path.join(v.store,'heads',id+'.json'))
      ||(phase==='intent-before-head'&&fs.existsSync(pending)&&args[0].startsWith(path.join(v.store,'objects')+'/')))throw Error('UNKNOWN_STATE_PUBLICATION');
    return result;
   };
   await assert.rejects(files.quarantine(key),/UNKNOWN_STATE_PUBLICATION/);durable.publishDurableFile=publish;
   const originalPending=fs.readFileSync(pending),originalInode=fs.statSync(pending,{bigint:true}).ino;
   const snapshot=()=>fs.readdirSync(path.join(v.store,'heads')).sort().map(name=>[name,fs.readFileSync(path.join(v.store,'heads',name),'hex')]);
   const before=snapshot(),successor=await v.create(operationId);
   await assert.rejects(phase==='result-after-head'?successor.restoreQuarantined(key):successor.quarantine(key),/FILE_VERSION_KEY_UNSETTLED/);
   assert.deepEqual(snapshot(),before);assert.deepEqual(fs.readFileSync(pending),originalPending);assert.equal(fs.statSync(pending,{bigint:true}).ino,originalInode);
  }finally{durable.publishDurableFile=publish;await v.close();}
 }
});
