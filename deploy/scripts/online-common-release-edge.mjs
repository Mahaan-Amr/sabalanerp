/** Production transport process owned through the original host's signed
 * anonymous control pipe. No private signer, SQL client or public admission. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createPublicKey,verify,createHash} from 'node:crypto';
import {readOriginalBuildFence,readOriginalBuildQuiescence,createCommonReleaseEdge} from './common-release-edge.mjs';
import {BrowserRoutingStore} from './browser-routing-store.mjs';
import {apiRoutingSnapshot} from './api-release-routing.mjs';
import {BrowserOperationJournal} from './browser-operation-journal.mjs';
import {createReleaseEndpointCatalog} from './release-endpoint-catalog.mjs';
import {createOriginalIngressTrust} from './release-forwarding.mjs';
const assert=(value,code)=>{if(!value)throw Error(code);};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical(v[key])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v))),sha=v=>createHash('sha256').update(v).digest('hex');
const emit=(event,fields={})=>process.stdout.write(JSON.stringify({event,...fields})+'\n');
const held=async()=>{emit('HELD');await new Promise(()=>setInterval(()=>{},1000));};
let edge,sequence=0,closed=false,buffer=Buffer.alloc(0);const fences=new Map();
try{
 assert(process.platform==='linux'&&process.argv.length===4&&fs.fstatSync(0).isFIFO(),'EDGE_ORIGINAL_PIPE_REQUIRED');
 const [session,instanceId]=process.argv.slice(2);
 assert(/^[a-f0-9]{64}$/.test(session)&&/^[a-f0-9]{64}$/.test(instanceId),'EDGE_ORIGINAL_IDENTITY_REQUIRED');
 const keyFile='/run/sabalan-online/release-controller-public-key.pem',keyStat=fs.lstatSync(keyFile);
 assert(keyStat.isFile()&&keyStat.uid===0&&keyStat.nlink===1&&(keyStat.mode&0o777)===0o444&&keyStat.size<4096&&fs.realpathSync(keyFile)===keyFile,'EDGE_RO_KEY_REQUIRED');
 const keyRaw=fs.readFileSync(keyFile),keyHash=sha(keyRaw),key=createPublicKey(keyRaw);
 assert(key.asymmetricKeyType==='ed25519','EDGE_ED25519_REQUIRED');
 const catalog=createReleaseEndpointCatalog(),ingress=createOriginalIngressTrust();let store;
 async function receive(raw){
  assert(sha(fs.readFileSync(keyFile))===keyHash,'EDGE_ORIGINAL_KEY_CHANGED');
  const envelope=JSON.parse(raw),value=envelope.decision;
  assert(Object.keys(envelope).sort().join(',')==='decision,signature'&&Object.keys(value).sort().join(',')==='command,format,input,scopeSha256,sequence,session'
   &&value.format==='sabalan-online-original-control/v1'&&value.session===session&&value.scopeSha256===instanceId&&value.sequence===++sequence
   &&verify(null,Buffer.concat([Buffer.from('sabalan-online-original-control/v1\n'),bytes(value)]),key,Buffer.from(envelope.signature,'base64')),'EDGE_ORIGINAL_SIGNED_FRAME_REQUIRED');
  const input=value.input;
  if(value.command==='START'){
   assert(!edge&&input.instanceId===instanceId&&input.port===3199
    &&Object.values(os.networkInterfaces()).flat().some(item=>item&&item.address===input.host&&!item.internal),'EDGE_ASSIGNED_PRIVATE_INTERFACE_REQUIRED');
   assert(input.publicationDirectory==='/run/sabalan-publications'&&input.journalRoot==='/app/online-edge/'+instanceId,'EDGE_FIXED_ROOT_REQUIRED');
   const parent=fs.lstatSync('/app/online-edge');assert(parent.isDirectory()&&parent.uid===process.getuid()&&(parent.mode&0o077)===0,'EDGE_JOURNAL_PARENT_UNPROVEN');
   fs.mkdirSync(input.journalRoot,{mode:0o700});
   const journals={};for(const name of ['ui','api','socket']){
    const directory=path.join(input.journalRoot,name);fs.mkdirSync(directory,{mode:0o700});
    journals[name]=new BrowserOperationJournal({directory,instanceId:sha(Buffer.from(instanceId+':'+name))});await journals[name].initialize();
   }
   catalog.append(input.endpoints);ingress.append(input.trustedProxyIPs);
   store=new BrowserRoutingStore({directory:input.publicationDirectory});
   edge=createCommonReleaseEdge({loadSnapshot:async()=>{const head=await store.readPublication();return {...apiRoutingSnapshot(head.registry),publicationSha256:head.publicationSha256};},
    endpointCatalog:catalog.catalog,ingressTrust:ingress.trust,applicationsByHost:input.applicationsByHost,journals,bodyLimit:26*1024*1024});
   await new Promise((resolve,reject)=>{edge.server.once('error',reject);edge.server.listen(input.port,input.host,resolve);});
   emit('LISTENING',{instanceId,address:edge.server.address(),publicAdmissionGranted:false});
  }else if(value.command==='APPEND_ENDPOINTS'){
   assert(edge&&!closed,'EDGE_ORIGINAL_NOT_LISTENING');catalog.append(input);emit('ENDPOINTS_APPENDED',{sequence});
  }else if(value.command==='APPEND_INGRESS'){
   assert(edge&&!closed,'EDGE_ORIGINAL_NOT_LISTENING');ingress.append(input.addresses);emit('INGRESS_APPENDED',{sequence});
  }else if(value.command==='VERIFY_PUBLICATION'){
   assert(edge&&!closed,'EDGE_ORIGINAL_NOT_LISTENING');const head=await store.readPublication();
   assert(head.publicationSha256===input.publicationSha256,'EDGE_PUBLICATION_NOT_OBSERVED');
   // Snapshot validation checks both UI and API from this exact durable head.
   apiRoutingSnapshot(head.registry);emit('PUBLICATION_OBSERVED',{sequence,generation:head.generation,publicationSha256:head.publicationSha256});
  }else if(value.command==='FENCE_EXPIRED_BUILDS'){
   assert(edge&&!closed,'EDGE_ORIGINAL_NOT_LISTENING');
   const head=await store.readPublication();assert(head.publicationSha256===input.publicationSha256,'EDGE_PUBLICATION_NOT_OBSERVED');
   const token=await edge.fenceBuilds(input),facts=readOriginalBuildFence(token);assert(!fences.has(facts.fenceId),'EDGE_FENCE_REUSED');
   fences.set(facts.fenceId,token);emit('EXPIRED_BUILDS_FENCED',{sequence,...facts});
  }else if(value.command==='CLOSE_EXPIRED_POLLING_SESSIONS'){
   assert(edge&&!closed&&Object.keys(input).join(',')==='fenceId'&&fences.has(input.fenceId),'EDGE_ORIGINAL_FENCE_REQUIRED');
   emit('EXPIRED_POLLING_SESSIONS_RECONCILED',{sequence,...await edge.closeFencedPollingSessions(fences.get(input.fenceId))});
  }else if(value.command==='READ_EXPIRED_BUILD_QUIESCENCE'){
   assert(edge&&!closed&&Object.keys(input).join(',')==='fenceId'&&fences.has(input.fenceId),'EDGE_ORIGINAL_FENCE_REQUIRED');
   try{const completion=await edge.readBuildQuiescence(fences.get(input.fenceId));
    emit('EXPIRED_BUILDS_QUIESCENT',{sequence,...await readOriginalBuildQuiescence(completion)});
   }catch(error){if(error.code!=='COMMON_EDGE_BUILD_PENDING'&&error.message!=='COMMON_EDGE_BUILD_PENDING')throw error;
    emit('EXPIRED_BUILDS_PENDING',{sequence,fenceId:input.fenceId,counts:error.counts});}
  }else if(value.command==='STOP'){
   assert(edge&&!closed,'EDGE_ORIGINAL_NOT_LISTENING');edge.beginDrain();
   await new Promise((resolve,reject)=>edge.server.close(error=>error?reject(error):resolve()));
   await edge.assertDrained();closed=true;emit('CLOSED',{instanceId,rawUnknownCleared:false});
  }else throw Error('EDGE_FIXED_COMMAND_REQUIRED');
 }
 for await(const chunk of process.stdin){
  buffer=Buffer.concat([buffer,chunk]);assert(buffer.length<=1048576,'EDGE_CONTROL_FRAME_BOUND');
  for(let split;(split=buffer.indexOf(10))>=0;){const line=buffer.subarray(0,split);buffer=buffer.subarray(split+1);await receive(line);if(closed)break;}
  if(closed)break;
 }
 if(!closed)await held();
}catch{await held();}
