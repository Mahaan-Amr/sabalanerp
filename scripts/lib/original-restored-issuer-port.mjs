/** Explicit transport for fixed original-issuer operations. Distinct from the
 * one-request material exchange and read-only Inquiry observation protocols. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac,hkdfSync,timingSafeEqual} from 'node:crypto';
import {assertOriginalRoleRestoredIssuer} from './original-role-restored-issuer.mjs';

const format='sabalan-original-restored-issuer/v1',route='/original-restored-issuer/v1';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v)));
const mac=(key,domain,value)=>createHmac('sha256',key).update(format+'\0'+domain+'\0').update(bytes(value)).digest('hex');
const validMac=(a,b)=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));

export async function createOriginalRestoredIssuerPort({operation,passphrase,issuer,port=0,readerDeadlineMs=5000}){
 assertOriginalRoleRestoredIssuer(issuer);assert.match(operation,/^[a-f0-9]{32}$/);
 assert.equal(issuer.inspect().operation,operation);assert.ok(typeof passphrase==='string'&&/^[A-Za-z0-9_-]{64}$/.test(passphrase),'ORIGINAL_ISSUER_TRANSPORT_SECRET_REFUSED');
 assert.ok(Number.isInteger(port)&&port>=0&&port<=65535);
 assert.ok(Number.isInteger(readerDeadlineMs)&&readerDeadlineMs>=100&&readerDeadlineMs<=300000);
 const key=Buffer.from(hkdfSync('sha256',Buffer.from(passphrase),Buffer.from(operation,'hex'),Buffer.from(format),32));
 let phase='STARTING',sequence=0,busy=false,fault=null;const sockets=new Set(),tasks=new Set(),closures=[],requests=[];
 const hold=code=>{fault??=code;};
 const server=http.createServer((request,response)=>{
  const task=(async()=>{
   response.setHeader('Connection','close');response.setHeader('Content-Type','application/json');
   const refuse=(status,code)=>{response.statusCode=status;response.end(JSON.stringify({format,status:'REFUSED',code}));};
   if(phase!=='ACTIVE'||fault){refuse(503,'ORIGINAL_ISSUER_PORT_NOT_ACTIVE');return;}
   if(request.method!=='POST'||request.url!==route){refuse(404,'FIXED_ORIGINAL_ISSUER_ONLY');return;}
   let count=0;const chunks=[];
   const deadline=setTimeout(()=>{hold('ISSUER_REQUEST_BODY_DEADLINE');request.destroy();},5000);
   try{for await(const chunk of request){count+=chunk.length;if(count>4096){hold('ISSUER_REQUEST_BOUND');refuse(413,'ISSUER_REQUEST_BOUND');response.once('finish',()=>request.socket.destroy());return;}chunks.push(chunk);}}
   finally{clearTimeout(deadline);}
   let value;try{value=JSON.parse(Buffer.concat(chunks));}catch{refuse(400,'ISSUER_REQUEST_INVALID');return;}
   if(!validMac(request.headers['x-sabalan-issuer-mac'],mac(key,'request',value))){refuse(401,'ISSUER_AUTHENTICATION_REFUSED');return;}
   let admitted=false;
   try{
    assert.deepEqual(Object.keys(value).sort(),['challenge','format','kind','operation','sequence']);
    assert.equal(value.format,format);assert.equal(value.operation,operation);assert.match(value.challenge,/^[a-f0-9]{64}$/);
    assert.ok(['ENROLL','ASSERT_ACTIVE','PREPARE_LAYOUT','ISSUE_MATERIAL','WORK_ADMISSION','PREPARE_DRAIN','SHUTDOWN'].includes(value.kind));
    assert.equal(phase,'ACTIVE');assert.equal(fault,null);assert.equal(busy,false);assert.equal(value.sequence,sequence+1);assert.ok(value.sequence<=16384);
    busy=true;admitted=true;sequence++;await issuer.checkOriginalResources();
    let result;
    if(value.kind==='ENROLL')result=issuer.enrollment;
    else if(value.kind==='ASSERT_ACTIVE')result={active:true};
    else if(value.kind==='WORK_ADMISSION')result=await issuer.observeMemoryAdmission();
    else if(value.kind==='PREPARE_LAYOUT')result=await issuer.prepareOriginalRestoredLayout();
    else if(value.kind==='ISSUE_MATERIAL')result=await issuer.issueOriginalRestoredMaterial();
    else if(value.kind==='PREPARE_DRAIN')result=await issuer.prepareOriginalPrivateDrain();
    else result=await issuer.shutdownOriginalPrivateHttp();
    await issuer.checkOriginalResources();assert.equal(phase,'ACTIVE');assert.equal(fault,null);
    const reply={format,operation,sequence,challenge:value.challenge,kind:value.kind,result};const raw=bytes(reply);
    assert.ok(raw.length<=12*1024**2);response.setHeader('x-sabalan-issuer-mac',mac(key,'response',reply));response.statusCode=200;response.end(raw);
    requests.push({sequence,kind:value.kind});
   }catch{hold('ORIGINAL_ISSUER_OPERATION_UNPROVEN');refuse(409,'ORIGINAL_ISSUER_OPERATION_UNPROVEN');}
   finally{if(admitted)busy=false;}
  })();tasks.add(task);task.catch(()=>{hold('ORIGINAL_ISSUER_TRANSPORT_FAULT');response.destroy();}).finally(()=>tasks.delete(task));
 });
 server.on('connection',socket=>{
  sockets.add(socket);const record={closed:false,peerEofObserved:false,deadlineExpired:false};
  const deadline=setTimeout(()=>{record.deadlineExpired=true;hold('ORIGINAL_ISSUER_READER_DEADLINE');socket.destroy();},readerDeadlineMs);
  socket.once('end',()=>{record.peerEofObserved=true;});
  closures.push(new Promise(resolve=>socket.once('close',hadError=>{clearTimeout(deadline);sockets.delete(socket);record.closed=true;record.hadError=hadError;resolve(record);})));
  socket.on('error',()=>hold('ORIGINAL_ISSUER_SOCKET_FAULT'));
  if(phase==='DRAINING'||phase==='CLOSED'||sockets.size>4){hold('ORIGINAL_ISSUER_CONNECTION_REFUSED');socket.destroy();}
 });
 server.on('error',()=>hold('ORIGINAL_ISSUER_SERVER_FAULT'));
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});phase='ACTIVE';}
 catch(error){if(server.listening)await new Promise(resolve=>server.close(resolve));key.fill(0);throw error;}
 return Object.freeze({endpoint:Object.freeze({host:'127.0.0.1',port:server.address().port,path:route,operation}),
  async close(){assert.equal(phase,'ACTIVE');phase='DRAINING';await new Promise(resolve=>server.close(resolve));const readers=await Promise.all(closures);while(tasks.size)await Promise.allSettled([...tasks]);assert.equal(sockets.size,0);phase='CLOSED';key.fill(0);return Object.freeze({format,phase,fault,readers,requests:structuredClone(requests),authenticationKeyRetired:true,productionAdmission:false});},
  inspect(){return Object.freeze({phase,fault,busy,activeTasks:tasks.size,activeReaders:sockets.size,productionAdmission:false});},
 });
}
