/** Actual crypto/finite owner tests over explicitly modeled application data.
 * These tests produce neither native application nor COMPLETE acceptance. */
import test,{mock} from 'node:test';import fs from 'node:fs';import vm from 'node:vm';import dns from 'node:dns';import net from 'node:net';import assert from 'node:assert/strict';import http from 'node:http';import {createHash,createHmac,hkdfSync,generateKeyPairSync,verify} from 'node:crypto';
import {createOriginalRestoredIssuerPort} from '../../scripts/lib/original-restored-issuer-port.mjs';
import {retainOriginalRoleRestoredIssuer} from '../../scripts/lib/original-role-restored-issuer.mjs';
import {collectOriginalCompleteOwner} from '../../scripts/lib/original-existing-compose-owner.mjs';
import {readOriginalRoleRestoredIssuer} from '../../scripts/lib/application-native-role-coordinator.mjs';
import {retainOriginalIssuerTransportClient} from '../../scripts/lib/restored-qa/original-issuer-client.mjs';
import {assertOriginalIssuerResources,consumeOriginalRestoredMaterial} from '../../scripts/lib/restored-qa/original-issuer-material.mjs';
import {qualificationBytes} from '../../scripts/lib/independent-private-qualification-material.mjs';
import {restored} from './restored-qa-material.fixture.mjs';
const operation='a'.repeat(32),session='b'.repeat(64),sha=raw=>createHash('sha256').update(raw).digest('hex');
async function exerciseOriginal(mode,exercise){
 const key=generateKeyPairSync('ed25519'),input=restored({coordinationDirectory:'/app/runtime-authority/application-native-'+operation+'/restored-complete-app/coherent-private/coordination',releaseId:'qa-complete-'+operation});delete input.now;input.facts.originalSqlProbe={returncode:0,reaped:true};
 const pem=Buffer.from(key.publicKey.export({type:'spki',format:'pem'}));let trustInode='22',heldLocal=false,issuer,readyOwner,error,exerciseFailed=false,requests=0,observationFailure=false;
 const local={image:input.config.image,sourceCommit:input.config.sourceCommit,runtime:input.config.privateQualificationRuntime,host:input.config.roleTopology.main.host,databaseSystemIdentifier:input.facts.database.systemIdentifier};
 const retained=retainOriginalRoleRestoredIssuer({...key,session,local,assertLocalOriginalsClosed:()=>assert.equal(heldLocal,false)});
 const resources={observeMemoryAdmission:async()=>({admitted:mode!=='pressure-refusal'}),assertCurrent:async()=>{},readFixedTrust:async()=>({bytes:pem.length,rawBase64:pem.toString('base64'),sha256:sha(pem),identity:{uid:0,nlink:1,mode:0o100444,device:'1',inode:trustInode,mtimeNs:'10',ctimeNs:'10'}}),observePrivateMaterial:async()=>{if(observationFailure)throw 0;if(mode==='consumer-delayed')await new Promise(resolve=>setTimeout(resolve,30));if(mode==='transport-delayed')await new Promise(resolve=>setTimeout(resolve,350));return structuredClone(input);},assertHttpActive:async()=>{},assertHttpPreparedAndFenced:async()=>{}};
 const server=http.createServer((request,response)=>{requests++;void(async()=>{try{assert.equal(request.url,'/exercise');await exercise({issuer,key,input,retained,owner:readyOwner,changeTrust:()=>{trustInode='23';},loseLocal:()=>{heldLocal=true;},failObservation:()=>{observationFailure=true;}});}catch(e){exerciseFailed=true;error=e;}finally{response.setHeader('Connection','close');response.end('done');}})();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const code="const http=require('http');process.stdout.write(JSON.stringify({format:'sabalan-r9-master-private-credential-ready/v1',operation:'"+operation+"',credentialsRead:false,productionAdmission:false})+'\\n');let raw=[];process.stdin.on('data',b=>raw.push(b));process.stdin.on('end',()=>{JSON.parse(Buffer.concat(raw));http.get('http://127.0.0.1:"+server.address().port+"/exercise',r=>{r.resume();r.on('end',()=>process.stdout.write(JSON.stringify({file:'modeled-only.json',sha256:'c'.repeat(64),strictCompleteValidationSucceeded:true,outerOriginalClosurePending:true,productionAdmission:false})+'\\n'));});});";
 let completion;
 try{completion=await collectOriginalCompleteOwner({operation,command:{executable:process.execPath,argv:['-e',code],environment:process.env},beforeCredential:async()=>{},acquireCredential:async()=>'test-only-owner-input',onClosed:async()=>{},onOriginalReady:async owner=>{
  readyOwner=owner;issuer=await retained.beginOriginalComplete({operation,ownerToken:owner,expectedManifestSha256:input.restoredQaLineage.completeManifestSha256,resources});Object.assign(input.config,{publicKey:issuer.enrollment.publicKey,session:issuer.enrollment.session,actorId:issuer.enrollment.actorId});
 }});}finally{await new Promise(resolve=>server.close(resolve));}
 assert.equal(requests,1);if(exerciseFailed)throw error;return{issuer,retained,completion,readyOwner,mode};
}
test('same retained key issues canonical restored material and two fixed controls; closes only its original owner',async()=>{
 const result=await exerciseOriginal('success',async({issuer,key,input})=>{
  const material=await issuer.issueOriginalRestoredMaterial();assert.equal(material.enrollment.publicKey,key.publicKey.export({type:'spki',format:'der'}).toString('base64'));assert.equal(Object.keys(material.materials).length,2);
  for(const row of Object.values(material.materials)){assert.ok(verify(null,Buffer.concat([Buffer.from('sabalan-online-private-qualification/v1\n'),qualificationBytes(row.decision.decision)]),key.publicKey,Buffer.from(row.decision.signature,'base64')));assert.deepEqual(row.decision.decision.database,input.facts.database);}
  for(const control of [await issuer.prepareOriginalPrivateDrain(),await issuer.shutdownOriginalPrivateHttp()]){const preimage=Buffer.from([control.format,control.session,control.actorId,control.scopeSha256,String(control.sequence),control.command].join('\0'));assert.ok(verify(null,preimage,key.publicKey,Buffer.from(control.signature,'base64')));}
  assert.equal(issuer.sign,undefined);assert.equal(issuer.signDecision,undefined);assert.equal(issuer.privateKey,undefined);
 });
 assert.throws(()=>result.issuer.finishOriginalOwner({}),/ORIGINAL_COMPLETE_OWNER_LINEAGE_REQUIRED/);const closed=result.issuer.finishOriginalOwner(result.completion);assert.equal(closed.originalCoordinatorRetained,true);assert.equal(closed.privateKeyExported,false);assert.equal(result.issuer.inspect().phase,'CLOSED');
 await assert.rejects(result.retained.beginOriginalComplete({operation,ownerToken:result.readyOwner}),/ALREADY_USED/);
});
for(const mode of ['changed-trust','changed-lineage','open-sql','duplicate-issue'])test('same original issuer refuses '+mode+' and retains a negative state',async()=>{
 await exerciseOriginal(mode,async({issuer,input,changeTrust})=>{
  if(mode==='changed-trust')changeTrust();if(mode==='changed-lineage')input.restoredQaLineage.completeManifestSha256='e'.repeat(64);if(mode==='open-sql')input.facts.sql.sessions=1;
  if(mode==='duplicate-issue')await issuer.issueOriginalRestoredMaterial();await assert.rejects(issuer.issueOriginalRestoredMaterial());assert.ok(issuer.inspect().held);await assert.rejects(issuer.prepareOriginalPrivateDrain());
 });
});
test('JSON local completions cannot reconstruct the retained original key port',()=>{for(const value of [{},{productionAdmission:false},JSON.parse('{}')])assert.throws(()=>readOriginalRoleRestoredIssuer(value),/ORIGINAL_LOCAL_COMPLETE_ISSUER_REQUIRED/);});
test('a falsy observer failure stays negative after the same owner closes',async()=>{
 const result=await exerciseOriginal('falsy',async({issuer,failObservation})=>{failObservation();let observed=false;try{await issuer.issueOriginalRestoredMaterial();}catch(error){assert.equal(error,0);observed=true;}assert.equal(observed,true);assert.equal(issuer.inspect().failureObserved,true);assert.equal(issuer.inspect().held,'THROWN_VALUE');});
 assert.throws(()=>result.issuer.finishOriginalOwner(result.completion));
});
test('the actual outer owner exiting before issuance invalidates the port',async()=>{const result=await exerciseOriginal('expired',async()=>{});await assert.rejects(result.issuer.issueOriginalRestoredMaterial(),/ORIGINAL_COMPLETE_LIVE_OWNER_LOST/);assert.equal(result.issuer.inspect().failureObserved,true);});

test('actual retained issuer and worker compile at separate times using the authenticated original issuance instant',async()=>{
 await exerciseOriginal('consumer-delayed',async({issuer,input})=>{const before=Date.now();const consumed=await consumeOriginalRestoredMaterial(issuer,input);assert.ok(Date.now()-before>=30);for(const row of Object.values(consumed.materials)){assert.ok(Date.parse(row.decision.decision.issuedAt)>=before);assert.deepEqual(row.decision.decision,consumed.material.decisionsByRuntime[row.decision.decision.runtimeId]);}});
});

const issuerFormat='sabalan-original-restored-issuer/v1';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
async function transportExercise(issuer,exercise,options={}){
 const passphrase='a'.repeat(64),key=Buffer.from(hkdfSync('sha256',Buffer.from(passphrase),Buffer.from(operation,'hex'),Buffer.from(issuerFormat),32));
 const port=await createOriginalRestoredIssuerPort({operation,passphrase,issuer,...options});
 const mac=(domain,value)=>createHmac('sha256',key).update(issuerFormat+'\0'+domain+'\0').update(JSON.stringify(canonical(value))).digest('hex');
 let sequence=0,closed;
 const send=async(kind,extra={},options={})=>{const value={format:issuerFormat,operation,sequence:options.sequence??++sequence,challenge:'d'.repeat(64),kind,...extra};
  const response=await fetch('http://'+port.endpoint.host+':'+port.endpoint.port+port.endpoint.path,{method:'POST',headers:{Connection:'close','x-sabalan-issuer-mac':options.badMac?'0'.repeat(64):mac('request',value)},body:JSON.stringify(value)});
  const reply=await response.json();if(response.status===200){assert.equal(response.headers.get('x-sabalan-issuer-mac'),mac('response',reply));assert.equal(reply.challenge,value.challenge);assert.equal(reply.sequence,value.sequence);}return{status:response.status,reply};};
 try{await exercise({port,send});}finally{closed=await port.close();key.fill(0);}
 assert.equal(closed.phase,'CLOSED');assert.equal(closed.authenticationKeyRetired,true);assert.ok(closed.readers.every(r=>r.closed));return closed;
}
test('actual authenticated issuer transport invokes only fixed zero-input operations under the same original owner',async()=>{
 const result=await exerciseOriginal('transport',async({issuer})=>{
  const closed=await transportExercise(issuer,async({send})=>{for(const kind of ['ENROLL','ASSERT_ACTIVE','ISSUE_MATERIAL','PREPARE_DRAIN','SHUTDOWN'])assert.equal((await send(kind)).status,200);});
  assert.equal(closed.fault,null);assert.equal(closed.requests.length,5);
 });assert.equal(result.issuer.finishOriginalOwner(result.completion).closed,true);
});
for(const mode of ['caller-signing-input','replay'])test('authenticated issuer transport refuses '+mode+' and preserves a negative port',async()=>{
 await exerciseOriginal(mode,async({issuer})=>{const closed=await transportExercise(issuer,async({port,send})=>{
  assert.equal((await send('ENROLL')).status,200);
  const bad=mode==='replay'?await send('ENROLL',{}, {sequence:1}):await send('ISSUE_MATERIAL',{decision:{}});
  assert.equal(bad.status,409);assert.ok(port.inspect().fault);assert.equal((await send('ISSUE_MATERIAL')).status,503);
 });assert.equal(closed.fault,'ORIGINAL_ISSUER_OPERATION_UNPROVEN');assert.equal(issuer.inspect().phase,'ENROLLED');});
});
test('serialized issuer cannot open an original issuer transport',async()=>{await assert.rejects(createOriginalRestoredIssuerPort({operation,passphrase:'a'.repeat(64),issuer:{}}),/ORIGINAL_RETAINED_ISSUER_PORT_REQUIRED/);});

async function withIssuerDns(exercise){
 const lookup=dns.lookup;const patched=mock.method(dns,'lookup',(hostname,options,callback)=>{
  if(hostname!=='host.docker.internal')return lookup(hostname,options,callback);
  if(typeof options==='function'){callback=options;options={};}
  process.nextTick(()=>options?.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4));
 });try{return await exercise();}finally{patched.mock.restore();}
}
async function clientFor(issuer,port){return retainOriginalIssuerTransportClient({operation,passphrase:'a'.repeat(64),port:port.endpoint.port,expectedPublicKeyPem:issuer.enrollment.publicKeyPem,assertOriginalWorkerActive:()=>{}});}
test('actual HTTP client verifies the fixed original issuer and retires only after response/request closure',async()=>withIssuerDns(async()=>{
 const result=await exerciseOriginal('client',async({issuer,input})=>{await transportExercise(issuer,async({port})=>{
  const client=await clientFor(issuer,port);await assertOriginalIssuerResources(client,()=>{});
  const consumed=await consumeOriginalRestoredMaterial(client,input);assert.equal(Object.keys(consumed.materials).length,2);
  await client.prepareOriginalPrivateDrain();await client.shutdownOriginalPrivateHttp();const closed=client.close();assert.equal(closed.failed,false);assert.ok(closed.readers.every(r=>r.responseEof&&r.requestClosed&&r.responseClosed));
 });});result.issuer.finishOriginalOwner(result.completion);
}));
test('lost Windows original is checked remotely before any further native executor is invoked',async()=>withIssuerDns(async()=>{
 let port,client,executions=0;await exerciseOriginal('lost-original',async({issuer})=>{port=await createOriginalRestoredIssuerPort({operation,passphrase:'a'.repeat(64),issuer});client=await clientFor(issuer,port);});
 try{await assert.rejects((async()=>{await assertOriginalIssuerResources(client,()=>{});executions++;})());assert.equal(executions,0);assert.equal(client.close().failed,true);}finally{const closed=await port.close();assert.equal(closed.fault,'ORIGINAL_ISSUER_OPERATION_UNPROVEN');}
}));
test('post-enrollment connection failure retires a negative client without inventing a Response or EOF',async()=>withIssuerDns(async()=>{
 await exerciseOriginal('connection-lost',async({issuer})=>{const port=await createOriginalRestoredIssuerPort({operation,passphrase:'a'.repeat(64),issuer}),client=await clientFor(issuer,port);await port.close();
  await assert.rejects(client.checkOriginalResources());const closed=client.close();assert.equal(closed.failed,true);assert.equal(closed.authenticationKeyRetired,true);assert.deepEqual(closed.readers.at(-1),{requestClosed:true,responseSeen:false,responseClosed:false,responseEof:false});
 });
}));
test('partial HTTP headers have a bounded bridge socket lifetime and actual negative closure',async()=>{
 await exerciseOriginal('partial-headers',async({issuer})=>{const port=await createOriginalRestoredIssuerPort({operation,passphrase:'a'.repeat(64),issuer,readerDeadlineMs:100});
  const socket=net.connect(port.endpoint.port,'127.0.0.1');socket.on('error',()=>{});const ended=new Promise(resolve=>socket.once('close',resolve));await new Promise(resolve=>socket.once('connect',resolve));socket.write('POST /original-restored-issuer/v1 HTTP/1.1\r\nHost:');
  const closed=await port.close();await ended;assert.equal(closed.fault,'ORIGINAL_ISSUER_READER_DEADLINE');assert.equal(closed.readers[0].deadlineExpired,true);assert.equal(closed.readers[0].closed,true);
 });
});
test('a stalled issuer response expires only its bridge socket and retains the actual issuance task until completion',async()=>{
 await exerciseOriginal('transport-delayed',async({issuer})=>{const before=Date.now();const closed=await transportExercise(issuer,async({send})=>{await assert.rejects(send('ISSUE_MATERIAL'));}, {readerDeadlineMs:100});
  assert.ok(Date.now()-before>=350);assert.equal(closed.fault,'ORIGINAL_ISSUER_READER_DEADLINE');assert.equal(issuer.inspect().phase,'ISSUED');assert.ok(closed.readers.every(r=>r.closed));
 });
});

test('actual broker start boundaries consume signed refusal; original issuer CURRENT/drain/shutdown remain usable',async()=>withIssuerDns(async()=>{
 await exerciseOriginal('pressure-refusal',async({issuer})=>{await transportExercise(issuer,async({port})=>{
  const client=await clientFor(issuer,port),source=fs.readFileSync(new URL('../../scripts/lib/restored-qa/restored-private-broker.mjs',import.meta.url),'utf8');let entered=0;
  for(const name of ['runBaseline','initialize','startHttp']){const line=source.split('\n').find(v=>v.includes('async '+name+'('));assert.ok(line);const prefix=line.slice(0,line.indexOf('try{'));const method=vm.compileFunction('return ({'+prefix+'entered++;}}).'+name+'();',['issuer','entered'])(client,entered);await assert.rejects(method,/QA_MEMORY_PRESSURE_REFUSED/);}
  assert.equal(entered,0);await client.checkOriginalResources();await client.issueOriginalRestoredMaterial();await client.prepareOriginalPrivateDrain();await client.shutdownOriginalPrivateHttp();assert.equal(client.close().failed,false);
 });});
}));
