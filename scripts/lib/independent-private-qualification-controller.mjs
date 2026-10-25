import assert from 'node:assert/strict';
import {spawn,ChildProcess} from 'node:child_process';
import {generateKeyPairSync,randomBytes,createHash,sign} from 'node:crypto';
import {compileIndependentPrivateQualificationMaterial,qualificationBytes} from './independent-private-qualification-material.mjs';

const hash=raw=>createHash('sha256').update(raw).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>assert.deepEqual(a,b);
const LIMIT=12*1024**2;
const liveHttpEndpoints=new WeakMap();
/** Same-process observation of this original owner's still-live HTTP child.
 * It grants no FD9, database lease, checkpoint or qualification acceptance.
 * Copies, PIDs, READY receipts and serialized paths have no authority here. */
export function assertOriginalIndependentQualificationEndpoint(witness){
  const revalidate=witness&&typeof witness==='object'?liveHttpEndpoints.get(witness):undefined;
  assert.ok(revalidate,'ORIGINAL_INDEPENDENT_HTTP_ENDPOINT_REQUIRED');
  return revalidate();
}


/** Fixed-domain private QA issuer. The enclosing original backup controller owns
 * the container CREATE/START handles and both host locks; this closure owns every
 * exec and the QA-only signing key. It has no public arbitrary signing method,
 * production release capability, accepted-row constructor or file adoption API.
 */
export function createOriginalIndependentQualificationController({root,index,config,sourcePins,beforeDocker,onHeld=()=>{}}){
  index=structuredClone(index);config=structuredClone(config);sourcePins=structuredClone(sourcePins);
  assert.match(root,/^\/app\/online-runtime-acceptance\/application-native-[a-f0-9]{32}$/);
  assert.equal(typeof beforeDocker,'function');assert.equal(typeof onHeld,'function');
  for(const name of ['independent-private-runtime.py','private-qualification-observer.py','private-qualification-materialize.py','private-qualification-bootstrap.sql'])assert.ok(hex(sourcePins[name]));
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const session=randomBytes(32).toString('hex'),actorId=randomBytes(32).toString('hex');
  const publicKeyBase64=publicKey.export({type:'spki',format:'der'}).toString('base64');
  const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
  let phase='NEW',held=null,container=null,baseline=null,material=null,materials=null,http=null,sequence=0,keeper;
  const children=[];
  function hold(error){if(!held){held=error;phase='HELD';keeper=setInterval(()=>{void privateKey;void children;},30000);
    onHeld({format:'sabalan-original-independent-qualification/v1',phase,productionAdmission:false,code:error.message,
      children:children.map(v=>({pid:v.child.pid,closed:v.closed,code:v.code,signal:v.signal}))});}return error;}
  const check=()=>assert.equal(held,null);
  const ensure=condition=>{check();assert.ok(condition);};
  async function launch(name,args=[],input){
    check();assert.ok(container);assert.ok(hex(sourcePins[name]));await beforeDocker(container);
    const bootstrap="import hashlib,runpy,sys; p=sys.argv[1]; expected=sys.argv[2]; assert hashlib.sha256(open(p,'rb').read()).hexdigest()==expected; sys.argv=[p]+sys.argv[3:]; runpy.run_path(p,run_name='__main__')";
    const child=spawn('docker',['exec','-i',container.id,'/usr/bin/python3','-I','-B','-c',bootstrap,
      root+'/'+name,sourcePins[name],...args],{stdio:['pipe','pipe','pipe']});
    const owner={child,closed:false,code:null,signal:null,stdout:[],stderr:[],outBytes:0,errBytes:0,lines:[],buffer:'',waiters:[]};children.push(owner);
    owner.done=new Promise(resolve=>child.once('close',(code,signal)=>{owner.closed=true;owner.code=code;owner.signal=signal;resolve();for(const wake of owner.waiters.splice(0))wake();}));
    child.on('error',error=>hold(error));child.stdin.on('error',error=>hold(error));
    child.stdout.on('data',raw=>{owner.outBytes+=raw.length;if(owner.outBytes>LIMIT){hold(Error('INDEPENDENT_ORIGINAL_OUTPUT_BOUND'));return;}
      owner.stdout.push(raw);owner.buffer+=raw.toString('utf8');for(;;){const newline=owner.buffer.indexOf('\n');if(newline<0)break;
        owner.lines.push(owner.buffer.slice(0,newline));owner.buffer=owner.buffer.slice(newline+1);}
      for(const wake of owner.waiters.splice(0))wake();});
    child.stderr.on('data',raw=>{owner.errBytes+=raw.length;if(owner.errBytes>65536){hold(Error('INDEPENDENT_ORIGINAL_STDERR_BOUND'));return;}owner.stderr.push(raw);});
    if(input!==undefined)child.stdin.end(JSON.stringify(input));
    return owner;
  }
  async function event(owner,name){
    for(;;){check();while(owner.lines.length){const raw=owner.lines.shift();let value;try{value=JSON.parse(raw);}catch{throw hold(Error('INDEPENDENT_ORIGINAL_EVENT_INVALID'));}
      same(value.format,'sabalan-original-independent-private-runtime/v1');same(value.productionAdmission,false);
      if(value.event==='HELD')throw hold(Error('INDEPENDENT_ORIGINAL_NATIVE_HELD'));
      same(value.event,name);return value;}
      if(owner.closed)throw hold(Error('INDEPENDENT_ORIGINAL_EXIT_BEFORE_EVENT'));
      await new Promise(resolve=>owner.waiters.push(resolve));}
  }
  async function ended(owner){await owner.done;check();same(owner.code,0);same(owner.signal,null);same(owner.buffer,'');same(owner.lines,[]);}
  async function helper(name,input){const owner=await launch(name,[],{root,...input});await owner.done;check();same(owner.code,0);same(owner.signal,null);
    return JSON.parse(Buffer.concat(owner.stdout));}
  function closure(value,started,grant){
    same(value.event,'CLOSED');same(value.originalReturncode,0);same(value.originalPopenPid,started.originalPopenPid);same(value.scopeSha256,grant.sha256);
    const native=JSON.parse(Buffer.from(value.nativeRawBase64,'base64')),work=JSON.parse(Buffer.from(value.workRawBase64,'base64'));
    same(native.phase,'QUIESCENT');same(work.phase,'QUIESCENT');same(native.guardian,started.birth);
    same(native.activeClaimSha256,hash(Buffer.from(started.activeNativeRawBase64,'base64')));
    same(native.onlineScope.scope,grant.scope);same(native.onlineScope.sha256,grant.sha256);
    same(native.nativeReaped,true);same(native.databaseQuiet,true);same(native.nativeStatus,0);same(native.stoppedBySignal,false);
  }
  function initialized(result,mode){
    same(result.format,'sabalan-original-private-qualification-initializer/v1');same(result.mode,mode);
    same(result.qualificationId,index.privateQualification.qualificationId);same(result.targetsSha256,material.targetsSha256);
    same(result.databaseName,index.restoredDatabase);same(result.databaseOid,String(index.restoredOid));
    same(result.systemIdentifier,index.privateQualification.httpGrant.scope.database.systemIdentifier);
    same(result.targetCount,1);same(result.productionAdmission,false);
    same(result.phase,{initialize:'ACTIVE',fence:'DRAINING',close:'CLOSED'}[mode]);
    assert.ok(result.originalSqlChildren.length&&result.originalSqlChildren.every(v=>v.returncode===0&&v.reaped===true));
  }
  function start(value,grant){
    same(value.event,'STARTED');same(value.scopeSha256,grant.sha256);assert.ok(Number.isSafeInteger(value.originalPopenPid)&&value.originalPopenPid>1);
    same(value.birth.pid,value.originalPopenPid);const native=JSON.parse(Buffer.from(value.activeNativeRawBase64,'base64'));
    same(native.phase,'ACTIVE');same(native.guardian,value.birth);same(native.onlineScope.scope,grant.scope);same(native.onlineScope.sha256,grant.sha256);
  }
  function control(command){
    check();assert.ok(http&&!http.owner.closed);const grant=index.privateQualification.httpGrant;
    const value={format:'sabalan-private-qualification-control/v1',session,actorId,scopeSha256:grant.sha256,sequence:++sequence,command};
    const preimage=Buffer.from([value.format,session,actorId,grant.sha256,String(sequence),command].join('\0'),'utf8');
    http.owner.child.stdin.write(JSON.stringify({...value,signature:sign(null,preimage,privateKey).toString('base64')})+'\n');
  }
  function assertLiveHttpEndpoint(){
    check();same(phase,'HTTP_READY');assert.ok(http&&container&&materials);
    const child=http.owner.child;
    assert.ok(child instanceof ChildProcess&&!http.owner.closed&&child.exitCode===null&&child.signalCode===null
      &&!child.killed&&child.stdin&&!child.stdin.destroyed&&!child.stdin.writableEnded
      &&child.stdout&&!child.stdout.destroyed&&!child.stdout.readableEnded
      &&child.stderr&&!child.stderr.destroyed&&!child.stderr.readableEnded,'ORIGINAL_HTTP_CHILD_NOT_LIVE');
    same(child.spawnfile,'docker');same(child.spawnargs.slice(1,4),['exec','-i',container.id]);
    const grant=index.privateQualification.httpGrant,decision=materials[grant.scope.runtimeId].decision.decision;
    const identity=http.ready.result.identity;
    same(identity.runtimeId,decision.runtimeId);same(identity.image,decision.image);same(identity.sourceCommit,decision.sourceCommit);
    same(identity.database,decision.database);same(identity.httpIngress,decision.httpIngress);
    same(identity.scopeSha256,grant.sha256);same(identity.runtimeBundleSha256,decision.runtimeBundleSha256);
    same(identity.restoreManifestSha256,decision.restoreManifestSha256);same(identity.artifactsSha256,decision.artifactsSha256);
    same(decision.database.name,index.restoredDatabase);same(decision.database.oid,String(index.restoredOid));
    same(decision.httpIngress.bindHost,config.roleTopology.main.host);
    assert.ok(Number.isInteger(decision.httpIngress.port)&&decision.httpIngress.port>=1024&&decision.httpIngress.port<=65535);
    return Object.freeze({format:'sabalan-original-live-private-http-endpoint/v1',purpose:'RESTORED_QA_HTTP_OBSERVATION',
      containerId:container.id,image:container.image,sourceCommit:decision.sourceCommit,runtimeId:decision.runtimeId,
      scopeSha256:grant.sha256,database:Object.freeze({...decision.database}),
      url:'http://'+decision.httpIngress.bindHost+':'+decision.httpIngress.port,
      nativeOriginalPid:http.started.originalPopenPid,outerOriginalExecPid:child.pid,
      independentPointHealthy:false,cleanupPending:true,productionAdmission:false});
  }
  return Object.freeze({
    httpEndpointWitness(){
      assertLiveHttpEndpoint();const witness=Object.freeze({});liveHttpEndpoints.set(witness,assertLiveHttpEndpoint);return witness;
    },
    enrollment:Object.freeze({publicKey:publicKeyBase64,publicKeyPem,session,actorId}),
    enrollOriginalContainer(value){check();same(phase,'NEW');assert.ok(hex(value.id));assert.match(value.image,/^sha256:[a-f0-9]{64}$/);
      same(value.image,config.image);same(value.originalCreateClosed,true);same(value.originalCreateExitCode,0);
      // The caller must retain its same create/start handles; this is not a receipt adopter.
      assert.ok(value.originalCreateChild instanceof ChildProcess&&value.originalStartChild instanceof ChildProcess);
      same(value.originalCreateChild.exitCode,0);same(value.originalCreateChild.signalCode,null);
      assert.equal(value.originalCreateChild.spawnfile,'docker');assert.equal(value.originalCreateChild.spawnargs[1],'create');
      assert.equal(value.originalStartChild.spawnfile,'docker');same(value.originalStartChild.spawnargs.slice(1),['start','--attach',value.id]);
      assert.equal(value.originalStartChild.exitCode,null);container=value;phase='ENROLLED';},
    async runBaseline(controllerSha256){try{check();same(phase,'ENROLLED');assert.ok(hex(controllerSha256));phase='BASELINE_RUNNING';
      const owner=await launch('independent-private-runtime.py',[root,'baseline',controllerSha256]);
      const started=await event(owner,'STARTED');start(started,index.restoredBaselineGrant);
      const closed=await event(owner,'CLOSED');closure(closed,started,index.restoredBaselineGrant);await ended(owner);
      same(closed.result.event,'restored-file-baseline-complete');same(closed.result.runtimeId,index.restoredBaselineGrant.scope.runtimeId);
      baseline={owner,started,closed};phase='BASELINE_CLOSED';return closed;
    }catch(error){throw hold(error);}},
    async initialize(){try{check();same(phase,'BASELINE_CLOSED');assert.ok(baseline.owner.closed);phase='INITIALIZING';
      const facts=await helper('private-qualification-observer.py',{});
      same(facts.format,'sabalan-original-private-qualification-observation/v1');same(facts.originalSqlProbe.returncode,0);same(facts.originalSqlProbe.reaped,true);
      same(facts.sourceSql,{visible:true,sessions:0,prepared:0,databaseOid:String(index.oid)});
      material=compileIndependentPrivateQualificationMaterial({index,config,baselineCompletion:baseline.closed.result,facts,now:new Date()});
      materials=Object.fromEntries(Object.entries(material.decisionsByRuntime).map(([id,decision])=>[id,{artifacts:material.artifactsByRuntime[id],
        decision:{format:'sabalan-signed-online-private-qualification/v1',decision,
          signature:sign(null,Buffer.concat([Buffer.from('sabalan-online-private-qualification/v1\n'),qualificationBytes(decision)]),privateKey).toString('base64')}}]));
      const result=await helper('private-qualification-materialize.py',{mode:'initialize',materials,bootstrapSha256:sourcePins['private-qualification-bootstrap.sql']});
      initialized(result,'initialize');phase='INITIALIZED';return result;
    }catch(error){throw hold(error);}},
    async startHttp(controllerSha256){try{check();same(phase,'INITIALIZED');phase='HTTP_STARTING';
      const owner=await launch('independent-private-runtime.py',[root,'http',controllerSha256]);const started=await event(owner,'STARTED');
      start(started,index.privateQualification.httpGrant);const ready=await event(owner,'READY');same(ready.result.event,'READY');same(ready.result.actorId,actorId);
      same(ready.result.installedEntrySha256,config.privateQualificationRuntime.entrySha256);
      same(ready.result.identity.runtimeId,index.privateQualification.httpGrant.scope.runtimeId);same(ready.result.identity.image,config.image);
      http={owner,started,ready};phase='HTTP_READY';return ready;
    }catch(error){throw hold(error);}},
    async closeHttp(){try{check();same(phase,'HTTP_READY');phase='HTTP_PREPARING';control('PRIVATE_PREPARE_DRAIN');
      const prepared=await event(http.owner,'PREPARED');same(prepared.result.sequence,1);same(prepared.result.actorId,actorId);
      const fenced=await helper('private-qualification-materialize.py',{mode:'fence',materials,bootstrapSha256:sourcePins['private-qualification-bootstrap.sql']});initialized(fenced,'fence');
      control('PRIVATE_SHUTDOWN');const closed=await event(http.owner,'CLOSED');closure(closed,http.started,index.privateQualification.httpGrant);await ended(http.owner);
      const final=await helper('private-qualification-materialize.py',{mode:'close',materials,bootstrapSha256:sourcePins['private-qualification-bootstrap.sql']});initialized(final,'close');
      assert.ok(children.every(v=>v.closed&&v.code===0&&v.signal===null));phase='CLOSED';clearInterval(keeper);return {closed,fence:final,productionAdmission:false};
    }catch(error){throw hold(error);}},
    inspect(){return Object.freeze({phase,held:held?.message??null,originalExecs:children.map(v=>({pid:v.child.pid,closed:v.closed,code:v.code,signal:v.signal})),productionAdmission:false});},
  });
}
