/** Reuse the reviewed #413 read-only current-source/canonical capacity chain.
 * Stop before its image builder. No cleanup, service action or admission. */
import assert from'node:assert/strict';
import{freshBothHostBackendBasePreflight}from'./lib/production-backend-base-artifacts.mjs';
import{closedReadOnlyObservationPassed}from'./lib/read-only-observation-result.mjs';import fs from'node:fs';import path from'node:path';import{createHash,randomBytes}from'node:crypto';
import{acquireSerialHostLease}from'./lib/serial-physical/host-lease.mjs';import{originalBackendBaseCommands}from'./lib/production-backend-base-process.mjs';
const Q='D:/sabalanerp-online-qa',python='C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',sha=b=>createHash('sha256').update(b).digest('hex'),commands=originalBackendBaseCommands(),operation=randomBytes(16).toString('hex'),report={format:'sabalan-419-v2-current-source-preflight-observation/v1',operation,pass:false,children:[],upStarted:false,masterStarted:false,productionAdmission:false};let lease;
const preparation={file:'C:/Users/mahan/.codex/worktrees/immutable-final-package-413/sabalanerp/reports/qa/issue-413-backend-image-20261026/prepare-current-preflight.py',sha256:'874d2e3a86bffadbde5d17f7c3fb4fba3552d924a887f403e73e8cf4ddbdbfcf'};
const pinned=ref=>{assert.equal(fs.realpathSync(ref.file),path.resolve(ref.file));assert.equal(sha(fs.readFileSync(ref.file)),ref.sha256);};
async function run(args){lease.assertHeld();pinned(preparation);const row=await commands.run(python,['-I','-B',...args],{maximum:2*1024**2});report.children.push(row);commands.assertSuccessful(row);assert.equal(row.stderr,'');return JSON.parse(row.stdout.trim());}
try{
 lease=await acquireSerialHostLease(Q+'/deployment.lock');report.leasePid=lease.originalPid;pinned(preparation);
 const baseline=await run([Q+'/C29-installed45cab-healthy-baseline-source-r2-exact-bytes-20261024/run-baseline-observer.py','--observe-reviewed','--installation',Q+'/offline-source-install-original-20261024T161731966906Z.json','--installation-sha256','4ce668432ad3a82b3b1224ecc7305c1c734e9862d2bc64d1040c9073940676f3','--installation-original-sha256','77f249b57bee1e92799e5b2a2b9d0bc4419f5a73ab0b76efd540dc54f026eb19']);report.baseline=baseline;assert.equal(baseline.qualified,true);
 const prepared=await run([preparation.file,baseline.file,baseline.sha256]);report.preparation=prepared;pinned(prepared.source);
 report.preflight=await run([prepared.source.file,'--execute-reviewed']);const actual=report.preflight.report??report.preflight.file;assert.equal(typeof actual,'string');report.canonicalBothHostPreflight=freshBothHostBackendBasePreflight(path.resolve('C:/Users/mahan/.codex/worktrees/immutable-final-package-413/sabalanerp'),actual);report.prerequisitesPassed=true;
}catch(error){report.failure={name:error.name,code:error.code??null,message:error.message};process.exitCode=1;}
finally{report.originalChildren=await commands.close();if(lease){await lease.release();report.leaseClosed=true;}report.pass=closedReadOnlyObservationPassed(report);if(!report.pass)process.exitCode=1;const file=path.resolve('reports/qa/issue-419-c3-bindings-20261026/CURRENT-SOURCE-PREFLIGHT-'+operation+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({file,pass:report.pass,failure:report.failure??null}));}
