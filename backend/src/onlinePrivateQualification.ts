/** Private qualification entry; never a production admission or public issuer. */
import type {RuntimeWorkBoundary} from './services/runtimeWorkBoundary';
import {openOriginalOnlinePrivateQualificationAuthority,admitOnlinePrivateQualification,assertOriginalOnlinePrivateQualification} from './services/onlinePrivateQualificationAuthority';
import {assertOnlineHttpIngressAssigned} from './services/onlinePrivateIngress';

export async function mainPrivateQualificationRuntime(){
 const originalAuthority=openOriginalOnlinePrivateQualificationAuthority();
 const pool=await import('./lib/prisma');
 let boundary:RuntimeWorkBoundary|undefined;
 let app:ReturnType<typeof import('./application').createPrivateQualificationApplication>|undefined;
 let producer:Awaited<ReturnType<typeof import('./services/onlineRealtimeBridge').createOnlineQualificationRealtimeProducer>>|undefined;
 let workers:Awaited<ReturnType<typeof import('./services/applicationWorkers').startPrivateQualificationApplicationWorkers>>|undefined;
 let consumer:Awaited<ReturnType<typeof import('./services/onlineRealtimeScheduling').startPrivateQualificationRealtimeConsumer>>|undefined;
 let finalStopping=false,stopRequested=false,startupComplete=false,shutdownPromise:Promise<void>|undefined,preparePromise:Promise<void>|undefined;
 let qualification:Awaited<ReturnType<typeof admitOnlinePrivateQualification>>|undefined;
 let state:ReturnType<typeof assertOriginalOnlinePrivateQualification>|undefined;
 const prepareDrain=()=>preparePromise??=(async()=>{
  if(!state)return;
  if(state.decision.runtimePurpose==='jobs'){workers?.stopNewTicks();return;}
  app?.closeExternalAdmission();if(boundary)await boundary.requests.waitForDrain(240_000);
  const {assertOnlineHrInvalidationClosed}=await import('./services/onlineHrInvalidation');assertOnlineHrInvalidationClosed();
 })();
 const shutdown=()=>shutdownPromise??=(async()=>{
  await prepareDrain();if(workers)await workers.stopAndDrain(240_000);else if(producer)await producer.stopAndDrain();
  // Requires original host's exact private QA target row DRAINING fence.
  if(consumer)await consumer.drainAndStop(240_000);
  if(app)await app.realtimeDelivery.stop(240_000);finalStopping=true;
  if(boundary)await boundary.stopAndDrain(240_000);
  if(app?.server.listening)await new Promise<void>((resolve,reject)=>app!.io.close(error=>error?reject(error):resolve()));
  await pool.disconnectDatabase();
 })();
 const signal=()=>{stopRequested=true;if(startupComplete)void shutdown().catch(()=>{process.exitCode=1;console.error('PRIVATE_QUALIFICATION_DRAIN_UNPROVEN');});};
 process.once('SIGTERM',signal);process.once('SIGINT',signal);
 try{
  qualification=await admitOnlinePrivateQualification(originalAuthority,pool.prisma);
  state=assertOriginalOnlinePrivateQualification(qualification);
  const {decision,artifacts}=state;
  if(stopRequested)throw Error('PRIVATE_QUALIFICATION_STOPPING');
  const {createScopedRuntimeWork}=await import('./services/onlineRuntimeWork');
  boundary=await createScopedRuntimeWork({registrySha256:artifacts.runtimeBundleSha256,generation:artifacts.generation,canJoin:()=>{
   if(finalStopping)return false;assertOriginalOnlinePrivateQualification(qualification!,decision.runtimePurpose);return true;
  }});
  const {openOnlineQualificationComposition}=await import('./services/onlineRuntimeComposition');
  const runtime=await openOnlineQualificationComposition({qualification,boundary});
  if(stopRequested)throw Error('PRIVATE_QUALIFICATION_STOPPING');
  // Same provider/key and cutover validation as actual production paths.
  const {validateProductionEnvironment}=await import('./services/productionEnvironment');validateProductionEnvironment();
  const {resolveHrRedesignCutoverStartup}=await import('./services/hrRedesignCutoverStartup');
  const cutover=process.env.NODE_ENV==='production'?resolveHrRedesignCutoverStartup(process.env):undefined;
  if(cutover?.enabled){const {readFile}=await import('node:fs/promises');const {verifyHrRedesignCutover}=await import('./services/hrRedesignCutover');
   await verifyHrRedesignCutover(pool.prisma,{acceptanceAttestation:JSON.parse(await readFile(cutover.acceptancePath!,'utf8')),sourceRevision:cutover.sourceRevision!});}
  if(decision.runtimePurpose==='jobs'){
   const {createOnlineQualificationRealtimeProducer}=await import('./services/onlineRealtimeBridge');
   producer=await createOnlineQualificationRealtimeProducer(runtime,pool.prisma);
   const {startPrivateQualificationApplicationWorkers}=await import('./services/applicationWorkers');
   workers=await startPrivateQualificationApplicationWorkers(runtime,pool.prisma,producer);
  }else{
   const {createPrivateQualificationApplication}=await import('./application');app=createPrivateQualificationApplication({runtime,isShuttingDown:()=>finalStopping});
   const {startPrivateQualificationRealtimeConsumer}=await import('./services/onlineRealtimeScheduling');consumer=await startPrivateQualificationRealtimeConsumer(runtime,app);
   const ingress=decision.httpIngress;if(!ingress)throw Error('PRIVATE_QUALIFICATION_INGRESS_REQUIRED');
   assertOriginalOnlinePrivateQualification(qualification,'http');assertOnlineHttpIngressAssigned(ingress);
   await new Promise<void>((resolve,reject)=>{app!.server.once('error',reject);app!.server.listen(ingress.port,ingress.bindHost,()=>{app!.server.off('error',reject);resolve();});});
   assertOnlineHttpIngressAssigned(ingress);
  }
  if(stopRequested)throw Error('PRIVATE_QUALIFICATION_STOPPING');startupComplete=true;
  // Observation only. This data cannot mint admission or replace the
  // original host's native/process/SQL custody checks.
  const identity=Object.freeze({qualificationId:decision.qualificationId,scopeSha256:decision.scopeSha256,
   runtimeId:decision.runtimeId,nonceSha256:decision.nonceSha256,purpose:decision.runtimePurpose,
   releaseId:decision.releaseId,image:decision.image,sourceCommit:decision.sourceCommit,
   runtimeBundleSha256:decision.runtimeBundleSha256,artifactsSha256:decision.artifactsSha256,
   restoreManifestSha256:decision.restoreManifestSha256,database:decision.database,httpIngress:decision.httpIngress});
  return Object.freeze({prepareDrain,shutdown,identity});
 }catch(error){
  try{await shutdown();}catch{process.exitCode=1;throw Error('PRIVATE_QUALIFICATION_CLOSURE_UNPROVEN');}
  process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);throw error;
 }
}
if(require.main===module)void mainPrivateQualificationRuntime().catch(()=>{process.exitCode=1;console.error('PRIVATE_QUALIFICATION_STARTUP_REFUSED');});
