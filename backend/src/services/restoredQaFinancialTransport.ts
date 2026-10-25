/** Data-only loopback HTTP transport. No endpoint/cohort/DB/financial authority.
 * Every failure waits for the SAME request and response to actually close. */
import http from'node:http';
export async function ownedRestoredQaLoopbackRequest(url:URL,session:string,payload?:Buffer){
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.hash||session.length>512||!session||/[\r\n;]/.test(session)||payload&&payload.length>16384)throw Error('RESTORED_QA_FINANCIAL_TRANSPORT_INPUT');
 return new Promise<{status:number;raw:Buffer}>((resolve,reject)=>{let failed=false,requestClosed=false,responseSeen=false,responseClosed=false,responseEnded=false,status=0,bytes=0;const chunks:Buffer[]=[];
  const settle=()=>{if(!requestClosed||responseSeen&&!responseClosed)return;if(failed||!responseSeen||!responseEnded)reject(Error('RESTORED_QA_FINANCIAL_TRANSPORT_FAILED'));else resolve({status,raw:Buffer.concat(chunks)});};
  const req=http.request(url,{method:payload?'POST':'GET',headers:{Cookie:'sabalan_session='+session,...(payload?{'Content-Type':'application/json','Content-Length':String(payload.length)}:{})}},res=>{responseSeen=true;status=res.statusCode??0;
   res.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>1048576)failed=true;else chunks.push(b);});res.on('error',()=>{failed=true;});res.on('aborted',()=>{failed=true;});res.on('end',()=>{responseEnded=true;});res.on('close',()=>{responseClosed=true;if(!res.complete)failed=true;settle();});
  });req.on('error',()=>{failed=true;});req.on('close',()=>{requestClosed=true;settle();});
  // A timeout is sticky negative evidence, never cancellation/closure proof.
  req.setTimeout(30000,()=>{failed=true;});req.end(payload);
 });
}
