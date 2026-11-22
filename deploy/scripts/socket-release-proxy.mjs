import {originalForwardedHeaders} from './release-forwarding.mjs';
import {assertReleaseEndpointCatalog,readReleaseEndpoint} from './release-endpoint-catalog.mjs';
import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {compileApiRoutingRegistry,selectApiRelease,apiRoutingIdentity} from './api-release-routing.mjs';

const fail=(code,status=503)=>Object.assign(new Error(code),{code,status});
const name=/^[a-z][a-z0-9_-]{7,95}$/;
const originalStoppedEvidence=new WeakMap();

/** Only receipts minted by an actual original Socket factory are capabilities.
 * Deserializing displayed JSON cannot grant transport or retirement authority.
 * The separate original-controller bridge must still prove backend/native SQL
 * retirement and the immutable read-only protocol before issuing its decision. */
export async function readOriginalSocketStoppedEvidence(evidence) {
  const owner=originalStoppedEvidence.get(evidence);
  if(!owner)throw fail('SOCKET_ORIGINAL_STOPPED_EVIDENCE_UNPROVEN');
  await owner.revalidate();return evidence;
}
const excluded=new Set(['connection','proxy-connection','keep-alive','te','trailer','transfer-encoding','upgrade','proxy-authorization','proxy-authenticate']);
function headers(value) {
  const blocked=new Set([...excluded,...String(value.connection||'').toLowerCase().split(',').map(key=>key.trim())]);
  return Object.fromEntries(Object.entries(value).filter(([key])=>!blocked.has(key.toLowerCase())));
}
function respond(response,status,code) {
  if(response.destroyed || response.headersSent)return;
  response.writeHead(status,{'content-type':'text/plain','cache-control':'no-store, private'});response.end(code);
}

/** Constant-memory protocol closure evidence. TCP FIN alone can be an abrupt
 * disconnect (including ws.terminate), so it cannot settle an upgraded stream.
 * Inspect only frame headers and consume lengths; application payload stays
 * opaque and is never buffered, acknowledged, interpreted or replayed. */
function webSocketClosure(masked) {
  let header=[],required=2,remaining=0n,isClose=false,closed=false,invalid=false;
  const finish=()=>{if(isClose)closed=true;header=[];required=2;isClose=false;};
  return {
    feed(chunk) {
      let offset=0;
      while(offset<chunk.length && !invalid) {
        if(remaining>0n) {
          const available=BigInt(chunk.length-offset),count=Number(remaining<available?remaining:available);
          remaining-=BigInt(count);offset+=count;if(remaining===0n)finish();continue;
        }
        if(closed){invalid=true;break;}
        header.push(chunk[offset++]);
        if(header.length===2) {
          const short=header[1]&127;required=2+(short===126?2:short===127?8:0)+(masked?4:0);
          if(Boolean(header[1]&128)!==masked)invalid=true;
        }
        if(header.length!==required || header.length<2)continue;
        const opcode=header[0]&15,short=header[1]&127;
        if(![0,1,2,8,9,10].includes(opcode)){invalid=true;break;}
        let size=BigInt(short);
        if(short===126)size=BigInt(header[2]*256+header[3]);
        if(short===127){size=0n;for(let i=2;i<10;i++)size=size*256n+BigInt(header[i]);if(header[2]&128)invalid=true;}
        if(opcode>=8 && (!(header[0]&128) || (header[0]&0x70)!==0 || size>125n))invalid=true;
        isClose=opcode===8;if(isClose && size===1n)invalid=true;
        remaining=size;if(remaining===0n)finish();
      }
    },
    complete(){return closed && !invalid && header.length===0 && remaining===0n;},
  };
}

/** Producer selection grants no session or domain authority. The canonical
 * Socket.IO server still validates the authoritative cookie and expected user.
 * Every Engine.IO request carries the same compiled producer query; browser
 * WebSocket handshakes cannot attach the ordinary API build header. */
export function socketRequestIdentity(request,upgrade) {
  const raw=request.url;
  if(typeof raw!=='string' || !raw.startsWith('/') || raw.startsWith('//') || /\\|%(?:2f|5c|25|00)/i.test(raw.split('?')[0]))throw fail('SOCKET_PATH_INVALID',400);
  const url=new URL(raw,'http://socket.invalid');
  if(url.hash || url.pathname!=='/socket.io/')throw fail('SOCKET_PATH_INVALID',400);
  const one=key=>{const values=url.searchParams.getAll(key);if(values.length>1)throw fail('SOCKET_QUERY_AMBIGUOUS',400);return values[0]??null;};
  const build=one('__sabalan_build'),header=request.headers['x-deployment-id'];
  if(build!==null && !name.test(build) || header!==undefined && (typeof header!=='string' || !name.test(header))
    || build!==null && header!==undefined && build!==header)throw fail('SOCKET_BUILD_ID_INVALID',400);
  if(one('EIO')!=='4' || one('transport')!==(upgrade?'websocket':'polling'))throw fail('SOCKET_PROTOCOL_INVALID',400);
  const sid=one('sid');if(sid!==null && !/^[A-Za-z0-9_-]{1,128}$/.test(sid))throw fail('SOCKET_SESSION_ID_INVALID',400);
  if(upgrade ? request.method!=='GET' : !['GET','POST'].includes(request.method))throw fail('SOCKET_METHOD_INVALID',405);
  const at=raw.indexOf('?'),parts=at===-1?[]:raw.slice(at+1).split('&');
  const kept=parts.filter(part=>!new URLSearchParams(part).has('__sabalan_build'));
  return {deploymentId:build??header,sid,path:raw.slice(0,at===-1?raw.length:at)+(kept.length?'?'+kept.join('&'):'')};
}

/** Private transport only, with no listener or release-admission authority.
 * Idle upgraded sockets own transport custody, not application write work.
 * Capture fences actual backend callback completion separately. There is no
 * failover, replay, application-payload inspection, synthetic acknowledgement or forced drain. */
export function createSocketReleaseProxy({loadSnapshot,slotEndpoints=[],endpointCatalog,ingressTrust,applicationsByHost,operationJournal,admission,
  timeoutMs=90000,bodyLimit=1024*1024,totalBodyLimit=8*1024*1024,connectionLimit=256}) {
  if(typeof loadSnapshot!=='function' || !operationJournal || typeof operationJournal.begin!=='function'
    || typeof operationJournal.complete!=='function' || typeof operationJournal.pending!=='function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>240000
    || !Number.isSafeInteger(bodyLimit) || bodyLimit<1 || !Number.isSafeInteger(totalBodyLimit) || totalBodyLimit<bodyLimit
    || !Number.isSafeInteger(connectionLimit) || connectionLimit<1 || connectionLimit>256)throw fail('SOCKET_PROXY_CONFIGURATION_INVALID');
  if(endpointCatalog)assertReleaseEndpointCatalog(endpointCatalog);
  const endpoints=new Map(),hosts=new Map(Object.entries(applicationsByHost));
  for(const endpoint of slotEndpoints) {
    if(!name.test(endpoint.slotId) || endpoints.has(endpoint.slotId) || !/^backend(?:-[a-z0-9]+)*$/.test(endpoint.host)
      || !Number.isInteger(endpoint.port) || endpoint.port<1024 || endpoint.port>65535
      || !/^sha256:[a-f0-9]{64}$/.test(endpoint.image) || !/^[a-f0-9]{64}$/.test(endpoint.manifestSha256))throw fail('SOCKET_PROXY_ENDPOINT_INVALID');
    endpoints.set(endpoint.slotId,Object.freeze({...endpoint}));
  }
  if(!hosts.size || [...hosts.values()].some(value=>value!=='erp'))throw fail('SOCKET_PROXY_HOST_INVALID');
  const socketInstanceId=randomBytes(32).toString('hex');
  let accepting=true,bodyBytes=0,generation=0,registryIdentity=null;
  const active=new Set(),unresolved=new Set(),outbound=new Set(),sessions=new Map(),socketFacts=new WeakMap();
  const reservations=new Set();let reservedIntents=0;
  let initialAdmission;
  async function reserveOperation(operation,selected,upgrade) {
    initialAdmission??=operationJournal.originalPendingEvidence().then(values=>{
      if(values.length)throw fail('SOCKET_JOURNAL_ORIGINAL_ADMISSION_UNPROVEN');
    });
    await initialAdmission;
    const session=selected.identity.sid?sessions.get(selected.identity.sid):null;
    if(selected.identity.sid&&(!session||session!==selected.session||session.state!=='ACTIVE'))
      throw fail('SOCKET_SESSION_OWNER_UNPROVEN',400);
    const progress=upgrade?'upgrade':operation.method;
    if(session) {
      const prior=session.progress.get(progress);
      if(prior) {
        if(session.waitingProgress.has(progress))throw fail('SOCKET_SESSION_PROGRESS_CAPACITY',503);
        session.waitingProgress.add(progress);
        try{await prior.finished;}finally{session.waitingProgress.delete(progress);}
        if(sessions.get(selected.identity.sid)!==session||session.state!=='ACTIVE')throw fail('SOCKET_SESSION_OWNER_UNPROVEN',400);
      }
      session.progress.set(progress,operation);operation.session=session;operation.progress=progress;
      operation.reservation=session.reservation;
    } else {
      const cost=upgrade?1:4;
      if(reservations.size>=connectionLimit || reservedIntents+cost>1024)throw fail('SOCKET_PROXY_CAPACITY',503);
      const reservation={cost,pending:new Set()};reservations.add(reservation);reservedIntents+=cost;
      operation.reservation=reservation;
    }
    operation.reservation.pending.add(operation);
    operation.finished=new Promise((resolve,reject)=>{operation.finishProgress=resolve;operation.failProgress=reject;});
    void operation.finished.catch(()=>undefined);
  }
  async function completeOperation(operation,outcome) {
    await operationJournal.complete(operation.intentId,outcome);
    const reservation=operation.reservation;
    reservation.pending.delete(operation);
    if(operation.progress)operation.session.progress.delete(operation.progress);
    if(!reservation.pending.size&&reservations.delete(reservation))reservedIntents-=reservation.cost;
    operation.finishProgress();
  }
  function observeSocket(socket) {
    let fact=socketFacts.get(socket);
    if(!fact) {
      fact={closed:false,listeners:[]};socketFacts.set(socket,fact);
      socket.once('close',()=>{fact.closed=true;for(const done of fact.listeners)done();fact.listeners=[];});
    }
    return fact;
  }
  function attachSocket(session,fact,kind) {
    if(!fact)return;
    const seen=session[kind+'Seen'],live=session[kind+'Live'];
    if(seen.has(fact))return;seen.add(fact);
    if(fact.closed){session[kind+'Closed']++;return;}
    live.add(fact);fact.listeners.push(()=>{live.delete(fact);session[kind+'Closed']++;});
  }
  function attachOperation(session,operation) {
    attachSocket(session,operation.clientFact,'client');attachSocket(session,operation.upstreamFact,'upstream');
  }
  async function closeSession(sid) {
    const session=sessions.get(sid);
    if(!session)return;
    if(session.originalCloseBarrier)await session.originalCloseBarrier;
    if(session.state==='CLOSING')return await session.completion;
    if(session.state!=='ACTIVE')throw fail('SOCKET_SESSION_COMPLETION_UNPROVEN');
    session.state='CLOSING';
    session.completion=(async()=>{
      try {await completeOperation(session.baseOperation,'UPSTREAM_ENDED');sessions.delete(sid);}
      catch(error){session.state='HELD';throw error;}
    })();
    return await session.completion;
  }
  async function closeOriginalPollingSession(session){
    const operation={kind:'polling',method:'POST',clientFact:null,requestClosed:false,upstreamFact:null,
      ticket:admission.beginClose(session.buildId)};
    active.add(operation);let forwarded=false,completed=false,acknowledge,refuse;
    try{
      await reserveOperation(operation,{identity:{sid:session.sid},session},false);
      // Existing GET may receive the close packet concurrently. Its logical
      // session completion must also wait for this original control's actual
      // response and socket closure, never just for seeing a packet byte.
      session.originalCloseBarrier=new Promise((resolve,reject)=>{acknowledge=resolve;refuse=reject;});
      void session.originalCloseBarrier.catch(()=>undefined);
      const source=session.pollingOwner;
      operation.intentId=await operationJournal.begin({registryIdentity:source.hash,generation:source.generation,
        buildId:session.buildId,slotId:session.slotId,image:session.image,manifestSha256:session.manifestSha256,method:'POST'});
      await new Promise((resolve,reject)=>{
        let ended=false,requestClosed=false,socketClosed=false,valid=false,bytes=0;const chunks=[];
        const check=()=>{if(ended&&requestClosed&&socketClosed){if(valid)resolve();else reject(fail('SOCKET_OWNED_CLOSE_UNPROVEN'));}};
        const outgoing=http.request({hostname:source.endpoint.host,port:source.endpoint.port,
          path:'/socket.io/?EIO=4&transport=polling&sid='+encodeURIComponent(session.sid),method:'POST',
          headers:{...source.headers,connection:'close','content-type':'text/plain;charset=UTF-8','content-length':'1',
            'x-sabalan-proxy-operation-id':operation.intentId}},incoming=>{
          incoming.on('data',chunk=>{bytes+=chunk.length;if(bytes>16){incoming.destroy(fail('SOCKET_OWNED_CLOSE_UNPROVEN'));return;}chunks.push(Buffer.from(chunk));});
          incoming.once('end',()=>{ended=true;valid=incoming.statusCode>=200&&incoming.statusCode<300&&Buffer.concat(chunks).toString()==='ok';check();});
          incoming.once('error',reject);incoming.once('aborted',()=>reject(fail('SOCKET_OWNED_CLOSE_UNKNOWN')));
        });
        outgoing.once('socket',socket=>{operation.upstreamFact=observeSocket(socket);attachOperation(session,operation);
          socket.once('close',()=>{socketClosed=true;check();});});
        const release=admission.hold(operation.ticket);outbound.add(outgoing);
        outgoing.once('close',()=>{requestClosed=true;operation.requestClosed=true;outbound.delete(outgoing);release();check();});
        outgoing.once('error',reject);forwarded=true;outgoing.end('1');
      });
      acknowledge();await closeSession(session.sid);await completeOperation(operation,'UPSTREAM_ENDED');completed=true;return true;
    }catch(error){
      session.edgeCloseError=error.code||'SOCKET_OWNED_CLOSE_UNPROVEN';
      refuse?.(error);operation.failProgress?.(error);
      if(operation.intentId&&!forwarded)try{await completeOperation(operation,'NOT_FORWARDED');completed=true;}catch{unresolved.add(operation);admission.unknown(operation.ticket);}
      if(forwarded&&!completed){unresolved.add(operation);admission.unknown(operation.ticket);}
      return false;
    }finally{active.delete(operation);admission.finish(operation.ticket);}
  }
  async function select(request,upgrade,operation) {
    if(active.size>1024)throw fail('SOCKET_PROXY_CAPACITY',503);
    if(hosts.get(String(request.headers.host).toLowerCase())!=='erp')throw fail('SOCKET_PROXY_HOST_UNAVAILABLE',421);
    const identity=socketRequestIdentity(request,upgrade),snapshot=await loadSnapshot();
    if(!upgrade && request.method==='POST' && !identity.sid)throw fail('SOCKET_SESSION_OWNER_UNPROVEN',400);
    const registry=compileApiRoutingRegistry(snapshot.browser,snapshot.api),hash=apiRoutingIdentity(snapshot.browser,snapshot.api);
    if(registry.generation<generation || registry.generation===generation && registryIdentity!==null && hash!==registryIdentity)throw fail('SOCKET_PROXY_GENERATION_INVALID');
    generation=registry.generation;registryIdentity=hash;
    const selection=selectApiRelease(registry,identity.deploymentId);
    admission?.select(operation.ticket,selection.buildId);
    const session=identity.sid?sessions.get(identity.sid):null;
    if(identity.sid && (!session || session.state!=='ACTIVE' || session.buildId!==selection.buildId
      || session.slotId!==selection.slotId || session.image!==selection.image || session.manifestSha256!==selection.manifestSha256))throw fail('SOCKET_SESSION_OWNER_UNPROVEN',400);
    // Existing observed Engine.IO sessions must be able to finish their own
    // close POST and upgrade while retiring. They never move to another build.
    if(!accepting && !session)throw fail('SOCKET_PROXY_DRAINING');
    if(selection.requiresDraftHandoff && !session)throw fail(selection.manualSaveRequired?'API_LEGACY_MANUAL_SAVE_REQUIRED':'API_BUILD_REFRESH_REQUIRED',409);
    if(!session && sessions.size>=connectionLimit)throw fail('SOCKET_PROXY_CAPACITY',503);
    const endpoint=endpointCatalog?readReleaseEndpoint(endpointCatalog,'backend',selection.slotId):endpoints.get(selection.slotId);
    if(!endpoint || endpoint.image!==selection.image || endpoint.manifestSha256!==selection.manifestSha256)throw fail('SOCKET_PROXY_SLOT_IDENTITY_UNAVAILABLE');
    return {identity,selection,endpoint,hash,registry,session};
  }
  const server=http.createServer(async(request,response)=>{
    const operation={kind:'polling',method:request.method,clientFact:observeSocket(request.socket),requestClosed:false,upstreamFact:null};
    operation.ticket=admission?.begin();active.add(operation);let allocated=0,id=null,forwarded=false,completed=false;
    try {
      const selected=await select(request,false,operation);
      const declared=request.headers['content-length'];
      if(declared!==undefined && (typeof declared!=='string' || !/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))))throw fail('SOCKET_BODY_INVALID',400);
      if(declared!==undefined && Number(declared)>bodyLimit)throw fail('SOCKET_BODY_CAPACITY',413);
      const chunks=[];
      for await(const chunk of request) {allocated+=chunk.length;bodyBytes+=chunk.length;if(allocated>bodyLimit || bodyBytes>totalBodyLimit)throw fail('SOCKET_BODY_CAPACITY',413);chunks.push(chunk);}
      if(request.aborted || request.method==='GET' && allocated)throw fail('SOCKET_BODY_INVALID',400);
      const body=Buffer.concat(chunks),forward=headers(request.headers);
      forward['x-deployment-id']=selected.selection.buildId;
      forward['x-forwarded-host']=request.headers.host;Object.assign(forward,originalForwardedHeaders(request,ingressTrust));
      if(body.length || request.method==='POST')forward['content-length']=String(body.length);
      await reserveOperation(operation,selected,false);
      id=await operationJournal.begin({registryIdentity:selected.hash,generation:selected.registry.generation,
        buildId:selected.selection.buildId,slotId:selected.selection.slotId,image:selected.selection.image,
        manifestSha256:selected.selection.manifestSha256,method:request.method});
      operation.intentId=id;
      forward['x-sabalan-proxy-operation-id']=id;
      await new Promise((resolve,reject)=>{
        let upstream;
        const resume=()=>upstream?.resume();
        const outgoing=http.request({hostname:selected.endpoint.host,port:selected.endpoint.port,path:selected.identity.path,
          method:request.method,headers:forward},incoming=>{
          upstream=incoming;const value=headers(incoming.headers);value['cache-control']='no-store, private';value['x-sabalan-proxy-operation-id']=id;
          const initial=!selected.identity.sid && request.method==='GET' && incoming.statusCode===200;
          const handshake=[];let handshakeBytes=0;
          const control=[];let controlBytes=0;
          if(!response.destroyed)response.writeHead(incoming.statusCode||502,value);
          incoming.on('data',chunk=>{
            if(initial){handshakeBytes+=chunk.length;if(handshakeBytes>16384){incoming.destroy(fail('SOCKET_HANDSHAKE_CAPACITY'));return;}handshake.push(Buffer.from(chunk));}
            else {
              if(selected.identity.sid && request.method==='GET' && controlBytes<=16384){controlBytes+=chunk.length;if(controlBytes<=16384)control.push(Buffer.from(chunk));}
              if(!response.destroyed && !response.write(chunk))incoming.pause();
            }
          });
          response.on('drain',resume);response.once('close',resume);
          incoming.once('end',()=>{void (async()=>{
            let sessionId=null;
            if(initial) {
              const bytes=Buffer.concat(handshake),text=bytes.toString();
              if(!text.startsWith('0'))throw fail('SOCKET_HANDSHAKE_OUTCOME_UNPROVEN');
              let packet;try{packet=JSON.parse(text.slice(1));}catch{throw fail('SOCKET_HANDSHAKE_OUTCOME_UNPROVEN');}
              if(!packet || typeof packet.sid!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(packet.sid) || sessions.has(packet.sid))throw fail('SOCKET_SESSION_ID_UNPROVEN');
              sessionId=packet.sid;
              const session={sid:sessionId,intentId:id,baseOperation:operation,reservation:operation.reservation,progress:new Map(),waitingProgress:new Set(),
                pollingOwner:Object.freeze({endpoint:Object.freeze({...selected.endpoint}),headers:Object.freeze({...forward}),hash:selected.hash,generation:selected.registry.generation}),
                state:'ACTIVE',buildId:selected.selection.buildId,slotId:selected.selection.slotId,
                image:selected.selection.image,manifestSha256:selected.selection.manifestSha256,
                clientSeen:new WeakSet(),upstreamSeen:new WeakSet(),clientLive:new Set(),upstreamLive:new Set(),clientClosed:0,upstreamClosed:0};
              operation.session=session;attachOperation(session,operation);sessions.set(sessionId,session);
              // The initial durable intent now owns the logical Engine.IO
              // session, including the idle gaps between polling requests.
              completed=true;if(!response.destroyed)response.end(bytes);
            } else {
              const closed=request.method==='POST' ? body.toString().split('\x1e').includes('1')
                : controlBytes<=16384 && Buffer.concat(control).toString().split('\x1e').includes('1');
              if(selected.identity.sid && incoming.statusCode>=200 && incoming.statusCode<300 && closed)await closeSession(selected.identity.sid);
              await completeOperation(operation,'UPSTREAM_ENDED');completed=true;if(!response.destroyed)response.end();
            }
            resolve();
          })().catch(reject);});
          incoming.once('aborted',()=>reject(fail('SOCKET_UPSTREAM_OUTCOME_UNKNOWN')));incoming.once('error',reject);
        });
        outgoing.once('socket',socket=>{operation.upstreamFact=observeSocket(socket);
          const session=selected.identity.sid?sessions.get(selected.identity.sid):null;if(session)attachOperation(session,operation);});
        const session=selected.identity.sid?sessions.get(selected.identity.sid):null;if(session)attachOperation(session,operation);
        outbound.add(outgoing);const release=admission?.hold(operation.ticket);outgoing.once('close',()=>release?.());
        const timer=setTimeout(()=>outgoing.destroy(fail('SOCKET_UPSTREAM_OUTCOME_UNKNOWN')),timeoutMs);
        outgoing.once('close',()=>{operation.requestClosed=true;outbound.delete(outgoing);clearTimeout(timer);response.off('drain',resume);response.off('close',resume);});
        outgoing.once('error',reject);forwarded=true;outgoing.end(body);
      });
    } catch(error) {
      operation.failProgress?.(error);
      if(id && !forwarded)try{await completeOperation(operation,'NOT_FORWARDED');completed=true;}catch{unresolved.add(operation);admission?.unknown(operation.ticket);}
      if(forwarded && !completed){unresolved.add(operation);admission?.unknown(operation.ticket);}
      respond(response,forwarded&&!completed?502:error.status||503,forwarded&&!completed?'SOCKET_UPSTREAM_OUTCOME_UNKNOWN':error.code||'SOCKET_PROXY_UNAVAILABLE');
    } finally {bodyBytes-=allocated;active.delete(operation);admission?.finish(operation.ticket);}
  });
  server.on('upgrade',(request,client,head)=>{
    const operation={kind:'websocket',method:'GET',clientFact:observeSocket(client),requestClosed:false,upstreamFact:null,ticket:admission?.begin()};active.add(operation);
    let id=null,forwarded=false,upgraded=false,settled=false;
    // Admission and durable intent publication can yield before the upstream
    // exists. Observe early peer errors without treating them as completion.
    client.on('error',()=>{});
    const task=(async()=>{
      const selected=await select(request,true,operation);
      const key=request.headers['sec-websocket-key'];
      if(request.headers.upgrade?.toLowerCase()!=='websocket' || request.headers['sec-websocket-version']!=='13'
        || typeof key!=='string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)
        || request.headers['content-length']!==undefined || request.headers['transfer-encoding']!==undefined
        || head.length>65536)throw fail('SOCKET_HANDSHAKE_INVALID',400);
      const forward=headers(request.headers);forward.connection='Upgrade';forward.upgrade='websocket';
      forward['x-deployment-id']=selected.selection.buildId;forward['x-forwarded-host']=request.headers.host;
      Object.assign(forward,originalForwardedHeaders(request,ingressTrust));
      await reserveOperation(operation,selected,true);
      id=await operationJournal.begin({registryIdentity:selected.hash,generation:selected.registry.generation,
        buildId:selected.selection.buildId,slotId:selected.selection.slotId,image:selected.selection.image,
        manifestSha256:selected.selection.manifestSha256,method:'GET'});
      operation.intentId=id;
      forward['x-sabalan-proxy-operation-id']=id;
      if(client.destroyed)throw fail('SOCKET_CLIENT_DISCONNECTED',400);
      await new Promise((resolve,reject)=>{
        const outgoing=http.request({hostname:selected.endpoint.host,port:selected.endpoint.port,path:selected.identity.path,method:'GET',headers:forward});
        outgoing.once('socket',socket=>{operation.upstreamFact=observeSocket(socket);
          const session=selected.identity.sid?sessions.get(selected.identity.sid):null;if(session)attachOperation(session,operation);});
        const session=selected.identity.sid?sessions.get(selected.identity.sid):null;if(session)attachOperation(session,operation);
        outbound.add(outgoing);const releaseRequest=admission?.hold(operation.ticket);outgoing.once('close',()=>releaseRequest?.());
        const timer=setTimeout(()=>outgoing.destroy(fail('SOCKET_HANDSHAKE_OUTCOME_UNKNOWN')),timeoutMs);
        outgoing.once('error',reject);outgoing.once('close',()=>{operation.requestClosed=true;outbound.delete(outgoing);clearTimeout(timer);});
        outgoing.once('response',incoming=>{
          // Ordinary HTTP refusal is fully consumed before custody settles.
          incoming.resume();incoming.once('end',()=>completeOperation(operation,'UPSTREAM_ENDED').then(()=>{settled=true;
            if(!client.destroyed)client.end('HTTP/1.1 '+(incoming.statusCode||502)+' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');resolve();},reject));
          incoming.once('aborted',()=>reject(fail('SOCKET_HANDSHAKE_OUTCOME_UNKNOWN')));incoming.once('error',reject);
        });
        outgoing.once('upgrade',(incoming,upstream,upstreamHead)=>{
          upgraded=true;clearTimeout(timer);outbound.add(upstream);
          const releaseSocket=admission?.hold(operation.ticket);upstream.once('close',()=>releaseSocket?.());
          upstream.once('close',()=>outbound.delete(upstream));
          const expected=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
          if(incoming.statusCode!==101 || incoming.headers.upgrade?.toLowerCase()!=='websocket'
            || incoming.headers['sec-websocket-accept']!==expected || upstreamHead.length>65536 || client.destroyed){upstream.destroy();reject(fail('SOCKET_HANDSHAKE_OUTCOME_UNKNOWN'));return;}
          const result=headers(incoming.headers);result.connection='Upgrade';result.upgrade='websocket';result['x-sabalan-proxy-operation-id']=id;
          if(operation.session)operation.session.upgraded=true;
          client.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(result).flatMap(([k,v])=>(Array.isArray(v)?v:[v]).map(value=>k+': '+value+'\r\n')).join('')+'\r\n');
          const clientProtocol=webSocketClosure(true),upstreamProtocol=webSocketClosure(false);
          let clientEnded=false,upstreamEnded=false,clientClosed=false,upstreamClosed=false,failed=false;
          const check=()=>{
            if(!clientClosed || !upstreamClosed)return;
            if(failed || !clientEnded || !upstreamEnded || !clientProtocol.complete() || !upstreamProtocol.complete()){
              reject(fail('SOCKET_TRANSPORT_OUTCOME_UNKNOWN'));return;
            }
            (async()=>{
              if(selected.identity.sid)await closeSession(selected.identity.sid);
              await completeOperation(operation,'UPSTREAM_ENDED');settled=true;resolve();
            })().catch(reject);
          };
          client.once('end',()=>{clientEnded=true;});upstream.once('end',()=>{upstreamEnded=true;});
          client.on('data',chunk=>clientProtocol.feed(chunk));upstream.on('data',chunk=>upstreamProtocol.feed(chunk));
          client.once('error',()=>{failed=true;upstream.destroy();});upstream.once('error',()=>{failed=true;client.destroy();});
          client.once('close',hadError=>{clientClosed=true;failed ||= hadError;if(!clientEnded)upstream.destroy();check();});
          upstream.once('close',hadError=>{upstreamClosed=true;failed ||= hadError;outbound.delete(upstream);if(!upstreamEnded)client.destroy();check();});
          if(upstreamHead.length){upstreamProtocol.feed(upstreamHead);client.write(upstreamHead);}
          if(head.length){clientProtocol.feed(head);upstream.write(head);}
          client.pipe(upstream);upstream.pipe(client);
        });
        forwarded=true;outgoing.end();
      });
    })();
    // Observe immediately; an async admission failure cannot escape the owned
    // transport cleanup and leave an unhandled rejection in the edge process.
    void task.catch(async error=>{
      operation.failProgress?.(error);
      if(id && !forwarded)try{await completeOperation(operation,'NOT_FORWARDED');settled=true;}catch{unresolved.add(operation);admission?.unknown(operation.ticket);}
      if(forwarded && !settled){unresolved.add(operation);admission?.unknown(operation.ticket);}
      if(!client.destroyed) {
        if(upgraded)client.destroy();
        else client.end('HTTP/1.1 '+(error.status||503)+' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      }
    }).finally(()=>{active.delete(operation);admission?.finish(operation.ticket);});
  });
  server.requestTimeout=timeoutMs;server.headersTimeout=Math.min(30000,timeoutMs);
  return Object.freeze({server,beginDrain(){accepting=false;},
    async closeFencedPollingSessions(buildIds){
      if(!admission?.beginClose)throw fail('SOCKET_ORIGINAL_EDGE_FENCE_REQUIRED');
      const ids=new Set(buildIds),failureCodes=[];let closed=0,pending=0,skippedWebSocket=0;
      for(const session of [...sessions.values()]){
        if(!ids.has(session.buildId))continue;
        if(session.upgraded||session.progress.has('upgrade')){skippedWebSocket++;continue;}
        if(session.state!=='ACTIVE'){pending++;continue;}
        // Store the original promise before yielding: retries observe this same
        // attempt, including UNKNOWN, and cannot emit a second control packet.
        session.edgeCloseTask??=closeOriginalPollingSession(session);
        if(await session.edgeCloseTask)closed++;else{pending++;failureCodes.push(session.edgeCloseError);}
      }
      return {closed,pending,skippedWebSocket,failureCodes:Object.freeze(failureCodes)};
    },
    status(){return {socketInstanceId,accepting,active:active.size,unresolved:unresolved.size,sessions:sessions.size,
      reservedIntents,reservedConnections:reservations.size,bodyBytes,generation};},
    async assertDrained(){if(accepting || active.size || outbound.size || unresolved.size || sessions.size || reservations.size || bodyBytes || (await operationJournal.pending()).length
      || accepting || active.size || outbound.size || unresolved.size || sessions.size || reservations.size || bodyBytes)throw fail('SOCKET_PROXY_DRAIN_NOT_PROVEN');},
    async readStoppedTransport(){
      const check=()=>{
        if(accepting || server.listening || active.size || outbound.size || bodyBytes)throw fail('SOCKET_PROXY_TRANSPORT_NOT_STOPPED');
        for(const operation of unresolved)if((operation.clientFact && !operation.clientFact.closed) || !operation.requestClosed
          || operation.upstreamFact && !operation.upstreamFact.closed)throw fail('SOCKET_PROXY_FD_CLOSURE_UNPROVEN');
        for(const session of sessions.values())if(session.clientLive.size || session.upstreamLive.size)throw fail('SOCKET_PROXY_FD_CLOSURE_UNPROVEN');
        for(const reservation of reservations)for(const operation of reservation.pending)
          if(!operation.intentId)throw fail('SOCKET_INTENT_RESERVATION_UNPROVEN');
      };
      check();
      const pendingEvidence=await operationJournal.originalPendingEvidence();check();
      if(pendingEvidence.length>1024 || Buffer.byteLength(JSON.stringify(pendingEvidence))>5*1024*1024)
        throw fail('SOCKET_RETIREMENT_EVIDENCE_CAPACITY');
      const ownedSessions=new Set(sessions.values());
      for(const operation of unresolved)if(operation.session)ownedSessions.add(operation.session);
      const closedSessions=[];
      for(const session of ownedSessions){
        if(session.clientLive.size||session.upstreamLive.size)throw fail('SOCKET_PROXY_FD_CLOSURE_UNPROVEN');
        session.state='HELD_TRANSPORT_CLOSED';closedSessions.push({sid:session.sid,intentId:session.intentId,
          clientSocketCloseEvents:session.clientClosed,upstreamSocketCloseEvents:session.upstreamClosed});
      }
      // This is a retirement REQUIREMENT, never drained/business-success proof.
      // The original controller must separately prove original backend native
      // retirement/SQL quiet and a published notification-only protocol before
      // appending any READONLY_TRANSPORT_RECONCILED decision. UNKNOWN stays.
      const receipt=Object.freeze({format:'sabalan-socket-stopped-requirements/v1',socketInstanceId,
        journalInstanceId:pendingEvidence[0]?.intent.instanceId??null,
        pendingOperations:Object.freeze(pendingEvidence.map(value=>value.intent)),pendingEvidence,
        transportClosed:true,semanticOutcome:'UNKNOWN_REQUIRES_ORIGINAL_BACKEND_RETIREMENT',closedSessions,
        closedOperations:Object.freeze([...unresolved].map(value=>Object.freeze({intentId:value.intentId,kind:value.kind,method:value.method,
          clientSocketClosed:true,upstreamSocketClosedOrNeverAcquired:true,upstreamSocketExisted:Boolean(value.upstreamFact),
          ...(value.method==='POST'&&value.session?{control:Object.freeze({protocol:'EIO4',transport:'polling',path:'/socket.io/',
            sessionId:value.session.sid,sessionIntentId:value.session.intentId,sessionSource:'UPSTREAM_ISSUED'})}:{})}))) });
      Object.freeze(closedSessions);for(const value of closedSessions)Object.freeze(value);
      const rawIdentity=JSON.stringify(pendingEvidence);
      originalStoppedEvidence.set(receipt,{async revalidate(){
        check();const current=await operationJournal.originalPendingEvidence();check();
        if(JSON.stringify(current)!==rawIdentity)throw fail('SOCKET_STOPPED_INTENT_SET_CHANGED');
      }});
      return receipt;
    },
  });
}
