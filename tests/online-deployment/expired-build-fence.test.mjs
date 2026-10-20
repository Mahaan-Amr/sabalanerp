import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dns from 'node:dns';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import * as edgeModule from '../../deploy/scripts/common-release-edge.mjs';
import {apiRoutingSnapshot} from '../../deploy/scripts/api-release-routing.mjs';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';

const image='sha256:'+'a'.repeat(64),manifest='b'.repeat(64),publicationSha256='c'.repeat(64);
const {WebSocket,WebSocketServer}=createRequire(new URL('../../backend/package.json',import.meta.url))('ws');
const {Server:SocketIoServer}=createRequire(new URL('../../backend/package.json',import.meta.url))('socket.io');
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
const close=server=>new Promise(resolve=>server.close(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function fixture(run){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'expired-build-fence-')),agent=http.globalAgent;
 http.globalAgent=new http.Agent({lookup:(host,options,done)=>dns.lookup(/^(backend|frontend|inquiry)-a$/.test(host)?'127.0.0.1':host,options,done)});
 let edge,handler=(req,res)=>{req.resume();res.end('actual-upstream');},loads=null,calls=0;
 const upstream=http.createServer((req,res)=>{calls++;handler(req,res);});
 try{
  const port=await listen(upstream),journals={};
  for(const kind of ['ui','api','socket']){const directory=path.join(root,kind);await fs.mkdir(directory,{mode:0o700});journals[kind]=new BrowserOperationJournal({directory,instanceId:randomBytes(32).toString('hex')});await journals[kind].initialize();}
  const build=(id,application,old)=>({id,application,slotId:application==='erp'?'frontend_slot_a':'inquiry_slot_a',image,manifestSha256:manifest,assets:[],actionIds:application==='inquiry'?['d'.repeat(40)]:[],retiredAt:old?new Date(Date.now()-3*86400000).toISOString():null,supportUntil:old?new Date(Date.now()-86400000).toISOString():null});
  const browser={format:'sabalan-browser-routing/v2',generation:1,current:{erp:'erp_current_build',inquiry:'inquiry_current_build'},legacy:{erp:'erp_expired_build',inquiry:'inquiry_expired_build'},builds:[build('erp_expired_build','erp',true),build('erp_current_build','erp',false),build('inquiry_expired_build','inquiry',true),build('inquiry_current_build','inquiry',false)],apiBindings:['erp_expired_build','erp_current_build'].map(buildId=>({buildId,browserManifestSha256:manifest,slotId:'backend_slot_a',image,manifestSha256:manifest}))};
  edge=edgeModule.createCommonReleaseEdge({loadSnapshot:async()=>{if(loads)await loads.promise;return {...apiRoutingSnapshot(browser),publicationSha256};},uiEndpoints:[{slotId:'frontend_slot_a',host:'frontend-a',port,image},{slotId:'inquiry_slot_a',host:'inquiry-a',port,image}],backendEndpoints:[{slotId:'backend_slot_a',host:'backend-a',port,image,manifestSha256:manifest}],applicationsByHost:{'erp.edge.invalid':'erp','inquiry.edge.invalid':'inquiry'},journals,timeoutMs:5000});
  const edgePort=await listen(edge.server);
  const request=(url='/',headers={},body)=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:edgePort,path:url,method:body===undefined?'GET':'POST',headers:{host:'erp.edge.invalid',...headers}},res=>{const chunks=[];res.on('data',value=>chunks.push(value));res.once('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));});req.once('error',reject);req.end(body);});
  await run({edge,upstream,url:'http://127.0.0.1:'+edgePort,request,journals,browser,setHandler:value=>handler=value,setLoad:value=>loads=value,calls:()=>calls});
 }finally{if(edge){edge.beginDrain();edge.server.closeAllConnections();await close(edge.server);}upstream.closeAllConnections();await close(upstream);http.globalAgent.destroy();http.globalAgent=agent;await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:25});}
}

test('expired UI documents, RSC and native Inquiry actions refuse before upstream',()=>fixture(async({request,calls})=>{
 for(const [url,headers,body] of [
  ['/',{'x-deployment-id':'erp_expired_build'}],
  ['/',{'x-deployment-id':'erp_expired_build',rsc:'1'}],
  ['/',{host:'inquiry.edge.invalid','x-deployment-id':'inquiry_expired_build','content-type':'application/x-www-form-urlencoded'},'$ACTION_ID_'+'d'.repeat(40)+'='],
 ])assert.equal((await request(url,headers,body)).status,409);
 assert.equal(calls(),0);
 assert.equal((await request('/',{'x-deployment-id':'erp_current_build'})).status,200);
}));

test('same-edge fence waits for preselection and preserves current-build service; forged proof refuses',()=>fixture(async({edge,request,setLoad,calls})=>{
 const gate=deferred();setLoad(gate);const pending=request('/',{'x-deployment-id':'erp_expired_build'});void pending.catch(()=>undefined);
 // Wait until the actual HTTP handler has entered its asynchronous selection.
 while(!edge.status().ui.active)await new Promise(resolve=>setImmediate(resolve));
 setLoad(null);
 await assert.rejects(edge.fenceBuilds({buildIds:['erp_current_build'],publicationSha256}),/BUILD_NOT_EXPIRED/);
 await assert.rejects(edge.fenceBuilds({buildIds:['erp_expired_build'],publicationSha256:'0'.repeat(64)}),/PUBLICATION_CHANGED/);
 const fence=await edge.fenceBuilds({buildIds:['erp_expired_build'],publicationSha256});
 await assert.rejects(edge.readBuildQuiescence(fence),/BUILD_PENDING/);
 gate.resolve();assert.equal((await pending).status,409);
 const completion=await edge.readBuildQuiescence(fence);
 const facts=await edgeModule.readOriginalBuildQuiescence(completion);
 assert.deepEqual(facts.buildIds,['erp_expired_build']);assert.equal(facts.publicationSha256,publicationSha256);
 await assert.rejects(edgeModule.readOriginalBuildQuiescence({...facts}),/QUIESCENCE_UNPROVEN/);
 assert.throws(()=>edgeModule.readOriginalBuildFence({...facts}),/FENCE_UNPROVEN/);
 assert.equal(calls(),0);
 assert.equal((await request('/api/auth/me',{'x-deployment-id':'erp_current_build'})).status,200);
 assert.equal((await request('/api/auth/me',{'x-deployment-id':'erp_expired_build'})).status,409);
 assert.equal(calls(),1);
}));

test('fence keeps admitted upstream ownership until genuine response completion',()=>fixture(async({edge,request,browser,setHandler})=>{
 const entered=deferred(),release=deferred();
 browser.builds[0].supportUntil=new Date(Date.now()+86400000).toISOString();
 setHandler((req,res)=>{req.resume();entered.resolve();void release.promise.then(()=>res.end('committed-response'));});
 const actual=request('/api/write',{'x-deployment-id':'erp_expired_build'},'mutation');void actual.catch(()=>undefined);
 await entered.promise;
 browser.generation++;browser.builds[0].supportUntil=new Date(Date.now()-86400000).toISOString();
 const fence=await edge.fenceBuilds({buildIds:['erp_expired_build'],publicationSha256});
 await assert.rejects(edge.readBuildQuiescence(fence),error=>error.code==='COMMON_EDGE_BUILD_PENDING'&&error.counts.active>0&&error.counts.api===1);
 release.resolve();assert.equal((await actual).status,200);
 let completion;for(let i=0;i<100&&!completion;i++)try{completion=await edge.readBuildQuiescence(fence);}catch(error){assert.equal(error.code,'COMMON_EDGE_BUILD_PENDING');await new Promise(resolve=>setTimeout(resolve,5));}
 assert.ok(completion);assert.equal((await edgeModule.readOriginalBuildQuiescence(completion)).counts.active,0);
}));

test('real aborted upstream remains UNKNOWN and cannot mint expired-build quiescence',()=>fixture(async({edge,request,browser,setHandler,journals})=>{
 browser.builds[0].supportUntil=new Date(Date.now()+86400000).toISOString();
 setHandler((req,res)=>{req.resume();res.writeHead(200);res.write('partial');res.socket.destroy();});
 assert.equal((await request('/api/write',{'x-deployment-id':'erp_expired_build'},'mutation')).status,502);
 browser.generation++;browser.builds[0].supportUntil=new Date(Date.now()-86400000).toISOString();
 const fence=await edge.fenceBuilds({buildIds:['erp_expired_build'],publicationSha256});
 await assert.rejects(edge.readBuildQuiescence(fence),error=>error.code==='COMMON_EDGE_BUILD_PENDING'&&error.counts.unknown===1&&error.counts.api===1);
 assert.equal((await journals.api.pending()).length,1);
}));

for(const ending of ['clean','abrupt'])test('per-build fence preserves real WebSocket until '+ending+' upstream closure; other build stays live',()=>fixture(async({edge,upstream,url,request,browser})=>{
 const wss=new WebSocketServer({noServer:true}),peers=[],clients=[];
 upstream.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,peer=>{peers.push(peer);peer.on('error',()=>{});}));
 const connect=async id=>{const client=new WebSocket(url.replace('http:','ws:')+'/socket.io/?EIO=4&transport=websocket&__sabalan_build='+id,{headers:{host:'erp.edge.invalid'}});clients.push(client);client.on('error',()=>{});await once(client,'open');return client;};
 try{
  browser.builds[0].supportUntil=new Date(Date.now()+86400000).toISOString();
  const old=await connect('erp_expired_build'),current=await connect('erp_current_build');
  browser.generation++;browser.builds[0].supportUntil=new Date(Date.now()-86400000).toISOString();
  const fence=await edge.fenceBuilds({buildIds:['erp_expired_build'],publicationSha256});
  await assert.rejects(edge.readBuildQuiescence(fence),error=>error.counts.socket===1&&error.counts.active>0);
  // A deadline/fence is not a fabricated WS Close. Original bytes still flow.
  const received=once(old,'message');peers[0].send('original-backend-still-owned');assert.equal(String((await received)[0]),'original-backend-still-owned');
  assert.equal((await request('/socket.io/?EIO=4&transport=polling&__sabalan_build=erp_expired_build')).status,409);
  await assert.rejects(connect('erp_expired_build'),/409/);
  const closed=once(old,'close');if(ending==='clean')peers[0].close();else peers[0].terminate();await closed;
  let proof;
  for(let i=0;i<100;i++){
   try{proof=await edge.readBuildQuiescence(fence);break;}catch(error){assert.equal(error.code,'COMMON_EDGE_BUILD_PENDING');if(ending==='abrupt'&&error.counts.unknown)break;await new Promise(resolve=>setTimeout(resolve,5));}
  }
  if(ending==='clean')assert.ok(await edgeModule.readOriginalBuildQuiescence(proof));
  else await assert.rejects(edge.readBuildQuiescence(fence),error=>error.counts.socket===1&&error.counts.unknown===1);
  assert.equal(current.readyState,WebSocket.OPEN);
 }finally{
  for(const client of clients)if(client.readyState===WebSocket.OPEN){const done=once(client,'close');client.close();await done;}
  for(const peer of peers)if(peer.readyState===WebSocket.OPEN)peer.close();
  await new Promise(resolve=>wss.close(resolve));
 }
}));

test('fenced upstream-issued polling session cannot admit GET, control POST or upgrade; its intent stays pending',()=>fixture(async({edge,upstream,url,request,browser,journals})=>{
 const transport=new SocketIoServer(upstream,{transports:['polling','websocket']});
 try{
  browser.builds[0].supportUntil=new Date(Date.now()+86400000).toISOString();
  const initial=await request('/socket.io/?EIO=4&transport=polling&__sabalan_build=erp_expired_build');
  assert.equal(initial.status,200);const sid=JSON.parse(initial.body.slice(1)).sid;assert.ok(sid);
  browser.generation++;browser.builds[0].supportUntil=new Date(Date.now()-86400000).toISOString();
  const fence=await edge.fenceBuilds({buildIds:['erp_expired_build'],publicationSha256});
  const query='/socket.io/?EIO=4&transport=polling&sid='+sid+'&__sabalan_build=erp_expired_build';
  assert.equal((await request(query)).status,409);
  assert.equal((await request(query,{},'1')).status,409);
  const upgrade=new WebSocket(url.replace('http:','ws:')+query.replace('transport=polling','transport=websocket'),{headers:{host:'erp.edge.invalid'}});
  await assert.rejects(once(upgrade,'open'),/409/);
  await assert.rejects(edge.readBuildQuiescence(fence),error=>error.counts.socket===1);
  assert.equal((await journals.socket.pending()).length,1,'fence never completes the original logical session');
  assert.equal((await request('/api/auth/me',{'x-deployment-id':'erp_current_build'})).status,200);
 }finally{await new Promise(resolve=>transport.close(resolve));}
}));

test('only original edge can close its fenced polling SID using actual Engine.IO close acknowledgement',()=>fixture(async({edge,upstream,request,browser,journals})=>{
 const transport=new SocketIoServer(upstream,{transports:['polling','websocket']});
 try{
  browser.builds[0].supportUntil=new Date(Date.now()+86400000).toISOString();
  const open=async id=>JSON.parse((await request('/socket.io/?EIO=4&transport=polling&__sabalan_build='+id)).body.slice(1)).sid;
  const old=await open('erp_expired_build'),current=await open('erp_current_build');
  const foreignRaw=await (await fetch('http://127.0.0.1:'+upstream.address().port+'/socket.io/?EIO=4&transport=polling')).text();
  const foreign=JSON.parse(foreignRaw.slice(1)).sid;assert.ok(transport.engine.clients[foreign]);
  await assert.rejects(edge.closeFencedPollingSessions({}),/FENCE_UNPROVEN/);
  browser.generation++;browser.builds[0].supportUntil=new Date(Date.now()-86400000).toISOString();
  const fence=await edge.fenceBuilds({buildIds:['erp_expired_build'],publicationSha256});
  assert.equal((await request('/socket.io/?EIO=4&transport=polling&sid='+old+'&__sabalan_build=erp_expired_build',{},'1')).status,409);
  const result=await edge.closeFencedPollingSessions(fence);assert.equal(result.closed,1,JSON.stringify(result));assert.equal(result.pending,0);
  assert.equal(transport.engine.clients[old],undefined);assert.ok(transport.engine.clients[current]);
  assert.ok(transport.engine.clients[foreign],'unobserved upstream SID cannot be closed by the fence');
  assert.equal((await journals.socket.pending()).length,1,'other build original SID stays owned');
  assert.ok(await edgeModule.readOriginalBuildQuiescence(await edge.readBuildQuiescence(fence)));
  assert.equal((await edge.closeFencedPollingSessions(fence)).closed,0,'repeat cannot emit a new control after original close');
 }finally{await new Promise(resolve=>transport.close(resolve));}
}));

test('aborted original edge close retains both original polling and control intents; retry never re-emits',()=>fixture(async({edge,upstream,request,browser,journals})=>{
 const transport=new SocketIoServer(upstream,{transports:['polling','websocket']});let controls=0;
 try{
  browser.builds[0].supportUntil=new Date(Date.now()+86400000).toISOString();
  const open=await request('/socket.io/?EIO=4&transport=polling&__sabalan_build=erp_expired_build'),sid=JSON.parse(open.body.slice(1)).sid;
  const handlers=upstream.listeners('request');upstream.removeAllListeners('request');
  upstream.on('request',(req,res)=>{
   if(req.method==='POST'&&new URL(req.url,'http://upstream.invalid').searchParams.get('sid')===sid){controls++;req.resume();res.destroy();return;}
   for(const handler of handlers)handler.call(upstream,req,res);
  });
  browser.generation++;browser.builds[0].supportUntil=new Date(Date.now()-86400000).toISOString();
  const fence=await edge.fenceBuilds({buildIds:['erp_expired_build'],publicationSha256});
  const result=await edge.closeFencedPollingSessions(fence);assert.equal(result.closed,0);assert.equal(result.pending,1);
  assert.equal((await journals.socket.pending()).length,2);
  await assert.rejects(edge.readBuildQuiescence(fence),error=>error.counts.socket===2&&error.counts.unknown===1);
  assert.equal((await edge.closeFencedPollingSessions(fence)).pending,1);assert.equal(controls,1);
  assert.ok(transport.engine.clients[sid]);
 }finally{await new Promise(resolve=>transport.close(resolve));}
}));

test('original edge close also settles an already-admitted long polling GET through actual upstream end',()=>fixture(async({edge,upstream,request,browser,journals})=>{
 const transport=new SocketIoServer(upstream,{transports:['polling','websocket']});
 try{
  browser.builds[0].supportUntil=new Date(Date.now()+86400000).toISOString();
  const initial=await request('/socket.io/?EIO=4&transport=polling&__sabalan_build=erp_expired_build'),sid=JSON.parse(initial.body.slice(1)).sid;
  const poll=request('/socket.io/?EIO=4&transport=polling&sid='+sid+'&__sabalan_build=erp_expired_build');void poll.catch(()=>undefined);
  while((await journals.socket.pending()).length!==2)await new Promise(resolve=>setTimeout(resolve,5));
  browser.generation++;browser.builds[0].supportUntil=new Date(Date.now()-86400000).toISOString();
  const fence=await edge.fenceBuilds({buildIds:['erp_expired_build'],publicationSha256});
  const outcome=await edge.closeFencedPollingSessions(fence);assert.equal(outcome.closed,1);
  assert.equal((await poll).status,200);
  for(let i=0;i<100&&edge.status().socket.active;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(await edgeModule.readOriginalBuildQuiescence(await edge.readBuildQuiescence(fence)));
 }finally{await new Promise(resolve=>transport.close(resolve));}
}));
