/** Current data preservation only. Live authority remains in the original Root. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';
import{historicalCapsulePreflightSpec}from'./application-native-historical-capsules.mjs';
import{negativeCapsuleNames,negativeCapsuleSubpath}from'./application-native-negative-capsule-acceptance.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function currentCapsuleParentInvocation(root){
 const file=path.join(root,'deploy/scripts/original-current-capsule-parent.py'),source=fs.readFileSync(file),canonicalSource=fs.readFileSync(path.join(root,'tests/online-deployment/historical-capsule-preflight.fixture.py'));
 assert.equal(sha(canonicalSource),'a4f20672aec779899b037d775ade51cb84f24ade8f3cbcef5c8d3219f9513b65');
 const input=Buffer.from(JSON.stringify({source:source.toString('base64'),spec:{canonicalSource:canonicalSource.toString('base64'),canonicalSpec:historicalCapsulePreflightSpec(root)}}));assert.ok(input.length<=2*1024**2);
 return{source:{file,sha256:sha(source)},input,bootstrap:"import base64,hashlib,io,json,sys;p=json.load(sys.stdin);s=base64.b64decode(p['source'],validate=True);assert hashlib.sha256(s).hexdigest()=="+JSON.stringify(sha(source))+";sys.stdin=io.StringIO(json.dumps(p['spec']));exec(compile(s,'source-owned-current-capsule-parent','exec'),{'__name__':'__main__'})"};
}
export function normalizedCurrentCapsuleParent(value){
 assert.equal(value.format,'sabalan-current-mixed-capsule-parent/v1');for(const k of ['heldScopesStableDuringObservation','readOnly'])assert.equal(value[k],true);for(const k of ['parentGloballyEmpty','unusedNamespaceClaimed','historicalClosureClaimed','qualificationAccepted','productionAdmission'])assert.equal(value[k],false);
 assert.deepEqual(value.entries,[...value.entries].sort());assert.equal(new Set(value.entries).size,value.entries.length);assert.ok(negativeCapsuleNames.every(n=>value.entries.includes(n)));
 assert.deepEqual(value.protectedEntries.map(v=>v.name),value.entries.filter(n=>!negativeCapsuleNames.includes(n)));for(const row of value.protectedEntries){assert.match(row.treeSha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(row.entries)&&row.entries>0);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>=0);}
 assert.equal(value.parentIdentity.st_uid,'0');assert.equal(value.parentIdentity.st_mode,'16832');assert.equal(value.mounts.subpath,negativeCapsuleSubpath);assert.equal(value.mounts.namedVolume,'sabalanerp-local_online_runtime_acceptance');assert.equal(value.mounts.target,'/app/online-runtime-acceptance');assert.equal(value.mounts.readOnly,false);assert.equal(value.mounts.capsules.length,2);assert.ok(value.mounts.capsules.every(v=>v.readOnly===true));
 for(const [i,name]of negativeCapsuleNames.entries()){assert.equal(value.mounts.capsules[i].target,'/app/online-runtime-acceptance/'+name);assert.ok(value.mounts.capsules[i].root.endsWith('/sabalanerp-local_online_runtime_acceptance/_data/'+name));}
 const c=value.canonicalCapsules;assert.equal(c.readOnly,true);assert.equal(c.capsulesVerified,2);for(const k of ['databaseExecuted','nativeActorStarted','productionAdmission'])assert.equal(c[k],false);assert.ok(Number.isSafeInteger(c.inventoryChild.originalPid)&&c.inventoryChild.originalPid>0);assert.equal(c.inventoryChild.code,0);assert.equal(c.inventoryChild.stdoutEof,true);assert.equal(c.inventoryChild.stderrEof,true);
 const result=structuredClone(value);result.canonicalCapsules.inventoryChild.originalPid=0;return result;
}
export function assertCurrentCapsuleParentPreserved(before,after,allowedNewNames=[]){
 assert.equal(new Set(allowedNewNames).size,allowedNewNames.length);for(const name of allowedNewNames)assert.match(name,/^application-native-[a-f0-9]{32}$/);
 const a=normalizedCurrentCapsuleParent(before),b=normalizedCurrentCapsuleParent(after);
 assert.deepEqual(b.mounts,a.mounts);assert.deepEqual(b.canonicalCapsules,a.canonicalCapsules);
 assert.deepEqual(b.entries.filter(n=>!a.entries.includes(n)).sort(),allowedNewNames.filter(n=>b.entries.includes(n)).sort());assert.ok(a.entries.every(n=>b.entries.includes(n)));
 for(const row of a.protectedEntries)assert.deepEqual(b.protectedEntries.find(v=>v.name===row.name),row,'HELD_SCOPE_BYTES_OR_METADATA_CHANGED');
 if(!allowedNewNames.length)assert.deepEqual(b.parentIdentity,a.parentIdentity);else for(const key of ['st_dev','st_ino','st_mode','st_uid','st_gid'])assert.equal(b.parentIdentity[key],a.parentIdentity[key]);
 return after;
}
/** Data preservation only. Callers must separately prove custody of the actual
 * closed retained producer. This never grants runtime or qualification authority. */
export function assertCurrentCapsuleParentPreservedWithRetainedHold(before,after,operation){
 assert.match(operation,/^[a-f0-9]{32}$/);const name='retained-browser-'+operation,a=normalizedCurrentCapsuleParent(before),b=normalizedCurrentCapsuleParent(after);
 assert.equal(a.entries.includes(name),false);assert.deepEqual(b.mounts,a.mounts);assert.deepEqual(b.canonicalCapsules,a.canonicalCapsules);
 assert.deepEqual(b.entries.filter(n=>!a.entries.includes(n)),[name]);assert.ok(a.entries.every(n=>b.entries.includes(n)));
 for(const row of a.protectedEntries)assert.deepEqual(b.protectedEntries.find(v=>v.name===row.name),row,'HELD_SCOPE_BYTES_OR_METADATA_CHANGED');
 for(const key of ['st_dev','st_ino','st_mode','st_uid','st_gid'])assert.equal(b.parentIdentity[key],a.parentIdentity[key]);
 for(const value of [a.parentIdentity.st_nlink,b.parentIdentity.st_nlink])assert.match(value,/^[0-9]+$/);assert.equal(BigInt(b.parentIdentity.st_nlink),BigInt(a.parentIdentity.st_nlink)+1n,'RETAINED_HOLD_PARENT_LINK_CHANGE');
 const added=b.protectedEntries.find(row=>row.name===name);assert.ok(added);assert.equal(added.identity.st_dev,b.parentIdentity.st_dev);assert.equal(added.identity.st_mode,'16832');assert.equal(added.identity.st_uid,'0');assert.equal(added.identity.st_gid,'0');assert.notEqual(added.identity.st_ino,b.parentIdentity.st_ino);assert.ok(a.protectedEntries.every(row=>row.identity.st_ino!==added.identity.st_ino));
 return after;
}
/** Fixed read-only proc/scope observer. Counts only; never closes a reader. */
export function retainedHoldQuietProbe(operation,closures){
 assert.match(operation,/^[a-f0-9]{32}$/);assert.deepEqual(Object.keys(closures).sort(),['current','old']);const expected={};
 for(const [role,row]of Object.entries(closures)){assert.match(row.nativeSha256,/^[a-f0-9]{64}$/);const raw=Buffer.from(row.nativeRawBase64,'base64');assert.equal(raw.toString('base64'),row.nativeRawBase64);assert.equal(sha(raw),row.nativeSha256);const value=JSON.parse(raw);assert.equal(value.format,'sabalan-inquiry-native/v2');assert.equal(value.phase,'QUIESCENT');assert.equal(value.nativeReaped,true);assert.equal(value.sqliteNativeClosed,true);assert.equal(value.stoppedBySignal,true);assert.ok([0,143,-15].includes(value.nativeStatus));expected[role]=row.nativeSha256;}
 return String.raw`const fs=require('fs'),crypto=require('crypto'),root=`+JSON.stringify('/app/online-runtime-acceptance/retained-browser-'+operation)+`,expected=`+JSON.stringify(expected)+String.raw`;const read=p=>{const f=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const a=fs.fstatSync(f,{bigint:true});if(!a.isFile()||a.nlink!==1n||a.size>1048576n)throw Error('PRIVATE_SCOPE_FILE');const raw=fs.readFileSync(f),b=fs.fstatSync(f,{bigint:true});for(const k of ['dev','ino','mode','size','mtimeNs','ctimeNs'])if(a[k]!==b[k])throw Error('PRIVATE_SCOPE_CHANGED');return raw;}finally{fs.closeSync(f);}};if(fs.realpathSync(root)!==root)throw Error('PRIVATE_ROOT_ALIAS');const pair=JSON.parse(read(root+'/pair.json'));if(pair.format!=='sabalan-retained-inquiry-pair/v1'||pair.root!==root||Object.keys(pair.scopes).sort().join(',')!=='current,old')throw Error('PRIVATE_PAIR_CHANGED');for(const role of ['old','current']){const scope=pair.scopes[role].scope,id=scope.runtimeId;if(!/^[a-f0-9]{64}$/.test(id)||scope.nativeDirectory!==root+'/coordination/online/native/'+id||scope.boundaryDirectory!==root+'/coordination/online/work/'+id)throw Error('PRIVATE_SCOPE_PATH_CHANGED');const raw=read(scope.nativeDirectory+'/deployment-runtime-native.json');if(crypto.createHash('sha256').update(raw).digest('hex')!==expected[role])throw Error('PRIVATE_NATIVE_CLOSURE_CHANGED');const state=JSON.parse(read(scope.boundaryDirectory+'/state.json'));if(state.phase!=='QUIESCENT')throw Error('PRIVATE_WORK_NOT_QUIET');}let readers=0,processes=0;for(const pid of fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n))){if(Number(pid)===process.pid)continue;let command;try{command=fs.readFileSync('/proc/'+pid+'/cmdline');}catch(e){if(['ENOENT','ESRCH'].includes(e.code))continue;throw e;}if(command.includes(Buffer.from(root)))processes++;let names;try{names=fs.readdirSync('/proc/'+pid+'/fd');}catch(e){if(['ENOENT','ESRCH'].includes(e.code))continue;throw e;}for(const name of names){try{const link=fs.readlinkSync('/proc/'+pid+'/fd/'+name);if(link===root||link.startsWith(root+'/'))readers++;}catch(e){if(['ENOENT','ESRCH'].includes(e.code))continue;throw e;}}}console.log(JSON.stringify({readers,processes,scopesQuiescent:true,readOnly:true,contentsReturned:false}));`;
}
export function validateCurrentCapsuleParentReceipt(value){
 const p=value.currentAcceptanceParent;assert.equal(p.format,'sabalan-root-current-mixed-acceptance-parent/v1');for(const key of ['parentGloballyEmpty','unusedNamespaceClaimed','historicalClosureClaimed'])assert.equal(p[key],false);
 const slots=['backend-candidate','backend-retained'];for(const stage of ['before','after'])assert.deepEqual(Object.keys(p[stage]).sort(),[...slots].sort());
 for(const service of slots){for(const stage of ['before','after']){const row=p[stage][service];assert.ok(Number.isSafeInteger(row.originalPid)&&row.originalPid>0);assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);assert.equal(row.containerId,stage==='before'?value.previous[service].id:value.actual[service].id);normalizedCurrentCapsuleParent(row.result);}assertCurrentCapsuleParentPreserved(p.before[service].result,p.after[service].result);}
 assert.deepEqual(normalizedCurrentCapsuleParent(p.before[slots[0]].result),normalizedCurrentCapsuleParent(p.before[slots[1]].result));assert.deepEqual(normalizedCurrentCapsuleParent(p.after[slots[0]].result),normalizedCurrentCapsuleParent(p.after[slots[1]].result));
 return p;
}
