import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dns from 'node:dns';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createSocketReleaseProxy,readOriginalSocketStoppedEvidence} from '../../deploy/scripts/socket-release-proxy.mjs';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';
import {apiRoutingSnapshot} from '../../deploy/scripts/api-release-routing.mjs';
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
const close=server=>new Promise(resolve=>server.close(resolve));
const until=async fn=>{const end=Date.now()+10000;while(!await fn()){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,10));}};
for(const limit of [128,256])test(limit+' polling sessions retain progress slots, next refuses before upstream, interrupted POST preserves genuine custody', {timeout:60000},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-socket-budget-'));
  const dir=path.join(root,'journal');await fs.mkdir(dir,{mode:0o700});
  const journal=new BrowserOperationJournal({directory:dir,instanceId:randomBytes(32).toString('hex')});await journal.initialize();
  const original=http.globalAgent;
  http.globalAgent=new http.Agent({keepAlive:false,lookup:(host,options,done)=>dns.lookup(host==='backend-owned'?'127.0.0.1':host,options,done)});
  let sequence=0,forwarded=0,postOperationId;const held=new Map();const upstream=http.createServer(async(req,res)=>{
    forwarded++;const query=new URL(req.url,'http://upstream').searchParams,sid=query.get('sid');
    const body=[];for await(const chunk of req)body.push(chunk);
    if(req.method==='GET'&&!sid)res.end('0'+JSON.stringify({sid:'actual_'+(++sequence),upgrades:[],pingInterval:60000,pingTimeout:60000}));
    else if(req.method==='GET'&&query.get('hold')==='true')held.set(sid,res);
    else if(req.method==='POST'&&Buffer.concat(body).toString().startsWith('40')){postOperationId=req.headers['x-sabalan-proxy-operation-id'];req.socket.destroy();}
    else if(req.method==='POST'&&Buffer.concat(body).toString()==='1'){held.get(sid)?.end('1');held.delete(sid);res.end('ok');}
    else res.end(req.method==='POST'?'ok':'2');
  });
  let edge;
  try {
    const port=await listen(upstream),image='sha256:'+'a'.repeat(64),hash='b'.repeat(64),buildId='erp_budget_producer_a';
    const snapshot=apiRoutingSnapshot({format:'sabalan-browser-routing/v2',generation:1,current:{erp:buildId,inquiry:'inquiry_budget_a'},
      legacy:{erp:buildId,inquiry:null},builds:[{id:buildId,application:'erp',slotId:'frontend_budget_a',image,manifestSha256:hash,
        assets:[],actionIds:[],retiredAt:null,supportUntil:null},{id:'inquiry_budget_a',application:'inquiry',slotId:'inquiry_budget_a',image,
        manifestSha256:hash,assets:[],actionIds:[],retiredAt:null,supportUntil:null}],
      apiBindings:[{buildId,browserManifestSha256:hash,slotId:'backend_budget_a',image,manifestSha256:hash}]});
    const options={loadSnapshot:async()=>snapshot,slotEndpoints:[{slotId:'backend_budget_a',host:'backend-owned',port,image,manifestSha256:hash}],
      applicationsByHost:{'erp.budget.invalid':'erp'},operationJournal:journal,...(limit===128?{connectionLimit:limit}:{})};
    if(!process.env.SABALAN_SOCKET_BASELINE)assert.throws(()=>createSocketReleaseProxy({...options,connectionLimit:257}),/SOCKET_PROXY_CONFIGURATION_INVALID/);
    edge=createSocketReleaseProxy(options);const edgePort=await listen(edge.server);
    const request=(sid,body,hold=false)=>new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port:edgePort,path:'/socket.io/?EIO=4&transport=polling'+(sid?'&sid='+sid:'')+(hold?'&hold=true':''),
        method:body===undefined?'GET':'POST',agent:false,headers:{host:'erp.budget.invalid',...(body===undefined?{}:{'content-length':Buffer.byteLength(body)})}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.once('end',()=>resolve({status:res.statusCode,
          id:res.headers['x-sabalan-proxy-operation-id'],text:Buffer.concat(chunks).toString()}));res.once('error',reject);
      });req.once('error',reject);req.end(body);
    });
    const sessions=[];
    for(let batch=0;batch<limit/8;batch++)for(const result of await Promise.all(Array.from({length:8},()=>request()))) {
      assert.equal(result.status,200);sessions.push({sid:JSON.parse(result.text.slice(1)).sid,id:result.id});
    }
    if(!process.env.SABALAN_SOCKET_BASELINE){assert.equal(edge.status().reservedConnections,limit);assert.equal(edge.status().reservedIntents,limit*4);}
    const before=forwarded;assert.equal((await request()).status,503);assert.equal(forwarded,before);
    const polling=[],pollingErrors=[];
    for(let batch=0;batch<limit/8;batch++) {
      for(const session of sessions.slice(batch*8,(batch+1)*8)){
        const task=request(session.sid,undefined,true);polling.push(task);void task.catch(error=>pollingErrors.push(error));
      }
      await until(()=>{if(pollingErrors.length)throw pollingErrors[0];return held.size===(batch+1)*8;});
    }
    const allEvidence=await journal.originalPendingEvidence();assert.equal(allEvidence.length,limit*2);
    assert.ok(Buffer.byteLength(JSON.stringify(allEvidence))<4*1024*1024,'all original intent evidence fits bounded whole certificate');
    const failed=await request(sessions[0].sid,'40{"expectedUserId":"user"}');assert.equal(failed.status,502);
    held.get(sessions[0].sid).end('2');held.delete(sessions[0].sid);
    const beforeDuplicate=forwarded;assert.equal((await request(sessions[0].sid,'1')).status,503);assert.equal(forwarded,beforeDuplicate);
    for(let batch=0;batch<limit/8;batch++)await Promise.all(sessions.slice(Math.max(1,batch*8),(batch+1)*8).map(async session=>{
      assert.equal((await request(session.sid,'1')).status,200,'owned close POST works even when new sessions are refused');
    }));
    await Promise.all(polling);
    edge.beginDrain();await close(edge.server);upstream.closeAllConnections();await close(upstream);
    await until(()=>edge.status().active===0);
    const stopped=await edge.readStoppedTransport();assert.equal(stopped.pendingEvidence.length,2);
    const facts=await readOriginalSocketStoppedEvidence(stopped),post=facts.closedOperations.find(value=>value.intentId===postOperationId);
    assert.equal(post.method,'POST');assert.deepEqual(post.control,{protocol:'EIO4',transport:'polling',path:'/socket.io/',
      sessionId:sessions[0].sid,sessionIntentId:sessions[0].id,sessionSource:'UPSTREAM_ISSUED'});
    assert.ok(facts.closedSessions.some(value=>value.sid===post.control.sessionId&&value.intentId===post.control.sessionIntentId));
    assert.ok(Object.isFrozen(post.control));await assert.rejects(readOriginalSocketStoppedEvidence(JSON.parse(JSON.stringify(stopped))));
    await assert.rejects(edge.assertDrained());assert.equal((await journal.pending()).find(value=>value.id===postOperationId).method,'POST');
    console.log(JSON.stringify({heldJournalRoot:root,pollingSessions:limit,nextNewSessionRefused:true,actualPostUnknownRetained:true,
      nativeBackendQualified:false}));
  }finally{
    for(const response of held.values())response.end('2');
    if(edge?.server.listening)await close(edge.server);upstream.closeAllConnections();if(upstream.listening)await close(upstream);
    http.globalAgent.destroy();http.globalAgent=original;
  }
});
