/** Zero-input read-only Windows bridge to the SAME retained native owner.
 * Separate domain/key/sequence from the Linux issuer; no enrollment, signing,
 * actor creation, caller path/command or authority reconstructed from JSON. */
import assert from 'node:assert/strict';import http from 'node:http';
import{assertOriginalCompleteResourcePorts}from'./original-complete-resource-ports.mjs';
import{format,route,keyFor,bytes,mac,valid}from'./original-complete-reader-protocol.mjs';
export{retainOriginalCompleteReaderClient,readOriginalCompleteLiveContext}from'./original-complete-reader-client.mjs';
export async function createOriginalCompleteReaderPort({operation,passphrase,resources,port=0}){
 assertOriginalCompleteResourcePorts(resources);const key=keyFor(operation,passphrase);assert.ok(Number.isInteger(port)&&port>=0&&port<=65535);
 let phase='STARTING',sequence=0,busy=false,fault=null;const sockets=new Set(),tasks=new Set(),readers=[],requests=[];const hold=code=>{fault??=code;};
 const server=http.createServer((request,response)=>{
  const work=(async()=>{
   response.setHeader('Connection','close');response.setHeader('Content-Type','application/json');const refuse=(status,code)=>{response.statusCode=status;response.end(JSON.stringify({format,status:'REFUSED',code}));};
   if(phase!=='ACTIVE'||fault){refuse(503,'ORIGINAL_COMPLETE_READER_HELD');return;}if(request.method!=='POST'||request.url!==route){refuse(404,'FIXED_READER_ONLY');return;}
   let count=0;const chunks=[];for await(const raw of request){count+=raw.length;if(count>4096){hold('READER_INPUT_BOUND');response.once('finish',()=>request.socket.destroy());refuse(413,'READER_INPUT_BOUND');return;}chunks.push(raw);}
   let value;try{value=JSON.parse(Buffer.concat(chunks));}catch{refuse(400,'READER_INPUT_INVALID');return;}
   if(!valid(request.headers['x-sabalan-reader-mac'],mac(key,'request',value))){refuse(401,'READER_AUTHENTICATION_REFUSED');return;}
   let admitted=false;try{
    assert.deepEqual(Object.keys(value).sort(),['challenge','format','kind','operation','sequence']);assert.equal(value.format,format);assert.equal(value.operation,operation);assert.match(value.challenge,/^[a-f0-9]{64}$/);assert.ok(['CURRENT','SEED_CONTEXT','WORK_ADMISSION'].includes(value.kind));assert.equal(busy,false);assert.equal(value.sequence,sequence+1);assert.ok(value.sequence<=16384);busy=true;admitted=true;sequence++;
    await resources.assertCurrent();const result=value.kind==='CURRENT'?{current:true}:value.kind==='WORK_ADMISSION'?await resources.observeMemoryAdmission():await resources.readSeedContext();await resources.assertCurrent();assert.equal(phase,'ACTIVE');assert.equal(fault,null);
    const reply={...value,result},raw=bytes(reply);assert.ok(raw.length<=8*1024**2);response.setHeader('x-sabalan-reader-mac',mac(key,'response',reply));response.statusCode=200;response.end(raw);requests.push({sequence,kind:value.kind});
   }catch{hold('ORIGINAL_COMPLETE_READ_UNPROVEN');refuse(409,'ORIGINAL_COMPLETE_READ_UNPROVEN');}finally{if(admitted)busy=false;}
  })();tasks.add(work);work.catch(()=>{hold('ORIGINAL_COMPLETE_READER_TRANSPORT_FAULT');response.destroy();}).finally(()=>tasks.delete(work));
 });
 server.on('connection',socket=>{sockets.add(socket);const record={closed:false,peerEofObserved:false,deadlineExpired:false};let resolve;record.completion=new Promise(r=>resolve=r);readers.push(record);const timer=setTimeout(()=>{record.deadlineExpired=true;hold('ORIGINAL_COMPLETE_READER_DEADLINE');socket.destroy();},300000);socket.once('end',()=>record.peerEofObserved=true);socket.once('close',hadError=>{clearTimeout(timer);sockets.delete(socket);record.closed=true;record.hadError=hadError;resolve();});socket.on('error',()=>hold('ORIGINAL_COMPLETE_READER_SOCKET_FAULT'));if(phase==='DRAINING'||phase==='CLOSED'||sockets.size>4){hold('ORIGINAL_COMPLETE_READER_CONNECTION_REFUSED');socket.destroy();}});
 server.on('error',()=>hold('ORIGINAL_COMPLETE_READER_SERVER_FAULT'));
 try{await resources.assertCurrent();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});phase='ACTIVE';}catch(error){if(server.listening)await new Promise(resolve=>server.close(resolve));key.fill(0);throw error;}
 let closing;return Object.freeze({endpoint:Object.freeze({host:'127.0.0.1',port:server.address().port,path:route,operation}),close(){return closing??=(async()=>{assert.equal(phase,'ACTIVE');phase='DRAINING';await new Promise(resolve=>server.close(resolve));await Promise.all(readers.map(r=>r.completion));while(tasks.size)await Promise.allSettled([...tasks]);assert.equal(sockets.size,0);phase='CLOSED';key.fill(0);return Object.freeze({format,phase,fault,requests,readers:readers.map(({completion,...r})=>r),authenticationKeyRetired:true,productionAdmission:false});})();}});
}
