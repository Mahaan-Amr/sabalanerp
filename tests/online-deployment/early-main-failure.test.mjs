import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {validateEarlyMainFailedClosure,validateMainAwaitingMigrationClosure} from '../../scripts/lib/application-native-role-coordinator.mjs';

const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
const raw=value=>Buffer.from(JSON.stringify(sorted(value))+'\n');
const sha=value=>createHash('sha256').update(value).digest('hex');
const b64=value=>raw(value).toString('base64');
function fixture(pid,status=1){
  const scope={purpose:'http',runtimeId:'original-http-a',database:{systemIdentifier:'123'},image:'sha256:'+'a'.repeat(64)};
  const grant={scope,sha256:sha(raw(scope))};
  const active={phase:'ACTIVE',guardian:{pid,startTicks:'123',bootId:'original'},onlineScope:{scope,sha256:grant.sha256}};
  const native={...active,phase:'QUIESCENT',nativeReaped:true,databaseQuiet:true,nativeStatus:status,stoppedBySignal:false,
    activeClaimSha256:sha(raw(active))};
  return {body:{failureKind:'EARLY_HTTP_STARTUP_CLOSED',originalPass:false,productionAdmission:false,
    edgeNeverCreated:true,originalChromeClosed:false,edgeClosure:null,owners:[{runtimeId:scope.runtimeId,
      originalPopenPid:pid,originalReturncode:status,nativeRawBase64:b64(native),workRawBase64:b64({phase:'QUIESCENT'}),
      claimNative:{scopeSha256:grant.sha256,claimSha256:native.activeClaimSha256},
      freshSql:{visible:true,systemIdentifier:'123',databaseOid:'1234',namespaceSessions:0,prepared:0}}]},
    context:{phase:'ENROLLED',pending:null,candidateActorCount:0,index:{grants:[grant],oid:'1234'}}};
}

test('genuinely closed original failing child permits only the negative early-startup transition',async()=>{
  const child=spawn(process.execPath,['-e','process.exit(1)'],{stdio:'ignore'});
  const result=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  assert.deepEqual(result,{code:1,signal:null});
  const {body,context}=fixture(child.pid);assert.doesNotThrow(()=>validateEarlyMainFailedClosure(body,context));
  assert.equal(body.originalPass,false);assert.equal(body.productionAdmission,false);
});

test('first migration empty-read negative owns only original HTTP closure and is bound to the pending request',()=>{
  const {body,context}=fixture(12345,0),request={requestId:'a'.repeat(64),kind:'migration',expected:'MIGRATION_DONE'};
  body.failureKind='HTTP_CLOSED_AWAITING_ORIGINAL_CANDIDATE';body.requestCount=1;
  body.failedReceive={requestId:request.requestId,command:'RUN_MIGRATION',expected:'MIGRATION_DONE',reason:'ORIGINAL_HOST_CHANNEL_EMPTY_READ'};
  const ctx={phase:'ENROLLED',request,index:context.index};
  for(const phase of ['ENROLLED','MIGRATION_DONE','PHASE_FAILED'])assert.doesNotThrow(()=>validateMainAwaitingMigrationClosure(body,{...ctx,phase}));
  for(const change of [b=>{b.failedReceive.reason='SIGNATURE_UNPROVEN';},b=>{b.failedReceive.requestId='b'.repeat(64);},
    b=>{b.requestCount=2;},b=>{b.owners[0].originalReturncode=1;},b=>{b.owners[0].freshSql.namespaceSessions=1;}]){
    const altered=structuredClone(body);change(altered);assert.throws(()=>validateMainAwaitingMigrationClosure(altered,ctx));
  }
  assert.throws(()=>validateMainAwaitingMigrationClosure(body,{...ctx,phase:'CHROME_READY'}));
  const afterPristine=structuredClone(body);afterPristine.requestCount=2;
  const secondRequest={...request,ordinal:2};
  assert.doesNotThrow(()=>validateMainAwaitingMigrationClosure(afterPristine,{...ctx,phase:'PRISTINE_PERFORMANCE_DONE',request:secondRequest}));
  assert.throws(()=>validateMainAwaitingMigrationClosure(body,{...ctx,phase:'PRISTINE_PERFORMANCE_DONE',request:secondRequest}));
  assert.equal(body.originalPass,false);
});

test('unknown/live work, successful status, substituted owner/claim/SQL or dispatched candidate cannot use early cleanup',()=>{
  const mutations=[
    (b,c)=>{c.pending={requestId:'sent'};},(b,c)=>{c.candidateActorCount=1;},(b,c)=>{c.phase='MIGRATION_DONE';},
    b=>{b.owners[0].originalReturncode=0;},b=>{b.edgeNeverCreated=false;},b=>{b.originalChromeClosed=true;},
    b=>{b.owners[0].freshSql.namespaceSessions=1;},b=>{b.owners[0].freshSql.prepared=1;},
    b=>{b.owners[0].freshSql.visible=false;},b=>{b.owners[0].freshSql.databaseOid='wrong';},
    b=>{b.owners[0].claimNative.claimSha256='b'.repeat(64);},b=>{b.owners[0].originalPopenPid++;},
    b=>{const n=JSON.parse(Buffer.from(b.owners[0].nativeRawBase64,'base64'));n.nativeReaped=false;b.owners[0].nativeRawBase64=b64(n);},
    b=>{const n=JSON.parse(Buffer.from(b.owners[0].nativeRawBase64,'base64'));n.guardian.startTicks='other';b.owners[0].nativeRawBase64=b64(n);},
    b=>{b.owners[0].workRawBase64=b64({phase:'ACTIVE'});},b=>{b.owners.push(structuredClone(b.owners[0]));},
  ];
  for(const change of mutations){const {body,context}=fixture(12345);change(body,context);
    assert.throws(()=>validateEarlyMainFailedClosure(body,context));}
});
