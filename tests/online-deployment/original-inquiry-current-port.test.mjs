import test from 'node:test';import assert from 'node:assert/strict';import {createHmac,randomBytes} from 'node:crypto';
import net from 'node:net';
import {InquiryCarrierIncarnation} from '../../deploy/scripts/local-inquiry-carrier.mjs';
import {createOriginalInquiryCurrentPort,originalInquiryObservationKey} from '../../scripts/lib/original-inquiry-current-port.mjs';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v)));
const sign=(key,domain,value)=>createHmac('sha256',key).update(domain+'\0').update(bytes(value)).digest('hex');
async function fixture(options={}){
 const operation='a'.repeat(32),session='b'.repeat(64),passphrase='c'.repeat(64);let active=true,calls=0;
 const initial={Id:'d'.repeat(64),Image:'sha256:'+'e'.repeat(64),Config:{Env:['SCOPE=private']},HostConfig:{},Mounts:[],State:{StartedAt:'2026-10-27T00:00:00Z',Running:true},NetworkSettings:{Ports:{},Networks:{}}};let current=structuredClone(initial);
 const carrier=new InquiryCarrierIncarnation(initial),handle=carrier.acquire(),binding={scope:{actual:true},originalDatabase:{sha256:'f'.repeat(64)},inputSqlite:{sha256:'1'.repeat(64)}};
 const port=await createOriginalInquiryCurrentPort({operation,session,passphrase,carrier,handle,initialInspection:initial,inspectCurrent:async()=>{calls++;return current;},assertOwnerActive:()=>assert.ok(active),readProbeBinding:async()=>binding,...options});
 const key=originalInquiryObservationKey(passphrase,operation,session);
 const query=(overrides={})=>({format:'sabalan-original-inquiry-observation/v1',operation,session,incarnation:port.endpoint.incarnation,sequence:1,challenge:randomBytes(32).toString('hex'),kind:'CURRENT',...overrides});
 const send=async value=>{const response=await fetch('http://127.0.0.1:'+port.endpoint.port+port.endpoint.path,{method:'POST',headers:{Connection:'close','x-sabalan-observation-mac':sign(key,'request',value)},body:bytes(value)});const result=await response.json();if(response.status===200)assert.equal(response.headers.get('x-sabalan-observation-mac'),sign(key,'response',result));return{status:response.status,result};};
 return{port,query,send,calls:()=>calls,loseOwner:()=>{active=false;},replace:()=>{current={...current,Id:'2'.repeat(64)};},key};
}
test('live original handle is freshly inspected; actual probe-binding reads and reader closure are retained',async()=>{
 const f=await fixture();try{assert.equal((await f.send(f.query())).status,200);assert.equal(f.calls(),1);const q=f.query({sequence:2,kind:'PROBE_BINDING'}),r=await f.send(q);assert.equal(r.status,200);assert.equal(r.result.binding.scope.actual,true);assert.equal(f.calls(),3);}finally{const row=await f.port.close();assert.equal(row.allOriginalReadersClosed,true);assert.equal(row.authenticationKeyRetired,true);f.port.assertClosed();f.key.fill(0);}
});
for(const mode of ['headers','body'])test('close retains an incomplete '+mode+' reader until its actual bounded socket closure',async()=>{
 const f=await fixture({readerDeadlineMs:100}),socket=net.createConnection({host:'127.0.0.1',port:f.port.endpoint.port});socket.on('error',()=>{});socket.resume();
 const closed=new Promise(resolve=>socket.once('close',resolve));await new Promise(resolve=>socket.once('connect',resolve));
 const header=mode==='headers'?'POST /original-inquiry-observation/v1 HTTP/1.1\r\nHost: localhost\r\n':'POST /original-inquiry-observation/v1 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{';
 await new Promise(resolve=>socket.write(header,resolve));await new Promise(setImmediate);
 const closing=f.port.close();const late=net.createConnection({host:'127.0.0.1',port:f.port.endpoint.port});late.on('error',()=>{});late.resume();await new Promise(resolve=>late.once('close',resolve));
 const row=await closing;await closed;assert.ok(row.fault);assert.equal(row.allOriginalReadersClosed,true);assert.ok(row.readers.length>=1);assert.ok(row.readers.every(r=>r.closed));assert.equal(f.calls(),0);f.key.fill(0);
});
test('oversized bodies stay negative and their actual socket closes',async()=>{
 const f=await fixture();try{await fetch('http://127.0.0.1:'+f.port.endpoint.port+f.port.endpoint.path,{method:'POST',headers:{Connection:'close'},body:'x'.repeat(4097)}).then(r=>r.arrayBuffer()).catch(()=>{});}finally{const row=await f.port.close();assert.equal(row.fault,'OBSERVATION_INPUT_BOUND');assert.ok(row.readers.every(r=>r.closed));assert.equal(f.calls(),0);f.key.fill(0);}
});
test('a replay is rejected before any additional inspection and permanently holds this port',async()=>{
 const f=await fixture();try{const q=f.query();assert.equal((await f.send(q)).status,200);assert.equal((await f.send(q)).status,409);assert.equal(f.calls(),1);assert.throws(()=>f.port.assertActive());}finally{const row=await f.port.close();assert.ok(row.fault);f.key.fill(0);}
});
for(const mutation of ['operation','incarnation','extra-command','lost-owner','replacement'])test('refuses '+mutation+' without adopting an observation',async()=>{
 const f=await fixture();try{let q=f.query();if(mutation==='operation')q.operation='3'.repeat(32);if(mutation==='incarnation')q.incarnation='4'.repeat(64);if(mutation==='extra-command')q.command='sign';if(mutation==='lost-owner')f.loseOwner();if(mutation==='replacement')f.replace();const r=await f.send(q);assert.equal(r.status,409);assert.equal(r.result.current,undefined);}finally{const row=await f.port.close();assert.ok(row.fault);f.key.fill(0);}
});
