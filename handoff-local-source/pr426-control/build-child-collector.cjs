'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const digest=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function writeNew(file,obj){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(obj)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}
function writeAll(fd,buffer,write=fs.writeSync){let offset=0;while(offset<buffer.length){const n=write(fd,buffer,offset,buffer.length-offset);if(!Number.isSafeInteger(n)||n<=0||n>buffer.length-offset)throw Error('BUILD_LOG_WRITE_UNPROVEN');offset+=n;}return offset;}
async function collect({executable,args,cwd,directory,maxBytes=16777216,timeoutMs=3600000,write=fs.writeSync}){
 for(const key of ['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','NODE_REPL_EXTERNAL_MODULE','ESBUILD_BINARY_PATH','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG'])if(process.env[key])throw Error('BUILD_ENV_OVERRIDE_UNPROVEN');
 const stdout=path.join(directory,'build-stdout.bin'),stderr=path.join(directory,'build-stderr.bin');let out,err;
 try{out=fs.openSync(stdout,'wx',0o600);err=fs.openSync(stderr,'wx',0o600);writeNew(path.join(directory,'build-start.json'),{format:'sabalan-build-attempt/v1',state:'UNKNOWN',startedUtc:new Date().toISOString(),productionAdmission:false});}
 catch(e){if(out!==undefined)fs.closeSync(out);if(err!==undefined)fs.closeSync(err);throw e}
 let timeout=false,overflow=false,streamError=false,spawnError=false,interrupted=false,closedOut=false,closedErr=false,os=0,es=0;
 const signal=()=>{interrupted=true};process.on('SIGINT',signal);process.on('SIGTERM',signal);
 try{
  const child=spawn(executable,args,{cwd,stdio:['ignore','pipe','pipe'],windowsHide:true});
  const timer=setTimeout(()=>{timeout=true},timeoutMs);
  const reader=(stream,fd,isOut)=>{stream.on('data',chunk=>{if(streamError)return;try{const used=isOut?os:es,remaining=Math.max(0,maxBytes-used),part=chunk.subarray(0,remaining);if(part.length){const n=writeAll(fd,part,write);fs.fsyncSync(fd);if(isOut)os+=n;else es+=n}if(part.length<chunk.length)overflow=true}catch{streamError=true}});stream.on('error',()=>{streamError=true});stream.on('close',()=>{if(isOut)closedOut=true;else closedErr=true})};
  reader(child.stdout,out,true);reader(child.stderr,err,false);child.on('error',()=>{spawnError=true});
  const result=await new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));clearTimeout(timer);
  fs.fsyncSync(out);fs.fsyncSync(err);fs.closeSync(out);out=undefined;fs.closeSync(err);err=undefined;
  const state=result.code===0&&result.signal===null&&!timeout&&!overflow&&!streamError&&!spawnError&&!interrupted&&closedOut&&closedErr?'OBSERVED_SUCCESS':'UNKNOWN';
  const receipt={format:'sabalan-build-child-observation/v1',state,code:result.code,signal:result.signal,timeout,overflow,streamError,spawnError,interrupted,closedOut,closedErr,stdoutBytes:os,stderrBytes:es,stdoutSha256:digest(stdout),stderrSha256:digest(stderr),productionAdmission:false};writeNew(path.join(directory,'build-receipt.json'),receipt);return receipt;
 }finally{process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);if(out!==undefined)fs.closeSync(out);if(err!==undefined)fs.closeSync(err)}
}
module.exports={collect,writeAll};
