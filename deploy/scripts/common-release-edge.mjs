import http from 'node:http';
import {createBrowserReleaseProxy,createApiReleaseProxy} from './browser-release-proxy.mjs';
import {createSocketReleaseProxy} from './socket-release-proxy.mjs';
import {compileApiRoutingRegistry} from './api-release-routing.mjs';
import {compileBrowserRoutingRegistry} from './browser-release-routing.mjs';
import {randomBytes} from 'node:crypto';

const fences=new WeakMap(),quiescences=new WeakMap();
const fail=code=>Object.assign(Error(code),{code,status:409});
export function readOriginalBuildFence(token){
  const value=fences.get(token);if(!value)throw fail('COMMON_EDGE_BUILD_FENCE_UNPROVEN');
  return value.facts;
}
export async function readOriginalBuildQuiescence(token){
  const value=quiescences.get(token);if(!value)throw fail('COMMON_EDGE_BUILD_QUIESCENCE_UNPROVEN');
  await value.check();return value.facts;
}

/** One private listener; UI, API, files and Socket.IO derive producer ownership
 * from the same atomically published v2 snapshot. No Next rewrite is assumed.
 * The controller alone provisions stores, supplies real immutable slot proofs
 * and owns release admission. This factory never opens a public listener. */
export function createCommonReleaseEdge({loadSnapshot,uiEndpoints,backendEndpoints,endpointCatalog,ingressTrust,applicationsByHost,
  journals,timeoutMs=90000,bodyLimit=10*1024*1024,totalBodyLimit=32*1024*1024}) {
  if(typeof loadSnapshot!=='function')throw Error('COMMON_EDGE_SNAPSHOT_INVALID');
  const loadPairedSnapshot=async()=>{
    const snapshot=await loadSnapshot();
    if(snapshot?.browser?.format!=='sabalan-browser-routing/v2')throw Object.assign(Error('COMMON_EDGE_PAIRED_PUBLICATION_REQUIRED'),{code:'COMMON_EDGE_PAIRED_PUBLICATION_REQUIRED'});
    compileApiRoutingRegistry(snapshot.browser,snapshot.api);
    return snapshot;
  };
  const erpHosts=Object.fromEntries(Object.entries(applicationsByHost).filter(([,application])=>application==='erp'));
  const edgeInstanceId=randomBytes(32).toString('hex'),blockedBuilds=new Set(),tickets=new Set(),unknown=new Set();
  // A ticket is entered synchronously before the first request await. Selection
  // and the fence consult the SAME closure, so an unselected old request cannot
  // disappear between the journal census and the final quiescence check.
  const admission=Object.freeze({
    begin(){const ticket={buildId:null,finished:false,holds:0};tickets.add(ticket);return ticket;},
    beginClose(buildId){if(!blockedBuilds.has(buildId))throw fail('COMMON_EDGE_BUILD_FENCE_UNPROVEN');const ticket={buildId,finished:false,holds:0};tickets.add(ticket);return ticket;},
    select(ticket,buildId){if(blockedBuilds.has(buildId))throw fail('COMMON_EDGE_BUILD_FENCED');ticket.buildId=buildId;},
    hold(ticket){ticket.holds++;let released=false;return ()=>{if(released)return;released=true;ticket.holds--;if(ticket.finished&&!ticket.holds)tickets.delete(ticket);};},
    unknown(ticket){unknown.add(ticket);},
    finish(ticket){ticket.finished=true;if(!ticket.holds)tickets.delete(ticket);},
  });
  const ui=createBrowserReleaseProxy({loadRegistry:async()=>(await loadPairedSnapshot()).browser,
    slotEndpoints:uiEndpoints,endpointCatalog,ingressTrust,applicationsByHost,operationJournal:journals.ui,timeoutMs,admission});
  const api=createApiReleaseProxy({loadSnapshot:loadPairedSnapshot,slotEndpoints:backendEndpoints,endpointCatalog,ingressTrust,applicationsByHost:erpHosts,
    operationJournal:journals.api,timeoutMs,bodyLimit,totalBodyLimit,admission});
  const socket=createSocketReleaseProxy({loadSnapshot:loadPairedSnapshot,slotEndpoints:backendEndpoints,endpointCatalog,ingressTrust,applicationsByHost:erpHosts,
    operationJournal:journals.socket,timeoutMs,admission});
  const expiry=async(buildIds,publicationSha256)=>{
    const snapshot=await loadPairedSnapshot();
    if(snapshot.publicationSha256!==publicationSha256)throw fail('COMMON_EDGE_PUBLICATION_CHANGED');
    const registry=compileBrowserRoutingRegistry(snapshot.browser),now=Date.now();
    return buildIds.map(id=>{
      const build=registry.builds[id];
      if(!build || build.retiredAt===null || build.supportUntil===null || now<build.supportUntil
        || Object.values(registry.current).includes(id))throw fail('COMMON_EDGE_BUILD_NOT_EXPIRED');
      return Object.freeze({buildId:id,retiredAt:build.retiredAt,supportUntil:build.supportUntil,
        slotId:build.slotId,image:build.image,manifestSha256:build.manifestSha256});
    });
  };
  const count=state=>({
    active:[...tickets].filter(ticket=>state.ids.has(ticket.buildId)).length,
    unselected:[...state.preselection].filter(ticket=>tickets.has(ticket)&&ticket.buildId===null).length,
    unknown:[...unknown].filter(ticket=>state.ids.has(ticket.buildId)).length,
  });
  const census=async state=>{
    const deadlines=await expiry(state.facts.buildIds,state.facts.publicationSha256);
    if(JSON.stringify(deadlines)!==JSON.stringify(state.facts.deadlines))throw fail('COMMON_EDGE_BUILD_IDENTITY_CHANGED');
    const pending=await Promise.all(['ui','api','socket'].map(async key=>(await journals[key].pending()).filter(intent=>state.ids.has(intent.buildId)).length));
    // Journal I/O may yield. Never issue the receipt after a backward clock
    // adjustment has put the promise back inside its support window.
    if(state.facts.deadlines.some(build=>Date.now()<build.supportUntil))throw fail('COMMON_EDGE_BUILD_NOT_EXPIRED');
    const counts=Object.freeze({...count(state),ui:pending[0],api:pending[1],socket:pending[2]});
    if(Object.values(counts).some(value=>value!==0))throw Object.assign(fail('COMMON_EDGE_BUILD_PENDING'),{counts});
    return counts;
  };
  const classify=request=>{
    try {
      const path=decodeURIComponent(new URL(request.url,'http://edge.invalid').pathname);
      if(/^\/socket\.io(?:\/|$)/i.test(path))return socket;
      return /^\/(?:api|files)(?:\/|$)/i.test(path)?api:ui;
    } catch{return ui;}
  };
  const server=http.createServer((request,response)=>classify(request).server.emit('request',request,response));
  server.on('upgrade',(request,stream,head)=>{
    if(classify(request)!==socket){stream.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
    socket.server.emit('upgrade',request,stream,head);
  });
  server.requestTimeout=timeoutMs;server.headersTimeout=Math.min(30000,timeoutMs);
  return Object.freeze({server,beginDrain(){ui.beginDrain();api.beginDrain();socket.beginDrain();},
    async fenceBuilds({buildIds,publicationSha256}){
      if(!Array.isArray(buildIds)||!buildIds.length||buildIds.length>256||new Set(buildIds).size!==buildIds.length
        ||buildIds.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9_-]{7,95}$/.test(id))
        ||!/^[a-f0-9]{64}$/.test(publicationSha256))throw fail('COMMON_EDGE_BUILD_FENCE_INVALID');
      const ids=Object.freeze([...buildIds].sort()),deadlines=Object.freeze(await expiry(ids,publicationSha256));
      const facts=Object.freeze({edgeInstanceId,fenceId:randomBytes(32).toString('hex'),buildIds:ids,publicationSha256,deadlines});
      const token=Object.freeze({});
      // No await between blocking every selected build and capturing the older
      // unselected tickets. Later unrelated traffic cannot starve this fence.
      for(const id of ids)blockedBuilds.add(id);
      fences.set(token,{facts,ids:new Set(ids),preselection:new Set([...tickets].filter(ticket=>ticket.buildId===null)),edgeInstanceId});
      return token;
    },
    async readBuildQuiescence(token){
      const state=fences.get(token);if(!state||state.edgeInstanceId!==edgeInstanceId)throw fail('COMMON_EDGE_BUILD_FENCE_UNPROVEN');
      const counts=await census(state),completion=Object.freeze({});
      quiescences.set(completion,{facts:Object.freeze({...state.facts,counts}),check:()=>census(state)});
      return completion;
    },
    async closeFencedPollingSessions(token){
      const state=fences.get(token);if(!state||state.edgeInstanceId!==edgeInstanceId)throw fail('COMMON_EDGE_BUILD_FENCE_UNPROVEN');
      const deadlines=await expiry(state.facts.buildIds,state.facts.publicationSha256);
      if(JSON.stringify(deadlines)!==JSON.stringify(state.facts.deadlines))throw fail('COMMON_EDGE_BUILD_IDENTITY_CHANGED');
      return Object.freeze({...state.facts,...await socket.closeFencedPollingSessions(state.facts.buildIds)});
    },
    status(){return {ui:ui.status(),api:api.status(),socket:socket.status()};},
    async assertDrained(){await Promise.all([ui.assertDrained(),api.assertDrained(),socket.assertDrained()]);},
    async readStoppedTransport(){if(server.listening)throw Error('COMMON_EDGE_LISTENER_NOT_STOPPED');
      const values=await Promise.all([ui.readStoppedTransport(),api.readStoppedTransport(),socket.readStoppedTransport()]);
      if(values[0].pendingOperations.length || values[1].pendingOperations.length)throw Error('COMMON_EDGE_BUSINESS_OUTCOME_UNKNOWN');
      return {ui:values[0],api:values[1],socket:values[2]};},
  });
}
