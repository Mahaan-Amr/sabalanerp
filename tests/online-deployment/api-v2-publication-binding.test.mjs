import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import dns from 'node:dns';
import {once} from 'node:events';
import test from 'node:test';
import {createApiReleaseProxy} from '../../deploy/scripts/browser-release-proxy.mjs';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';
import {apiRoutingSnapshot,compileApiRoutingRegistry} from '../../deploy/scripts/api-release-routing.mjs';

test('a fresh API proxy refuses a valid enrolled backend substituted outside the v2 publication',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-api-published-owner-'));
  const originalAgent=http.globalAgent,seen=[],servers=[];
  const enrolled=new Set(['backend-previous','backend-current']);
  const agent=new http.Agent({lookup:(hostname,options,complete)=>dns.lookup(enrolled.has(hostname)?'127.0.0.1':hostname,options,complete)});
  http.globalAgent=agent;
  let proxy;
  try {
    const image='sha256:'+'a'.repeat(64),manifest='b'.repeat(64);
    const browser={format:'sabalan-browser-routing/v2',generation:1,
      current:{erp:'erp_current',inquiry:'inquiry_current'},legacy:{erp:'erp_previous',inquiry:null},
      builds:['erp_previous','erp_current','inquiry_current'].map(id=>({id,application:id.startsWith('erp_')?'erp':'inquiry',
        slotId:'slot_'+id,image,manifestSha256:manifest,actionIds:[],assets:[],
        retiredAt:id==='erp_previous'?'2099-01-01T00:00:00.000Z':null,
        supportUntil:id==='erp_previous'?'2099-01-02T00:00:00.000Z':null})),
      apiBindings:['erp_previous','erp_current'].map((buildId,index)=>({buildId,browserManifestSha256:manifest,
        slotId:index?'backend_current':'backend_previous',image:'sha256:'+(index?'c':'d').repeat(64),
        manifestSha256:(index?'e':'f').repeat(64)}))};
    const snapshot=apiRoutingSnapshot(browser),endpoints=[];
    for(const binding of browser.apiBindings) {
      const server=http.createServer((request,response)=>{seen.push(binding.slotId);request.resume();response.writeHead(201);response.end(binding.slotId);});
      server.listen(0,'127.0.0.1');await once(server,'listening');servers.push(server);
      endpoints.push({...binding,host:binding.slotId.replaceAll('_','-'),port:server.address().port});
    }
    // Both endpoints are enrolled and healthy. The browser's embedded previous
    // owner stays intact; only the independently supplied API copy is altered.
    Object.assign(snapshot.api.bindings[0],{slotId:browser.apiBindings[1].slotId,
      image:browser.apiBindings[1].image,manifestSha256:browser.apiBindings[1].manifestSha256});
    const journal=new BrowserOperationJournal({directory:root,instanceId:'1'.repeat(64)});await journal.initialize();
    proxy=createApiReleaseProxy({loadSnapshot:async()=>structuredClone(snapshot),slotEndpoints:endpoints,
      applicationsByHost:{'erp.test':'erp'},operationJournal:journal});
    proxy.server.listen(0,'127.0.0.1');await once(proxy.server,'listening');servers.push(proxy.server);
    const result=await new Promise((resolve,reject)=>{
      const request=http.request({host:'127.0.0.1',port:proxy.server.address().port,path:'/api/accounting/form',method:'POST',
        headers:{host:'erp.test','x-deployment-id':'erp_previous','content-length':'6'}},response=>{
        const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.once('error',reject);
        response.once('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString()}));
      });request.once('error',reject);request.end('AMOUNT');
    });
    assert.equal(result.status,503,'no previously observed generation is available to catch this substituted first snapshot');
    assert.equal(JSON.parse(result.body).error,'API_BINDINGS_NOT_PUBLISHED');
    assert.deepEqual(seen,[],'neither enrolled backend may receive the substituted business write');
    assert.throws(()=>compileApiRoutingRegistry(snapshot.browser,snapshot.api),/API_BINDINGS_NOT_PUBLISHED/);
    assert.equal((await journal.pending()).length,0);
    proxy.beginDrain();await proxy.assertDrained();
  } finally {
    proxy?.beginDrain();
    for(const server of servers.reverse())await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    agent.destroy();http.globalAgent=originalAgent;
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('sabalan-api-published-owner-'));
    await fs.rm(root,{recursive:true,force:true});
  }
});
