import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';
import {createBrowserReleaseProxy} from '../../deploy/scripts/browser-release-proxy.mjs';
import {closeRetainedInquiryBrowser} from './retained-inquiry-browser-shutdown.mjs';
const image='sha256:'+'a'.repeat(64);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-inquiry-shutdown-')),journal=new BrowserOperationJournal({directory:root,instanceId:'1'.repeat(64)});await journal.initialize();
 const received=deferred(),release=deferred(),completed=deferred();let upstreamResponse;
 const upstream=http.createServer(async(req,res)=>{upstreamResponse=res;res.writeHead(200,{'content-type':'text/plain'});res.write('first');received.resolve();await release.promise;if(!res.destroyed)res.end('last');});
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const previous=http.globalAgent,agent=new http.Agent({lookup:(_h,o,cb)=>cb(null,o?.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4)});http.globalAgent=agent;
 const registry={format:'sabalan-browser-routing/v1',generation:1,current:{erp:'erp_current',inquiry:'inquiry_current'},legacy:{erp:'erp_legacy',inquiry:'inquiry_legacy'},builds:['erp_legacy','erp_current','inquiry_legacy','inquiry_current'].map(id=>({id,application:id.startsWith('erp')?'erp':'inquiry',slotId:'slot_'+id,image,manifestSha256:'c'.repeat(64),retiredAt:null,supportUntil:null,actionIds:[],assets:[]}))};
 const observed={begin:journal.begin.bind(journal),pending:journal.pending.bind(journal),complete:async(...args)=>{await journal.complete(...args);completed.resolve();}};
 const edge=createBrowserReleaseProxy({loadRegistry:async()=>registry,slotEndpoints:registry.builds.map(b=>({slotId:b.slotId,host:b.application==='erp'?'frontend':'inquiry',port:upstream.address().port,image})),applicationsByHost:{'inquiry.test':'inquiry'},operationJournal:observed});
 edge.server.listen(0,'127.0.0.1');await once(edge.server,'listening');let response;const finished=deferred();
 const request=http.get({hostname:'127.0.0.1',port:edge.server.address().port,path:'/admin',headers:{host:'inquiry.test'}},res=>{response=res;res.resume();res.once('end',finished.resolve);res.once('error',finished.resolve);});request.on('error',finished.resolve);request.once('close',finished.resolve);
 await received.promise;
 return {edge,journal,completed,release,finished,abortBrowser:()=>{request.destroy();response?.destroy();},abortUpstream:()=>upstreamResponse.destroy(),cleanup:async()=>{release.resolve();upstreamResponse?.destroy();edge.server.closeAllConnections();await new Promise(resolve=>edge.server.close(resolve));upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));agent.destroy();http.globalAgent=previous;await fs.rm(root,{recursive:true,force:true});}};
}
test('browser-first assertion refuses a real delayed GET before durable completion',{timeout:10000},async()=>{
 const f=await fixture();try{
  assert.equal((await f.journal.pending()).length,1);f.abortBrowser();await f.finished.promise;f.edge.beginDrain();
  await assert.rejects(f.edge.assertDrained(),/BROWSER_PROXY_DRAIN_NOT_PROVEN/);assert.equal((await f.journal.pending()).length,1);
 }finally{await f.cleanup();}
});
test('server drain retains browser through genuine upstream end and durable completion',{timeout:10000},async()=>{
 const f=await fixture();let contextClosed=false,browserClosed=false;try{
  const context={close:async()=>{assert.equal((await f.journal.pending()).length,0);contextClosed=true;}},browser={close:async()=>{assert.ok(contextClosed);browserClosed=true;}};
  const closed=closeRetainedInquiryBrowser({edge:f.edge,tasks:new Set(),contexts:[context],browser});
  assert.equal(f.edge.status().accepting,false);assert.equal(contextClosed,false);assert.equal((await f.journal.pending()).length,1);
  f.release.resolve();await f.completed.promise;await closed;await f.finished.promise;
  assert.ok(contextClosed&&browserClosed);assert.equal((await f.journal.pending()).length,0);await f.edge.assertDrained();
 }finally{await f.cleanup();}
});
test('a real aborted upstream remains unknown while browser cleanup still runs',{timeout:10000},async()=>{
 const f=await fixture(),contexts=[];try{
  f.abortUpstream();
  await assert.rejects(closeRetainedInquiryBrowser({edge:f.edge,tasks:new Set(),contexts:[{close:async()=>contexts.push('context')}],browser:{close:async()=>contexts.push('browser')}}),/BROWSER_PROXY_DRAIN_NOT_PROVEN/);
  assert.deepEqual(contexts,['context','browser']);assert.equal((await f.journal.pending()).length,1);
 }finally{await f.cleanup();}
});
