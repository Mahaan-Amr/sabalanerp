import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createApiReleaseProxy} from '../../deploy/scripts/browser-release-proxy.mjs';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';
import {browserRoutingIdentity} from '../../deploy/scripts/browser-release-routing.mjs';

const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
const image='sha256:'+'a'.repeat(64),manifest='b'.repeat(64);
function snapshot(){const browser={format:'sabalan-browser-routing/v1',generation:1,
  current:{erp:'erp_current',inquiry:'inquiry_current'},legacy:{erp:'erp_previous',inquiry:null},
  builds:['erp_previous','erp_current','inquiry_current'].map(id=>({id,application:id.startsWith('erp_')?'erp':'inquiry',
    slotId:'slot_'+id,image,manifestSha256:manifest,actionIds:[],assets:[],
    retiredAt:id==='erp_previous'?'2099-01-01T00:00:00.000Z':null,
    supportUntil:id==='erp_previous'?'2099-01-02T00:00:00.000Z':null}))};
  return {browser,api:{format:'sabalan-api-routing/v1',generation:1,browserRegistryIdentity:browserRoutingIdentity(browser),
    bindings:['erp_previous','erp_current'].map(buildId=>({buildId,browserManifestSha256:manifest,
      slotId:buildId==='erp_previous'?'backend_previous':'backend_current',image,manifestSha256:manifest}))}};}
const request=(port,method,headers={},body='',pathname='/api/accounting/form')=>new Promise((resolve,reject)=>{
  const call=http.request({hostname:'127.0.0.1',port,path:pathname,method,
    headers:{host:'erp.test',...headers,...(body?{'content-length':Buffer.byteLength(body)}:{})}},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);
    response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString()}));
  });call.on('error',reject);call.end(body);
});

test('business transport keeps old and unidentified forms on their backend through switch and current-data rollback',async()=>{
  const previousAgent=http.globalAgent;
  http.globalAgent=new http.Agent({lookup:(_host,options,callback)=>callback(null,options?.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4)});
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-api-journal-'));
  const servers=[],seen=[];let proxy;
  try {
    let input=snapshot();const endpoints=[];
    for(const slotId of ['backend_previous','backend_current']){
      const server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);
        seen.push({slotId,method:req.method,url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()});
        res.writeHead(201,{'cache-control':'public, max-age=1000','set-cookie':'session=kept; HttpOnly'});res.end(slotId);});
      servers.push(server);endpoints.push({slotId,host:slotId.replaceAll('_','-'),port:await listen(server),image,manifestSha256:manifest});
    }
    const journal=new BrowserOperationJournal({directory:root,instanceId:'c'.repeat(64)});await journal.initialize();
    proxy=createApiReleaseProxy({loadSnapshot:async()=>structuredClone(input),slotEndpoints:endpoints,
      operationJournal:journal,applicationsByHost:{'erp.test':'erp'}});
    servers.push(proxy.server);const port=await listen(proxy.server);
    for(const method of ['POST','PUT','PATCH','DELETE']){
      const result=await request(port,method,{'x-deployment-id':'erp_previous',cookie:'session=original',
        'x-forwarded-for':'attacker.invalid','x-forwarded-proto':'https'},'UNSAVED FORM');
      assert.equal(result.status,201);assert.equal(result.body,'backend_previous');
      assert.equal(result.headers['cache-control'],'no-store, private');assert.deepEqual(result.headers['set-cookie'],['session=kept; HttpOnly']);
      assert.equal(seen.at(-1).method,method);assert.equal(seen.at(-1).body,'UNSAVED FORM');assert.equal(seen.at(-1).headers.cookie,'session=original');
      assert.equal(seen.at(-1).headers['x-forwarded-for'],'127.0.0.1');assert.equal(seen.at(-1).headers['x-forwarded-proto'],'http');
    }
    assert.equal((await request(port,'POST',{},'BASELINE')).body,'backend_previous');
    assert.equal((await request(port,'POST',{'x-deployment-id':'erp_current'},'AFTER SWITCH')).body,'backend_current');
    input.browser.generation=2;input.api.generation=2;input.browser.current.erp='erp_previous';
    input.browser.builds[0].retiredAt=null;input.browser.builds[0].supportUntil=null;
    input.browser.builds[1].retiredAt='2099-01-01T00:00:00.000Z';input.browser.builds[1].supportUntil='2099-01-02T00:00:00.000Z';
    input.api.browserRegistryIdentity=browserRoutingIdentity(input.browser);
    assert.equal((await request(port,'POST',{'x-deployment-id':'erp_previous'},'AFTER ROLLBACK')).body,'backend_previous');
    assert.equal((await request(port,'POST',{'x-deployment-id':'erp_current'},'RETAINED NEW FORM')).body,'backend_current');
    assert.ok(seen.some(row=>row.body==='AFTER SWITCH'),'rollback does not cancel an already completed request');
    // Native DOM images/audio/downloads cannot send x-deployment-id. They
    // carry the compiled producer only on GET/HEAD and never change auth.
    for(const method of ['GET','HEAD']) {
      const result=await request(port,method,{cookie:'session=original'},'',
        '/files/private.pdf?signature=a%2Bb%20c&__sabalan_build=erp_current&part=1');
      assert.equal(result.status,201);
      assert.equal(seen.at(-1).slotId,'backend_current');
      assert.equal(seen.at(-1).url,'/files/private.pdf?signature=a%2Bb%20c&part=1');
      assert.equal(seen.at(-1).headers['x-deployment-id'],'erp_current');
      assert.equal(seen.at(-1).headers.cookie,'session=original');
    }
    for(const raw of ['/files/a?', '/files/a?signature=a%2Bb&']) {
      assert.equal((await request(port,'GET',{},'',raw+'&__sabalan_build=erp_current')).status,201);
      assert.equal(seen.at(-1).url,raw,'preserve empty signed query segments exactly');
    }
    const beforeRefusal=seen.length;
    for(const [method,headers,pathname] of [
      ['GET',{},'/files/a?__sabalan_build=erp_current&__sabalan_build=erp_current'],
      ['GET',{'x-deployment-id':'erp_previous'},'/files/a?__sabalan_build=erp_current'],
      ['POST',{},'/api/upload?__sabalan_build=erp_current'],
      ['GET',{},'/files/a?__sabalan_build=']]) {
      assert.ok([400,409].includes((await request(port,method,headers,'',pathname)).status));
      assert.equal(seen.length,beforeRefusal,'invalid producer must never reach upstream');
    }
    assert.equal((await request(port,'GET',{},'','/files/a?__sabalan_build=erp_unknown')).status,503);
    assert.equal(seen.length,beforeRefusal);
    const count=seen.length;
    for(const pathname of ['/about','/socket.io/','/%61bout','/api%2faccounting'])
      assert.ok([400,404].includes((await request(port,'GET',{},'',pathname)).status));
    input.browser.generation=3;input.api.generation=3;
    input.browser.builds[1].retiredAt='2000-01-01T00:00:00.000Z';input.browser.builds[1].supportUntil='2000-01-02T00:00:00.000Z';
    input.api.browserRegistryIdentity=browserRoutingIdentity(input.browser);
    const expired=await request(port,'POST',{'x-deployment-id':'erp_current'},'RETAIN THIS DRAFT');
    assert.equal(expired.status,409);assert.equal(JSON.parse(expired.body).error,'API_BUILD_REFRESH_REQUIRED');assert.equal(seen.length,count);
    const expiredNative=await request(port,'GET',{},'','/files/a?__sabalan_build=erp_current');
    assert.equal(expiredNative.status,409);assert.equal(seen.length,count);
    input.api.bindings[0].manifestSha256='d'.repeat(64);
    assert.equal((await request(port,'POST',{},'NO FORWARD')).status,503);assert.equal(seen.length,count);
    assert.equal((await journal.pending()).length,0);proxy.beginDrain();await proxy.assertDrained();
  }finally{
    proxy?.beginDrain();for(const server of servers.reverse())await close(server);http.globalAgent=previousAgent;
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('sabalan-api-journal-'));
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('retrying an existing transport completion persists its directory after an earlier fsync failure',async()=>{
  assert.equal(process.platform,'linux','directory fsync acceptance requires Linux');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-api-journal-'));
  const originalOpen=fs.open;let directorySyncs=0;
  try {
    const journal=new BrowserOperationJournal({directory:root,instanceId:'e'.repeat(64)});await journal.initialize();
    const id=await journal.begin({registryIdentity:'a'.repeat(64),generation:1,buildId:'erp_previous',
      slotId:'backend_previous',image,manifestSha256:manifest,method:'PATCH'});
    fs.open=async function(file,...args){const handle=await originalOpen.call(this,file,...args);
      if(file===root){const sync=handle.sync.bind(handle);handle.sync=async()=>{
        directorySyncs++;if(directorySyncs===1)throw Object.assign(new Error('QA_DIRECTORY_FSYNC_FAILURE'),{code:'EIO'});
        return sync();};}return handle;};
    await assert.rejects(journal.complete(id,'UPSTREAM_ENDED'),/QA_DIRECTORY_FSYNC_FAILURE/);
    assert.equal(JSON.parse(await fs.readFile(path.join(root,id+'.complete.json'),'utf8')).outcome,'UPSTREAM_ENDED');
    await journal.complete(id,'UPSTREAM_ENDED');assert.equal(directorySyncs,2,'existing completion must be made durable before retry succeeds');
    assert.equal((await journal.pending()).length,0);
  }finally{
    fs.open=originalOpen;assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('sabalan-api-journal-'));await fs.rm(root,{recursive:true,force:true});
  }
});
