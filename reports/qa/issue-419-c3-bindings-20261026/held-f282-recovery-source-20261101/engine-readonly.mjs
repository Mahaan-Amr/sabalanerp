/** Engine GET only. Context and daemon ID must match the existing Docker CLI.
 * API: https://docs.docker.com/reference/api/engine/version/v1.56/#tag/Exec/operation/ExecInspect
 */
import assert from 'node:assert/strict';import http from 'node:http';
async function get(pipe,resource){
 assert.ok(resource==='/info'||/^\/exec\/[a-f0-9]{64}\/json$/.test(resource));
 return await new Promise((resolve,reject)=>{let response,requestClosed=false,responseClosed=false,ended=false,fault=null,bytes=0,chunks=[],status;
  const finish=()=>{if(!requestClosed||response&&!responseClosed)return;if(fault)return reject(fault);try{assert.equal(ended,true,'ENGINE_METADATA_EOF_REQUIRED');assert.equal(status,200,'ENGINE_METADATA_HTTP_REFUSED');assert.ok(bytes>0&&bytes<=2*1024**2);resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){reject(error);}};
  const request=http.request({socketPath:pipe,path:resource,method:'GET',headers:{Connection:'close'},agent:false,maxHeaderSize:16384},res=>{response=res;status=res.statusCode;res.on('data',b=>{bytes+=b.length;if(bytes<=2*1024**2)chunks.push(b);else fault??=Error('ENGINE_METADATA_BOUND');});res.once('end',()=>{ended=true;});res.once('error',e=>{fault??=e;});res.once('close',()=>{responseClosed=true;finish();});res.resume();});
  request.setTimeout(2500,()=>{fault??=Error('ENGINE_METADATA_READ_TIMEOUT');request.destroy(fault);});request.once('error',e=>{fault??=e;});request.once('close',()=>{requestClosed=true;finish();});request.end();
 });
}
export async function inspectOriginalHealthExec(id,readCli){
 assert.match(id,/^[a-f0-9]{64}$/);const selected=(await readCli(['context','show'])).trim(),contexts=JSON.parse(await readCli(['context','inspect',selected]));assert.equal(contexts.length,1);assert.equal(contexts[0].Name,selected);const endpoint=contexts[0].Endpoints.docker.Host;assert.ok(endpoint.startsWith('npipe://'),'WINDOWS_NAMED_PIPE_CONTEXT_REQUIRED');const slash=String.fromCharCode(92),prefix=slash+slash+'.'+slash+'pipe'+slash,pipe=endpoint.slice('npipe://'.length).replaceAll('/',slash);assert.ok(pipe.startsWith(prefix)&&/^[A-Za-z0-9_.-]+$/.test(pipe.slice(prefix.length))&&!pipe.includes('..'),'LOCAL_ENGINE_PIPE_REQUIRED');const expected=(await readCli(['info','--format','{{.ID}}'])).trim();assert.ok(expected.length>0);const info=await get(pipe,'/info');assert.equal(info.ID,expected,'DOCKER_ENGINE_CONTEXT_CHANGED');const value=await get(pipe,'/exec/'+id+'/json');assert.equal(value.ID,id,'EXEC_ID_CHANGED');return value;
}
