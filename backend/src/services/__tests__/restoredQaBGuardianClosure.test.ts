import assert from'node:assert/strict';import test from'node:test';import{createHash}from'node:crypto';
import{parseRestoredQaBGuardianClosure}from'../restoredQaHttpObservation';
function fixture(){const database={name:'restored_b',oid:'123',systemIdentifier:'987'},expected={pid:100,startTicks:'456',commandSha256:'a'.repeat(64),database};
 const active={format:'sabalan-runtime-native/v1',phase:'ACTIVE',role:'standalone',guardian:{pid:100,startTicks:'456',bootId:'actual-boot',pidNamespace:'pid:[1]'},initialDatabase:{name:database.name,oid:database.oid},clusterIdentifier:database.systemIdentifier,commandSha256:expected.commandSha256,instanceId:'b'.repeat(48),namespace:'sabalan-rt-'+'b'.repeat(48),previousSha256:null};
 const raw=Buffer.from(JSON.stringify(active)+'\n'),final={...active,phase:'QUIESCENT',nativeReaped:true,databaseQuiet:true,nativeStatus:0,stoppedBySignal:false,activeClaimSha256:createHash('sha256').update(raw).digest('hex')};return{expected,active,raw,final};}
test('ordinary B closure parser preserves exact active record and truthful B database identity',()=>{const a=fixture();const result=parseRestoredQaBGuardianClosure(a.raw,Buffer.from(JSON.stringify(a.final)),a.expected);assert.deepEqual(result.database,a.expected.database);assert.equal(result.namespace,a.active.namespace);assert.ok(!('financialSchemaQualified'in result));});
test('PID/initialA substitution, changed command, signal closure and rewritten active fields all refuse',()=>{
 const mutants=[(a:ReturnType<typeof fixture>)=>a.final.nativeReaped=false,(a:ReturnType<typeof fixture>)=>a.final.nativeStatus=1,(a:ReturnType<typeof fixture>)=>a.final.stoppedBySignal=true,(a:ReturnType<typeof fixture>)=>a.final.activeClaimSha256='c'.repeat(64),
  (a:ReturnType<typeof fixture>)=>a.final.guardian.pid=101,(a:ReturnType<typeof fixture>)=>a.final.initialDatabase.name='source_a',(a:ReturnType<typeof fixture>)=>a.expected.commandSha256='d'.repeat(64),(a:ReturnType<typeof fixture>)=>a.expected.database.oid='999'];
 for(const change of mutants){const a=fixture();change(a);assert.throws(()=>parseRestoredQaBGuardianClosure(a.raw,Buffer.from(JSON.stringify(a.final)),a.expected));}
 for(const field of['onlineScope','onlineLocks','captureGate','extra']){const a=fixture();assert.throws(()=>parseRestoredQaBGuardianClosure(a.raw,Buffer.from(JSON.stringify({...a.final,[field]:{}})),a.expected));}
});

test('outer control is accepted ONLY when explicitly expected; HTTP default remains standalone',()=>{
 const a=fixture();a.active.role='control';const raw=Buffer.from(JSON.stringify(a.active)+'\n'),final={...a.final,role:'control',activeClaimSha256:createHash('sha256').update(raw).digest('hex')};
 assert.throws(()=>parseRestoredQaBGuardianClosure(raw,Buffer.from(JSON.stringify(final)),a.expected));
 assert.doesNotThrow(()=>parseRestoredQaBGuardianClosure(raw,Buffer.from(JSON.stringify(final)),{...a.expected,role:'control'}));
 const ordinary=fixture();assert.throws(()=>parseRestoredQaBGuardianClosure(ordinary.raw,Buffer.from(JSON.stringify(ordinary.final)),{...ordinary.expected,role:'control'}));
 assert.throws(()=>parseRestoredQaBGuardianClosure(raw,Buffer.from(JSON.stringify(final)),{...a.expected,role:'serving'}as any));
});
