/** Retain the SAME coordinator key for one original COMPLETE operation.
 * No private-key export, key generation, caller-supplied decision/signing bytes,
 * public-write path or authority reconstructed from a report exists here. */
import assert from 'node:assert/strict';
import {bindObservedCompleteManifest} from './original-complete-manifest-binding.mjs';
import {createPublicKey,createHash,randomBytes,sign} from 'node:crypto';
import {assertOriginalCompleteReadyOwner,assertOriginalCompleteActiveOwner,assertOriginalCompleteClosedOwnerFor} from './original-existing-compose-owner.mjs';
import {compileRestoredQaPrivateQualificationMaterial,qualificationBytes} from './independent-private-qualification-material.mjs';

const originalIssuerPorts=new WeakSet();
export function assertOriginalRoleRestoredIssuer(port){assert.ok(originalIssuerPorts.has(port),'ORIGINAL_RETAINED_ISSUER_PORT_REQUIRED');}
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
/** Invoked inside createOriginalRoleCoordinator after its own local originals
 * close. The coordinator's private completion-token map owns the returned port. */
export function retainOriginalRoleRestoredIssuer({privateKey,publicKey,session,local,assertLocalOriginalsClosed}){
 assert.equal(privateKey.type,'private');assert.equal(privateKey.asymmetricKeyType,'ed25519');assert.match(session,/^[a-f0-9]{64}$/);
 const publicDer=publicKey.export({type:'spki',format:'der'});assert.ok(createPublicKey(privateKey).export({type:'spki',format:'der'}).equals(publicDer));
 local=structuredClone(local);assert.match(local.image,/^sha256:[a-f0-9]{64}$/);assert.match(local.sourceCommit,/^[a-f0-9]{40}$/);assert.match(local.databaseSystemIdentifier,/^[1-9][0-9]*$/);assert.equal(typeof assertLocalOriginalsClosed,'function');
 assertLocalOriginalsClosed();let used=false;
 function trust(reference){
  assert.deepEqual(Object.keys(reference).sort(),['bytes','identity','rawBase64','sha256']);assert.ok(reference.bytes>0&&reference.bytes<=4096);assert.match(reference.sha256,/^[a-f0-9]{64}$/);
  const raw=Buffer.from(reference.rawBase64,'base64');assert.equal(raw.length,reference.bytes);assert.equal(raw.toString('base64'),reference.rawBase64);assert.equal(sha(raw),reference.sha256);
  assert.ok(createPublicKey(raw).export({type:'spki',format:'der'}).equals(publicDer),'ORIGINAL_COORDINATOR_TRUST_KEY_CHANGED');
  assert.equal(reference.identity.uid,0);assert.equal(reference.identity.nlink,1);assert.equal(reference.identity.mode&0o777,0o444);
  for(const field of ['device','inode','mtimeNs','ctimeNs'])assert.match(reference.identity[field],/^[0-9]+$/);
  return structuredClone(reference);
 }
 return Object.freeze({
  readLocalBinding(){assertLocalOriginalsClosed();return structuredClone(local);},
  /** resources are the source-owned original Docker/read/SQL ports; stdin JSON
   * cannot select them. Requests to this operation contain no signing input. */
  async beginOriginalComplete({operation,ownerToken,expectedManifestSha256,expectedManifest,resources}){
   assert.equal(used,false,'ORIGINAL_ROLE_COMPLETE_ISSUER_ALREADY_USED');used=true;assertLocalOriginalsClosed();
   assert.equal(assertOriginalCompleteReadyOwner(ownerToken),operation);assert.match(operation,/^[a-f0-9]{32}$/);if(expectedManifest){assert.equal(expectedManifestSha256,undefined);expectedManifest=structuredClone(expectedManifest);}else assert.match(expectedManifestSha256,/^[a-f0-9]{64}$/);
   for(const name of ['assertCurrent','readFixedTrust','observePrivateMaterial','assertHttpActive','assertHttpPreparedAndFenced'])assert.equal(typeof resources[name],'function','ORIGINAL_COMPLETE_RESOURCE_PORT_REQUIRED:'+name);
   Object.freeze(resources);
   await resources.assertCurrent();const originalTrust=trust(await resources.readFixedTrust());assertOriginalCompleteReadyOwner(ownerToken);
   const enrollment=freeze({publicKey:publicDer.toString('base64'),publicKeyPem:publicKey.export({type:'spki',format:'pem'}),session,actorId:randomBytes(32).toString('hex')});
   let phase='ENROLLED',failureObserved=false,held=null,material=null,http=null,layoutPrepared=false;
   async function active(){assertLocalOriginalsClosed();assert.equal(failureObserved,false);assert.ok(phase!=='CLOSED');assert.equal(assertOriginalCompleteActiveOwner(ownerToken),operation);await resources.assertCurrent();assert.deepEqual(trust(await resources.readFixedTrust()),originalTrust,'ORIGINAL_COMPLETE_TRUST_FILE_REPLACED');assert.equal(assertOriginalCompleteActiveOwner(ownerToken),operation);}
   async function guarded(action){try{await active();const result=await action();await active();return result;}catch(error){if(!failureObserved){failureObserved=true;held=error?.code??error?.name??'THROWN_VALUE';}throw error;}}
   const port=Object.freeze({enrollment,
    async checkOriginalResources(){return guarded(async()=>{});},
    async observeMemoryAdmission(){return guarded(async()=>{assert.equal(typeof resources.observeMemoryAdmission,'function','COMPLETE_MEMORY_ADMISSION_PORT_REQUIRED');return resources.observeMemoryAdmission();});},
    assertActive(){assertLocalOriginalsClosed();assert.equal(failureObserved,false);assert.notEqual(phase,'CLOSED');assert.equal(assertOriginalCompleteActiveOwner(ownerToken),operation);},
    async prepareOriginalRestoredLayout(){return guarded(async()=>{assert.equal(phase,'ENROLLED');assert.equal(layoutPrepared,false,'ORIGINAL_COMPLETE_LAYOUT_ALREADY_PREPARED');assert.equal(typeof resources.preparePrivateLayout,'function','ORIGINAL_COMPLETE_LAYOUT_PUBLISHER_REQUIRED');const value=await resources.preparePrivateLayout();if(expectedManifest)expectedManifestSha256=bindObservedCompleteManifest(expectedManifest,value);assert.equal(value.completeManifestSha256,expectedManifestSha256);assert.equal(value.published,true);layoutPrepared=true;return freeze({prepared:true,completeManifestSha256:value.completeManifestSha256,productionAdmission:false});});},
    /** Recompute from the original reader's observations, never sign a decision
     * or byte string supplied by the worker/request. Exactly one issuance. */
    async issueOriginalRestoredMaterial(){return guarded(async()=>{
     assert.equal(phase,'ENROLLED');phase='ISSUING';const observed=await resources.observePrivateMaterial();
     assert.deepEqual(Object.keys(observed).sort(),['baselineCompletion','config','facts','index','restoredQaLineage']);
     assert.equal(observed.config.image,local.image);assert.equal(observed.config.sourceCommit,local.sourceCommit);assert.deepEqual(observed.config.privateQualificationRuntime,local.runtime);
     assert.equal(observed.config.roleTopology.main.host,local.host);assert.equal(observed.config.publicKey,enrollment.publicKey);assert.equal(observed.config.session,enrollment.session);assert.equal(observed.config.actorId,enrollment.actorId);
     assert.equal(observed.facts.database.systemIdentifier,local.databaseSystemIdentifier);assert.equal(observed.restoredQaLineage.completeManifestSha256,expectedManifestSha256);
     const root='/app/runtime-authority/application-native-'+operation+'/restored-complete-app/coherent-private/coordination/private-qualifications/';
     assert.match(observed.index.privateQualification.qualificationId,/^[a-f0-9]{64}$/);assert.equal(observed.index.privateQualification.qualificationRoot,root+observed.index.privateQualification.qualificationId+'/restored-app');
     for(const grant of [observed.index.privateQualification.httpGrant,observed.index.privateQualification.jobsGrant])assert.equal(grant.scope.releaseId,'qa-complete-'+operation);
     assert.equal(observed.facts.originalSqlProbe.returncode,0);assert.equal(observed.facts.originalSqlProbe.reaped,true);
     material=compileRestoredQaPrivateQualificationMaterial({...observed,now:new Date()});const materials={};
     for(const [id,decision]of Object.entries(material.decisionsByRuntime)){
      const artifacts=material.artifactsByRuntime[id];materials[id]={artifacts,decision:{format:'sabalan-signed-online-private-qualification/v1',decision,
       signature:sign(null,Buffer.concat([Buffer.from('sabalan-online-private-qualification/v1\n'),qualificationBytes(decision)]),privateKey).toString('base64')}};
      if(decision.runtimePurpose==='http'){assert.equal(http,null);http={runtimeId:id,scopeSha256:decision.scopeSha256};}
     }
     assert.ok(http);phase='ISSUED';return freeze({materials,enrollment,productionAdmission:false});
    });},
    async prepareOriginalPrivateDrain(){return guarded(async()=>{
     assert.equal(phase,'ISSUED');await resources.assertHttpActive(structuredClone(http));
     const control={format:'sabalan-private-qualification-control/v1',session,actorId:enrollment.actorId,scopeSha256:http.scopeSha256,sequence:1,command:'PRIVATE_PREPARE_DRAIN'};
     const preimage=Buffer.from([control.format,session,control.actorId,control.scopeSha256,'1',control.command].join('\0'));
     phase='DRAIN_SIGNED';return freeze({...control,signature:sign(null,preimage,privateKey).toString('base64')});
    });},
    async shutdownOriginalPrivateHttp(){return guarded(async()=>{
     assert.equal(phase,'DRAIN_SIGNED');await resources.assertHttpPreparedAndFenced(structuredClone(http));
     const control={format:'sabalan-private-qualification-control/v1',session,actorId:enrollment.actorId,scopeSha256:http.scopeSha256,sequence:2,command:'PRIVATE_SHUTDOWN'};
     const preimage=Buffer.from([control.format,session,control.actorId,control.scopeSha256,'2',control.command].join('\0'));
     phase='SHUTDOWN_SIGNED';return freeze({...control,signature:sign(null,preimage,privateKey).toString('base64')});
    });},
    /** Retires this operation only after its SAME outer original truly closes.
     * The coordinator/key remain retained for later authorized milestones. */
    finishOriginalOwner(completion){assert.equal(failureObserved,false);assert.equal(phase,'SHUTDOWN_SIGNED');assertOriginalCompleteClosedOwnerFor(completion,ownerToken);assertLocalOriginalsClosed();phase='CLOSED';return Object.freeze({operation,closed:true,originalCoordinatorRetained:true,privateKeyExported:false,productionAdmission:false});},
    inspect(){return Object.freeze({operation,phase,held,failureObserved,originalCoordinatorRetained:true,privateKeyExported:false,productionAdmission:false});},
   });originalIssuerPorts.add(port);return port;
  },
 });
}
