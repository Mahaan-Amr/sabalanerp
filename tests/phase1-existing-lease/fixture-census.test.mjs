import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {readTestOwnedNativeSnapshot} from '../../scripts/lib/reconciliation-readonly-phase1-cli.mjs';

async function makeRoot(){const root=path.join(tmpdir(),'sabalan-phase1-fixture-'+randomUUID().replaceAll('-',''));await mkdir(root,{mode:0o700});return root;}

test('missing own proof reports UNKNOWN with explicit unavailable subchecks',async()=>{
 const root=await makeRoot();const result=await readTestOwnedNativeSnapshot(root);
 assert.equal(result.status,'UNKNOWN');assert.equal(result.ownerProof,'UNKNOWN');
 for(const name of ['proof','ancestor','nodePin','launcherPin'])assert.deepEqual(result.ownerChecks[name],{status:'UNKNOWN',expected:'UNAVAILABLE',actual:'UNAVAILABLE'});
});

test('invalid fixture parent proof records mismatch and retains later unknowns',async()=>{
 const root=await makeRoot();const runId=path.basename(root).slice('sabalan-phase1-fixture-'.length);
 const proof={format:'phase1-fixture-owner-proof/v1',fixtureOnly:true,runId,launcherPid:2147483647,parentPid:2147483646,jobAssignedBeforeResume:true,jobEvidence:'SUPERVISOR_HANDLE_QUERY',authority:'PARENT_REPORTED_FIXED_TEST_ROLE'};
 await writeFile(path.join(root,'fixture-owner-proof.json'),JSON.stringify(proof),{flag:'wx'});
 const result=await readTestOwnedNativeSnapshot(root);
 assert.equal(result.status,'UNKNOWN');assert.deepEqual(result.ownerChecks.proof,{status:'MISMATCH',expected:'True',actual:'False'});
 assert.equal(result.ownerChecks.ancestor.status,'UNKNOWN');assert.equal(result.ownerChecks.nodePin.actual,'UNAVAILABLE');
});

function processProof(pid,parentPid,runId){
 const script=`$a=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';$b=Get-CimInstance Win32_Process -Filter 'ProcessId=${parentPid}';[pscustomobject]@{a=[string]$a.CreationDate.ToUniversalTime().ToFileTimeUtc();b=[string]$b.CreationDate.ToUniversalTime().ToFileTimeUtc()}|ConvertTo-Json -Compress`;
 const values=JSON.parse(execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8'}));
 return {format:'phase1-fixture-owner-proof/v1',fixtureOnly:true,runId,launcherPid:pid,parentPid,launcherBirth100ns:values.a,parentBirth100ns:values.b,
  jobAssignedBeforeResume:true,jobEvidence:'SUPERVISOR_HANDLE_QUERY',jobMembers:[pid],authority:'PARENT_REPORTED_FIXED_TEST_ROLE',nodeSha256:'0'.repeat(64),launcherSha256:'0'.repeat(64)};
}

test('wrong node source pin is an explicit mismatch',async()=>{
 const root=await makeRoot();const runId=path.basename(root).slice('sabalan-phase1-fixture-'.length);
 await writeFile(path.join(root,'fixture-owner-proof.json'),JSON.stringify(processProof(process.pid,process.ppid,runId)),{flag:'wx'});
 const result=await readTestOwnedNativeSnapshot(root);
 assert.equal(result.status,'UNKNOWN');assert.equal(result.ownerChecks.ancestor.status,'MATCH');
 assert.equal(result.ownerChecks.nodePin.status,'MISMATCH');assert.equal(result.ownerChecks.launcherPin.status,'UNKNOWN');
});

test('a nonancestor fixture process is not excluded',async()=>{
 const root=await makeRoot();const runId=path.basename(root).slice('sabalan-phase1-fixture-'.length);
 const child=spawn(process.execPath,['-e','setTimeout(()=>{},4000)'],{stdio:'ignore'});
 try{
  await writeFile(path.join(root,'fixture-owner-proof.json'),JSON.stringify(processProof(child.pid,process.pid,runId)),{flag:'wx'});
  const result=await readTestOwnedNativeSnapshot(root);
  assert.equal(result.status,'UNKNOWN');assert.equal(result.ownerChecks.ancestor.status,'MISMATCH');
 }finally{await new Promise(resolve=>child.once('close',resolve));}
});
