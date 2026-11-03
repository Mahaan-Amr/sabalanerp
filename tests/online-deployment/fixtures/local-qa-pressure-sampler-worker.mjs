/** Real test-owned child chain, synthetic memory only; never Docker or runtime QA. */
import {parentPort,workerData} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {serveLocalQaPressureSampler} from '../../../scripts/lib/local-qa-pressure-sampler-worker.mjs';
let count=0;
serveLocalQaPressureSampler({port:parentPort,data:workerData,...(workerData.mode==='bound'?{maximumSamples:2}:{}),observe:async custody=>{
 count++;if(workerData.mode==='loss'&&count===2)process.exit(7);
 const delay=workerData.mode==='delay'&&count===2?5500:workerData.mode==='reader'&&count===2?3000:0;
 const begin=performance.now(),child=spawn(process.execPath,['-e','setTimeout(()=>process.stdout.write("{}"),Number(process.argv[1]))',String(delay)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 custody.onOriginal(child);child.stdout.resume();child.stderr.resume();
 const row=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded,observationFault:false})));
 await custody.onClosed(child,row);
 return{format:'sabalan-local-qa-pressure/v1',platform:'win32',observedAt:new Date().toISOString(),availableBytes:256*1024**2,commitTotalBytes:2**30,commitLimitBytes:8*2**30,lowMemory:workerData.mode==='transient'&&count===2||workerData.mode==='sustained'&&count>=2&&count<=4,
  vm:{probeContainerId:'a'.repeat(64),bootId:'12345678-1234-1234-1234-123456789012',fullAvg10:0,someAvg10:0,oomKills:workerData.mode==='oom'&&count>=2?1:0},probe:{durationMs:performance.now()-begin,children:[row,{...row}]}};
}});
