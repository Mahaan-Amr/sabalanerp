import assert from 'node:assert/strict';
import test from 'node:test';
import {validateCandidatePreflight} from '../../scripts/replace-application-native-candidate-local.mjs';
test('candidate replacement refuses stale or failed both-host cleanup before Docker',()=>{
 const value={observedAt:'2026-10-20T10:00:00Z',sshExitCode:0,stdout:JSON.stringify({exitCode:0,productionCommitBefore:'a'.repeat(40),productionCommitAfter:'a'.repeat(40),lockHeldThroughBothHostPreflight:true,stdout:[{ok:true,project:'sabalanerp'},{ok:true,project:'sabalanerp-backup'}].map(x=>JSON.stringify(x)).join('\n')})};
 assert.doesNotThrow(()=>validateCandidatePreflight(value,Date.parse('2026-10-20T10:09:59Z')));
 assert.throws(()=>validateCandidatePreflight(value,Date.parse('2026-10-20T10:10:01Z')));
 assert.throws(()=>validateCandidatePreflight({...value,sshExitCode:1},Date.parse(value.observedAt)));
 const remote=JSON.parse(value.stdout);remote.stdout=JSON.stringify({ok:true,project:'sabalanerp'});
 assert.throws(()=>validateCandidatePreflight({...value,stdout:JSON.stringify(remote)},Date.parse(value.observedAt)));
});

import {candidateReplacementServices,validateCandidateProjectRows,nativeMaterialIdentity,validateInstalledNativeRole} from '../../scripts/replace-application-native-candidate-local.mjs';
test('all ten healthy services including ClamAV and unchanged retained role must be measured uniquely',()=>{
 const rows=candidateReplacementServices.map(Service=>({Service,Project:'sabalanerp-local',State:'running',Health:'healthy'}));
 assert.doesNotThrow(()=>validateCandidateProjectRows(rows));
 assert.throws(()=>validateCandidateProjectRows(rows.filter(row=>row.Service!=='clamav')));
 assert.throws(()=>validateCandidateProjectRows([...rows.slice(1),rows[1]]));
 assert.throws(()=>validateCandidateProjectRows(rows.map(row=>row.Service==='backend-retained'?{...row,Health:'unhealthy'}:row)));
});
test('installed old and new roles are checked against their own immutable material, never relabelled',()=>{
 const material={schemaSha256:'3'.repeat(64),files:[{path:'app/dist/onlinePrivateQualification.js',bytes:7,sha256:'1'.repeat(64)},{path:'app/node_modules/@prisma/client/index.js',bytes:9,sha256:'2'.repeat(64)}]};
 const old=nativeMaterialIdentity(material),fresh=nativeMaterialIdentity({...material,schemaSha256:'4'.repeat(64)});
 const observed={format:'sabalan-actual-installed-native-image/v1',entrySha256:'1'.repeat(64),schemaSha256:'3'.repeat(64),dist:old.dist,client:old.client,entryExportPresent:true,applicationStarted:false,databaseConnected:false,productionAdmission:false};
 assert.doesNotThrow(()=>validateInstalledNativeRole(observed,old));
 assert.throws(()=>validateInstalledNativeRole(observed,fresh));
 assert.throws(()=>validateInstalledNativeRole({...observed,client:{...old.client,entries:[{path:'index.js',bytes:9,sha256:'5'.repeat(64)}]}},old));
 assert.throws(()=>validateInstalledNativeRole({...observed,databaseConnected:true},old));
});
