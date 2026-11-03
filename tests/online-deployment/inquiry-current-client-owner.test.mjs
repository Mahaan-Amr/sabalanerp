import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import client from '../../scripts/lib/restored-qa/inquiry-current-client.cjs';
const {reader,owner}=client.originalInquiryObservationTransportSources();
const python=process.platform==='win32'?'C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe':'/usr/bin/python3';
const fixture="import os,json,sys\njson.load(sys.stdin)\nprint(json.dumps({'pid':os.getpid()},separators=(',',':')))\n";
function replaceOnce(source,before,after){assert.equal(source.split(before).length,2);return source.replace(before,after);}
async function run(source){
 const child=spawn(python,['-I','-B','-c',source],{stdio:['pipe','pipe','pipe'],windowsHide:true});const out=[],err=[];let exceeded=false,count=0;
 for(const [stream,parts]of [[child.stdout,out],[child.stderr,err]])stream.on('data',raw=>{count+=raw.length;if(count<=4*1024**2)parts.push(raw);else exceeded=true;});
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));child.stdin.end('{}');});
 assert.deepEqual(result,{code:0,signal:null});assert.equal(exceeded,false);assert.equal(child.stdout.readableEnded,true);assert.equal(child.stderr.readableEnded,true);assert.equal(Buffer.concat(err).length,0);return JSON.parse(Buffer.concat(out));
}
for(const mode of ['normal','stdin-write','stdin-close','reader-read','output-bound','sigterm','sigint'])test('actual retained Python reader '+mode+' preserves Popen, wait and both EOFs',{skip:!fs.existsSync(python)},async()=>{
 let source=replaceOnce(owner,'reader='+JSON.stringify(reader),'reader='+JSON.stringify(mode==='output-bound'?"import sys\nsys.stdin.read()\nsys.stdout.write('x'*2097153)\n":fixture));
 if(mode==='stdin-write')source=replaceOnce(source,'try:child.stdin.write(raw);child.stdin.flush()',"try:raise OSError('injected post-Popen stdin error')");
 if(mode==='stdin-close'){
  source=replaceOnce(source,'streams={};threads=[]','streams={};threads=[];close_fault=[False]');
  source=replaceOnce(source,'try:child.stdin.close()',"try:\n    if not close_fault[0]:\n     close_fault[0]=True;raise OSError('injected close error')\n    child.stdin.close()");
 }
 if(mode==='reader-read')source=replaceOnce(source,' def read_part(stream):return os.read(stream.fileno(),65536)'," read_fault=[False]\n def read_part(stream):\n  if not read_fault[0]:\n   read_fault[0]=True;raise OSError('injected reader error')\n  return os.read(stream.fileno(),65536)");
 if(['sigterm','sigint'].includes(mode))source=replaceOnce(source,' try:child.stdin.write(raw);child.stdin.flush()'," signal.raise_signal(signal."+(mode==='sigterm'?'SIGTERM':'SIGINT')+")\n try:child.stdin.write(raw);child.stdin.flush()");
 const row=await run(source),original=row.original;assert.ok(Number.isSafeInteger(original.originalPid)&&original.originalPid>1);assert.equal(original.stdoutEof,true);assert.equal(original.stderrEof,true);assert.equal(original.signal,null);assert.equal(original.killed,false);
 if(mode==='normal'){
  assert.equal(row.transportSucceeded,true);assert.equal(row.response.pid,original.originalPid);assert.equal(original.code,0);assert.equal(original.observationFault,false);
  assert.equal(original.stdoutSha256,createHash('sha256').update(JSON.stringify({pid:original.originalPid})+(process.platform==='win32'?'\r\n':'\n')).digest('hex'));
 }else{assert.equal(row.transportSucceeded,false);assert.equal(original.observationFault,true);if(mode==='stdin-write')assert.notEqual(original.code,0);else assert.equal(original.code,0);}
 if(mode==='output-bound')assert.equal(original.stdoutBytes,2097153);
 if(['sigterm','sigint'].includes(mode)){assert.equal(original.cancelled,true);assert.deepEqual(original.observedSignals,[mode==='sigterm'?'SIGTERM':'SIGINT']);}
});
