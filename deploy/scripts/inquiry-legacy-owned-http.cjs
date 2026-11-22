'use strict';
const http=require('node:http');
/** The fixed entry supplies its genuine native SQLite work owner. Every
 * request holds that owner until BOTH the real handler and response settle.
 * Client disconnect never cancels or detaches an already admitted handler. */
exports.createOwnedLegacyInquiryHttp=async function({owner,prepare,handle,close}){
 try{await owner.run(prepare);}catch(error){await owner.stopAndDrain(240000);await close();throw error;}
 let draining=false,closing;const pending=new Set(),failures=[];
 const server=http.createServer((request,response)=>{
  if(draining){response.statusCode=503;response.end('INQUIRY_DRAINING');return;}
  const responseDone=new Promise(resolve=>{response.once('finish',resolve);response.once('close',resolve);});
  const task=owner.run(async()=>{
   const action=Promise.resolve().then(()=>{owner.assertActive();return handle(request,response);});
   // Observe immediately; an error must finish/close the actual response too.
   action.catch(error=>{if(!response.headersSent&&!response.destroyed){response.statusCode=500;response.end('INQUIRY_REQUEST_FAILED');}else if(!response.destroyed)response.destroy(error);});
   const results=await Promise.allSettled([action,responseDone]);
   if(results[0].status==='rejected')throw results[0].reason;
  });
  pending.add(task);
  task.then(()=>pending.delete(task),error=>{pending.delete(task);failures.push(error);process.stderr.write('INQUIRY_OWNED_REQUEST_FAILED\n');if(!response.destroyed)response.destroy(error);});
 });
 return Object.freeze({
  address:()=>server.address(),
  async listen(host,port){if(draining)throw Error('INQUIRY_ALREADY_DRAINING');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});},
  close(){if(closing)return closing;draining=true;closing=(async()=>{
   const listener=server.listening?new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())):Promise.resolve();
   server.closeIdleConnections();
   // Keep every original promise alive on failures. stopAndDrain records actual
   // nested SQL completion; no deadline means no authority to erase unknown work.
   while(pending.size)await Promise.allSettled([...pending]);
   await listener;await owner.stopAndDrain(240000);await close();
   if(failures.length)throw Error('INQUIRY_OWNED_REQUEST_FAILURE_RETAINED');
  })();return closing;}
 });
};
