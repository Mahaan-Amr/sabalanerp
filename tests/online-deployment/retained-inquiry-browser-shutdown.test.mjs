import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import vm from 'node:vm';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';
import {createBrowserReleaseProxy} from '../../deploy/scripts/browser-release-proxy.mjs';
import {closeRetainedInquiryBrowser,retireRetainedInquiryContexts} from './retained-inquiry-browser-shutdown.mjs';
const image='sha256:'+'a'.repeat(64);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-inquiry-shutdown-')),journal=new BrowserOperationJournal({directory:root,instanceId:'1'.repeat(64)});await journal.initialize();
 const received=deferred(),release=deferred(),completed=deferred(),lateReceived=deferred(),lateRelease=deferred(),lateFinished=deferred();let upstreamResponse;
 const upstream=http.createServer(async(req,res)=>{upstreamResponse=res;res.writeHead(200,{'content-type':'text/plain'});res.write('first');if(req.url==='/admin/late'){lateReceived.resolve();await lateRelease.promise;}else{received.resolve();await release.promise;}if(!res.destroyed)res.end('last');});
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const previous=http.globalAgent,agent=new http.Agent({lookup:(_h,o,cb)=>cb(null,o?.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4)});http.globalAgent=agent;
 const registry={format:'sabalan-browser-routing/v1',generation:1,current:{erp:'erp_current',inquiry:'inquiry_current'},legacy:{erp:'erp_legacy',inquiry:'inquiry_legacy'},builds:['erp_legacy','erp_current','inquiry_legacy','inquiry_current'].map(id=>({id,application:id.startsWith('erp')?'erp':'inquiry',slotId:'slot_'+id,image,manifestSha256:'c'.repeat(64),retiredAt:null,supportUntil:null,actionIds:[],assets:[]}))};
 const observed={begin:journal.begin.bind(journal),pending:journal.pending.bind(journal),complete:async(...args)=>{await journal.complete(...args);completed.resolve();}};
 const edge=createBrowserReleaseProxy({loadRegistry:async()=>registry,slotEndpoints:registry.builds.map(b=>({slotId:b.slotId,host:b.application==='erp'?'frontend':'inquiry',port:upstream.address().port,image})),applicationsByHost:{'inquiry.test':'inquiry'},operationJournal:observed});
 edge.server.listen(0,'127.0.0.1');await once(edge.server,'listening');let response;const finished=deferred();
 const request=http.get({hostname:'127.0.0.1',port:edge.server.address().port,path:'/admin',headers:{host:'inquiry.test'}},res=>{response=res;res.resume();res.once('end',finished.resolve);res.once('error',finished.resolve);});request.on('error',finished.resolve);request.once('close',finished.resolve);
 await received.promise;
 return {edge,journal,agent,completed,release,finished,beginLate:async()=>{const late=http.get({hostname:'127.0.0.1',port:edge.server.address().port,path:'/admin/late',headers:{host:'inquiry.test'}},res=>{res.resume();res.once('end',lateFinished.resolve);res.once('error',lateFinished.resolve);});late.on('error',lateFinished.resolve);await lateReceived.promise;},lateRelease,lateFinished,abortBrowser:()=>{request.destroy();response?.destroy();},abortUpstream:()=>upstreamResponse.destroy(),cleanup:async()=>{release.resolve();lateRelease.resolve();upstreamResponse?.destroy();edge.server.closeAllConnections();await new Promise(resolve=>edge.server.close(resolve));upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));agent.destroy();http.globalAgent=previous;await fs.rm(root,{recursive:true,force:true});}};
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


test('completed HTML contexts retire only after genuine proxy completion and observer drain',{timeout:10000},async()=>{
 const f=await fixture(),events=[],survivor={close:async()=>events.push('survivor')},html={close:async()=>{assert.equal((await f.journal.pending()).length,0);events.push('html');}},contexts=[html,survivor],tasks=new Set();
 try{const retired=retireRetainedInquiryContexts({edge:f.edge,journal:f.journal,agent:f.agent,tasks,contexts,retiring:[html],assertObservations:()=>{}});await new Promise(r=>setImmediate(r));assert.deepEqual(events,[]);f.release.resolve();await f.completed.promise;await f.finished.promise;const result=await retired;assert.deepEqual(events,['html']);assert.deepEqual(contexts,[survivor]);assert.equal(result.selectedContextsClosed,1);assert.equal(result.contextsRemaining,1);assert.equal(f.edge.status().accepting,true);
 }finally{await f.cleanup();}
});

test('context retirement refuses foreign or duplicate ownership before closing anything',async()=>{
 let calls=0;const c={close:async()=>calls++},edge={assertDrained:async()=>{}},tasks=new Set();
 for(const retiring of [[c,c],[{}]])await assert.rejects(retireRetainedInquiryContexts({edge,journal:{pending:async()=>[]},agent:{keepAlive:false,sockets:{},requests:{},freeSockets:{}},tasks,contexts:[c],retiring,assertObservations(){}}));assert.equal(calls,0);
});

test('unknown selected-context closure stays negative without retrying the context',async()=>{
 let calls=0,browserClosed=false;const c={close:async()=>{calls++;throw Error('CONTEXT_CLOSE_UNKNOWN');}},contexts=[c],tasks=new Set(),edge={status:()=>({accepting:true,active:0,unresolved:0,bodyBytes:0,generation:1}),assertDrained:async()=>{},beginDrain(){},server:{close:done=>done()}};
 await assert.rejects(retireRetainedInquiryContexts({edge,journal:{pending:async()=>[]},agent:{keepAlive:false,sockets:{},requests:{},freeSockets:{}},tasks,contexts,retiring:[c],assertObservations(){}}),/CONTEXT_CLOSE_UNKNOWN/);
 await assert.rejects(closeRetainedInquiryBrowser({edge,tasks,contexts,browser:{close:async()=>{browserClosed=true;}}}),/CONTEXT_CLOSURE_ALREADY_ATTEMPTED/);assert.equal(calls,1);assert.equal(browserClosed,true);
});

test('observer failure retains selected contexts for the original final cleanup',async()=>{
 let closed=false;const c={close:async()=>{closed=true;}},contexts=[c];await assert.rejects(retireRetainedInquiryContexts({edge:{status:()=>({accepting:true,active:0,unresolved:0,bodyBytes:0,generation:1}),assertDrained:async()=>{}},journal:{pending:async()=>[]},agent:{keepAlive:false,sockets:{},requests:{},freeSockets:{}},tasks:new Set(),contexts,retiring:[c],assertObservations(){throw Error('OBSERVER_UNKNOWN');}}),/OBSERVER_UNKNOWN/);assert.equal(closed,false);assert.deepEqual(contexts,[c]);
});


test('partial retirement rejects unknown journal, status, generation and sockets',async()=>{
 const status=()=>({accepting:true,active:0,unresolved:0,bodyBytes:0,generation:1});
 for(const mode of ['journal','status','generation','sockets']){let closed=0,reads=0;const c={close:async()=>closed++},contexts=[c],agent={keepAlive:false,sockets:{},requests:{},freeSockets:{}},edge={status:()=>{const value=status();if(mode==='status')value.active=undefined;if(mode==='generation'&&++reads>1)value.generation=2;return value;}};if(mode==='sockets')agent.sockets.x={length:0};await assert.rejects(retireRetainedInquiryContexts({edge,journal:{pending:async()=>mode==='journal'?[{}]:[]},agent,tasks:new Set(),contexts,retiring:[c],assertObservations(){}}));assert.equal(closed,0);}
});

test('partial retirement waits for actual owned socket references to close naturally',async()=>{
 const done=deferred(),socket={},agent={keepAlive:false,sockets:{upstream:[socket]},requests:{},freeSockets:{}},status={accepting:true,active:0,unresolved:0,bodyBytes:0,generation:1};let closed=false;
 const c={close:async()=>{closed=true;}},operation=retireRetainedInquiryContexts({edge:{status:()=>status},journal:{pending:async()=>[]},agent,tasks:new Set(),contexts:[c],retiring:[c],assertObservations(){}});await new Promise(r=>setTimeout(r,30));assert.equal(closed,false);agent.sockets.upstream=[];await operation;assert.equal(closed,true);
});

test('second selected close failure never replays it during original final browser cleanup',async()=>{
 const calls=[],a={close:async()=>calls.push('a')},b={close:async()=>{calls.push('b');throw Error('SECOND_CLOSE_UNKNOWN');}},survivor={close:async()=>calls.push('survivor')},contexts=[a,b,survivor],edge={status:()=>({accepting:true,active:0,unresolved:0,bodyBytes:0,generation:1}),beginDrain(){},server:{close:done=>done()},assertDrained:async()=>{}};
 await assert.rejects(retireRetainedInquiryContexts({edge,journal:{pending:async()=>[]},agent:{keepAlive:false,sockets:{},requests:{},freeSockets:{}},tasks:new Set(),contexts,retiring:[a,b],assertObservations(){}}),/SECOND_CLOSE_UNKNOWN/);await assert.rejects(closeRetainedInquiryBrowser({edge,tasks:new Set(),contexts,browser:{close:async()=>calls.push('browser')}}),/CONTEXT_CLOSURE_ALREADY_ATTEMPTED/);assert.deepEqual(calls,['a','b','survivor','browser']);
});

test('actual browser fixture ordering preserves four submissions and both old forms with three contexts',async()=>{
 const source=await fs.readFile(new URL('./installed-retained-inquiry-browser.fixture.mjs',import.meta.url),'utf8'),start=source.indexOf("const old=await open('old')"),end=source.indexOf('for(const name of names){assert.ok(assets.some',start),workflow=source.slice(start,end);assert.ok(start>0&&end>start);
 const contexts=[],posts=[],failures=[],tasks=new Set(),retirements=[],events=[];let peak=0,publication={publicationSha256:'before'};
 const context={assert,structuredClone,Date,http,agent:{keepAlive:false,sockets:{},requests:{},freeSockets:{}},artifacts:{current:{id:'current'},old:{id:'old'}},store:{publish:async()=>{publication={publicationSha256:'after'};return publication;},readPublication:async()=>publication},build:()=>({id:'current'}),retireRetainedInquiryContexts,contexts,posts,failures,tasks,contextRetirements:retirements,journal:{pending:async()=>[]},edge:{status:()=>({accepting:true,active:0,unresolved:0,bodyBytes:0,generation:2})},until:async check=>assert.ok(check()),
  open:async(name,hydrated=false)=>{if(name==='current'&&hydrated)assert.equal(contexts.length,1);const c={close:async()=>events.push('closed-'+name+'-'+hydrated)};contexts.push(c);peak=Math.max(peak,contexts.length);events.push('open-'+name+'-'+hydrated);return{context:c,name,hydrated,navigations:()=>0};},submit:async tab=>{assert.equal(publication.publicationSha256,'after');posts.push({hydrated:tab.hydrated});events.push('submit-'+tab.name+'-'+tab.hydrated);}};
 const previousAgent=http.globalAgent;http.globalAgent=context.agent;const run=vm.compileFunction('return(async()=>{let publication={publicationSha256:"before"},registry={generation:1,current:{inquiry:"old"},builds:[{id:"old"}]};const publications=[];'+workflow+'})();',Object.keys(context));try{await run(...Object.values(context));}finally{http.globalAgent=previousAgent;}assert.equal(peak,3);assert.equal(posts.length,4);assert.equal(posts.filter(p=>p.hydrated).length,2);assert.equal(retirements[0].selectedContextsClosed,2);assert.ok(events.indexOf('closed-current-false')<events.indexOf('open-current-true'));assert.equal(contexts.length,2);
});


test('a real late HTTP request during publication observation blocks selected-context closure',{timeout:10000},async()=>{
 const f=await fixture();let closed=false,checks=0,operation;
 try{f.release.resolve();await f.finished.promise;await f.completed.promise;const c={close:async()=>{closed=true;}};operation=retireRetainedInquiryContexts({edge:f.edge,journal:f.journal,agent:f.agent,tasks:new Set(),contexts:[c],retiring:[c],assertObservations:async()=>{if(++checks===4)await f.beginLate();}});await new Promise(r=>setTimeout(r,40));assert.equal((await f.journal.pending()).length,1);assert.equal(closed,false);f.lateRelease.resolve();await f.lateFinished.promise;await operation;assert.equal(closed,true);assert.equal((await f.journal.pending()).length,0);
 }finally{await f.cleanup();if(operation)await operation.catch(()=>{});}
});
