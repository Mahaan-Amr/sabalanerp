import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

const maximumBytes=1280*1024**2,minimumFreeBytes=384*1024**2;
const commandFor=id=>['exec',id,'/bin/cat','/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.max'];

export function validateOriginalPreparedMemoryObservation(value){
 assert.match(value.containerId,/^[a-f0-9]{64}$/);
 assert.deepEqual(value.argv,commandFor(value.containerId));
 assert.ok(Number.isSafeInteger(value.originalPid)&&value.originalPid>0,'PREPARED_MEMORY_ORIGINAL_CHILD_REQUIRED');
 assert.equal(value.naturalChildClosure,true,'PREPARED_MEMORY_ORIGINAL_CHILD_NOT_CLOSED');
 assert.equal(value.stdoutEof,true,'PREPARED_MEMORY_STDOUT_NOT_EOF');
 assert.equal(value.stderrEof,true,'PREPARED_MEMORY_STDERR_NOT_EOF');
 assert.equal(value.code,0,'PREPARED_MEMORY_CHILD_FAILED');
 assert.equal(value.signal,null,'PREPARED_MEMORY_CHILD_SIGNALLED');
 assert.equal(value.spawnError,null,'PREPARED_MEMORY_SPAWN_FAILED');
 assert.deepEqual(value.streamErrors,[],'PREPARED_MEMORY_STREAM_FAILED');
 assert.equal(value.outputBoundExceeded,false,'PREPARED_MEMORY_OUTPUT_BOUND');
 assert.equal(value.stderr,'','PREPARED_MEMORY_UNEXPECTED_STDERR');
 assert.equal(typeof value.stdout,'string');
 assert.ok(Buffer.byteLength(value.stdout)<=128,'PREPARED_MEMORY_OUTPUT_BOUND');
 assert.match(value.stdout,/^(0|[1-9][0-9]*)\n(0|[1-9][0-9]*)\n$/,'PREPARED_MEMORY_TWO_INTEGER_LINES_REQUIRED');
 const [memoryCurrent,memoryMaximum]=value.stdout.trimEnd().split('\n').map(Number);
 assert.ok(Number.isSafeInteger(memoryCurrent)&&memoryCurrent>0,'PREPARED_MEMORY_CURRENT_INVALID');
 assert.ok(Number.isSafeInteger(memoryMaximum),'PREPARED_MEMORY_MAXIMUM_INVALID');
 assert.equal(memoryMaximum,maximumBytes,'NATIVE_PREPARED_MEMORY_CAP_CHANGED');
 const actualFreeBytes=memoryMaximum-memoryCurrent;
 assert.ok(actualFreeBytes>=minimumFreeBytes,'NATIVE_PREPARED_ACTUAL_MEMORY_FLOOR_REFUSED');
 return{...value,format:'sabalan-original-prepared-memory-observation/v1',memoryCurrent,memoryMaximum,
  actualFreeBytes,minimumFreeBytes,cacheCreditUsed:false,observer:'ORIGINAL_CAT_AFTER_PREPARE_CACHE_CLOSED',
  observerMemoryIncluded:true};
}

/** One fresh original cat after the preparation child is already closed. */
export async function observeOriginalPreparedMemory({containerId,beforeDocker,onObservation=()=>{}}){
 assert.match(containerId,/^[a-f0-9]{64}$/);assert.equal(typeof beforeDocker,'function');
 const argv=commandFor(containerId);beforeDocker();
 const value=await new Promise(resolve=>{
  const child=spawn('docker',argv,{stdio:['ignore','pipe','pipe']});
  const chunks={stdout:[],stderr:[]},counts={stdout:0,stderr:0},ended={stdout:false,stderr:false};
  const streamErrors=[];let spawnError=null,outputBoundExceeded=false;
  for(const name of ['stdout','stderr']){
   child[name].on('data',bytes=>{counts[name]+=bytes.length;if(counts[name]<=(name==='stdout'?128:1024))chunks[name].push(bytes);else outputBoundExceeded=true;});
   child[name].once('end',()=>{ended[name]=true;});
   child[name].once('error',error=>{streamErrors.push({stream:name,code:error.code??null});});
  }
  child.once('error',error=>{spawnError=error.code??'SPAWN_ERROR';});
  // Never kill/retry the original child; drain both streams until close.
  child.once('close',(code,signal)=>resolve({containerId,argv,originalPid:child.pid??null,code,signal,
   naturalChildClosure:true,stdoutEof:ended.stdout,stderrEof:ended.stderr,spawnError,streamErrors,
   outputBoundExceeded,stdout:Buffer.concat(chunks.stdout).toString('utf8'),
   stderr:Buffer.concat(chunks.stderr).toString('utf8'),stdoutBytes:counts.stdout,stderrBytes:counts.stderr}));
 });
 onObservation(value);
 return validateOriginalPreparedMemoryObservation(value);
}
