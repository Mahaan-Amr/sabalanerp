const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const express=require('express');
const bcrypt=require('bcryptjs');
const {HttpRequestLifecycle}=require('./httpRequestLifecycle.js');
const policy=require('./systemRecoveryPolicy.js');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

async function fixture(work){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-http-control-'));
  const file=path.join(root,'checkpoint.sabrec');fs.writeFileSync(file,'OWNED_RECOVERY_FIXTURE');
  const lifecycle=new HttpRequestLifecycle();
  const update=deferred(),updateEntered=deferred(),audit=deferred(),auditEntered=deferred(),backupReady=deferred();
  const password=await bcrypt.hash('local-http-qa-password',4);
  let mode='NORMAL',busy=false,failReceipt=false,transactions=0,downloadAudits=0;
  const database={
    user:{findUnique:async()=>({password})},
    recoveryOperation:{findUnique:async()=>({id:'qa-operation',status:'READY',storageName:'checkpoint.sabrec',source:'CREATED',
      originalName:'checkpoint.sabrec',expiresAt:new Date(Date.now()+600000),encryptedSha256:'a'.repeat(64)}),
      create:async({data})=>({id:'qa-operation',...data}),
      update:async({data})=>{if(data.downloadedAt){updateEntered.resolve();await update.promise;if(failReceipt)throw Object.assign(new Error('injected receipt failure'),{code:'P2028'});}return {id:'qa-operation',...data};}},
    recoveryAuditEvent:{create:async({data})=>{
      if(data.eventType==='RECOVERY_BACKUP_DOWNLOADED'){auditEntered.resolve();await audit.promise;downloadAudits+=1;}
      if(data.eventType==='RECOVERY_BACKUP_READY')backupReady.resolve();
    }},
    $transaction:async run=>{transactions+=1;return run(database);},
  };
  const replacements={
    '../lib/prisma':{prisma:database},
    '../middleware/auth':{protect:(req,_res,next)=>{req.user={id:'qa-admin'};next();},authorize:()=> (_req,_res,next)=>next()},
    '../services/httpRequestLifecycle':{runtimeHttpRequests:lifecycle},
    '../services/systemRecoveryPolicy':policy,
    '../services/recoveryRuntime':{RECOVERY_ROOT:root,getRecoveryRuntimeState:()=>({mode}),
      acquireRecoveryOperation:()=>{if(busy)return false;busy=true;return true;},releaseRecoveryOperation:()=>{busy=false;},
      setRecoveryRuntimeState:value=>{mode=value;},waitForActiveWrites:()=>lifecycle.waitForWriteDrain(1000)},
    '../services/notificationService':{publishNotificationEvent:async()=>{}},
    '../services/systemRecoveryEngine':{recoveryPackagePath:()=>file,createRecoveryPackage:async({onProgress})=>{
      await onProgress(55);return {storageName:'created.sabrec',sha256:'a'.repeat(64),size:20,
        manifest:{appVersion:'1.0.0',commit:'a'.repeat(40),postgresVersion:'15'}};
    }},
  };
  const exports={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'system-recovery.js'),'utf8'),{exports,
    require:name=>Object.hasOwn(replacements,name)?replacements[name]:require(name),console,process,Buffer,setImmediate,setTimeout,clearTimeout},
    {filename:'actual-system-recovery-route.js'});
  const app=express();app.use(express.json());app.use(lifecycle.middleware);app.use('/api/system-recovery',exports.default);lifecycle.install(app);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const post=route=>fetch('http://127.0.0.1:'+server.address().port+'/api/system-recovery'+route,{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({adminPassword:'local-http-qa-password',packageType:'COMPLETE',passphrase:'Local-HTTP-qa-passphrase-123!'})});
  try{await work({lifecycle,post,update,updateEntered,audit,auditEntered,backupReady,
    state:()=>({mode,busy,transactions,downloadAudits}),failReceipt:()=>{failReceipt=true;}});}
  finally{
    update.resolve();audit.resolve();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('sabalan-http-control-'));fs.rmSync(root,{recursive:true});
  }
}
test('actual download route retains its atomic receipt and audit after the response finishes',{timeout:10000},async()=>fixture(async api=>{
  const response=await api.post('/qa-operation/download');assert.equal(response.status,200);assert.equal(await response.text(),'OWNED_RECOVERY_FIXTURE');
  await api.updateEntered.promise;await assert.rejects(()=>api.lifecycle.waitForDrain(30),/DRAIN_TIMEOUT/);
  api.update.resolve();await api.auditEntered.promise;await assert.rejects(()=>api.lifecycle.waitForDrain(30),/DRAIN_TIMEOUT/);
  api.audit.resolve();await api.lifecycle.waitForDrain(1000);
  assert.equal(api.state().transactions,1);assert.equal(api.state().downloadAudits,1);
}));
test('a failed post-response download receipt is contained and does not leave unfinished work',{timeout:10000},async()=>fixture(async api=>{
  api.failReceipt();api.update.resolve();api.audit.resolve();
  const response=await api.post('/qa-operation/download');assert.equal(await response.text(),'OWNED_RECOVERY_FIXTURE');
  await api.updateEntered.promise;await api.lifecycle.waitForDrain(1000);
  assert.equal(api.state().transactions,1);assert.equal(api.state().downloadAudits,0);
}));
test('actual backup POST leaves its own HTTP scope before the background snapshot drains writes',{timeout:10000},async()=>fixture(async api=>{
  const response=await api.post('/backups');assert.equal(response.status,202);await response.text();
  await Promise.race([api.backupReady.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('SNAPSHOT_SELF_DEADLOCK')),2000).unref())]);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(api.state().mode,'NORMAL');assert.equal(api.state().busy,false);
  await api.lifecycle.waitForDrain(1000);
}));
