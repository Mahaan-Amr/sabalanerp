/** Bounded observation adapter between the original COMPLETE controller and
 * its original Linux worker. It signs no authority and executes no caller input.
 * The existing request/ACK material exchange remains a separate protocol. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash,createHmac,hkdfSync,timingSafeEqual} from 'node:crypto';
import {InquiryCarrierIncarnation} from '../../deploy/scripts/local-inquiry-carrier.mjs';

const format='sabalan-original-inquiry-observation/v1';
const route='/original-inquiry-observation/v1';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v)));
const digest=v=>createHash('sha256').update(bytes(v)).digest('hex');
const mac=(key,domain,value)=>createHmac('sha256',key).update(domain+'\0').update(bytes(value)).digest('hex');
const equalMac=(a,b)=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export function originalInquiryObservationKey(passphrase,operation,session){
 assert.equal(typeof passphrase,'string');assert.ok(Buffer.byteLength(passphrase)>=32&&Buffer.byteLength(passphrase)<=4096&&!/[\r\n\0]/.test(passphrase));
 assert.match(operation,/^[a-f0-9]{32}$/);assert.match(session,/^[a-f0-9]{64}$/);
 return Buffer.from(hkdfSync('sha256',Buffer.from(passphrase),Buffer.from(operation,'hex'),Buffer.from(format+'\0'+session),32));
}
export function originalInquiryIncarnationDigest(inspection){
 return digest({id:inspection.Id,image:inspection.Image,startedAt:inspection.State.StartedAt});
}

/** carrier/handle and inspectCurrent are held in this original process. A saved
 * inspection or response cannot recreate this port's handle or live callback. */
export async function createOriginalInquiryCurrentPort({operation,session,passphrase,carrier,handle,initialInspection,inspectCurrent,assertOwnerActive,readProbeBinding,port=0,readerDeadlineMs=5000}){
 assert.ok(carrier instanceof InquiryCarrierIncarnation);carrier.assertCurrent(handle,initialInspection);
 assert.equal(typeof inspectCurrent,'function');assert.equal(typeof assertOwnerActive,'function');assert.equal(typeof readProbeBinding,'function');
 assert.ok(Number.isInteger(port)&&port>=0&&port<=65535);
 assert.ok(Number.isInteger(readerDeadlineMs)&&readerDeadlineMs>=100&&readerDeadlineMs<=5000);
 const key=originalInquiryObservationKey(passphrase,operation,session),incarnation=originalInquiryIncarnationDigest(initialInspection);
 let sequence=0,phase='STARTING',fault=null,observing=false;const tasks=new Set(),sockets=new Set(),socketClosures=[],socketRecords=[],requests=[];
 const hold=code=>{fault??=code;};
 const server=http.createServer((request,response)=>{
  const work=(async()=>{
   response.setHeader('Connection','close');response.setHeader('Content-Type','application/json');
   const refuse=(status,code)=>{response.statusCode=status;response.end(JSON.stringify({format,status:'REFUSED',code}));};
   if(phase!=='ACTIVE'||fault!==null){hold('OBSERVATION_DRAINING_READER');refuse(503,'OBSERVATION_OWNER_NOT_ACTIVE');return;}
   if(request.method!=='POST'||request.url!==route){refuse(404,'FIXED_OBSERVATION_ONLY');return;}
   let size=0;const chunks=[];
   for await(const chunk of request){size+=chunk.length;if(size>4096){hold('OBSERVATION_INPUT_BOUND');const socket=request.socket;response.once('finish',()=>socket.destroy());refuse(413,'OBSERVATION_INPUT_BOUND');return;}chunks.push(chunk);}
   let value;try{value=JSON.parse(Buffer.concat(chunks));}catch{refuse(400,'OBSERVATION_INPUT_INVALID');return;}
   if(!equalMac(request.headers['x-sabalan-observation-mac'],mac(key,'request',value))){refuse(401,'OBSERVATION_AUTHENTICATION_REFUSED');return;}
   try{
    assert.deepEqual(Object.keys(value).sort(),['challenge','format','incarnation','kind','operation','sequence','session']);
    assert.equal(value.format,format);assert.equal(value.operation,operation);assert.equal(value.session,session);assert.equal(value.incarnation,incarnation);
    assert.match(value.challenge,/^[a-f0-9]{64}$/);assert.ok(['CURRENT','PROBE_BINDING'].includes(value.kind));
    assert.equal(phase,'ACTIVE');assert.equal(fault,null);assert.equal(observing,false);assert.equal(value.sequence,sequence+1);assert.ok(value.sequence<=16384);sequence++;observing=true;
    assertOwnerActive();const inspected=await inspectCurrent();assertOwnerActive();carrier.assertCurrent(handle,inspected);
    const result={format,operation,session,incarnation,sequence,challenge:value.challenge,kind:value.kind,current:true};
    if(value.kind==='PROBE_BINDING'){
     const binding=await readProbeBinding();assertOwnerActive();carrier.assertCurrent(handle,await inspectCurrent());
     assert.deepEqual(Object.keys(binding).sort(),['inputSqlite','originalDatabase','scope']);result.binding=structuredClone(binding);
    }
    assertOwnerActive();assert.equal(fault,null);assert.equal(phase,'ACTIVE');
    const raw=bytes(result);assert.ok(raw.length<=1024*1024);response.setHeader('x-sabalan-observation-mac',mac(key,'response',result));response.statusCode=200;response.end(raw);
    requests.push({sequence,kind:value.kind,incarnation,inspectionDigest:originalInquiryIncarnationDigest(inspected),responseSha256:createHash('sha256').update(raw).digest('hex')});
   }catch{hold('ORIGINAL_INQUIRY_OBSERVATION_UNPROVEN');refuse(409,'ORIGINAL_INQUIRY_OBSERVATION_UNPROVEN');}finally{observing=false;}
  })();
  tasks.add(work);work.catch(()=>{hold('OBSERVATION_TRANSPORT_FAULT');response.destroy();}).finally(()=>tasks.delete(work));
 });
 server.on('connection',socket=>{
  sockets.add(socket);const record={closed:false,peerEofObserved:false,deadlineExpired:false};socketRecords.push(record);
  const deadline=setTimeout(()=>{record.deadlineExpired=true;hold('OBSERVATION_READER_DEADLINE');socket.destroy();},readerDeadlineMs);
  socket.once('end',()=>{record.peerEofObserved=true;});
  socketClosures.push(new Promise(resolve=>socket.once('close',hadError=>{clearTimeout(deadline);record.closed=true;record.hadError=hadError;record.bytesRead=socket.bytesRead;record.bytesWritten=socket.bytesWritten;sockets.delete(socket);resolve();})));
  socket.on('error',()=>hold('OBSERVATION_SOCKET_FAULT'));
  if(phase==='DRAINING'||phase==='CLOSED'||sockets.size>4){hold('OBSERVATION_CONNECTION_REFUSED');socket.destroy();}
 });
 server.on('error',()=>hold('OBSERVATION_SERVER_FAULT'));
 try{
  assertOwnerActive();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  assertOwnerActive();phase='ACTIVE';
 }catch(error){if(server.listening)await new Promise(resolve=>server.close(resolve));key.fill(0);throw error;}
 const address=server.address();assert.equal(address.address,'127.0.0.1');
 return Object.freeze({
  endpoint:Object.freeze({host:'127.0.0.1',port:address.port,path:route,operation,session,incarnation}),
  assertActive(){assert.equal(phase,'ACTIVE');assert.equal(fault,null);assertOwnerActive();assert.ok(server.listening);},
  async close(){
   assert.equal(phase,'ACTIVE');phase='DRAINING';const listenerClosed=new Promise(resolve=>server.close(resolve));
   await listenerClosed;await Promise.all(socketClosures);while(tasks.size)await Promise.allSettled([...tasks]);
   assert.equal(tasks.size,0);assert.equal(sockets.size,0);phase='CLOSED';key.fill(0);
   return Object.freeze({format,phase,fault,requests:structuredClone(requests),readers:structuredClone(socketRecords),allOriginalReadersClosed:true,authenticationKeyRetired:true,productionAdmission:false});
  },
  assertClosed(){assert.equal(phase,'CLOSED');assert.equal(fault,null);assert.equal(tasks.size,0);assert.equal(sockets.size,0);},
 });
}
