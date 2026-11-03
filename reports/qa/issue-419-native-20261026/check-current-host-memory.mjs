/** Fresh read-only canonical pre-UP memory gate. Never starts a runtime. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {randomBytes,createHash} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {validateQaHostMemoryObservation} from 'file:///C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp/scripts/lib/application-native-qa-memory.mjs';
const operation=randomBytes(16).toString('hex'),report={format:'sabalan-419-fresh-pre-up-memory-gate/v1',operation,admission:false,upStarted:false,masterStarted:false,productionAdmission:false};let lease;
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};await assert.rejects(acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);report.lease.contenderRefused=true;
 const file='C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp/scripts/lib/application-native-qa-memory.mjs';report.validator={file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
 lease.assertHeld();report.observation={platform:process.platform,availableBytes:os.freemem(),observedAt:new Date().toISOString()};report.profile='preserve-v3';report.requiredBytes=2048*1024**2;report.deficitBytes=Math.max(0,report.requiredBytes-report.observation.availableBytes);
 try{validateQaHostMemoryObservation(report.observation,report.profile);report.gatePassed=true;}catch(error){assert.match(error.message,/LOCAL_QA_HOST_MEMORY_FLOOR_REFUSED/);report.gatePassed=false;report.refusal='LOCAL_QA_HOST_MEMORY_FLOOR_REFUSED';}
 report.observationSucceeded=true;
}finally{if(lease){await lease.release();report.lease.closed=true;}const file=path.join(import.meta.dirname,'CURRENT-MEMORY-GATE-'+operation+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({file,gatePassed:report.gatePassed,availableBytes:report.observation?.availableBytes,requiredBytes:report.requiredBytes,deficitBytes:report.deficitBytes}));}
