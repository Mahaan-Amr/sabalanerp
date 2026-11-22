/** Pure preflight parser parity; never Docker, SSH or service mutation. */
import test from 'node:test';import assert from 'node:assert/strict';
import {validateCandidatePreflight as legacy} from '../../scripts/replace-application-native-candidate-local.mjs';
import {validateCandidatePreflight as qualified} from '../../scripts/replace-qualified-application-native-candidate-local.mjs';
const now=Date.parse('2026-10-24T10:00:00Z'),prerequisite={format:'sabalan-host-backup-retention-prerequisites/v1',inspected:true,sshStarted:false,mutation:false};
const hosts=[{project:'sabalanerp',ok:true},{project:'sabalanerp-backup',ok:true}];
function value(rows=[...hosts],age=1000){return{sshExitCode:0,observedAt:new Date(now-age).toISOString(),stdout:JSON.stringify({exitCode:0,lockHeldThroughBothHostPreflight:true,productionCommitBefore:'a'.repeat(40),productionCommitAfter:'a'.repeat(40),stdout:rows.map(row=>JSON.stringify(row)).join('\n')})};}
function mutateRemote(input,fn){const remote=JSON.parse(input.stdout);fn(remote);input.stdout=JSON.stringify(remote);return input;}
function accepts(input){for(const fn of [legacy,qualified])assert.doesNotThrow(()=>fn(input,now));}
function rejects(input){for(const fn of [legacy,qualified])assert.throws(()=>fn(input,now));}
test('legacy and qualified functions now have exact normalized parser semantics',()=>assert.equal(legacy.toString().replaceAll('\r\n','\n'),qualified.toString().replaceAll('\r\n','\n')));
test('original exact two healthy hosts remain accepted',()=>accepts(value()));
for(const index of [0,1,2])test('one exact inspected nonmutating prerequisite accepted at row '+index,()=>{const rows=[...hosts];rows.splice(index,0,prerequisite);accepts(value(rows));});
for(const [name,change]of Object.entries({notInspected:r=>r.inspected=false,startedSsh:r=>r.sshStarted=true,mutation:r=>r.mutation=true,missingField:r=>delete r.mutation,unknownField:r=>r.extra=true,truthyNotBoolean:r=>r.inspected=1}))test('refuses prerequisite '+name,()=>{const row=structuredClone(prerequisite);change(row);rejects(value([row,...hosts]));});
test('duplicate prerequisites refuse',()=>rejects(value([prerequisite,prerequisite,...hosts])));
test('unknown extra record refuses',()=>rejects(value([{format:'unrecognized-prerequisite',inspected:true},...hosts])));
test('duplicate project cannot replace other host',()=>rejects(value([hosts[0],hosts[0]])));
test('missing host refuses',()=>rejects(value([prerequisite,hosts[0]])));
test('unhealthy host refuses',()=>rejects(value([hosts[0],{...hosts[1],ok:false}])));
test('truthy host success refuses',()=>rejects(value([hosts[0],{...hosts[1],ok:1}])));
test('stale evidence refuses',()=>rejects(value([...hosts],600001)));
test('future evidence refuses',()=>rejects(value([...hosts],-1)));
test('invalid observedAt refuses',()=>rejects({...value(),observedAt:'unknown'}));
test('SSH failure refuses',()=>rejects({...value(),sshExitCode:1}));
test('remote failure refuses',()=>rejects(mutateRemote(value(),v=>v.exitCode=1)));
test('lease not held refuses',()=>rejects(mutateRemote(value(),v=>v.lockHeldThroughBothHostPreflight=false)));
test('production commit changed refuses',()=>rejects(mutateRemote(value(),v=>v.productionCommitAfter='b'.repeat(40))));
test('invalid production commit refuses',()=>rejects(mutateRemote(value(),v=>{v.productionCommitBefore='not-a-commit';v.productionCommitAfter='not-a-commit';})));
