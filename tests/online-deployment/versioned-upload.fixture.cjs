'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const { RuntimeWorkContext } = require('./runtimeWorkContext');
const { RuntimeWorkBoundary } = require('./runtimeWorkBoundary');
const { VersionedFilePublication } = require('./versionedFilePublication');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(assertOwner = () => {}) {
  const root = path.join(__dirname, randomBytes(16).toString('hex')); fs.mkdirSync(root, { mode: 0o700 });
  const gate = path.join(root, 'deployment-write-admission.lock'); fs.writeFileSync(gate, '', { flag: 'wx', mode: 0o600 });
  const stat = fs.statSync(gate, { bigint: true }), runtimeId = randomBytes(32).toString('hex');
  const identity = { device: String(stat.dev), inode: String(stat.ino), ownerUid: Number(stat.uid) };
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: identity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  const journalRoot = path.join(root, runtimeId); fs.mkdirSync(journalRoot, { mode: 0o700 });
  fs.writeFileSync(path.join(journalRoot, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(journalRoot, scope); await journal.initialize();
  let accepting = true;
  const tasks = new RuntimeTaskAdmission(new KernelWriteAdmission(gate, identity, () => {}), journal, () => {}, () => accepting);
  const boundary = new RuntimeWorkBoundary(tasks, () => true, assertOwner);
  const work = boundary.context;
  const store = path.join(root, 'versions'), live = path.join(root, 'live');
  for (const directory of [store, live]) fs.mkdirSync(directory, { mode: 0o700 });
  const publisher = await VersionedFilePublication.open(store, live, work);
  return { root, gate, work, store, live, publisher, boundary, close: () => { accepting = false; }, reopen: () => { accepting = true; } };
}

async function seal(value) {
  const captureId = randomBytes(32).toString('hex'), descriptor = fs.openSync(value.gate, 'r');
  try {
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'pipe', descriptor] }).status, 0);
    return { captureId, ...await value.publisher.seal(captureId, descriptor) };
  } finally { fs.closeSync(descriptor); }
}


const { Readable } = require('node:stream');


const express = require('express');
const {createVersionedDurableUpload} = require('./durableUpload');
const {HttpRequestLifecycle} = require('./httpRequestLifecycle');

test('real multipart upload preserves immutable bytes and failed multipart cleanup records a deletion version', async () => {
  const value=await fixture(), lifecycle=value.boundary.requests, app=express();
  let admitted=0;
  const upload=createVersionedDurableUpload({storage:{destination:value.live, filename:(_req,file,done)=>done(null,file.originalname)},
    fileFilter:(_req,file,done)=>{
      if(file.originalname!=='rejected.pdf')return done(null,true);
      const deadline=Date.now()+2000;
      const wait=()=>{
        if(fs.existsSync(path.join(value.live,'cleanup.pdf')))return done(Error('DOMAIN_FILTER_REJECTED'));
        if(Date.now()>deadline)return done(Error('FIRST_UPLOAD_DID_NOT_COMPLETE'));
        setTimeout(wait,5);
      };wait();
    }},value.live,value.publisher,lifecycle);
  app.use(lifecycle.middleware);
  app.post('/upload',upload.array('files',2),(_req,res)=>{admitted++;res.sendStatus(201);});
  app.use((error,_req,res,_next)=>res.status(400).json({code:error.code||error.message,storageErrors:error.storageErrors?.length||0}));
  lifecycle.install(app);
  const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
  const url='http://127.0.0.1:'+server.address().port+'/upload';
  try{
    const input=new FormData();input.append('files',new Blob(['ORIGINAL UPLOAD 123.00000001']),'original.pdf');
    assert.equal((await fetch(url,{method:'POST',body:input})).status,201);
    await lifecycle.waitForDrain(2000);
    const originalCut=await seal(value);
    const heads=originalCut.manifest.heads;assert.equal(heads.length,1);
    assert.equal((await value.publisher.readVersion(heads[0].sha256)).toString(),'ORIGINAL UPLOAD 123.00000001');
    const collision=new FormData();collision.append('files',new Blob(['WRONG']),'original.pdf');
    assert.equal((await fetch(url,{method:'POST',body:collision})).status,400);
    assert.equal(fs.readFileSync(path.join(value.live,'original.pdf'),'utf8'),'ORIGINAL UPLOAD 123.00000001');
    const rejected=new FormData();rejected.append('files',new Blob(['OWNED REJECTED MULTIPART BYTES']),'cleanup.pdf');
    rejected.append('files',new Blob(['REJECT']),'rejected.pdf');
    const response=await fetch(url,{method:'POST',body:rejected});assert.equal(response.status,400);
    const body=await response.json();assert.equal(body.code,'DOMAIN_FILTER_REJECTED');assert.equal(body.storageErrors,0);
    await lifecycle.waitForDrain(2000);assert.equal(admitted,1);
    assert.deepEqual(fs.readdirSync(value.live),['original.pdf']);
    const cut=await seal(value),cleanup=cut.manifest.heads.find(head=>head.key==='cleanup.pdf');
    assert.ok(cleanup);assert.equal(await value.publisher.readVersion(cleanup.sha256),null);
    const tombstone=JSON.parse(fs.readFileSync(path.join(value.store,'versions',cleanup.sha256+'.json')));
    assert.equal((await value.publisher.readVersion(tombstone.previousSha256)).toString(),'OWNED REJECTED MULTIPART BYTES');
    const target=path.join(value.root,'restored');
    const child=spawnSync('python3',['-I','-B',path.join(__dirname,'reader.worker.py'),value.store,cut.captureId,cut.sha256,target],{encoding:'utf8'});
    assert.equal(child.status,0,child.stdout+child.stderr);
    assert.deepEqual(fs.readdirSync(path.join(target,'files')),['original.pdf']);
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));await value.boundary.stopAndDrain(2000);}
});

test('stale upload cleanup cannot delete a later version and a mismatched root never gets a fallback writer',async()=>{
 const value=await fixture();
 try{
  const first=await value.publisher.publishUpload('original.pdf',Readable.from([Buffer.from('FIRST OWNED UPLOAD')]));
  await value.publisher.publishStream('original.pdf',Readable.from([Buffer.from('NEW USER VERSION')]),{replace:true});
  await assert.rejects(value.publisher.removeUpload('original.pdf',first.versionSha256),{code:'FILE_VERSION_UPLOAD_CHANGED'});
  assert.equal(fs.readFileSync(path.join(value.live,'original.pdf'),'utf8'),'NEW USER VERSION');
  assert.deepEqual(fs.readdirSync(path.join(value.store,'pending')),[]);
  assert.equal((await seal(value)).manifest.heads.length,1);
  assert.throws(()=>createVersionedDurableUpload({storage:{destination:value.root,filename:(_req,_file,done)=>done(null,'bad.pdf')}},value.root,value.publisher),/FILE_VERSION_STORAGE_ROOT_MISMATCH/);
  const lifecycle=value.boundary.requests,app=express();app.use(lifecycle.middleware);
  const upload=createVersionedDurableUpload({storage:{destination:value.root,filename:(_req,_file,done)=>done(null,'escaped.pdf')}},value.live,value.publisher,lifecycle);
  app.post('/upload',upload.single('file'),(_req,res)=>res.sendStatus(201));
  app.use((error,_req,res,_next)=>res.status(400).json({code:error.message}));lifecycle.install(app);
  const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
  try{
   const form=new FormData();form.append('file',new Blob(['ESCAPE']),'escaped.pdf');
   const response=await fetch('http://127.0.0.1:'+server.address().port+'/upload',{method:'POST',body:form});
   assert.equal(response.status,400);assert.equal((await response.json()).code,'FILE_VERSION_STORAGE_ROOT_MISMATCH');
   assert.equal(fs.existsSync(path.join(value.root,'escaped.pdf')),false);
   await lifecycle.waitForDrain(2000);
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
 }finally{await value.boundary.stopAndDrain(2000);}
});

test('upload receipt takes stream ownership synchronously before asynchronous native admission',async()=>{
 const value=await fixture(),source=Readable.from([Buffer.from('OWNED IMMEDIATELY')]);let pending;
 try{pending=value.publisher.publishUpload('receipt.pdf',source);assert.ok(source.listenerCount('error')>0,'receipt must observe source errors immediately');await pending;}
 finally{if(pending)await pending;await value.boundary.stopAndDrain(2000);}
});

test('an admitted multipart request completes its versioned file after capture closes new work',async()=>{
 const value=await fixture(),lifecycle=value.boundary.requests,app=express();let enter,proceed;
 const entered=new Promise(done=>enter=done),resume=new Promise(done=>proceed=done);
 const upload=createVersionedDurableUpload({storage:{destination:value.live,filename:(_req,_file,done)=>{enter();void resume.then(()=>done(null,'admitted.pdf'));}}},value.live,value.publisher,lifecycle);
 app.use(value.boundary.middleware);app.post('/upload',upload.single('file'),(_req,res)=>res.sendStatus(201));
 app.use((error,_req,res,_next)=>res.status(400).json({code:error.code}));lifecycle.install(app);
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 let request,timer;
 try{
  const form=new FormData();form.append('file',new Blob(['ADMITTED BEFORE CAPTURE CLOSURE']),'admitted.pdf');
  request=fetch('http://127.0.0.1:'+server.address().port+'/upload',{method:'POST',body:form});await entered;
  value.close();assert.notEqual(spawnSync('/usr/bin/flock',['--exclusive','--nonblock',value.gate,'/usr/bin/true']).status,0);
  proceed();const response=await Promise.race([request,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('MULTIPART_REACQUIRED_CLOSED_ADMISSION')),2000))]);
  clearTimeout(timer);assert.equal(response.status,201);await lifecycle.waitForDrain(2000);
  assert.equal(fs.readFileSync(path.join(value.live,'admitted.pdf'),'utf8'),'ADMITTED BEFORE CAPTURE CLOSURE');
  assert.equal((await seal(value)).manifest.heads.length,1);
 }finally{clearTimeout(timer);value.reopen();proceed();if(request)await request;server.closeAllConnections();await new Promise(done=>server.close(done));await value.boundary.stopAndDrain(2000);}
});
