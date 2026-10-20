import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import dns from 'node:dns';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {randomBytes,createHash} from 'node:crypto';
import {createCommonReleaseEdge} from '../../deploy/scripts/common-release-edge.mjs';
import {socketRequestIdentity,readOriginalSocketStoppedEvidence} from '../../deploy/scripts/socket-release-proxy.mjs';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';
import {apiRoutingSnapshot} from '../../deploy/scripts/api-release-routing.mjs';

const repository=process.env.SABALAN_TEST_REPOSITORY_ROOT || path.resolve(import.meta.dirname,'../..');
const backend=createRequire(path.join(repository,'backend/package.json'));
const frontend=createRequire(path.join(repository,'frontend/package.json'));
const {Server}=backend('socket.io'),{io}=frontend('socket.io-client');
const image='sha256:'+'a'.repeat(64),manifest='b'.repeat(64);
const listen=async (server,port=0)=>{server.listen(port,'127.0.0.1');await once(server,'listening');return server.address().port;};
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
const until=async predicate=>{const end=Date.now()+5000;while(!await predicate()){assert.ok(Date.now()<end,'transport did not naturally close');await new Promise(resolve=>setTimeout(resolve,10));}};
const request=(url,headers={},body)=>new Promise((resolve,reject)=>{
  const outgoing=http.request(url,{method:body===undefined?'GET':'POST',headers:{host:'erp.edge.invalid',
    ...(body===undefined?{}:{'content-length':String(body.length)}),...headers}},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(Buffer.from(chunk)));response.once('error',reject);
    response.once('end',()=>resolve({status:response.statusCode,text:async()=>Buffer.concat(chunks).toString()}));
  });outgoing.once('error',reject);outgoing.end(body);
});

test('socket query rejects duplicate/conflicting owners and preserves opaque application query bytes',()=>{
  const req=url=>({url,method:'POST',headers:{'x-deployment-id':'erp_socket_producer_a'}});
  const q='/socket.io/?EIO=4&transport=polling&sid=ABC_123&t=a%2Bb&__sabalan_build=erp_socket_producer_a';
  assert.deepEqual(socketRequestIdentity(req(q),false),{deploymentId:'erp_socket_producer_a',sid:'ABC_123',path:'/socket.io/?EIO=4&transport=polling&sid=ABC_123&t=a%2Bb'});
  assert.throws(()=>socketRequestIdentity(req(q+'&__sabalan_build=erp_socket_producer_a'),false),/SOCKET_QUERY_AMBIGUOUS/);
  assert.throws(()=>socketRequestIdentity(req(q.replace('build=erp_socket_producer_a','build=erp_socket_producer_b')),false),/SOCKET_BUILD_ID_INVALID/);
  assert.throws(()=>socketRequestIdentity(req(q.replace('transport=polling','transport=websocket')),false),/SOCKET_PROTOCOL_INVALID/);
});

/** Real Engine.IO polling/upgrade transport; synthetic producer servers below
 * qualify transport only. Canonical auth, real UI and SQL belong to the native
 * joined application fixture, not these deliberately small unit endpoints. */
for (const ending of ['clean','abrupt']) test('one edge keeps real old/new Socket.IO producers, cookies, polling upgrade and '+ending+' retirement ownership', {timeout:30000}, async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-common-edge-'));
  const originalAgent=http.globalAgent;
  http.globalAgent=new http.Agent({lookup:(host,options,done)=>dns.lookup(/^(backend|frontend|inquiry)-[ab]$/.test(host)?'127.0.0.1':host,options,done)});
  const servers=[],ios=[],clients=[],observed=[];let ordinaryRequests=0;
  let edge;
  try {
    const endpoints=[];
    for(const label of ['a','b']) {
      const server=http.createServer((req,res)=>{ordinaryRequests++;req.resume();res.writeHead(200,{'content-type':'text/plain'});res.end('producer-'+label);});servers.push(server);
      const transport=new Server(server,{transports:['polling','websocket'],allowUpgrades:true});ios.push(transport);
      transport.use((socket,next)=>socket.handshake.headers.cookie==='sabalan_session=actual-test-cookie'
        && socket.handshake.auth.expectedUserId==='user-one'?next():next(Error('Authentication required')));
      transport.on('connection',socket=>{observed.push({label,headers:socket.handshake.headers});socket.emit('producer',label);});
      const port=await listen(server);endpoints.push({slotId:'backend_slot_'+label,host:'backend-'+label,port,image,manifestSha256:manifest});
    }
    const journals={};for(const key of ['ui','api','socket']) {const directory=path.join(root,key);await fs.mkdir(directory,{mode:0o700});
      journals[key]=new BrowserOperationJournal({directory,instanceId:randomBytes(32).toString('hex')});await journals[key].initialize();}
    const build=(id,application,slotId)=>({id,application,slotId,image,manifestSha256:manifest,assets:[],actionIds:[],retiredAt:null,supportUntil:null});
    let registry={format:'sabalan-browser-routing/v2',generation:1,current:{erp:'erp_socket_producer_a',inquiry:'inquiry_socket_a'},
      legacy:{erp:'erp_socket_producer_a',inquiry:null},builds:[build('erp_socket_producer_a','erp','frontend_slot_a'),build('inquiry_socket_a','inquiry','inquiry_slot_a')],
      apiBindings:[{buildId:'erp_socket_producer_a',browserManifestSha256:manifest,...endpoints[0]}].map(({host,port,...binding})=>binding)};
    let snapshot=()=>apiRoutingSnapshot(registry);
    // Browser-compatible XHR implementations retain the actual origin Host
    // instead of accepting an overridden Host header. Provision that exact
    // private test origin in addition to the explicit ERP/Inquiry hosts.
    const reservation=http.createServer(),port=await listen(reservation);await close(reservation);
    edge=createCommonReleaseEdge({loadSnapshot:async()=>snapshot(),backendEndpoints:endpoints,
      uiEndpoints:[{slotId:'frontend_slot_a',host:'frontend-a',port:endpoints[0].port,image},
        {slotId:'frontend_slot_b',host:'frontend-b',port:endpoints[1].port,image},{slotId:'inquiry_slot_a',host:'inquiry-a',port:endpoints[0].port,image}],
      applicationsByHost:{'erp.edge.invalid':'erp','inquiry.edge.invalid':'inquiry',['127.0.0.1:'+port]:'erp'},journals,timeoutMs:5000,
      bodyLimit:32,totalBodyLimit:64});
    await listen(edge.server,port);const url='http://127.0.0.1:'+port;
    const legacy=structuredClone(registry);legacy.format='sabalan-browser-routing/v1';delete legacy.apiBindings;
    snapshot=()=>({browser:legacy,api:apiRoutingSnapshot(registry).api});
    const refused=await request(url+'/');assert.equal(refused.status,503);assert.match(await refused.text(),/COMMON_EDGE_PAIRED_PUBLICATION_REQUIRED/);
    assert.equal(ordinaryRequests,0,'v1 common-edge input must refuse UI before upstream');
    snapshot=()=>apiRoutingSnapshot(registry);
    const inquiry=await request(url+'/',{host:'inquiry.edge.invalid'});assert.equal(inquiry.status,200);assert.equal(await inquiry.text(),'producer-a');
    const api=await request(url+'/api/auth/me',{'x-deployment-id':'erp_socket_producer_a'});assert.equal(api.status,200);assert.equal(await api.text(),'producer-a');
    const acceptedBody=await request(url+'/api/transport-size-proof',{'x-deployment-id':'erp_socket_producer_a'},Buffer.alloc(32));
    assert.equal(acceptedBody.status,200);await acceptedBody.text();
    const requestsBefore=ordinaryRequests;
    const refusedBody=await request(url+'/api/transport-size-proof',{'x-deployment-id':'erp_socket_producer_a'},Buffer.alloc(33));
    assert.equal(refusedBody.status,413);await refusedBody.text();assert.equal(ordinaryRequests,requestsBefore);
    async function connect(buildId,transports,upgrade=true,cookie='sabalan_session=actual-test-cookie') {
      const client=io(url,{autoConnect:false,forceNew:true,reconnection:false,timeout:3000,transports,upgrade,
        query:{__sabalan_build:buildId},auth:{expectedUserId:'user-one'},extraHeaders:{host:'erp.edge.invalid',cookie}});
      clients.push(client);const result=new Promise((resolve,reject)=>{client.once('producer',resolve);client.once('connect_error',reject);});client.connect();return {client,producer:await result};
    }
    const old=await connect('erp_socket_producer_a',['polling','websocket']);assert.equal(old.producer,'a');
    await until(()=>old.client.io.engine.transport.name==='websocket');
    registry=structuredClone(registry);registry.generation++;
    registry.builds[0].retiredAt=new Date().toISOString();registry.builds[0].supportUntil=new Date(Date.now()+86400000).toISOString();
    registry.builds.push(build('erp_socket_producer_b','erp','frontend_slot_b'));registry.current.erp='erp_socket_producer_b';
    registry.apiBindings.push({buildId:'erp_socket_producer_b',browserManifestSha256:manifest,slotId:endpoints[1].slotId,image,manifestSha256:manifest});
    const newer=await connect('erp_socket_producer_b',['websocket']);assert.equal(newer.producer,'b');
    const oldPolling=await connect('erp_socket_producer_a',['polling'],false);assert.equal(oldPolling.producer,'a');
    assert.equal(old.client.connected,true);assert.equal(newer.client.connected,true);
    assert.ok(observed.every(row=>row.headers.cookie==='sabalan_session=actual-test-cookie'));
    await assert.rejects(connect('erp_socket_producer_b',['websocket'],true,'sabalan_session=forged'),/Authentication required/);
    // New handshakes after support expiry refuse; a live old transport is not
    // silently switched or confused with application/capture completion.
    registry=structuredClone(registry);registry.generation++;
    registry.builds[0].retiredAt=new Date(Date.now()-2*86400000).toISOString();registry.builds[0].supportUntil=new Date(Date.now()-86400000).toISOString();
    const expired=await request(url+'/socket.io/?EIO=4&transport=polling&__sabalan_build=erp_socket_producer_a');assert.equal(expired.status,409);await expired.text();
    assert.equal(old.client.connected,true);
    const interrupted=ending==='abrupt'?await connect('erp_socket_producer_b',['websocket']):null;
    edge.beginDrain();await assert.rejects(edge.assertDrained(),/DRAIN_NOT_PROVEN/);
    if(interrupted)interrupted.client.io.engine.transport.ws.terminate();
    for(const client of clients)if(client!==interrupted?.client)client.disconnect();
    await until(()=>edge.status().socket.active===0);
    if(interrupted) {
      assert.ok(edge.status().socket.unresolved>0);assert.ok((await journals.socket.pending()).length>0);
      await assert.rejects(edge.assertDrained(),/DRAIN_NOT_PROVEN/);
      await assert.rejects(edge.readStoppedTransport(),/COMMON_EDGE_LISTENER_NOT_STOPPED/);
      await close(edge.server);
      const stopped=await edge.readStoppedTransport();assert.equal(stopped.socket.transportClosed,true);
      assert.equal(stopped.socket.semanticOutcome,'UNKNOWN_REQUIRES_ORIGINAL_BACKEND_RETIREMENT');
      assert.equal(await readOriginalSocketStoppedEvidence(stopped.socket),stopped.socket);
      await assert.rejects(readOriginalSocketStoppedEvidence(JSON.parse(JSON.stringify(stopped.socket))),/SOCKET_ORIGINAL_STOPPED_EVIDENCE_UNPROVEN/);
      for(const value of stopped.socket.pendingEvidence) {
        const raw=await fs.readFile(path.join(root,'socket',value.intent.id+'.intent.json'));
        assert.equal(value.intentSha256,createHash('sha256').update(raw).digest('hex'));
      }
      const replacement=new BrowserOperationJournal({directory:path.join(root,'socket'),instanceId:randomBytes(32).toString('hex')});
      await replacement.initialize();await assert.rejects(replacement.originalPendingEvidence(),/BROWSER_JOURNAL_NOT_OWNED/);
      // Closed transport requirements are not completion or retirement proof.
      assert.ok((await journals.socket.pending()).length>0);await assert.rejects(edge.assertDrained(),/DRAIN_NOT_PROVEN/);
      console.log(JSON.stringify({heldJournalRoot:root,abruptTransportWasNotSettled:true}));
    } else {await edge.assertDrained();assert.equal((await journals.socket.pending()).length,0);}
  } finally {
    for(const client of clients)client.disconnect();
    for(const transport of ios)await new Promise(resolve=>transport.close(resolve));
    if(edge?.server.listening)await close(edge.server);
    for(const server of servers)if(server.listening)await close(server);
    http.globalAgent.destroy();http.globalAgent=originalAgent;
    // Cleanup this test's own temporary directory only after owned transports
    // close. A held journal must remain available on any failed drain assertion.
    if(edge && edge.status().socket.unresolved===0 && edge.status().socket.active===0)await fs.rm(root,{recursive:true});
  }
});
