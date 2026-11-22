#!/usr/bin/env node
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import {OriginalOnlineReleaseController} from './online-release-controller.mjs';
import {BrowserRoutingPublicationLock} from './browser-routing-store.mjs';
const require=createRequire(import.meta.url);
let database,controller;
const assert=(value,code)=>{if(!value)throw Error(code);};
function publicationPlanResult(value){
 assert(value&&Object.keys(value).sort().join(',')==='expectedPublicationSha256,previousReleaseId,registry,releaseId,rollback','ONLINE_PUBLICATION_PLAN_WIRE_INVALID');
 assert(value.registry?.format==='sabalan-browser-routing/v2'&&Object.keys(value.registry).sort().join(',')==='apiBindings,builds,current,format,generation,legacy','ONLINE_PUBLICATION_REGISTRY_WIRE_INVALID');
 assert(value.expectedPublicationSha256===null||typeof value.expectedPublicationSha256==='string'&&/^[a-f0-9]{64}$/.test(value.expectedPublicationSha256),'ONLINE_PUBLICATION_PREDECESSOR_WIRE_INVALID');
 assert(typeof value.releaseId==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(value.releaseId)
  &&(value.previousReleaseId===null||typeof value.previousReleaseId==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(value.previousReleaseId))&&typeof value.rollback==='boolean','ONLINE_PUBLICATION_RELEASE_WIRE_INVALID');
 return {registry:value.registry,expectedPublicationSha256:value.expectedPublicationSha256,releaseId:value.releaseId,previousReleaseId:value.previousReleaseId,rollback:value.rollback};
}
function rollbackPlanResult(value){
 assert(value&&Object.keys(value).sort().join(',')==='jobsRuntimeIds,releaseId'&&typeof value.releaseId==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(value.releaseId)
  &&Array.isArray(value.jobsRuntimeIds)&&value.jobsRuntimeIds.length===1&&typeof value.jobsRuntimeIds[0]==='string'&&/^[a-f0-9]{64}$/.test(value.jobsRuntimeIds[0]),'ONLINE_RETAINED_ROLLBACK_PLAN_WIRE_INVALID');
 return {releaseId:value.releaseId,jobsRuntimeIds:[value.jobsRuntimeIds[0]]};
}
try{
 assert(process.platform==='linux'&&process.getuid()===0&&process.argv.length===3&&fs.fstatSync(0).isFIFO(),'ONLINE_ORIGINAL_CLI_REQUIRED');
 const file=process.argv[2];assert(fs.realpathSync(file)===file,'ONLINE_CONFIG_ALIAS');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 let config;try{const st=fs.fstatSync(fd);assert(st.isFile()&&st.nlink===1&&st.uid===0&&(st.mode&0o777)===0o600&&st.size<1048576,'ONLINE_CONFIG_UNSAFE');config=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
 const url=new URL(process.env.DATABASE_URL);assert(url.protocol==='postgresql:'&&url.searchParams.get('connection_limit')==='1'
  &&url.searchParams.get('pool_timeout')==='10','ONLINE_CONTROLLER_SQL_POOL_REQUIRED');
 const {PrismaClient}=require('./online-release-host-dependencies/node_modules/@prisma/client');
 database=new PrismaClient({datasources:{db:{url:url.href}}});
 controller=new OriginalOnlineReleaseController({database,owner:config.owner,publicationDirectory:config.publicationDirectory,
  composeFile:config.composeFile,project:config.project,runtimeDatabaseUrl:config.runtimeDatabaseUrl,prebuiltReleasePlan:config.prebuiltReleasePlan,
  publicationLock:new BrowserRoutingPublicationLock(config.publicationLock)});
 // A separate original FIFO pair lets the SAME controller answer read-only
 // continuity observations while its main command awaits a native child.
 const context=config.continuousContext;
 assert(context&&[context.requestFd,context.responseFd].every(fd=>Number.isInteger(fd)&&fd>2&&fs.fstatSync(fd).isFIFO()),'ONLINE_ORIGINAL_CONTEXT_FIFOS_REQUIRED');
 let contextClosing=false,contextClosed=false;
 const contextTask=(async()=>{
  let sequence=0;
  for await(const raw of createInterface({input:fs.createReadStream(null,{fd:context.requestFd,autoClose:false}),crlfDelay:Infinity})){
   assert(!contextClosing&&raw.length<=65536,'ONLINE_CONTEXT_FRAME_BOUND');const r=JSON.parse(raw);
   assert(r.sequence===++sequence&&['READ_CONTINUOUS_CONTEXT','PREPARE_FINISH_CONTEXT'].includes(r.command)&&Object.keys(r).sort().join(',')==='command,runtimeId,sequence','ONLINE_CONTEXT_FIXED_REQUEST_REQUIRED');
   const result=r.command==='READ_CONTINUOUS_CONTEXT'?await controller.readOriginalContinuousCheckpointContext(r.runtimeId):await controller.prepareOriginalFinishContext(r.runtimeId);
   const data=Buffer.from(JSON.stringify({sequence,event:'CONTEXT_OBSERVED',result})+'\n');let offset=0;
   while(offset<data.length)offset+=fs.writeSync(context.responseFd,data,offset,data.length-offset);
  }
  assert(contextClosing,'ONLINE_ORIGINAL_CONTEXT_EOF');
  fs.closeSync(context.requestFd);fs.closeSync(context.responseFd);contextClosed=true;
 })();
 contextTask.catch(()=>controller.retainOriginalContextFailure());
 let sequence=0,finished=false;
 for await(const raw of createInterface({input:process.stdin,crlfDelay:Infinity})){
  assert(raw.length<8388608,'ONLINE_CONTROLLER_FRAME_BOUND');const request=JSON.parse(raw);
  assert(request.sequence===++sequence&&typeof request.command==='string','ONLINE_CONTROLLER_SEQUENCE');
  assert(!contextClosing||request.command==='CLOSE','ONLINE_CONTROLLER_CLOSE_SEQUENCE_REQUIRED');
  let result;
  switch(request.command){
   case 'BOOTSTRAP_PREPARE':result=await controller.prepareProtectedBootstrap(request.input);break;
   case 'BOOTSTRAP_PUBLISH':result=await controller.publishProtectedBootstrap(request.registry);break;
   case 'BOOTSTRAP_ACTIVATE':result=await controller.activateProtectedBootstrap(request.runtimeId);break;
   case 'FOLLOWING_READY':result=await controller.followingUpdateReady();break;
   case 'ACQUIRE_NEXT':result=await controller.acquireNextCycle(request.input);break;
   case 'DRAIN_CURRENT_JOBS':result=await controller.drainOriginalCurrentJobsForCheckpoint();break;
   case 'RETIRE_EXPIRED_BUILDS':result=await controller.retireExpiredBuilds(request.input);break;
   case 'READ_CYCLE_PLAN':result=await controller.readOriginalCyclePlan();break;
   case 'READ_CONTINUOUS_CONTEXT':result=await controller.readOriginalContinuousCheckpointContext(request.runtimeId);break;
   case 'PREPARE_CHECKPOINT_PUBLICATION':result=await controller.prepareOriginalCheckpointPublication(request.input);break;
   case 'COMMIT_CHECKPOINT_PUBLICATION':result=await controller.commitOriginalCheckpointPublication(request.input);break;
   case 'PREPARE_CHECKPOINT_CAPTURE':result=await controller.prepareOriginalCheckpointCapture();break;
   case 'PREPARE_INQUIRY':result=await controller.prepareInquiryRuntime(request.input);break;
   case 'BUILD_PUBLICATION_REGISTRY':result=publicationPlanResult(await controller.readOriginalPublicationPlan(request.input));break;
   case 'PREPARE_RETAINED_ROLLBACK':result=rollbackPlanResult(await controller.prepareOriginalRetainedRollback(request.input));break;
   case 'START_INQUIRY':result=await controller.startInquiryRuntime(request.input);break;
   case 'STOP_INQUIRY':result=await controller.stopInquiryRuntime(request.runtimeId);break;
   case 'OBSERVE_BOOTSTRAP_REQUEST':result=await controller.observeProtectedBootstrapQualificationRequest();break;
   case 'OBSERVE_ONLINE_REQUEST':result=await controller.observeOriginalOnlineQualificationRequest(request.input);break;
   case 'BUILD_BOOTSTRAP_MATERIAL':result=await controller.prepareOriginalBootstrapMaterial(request.input);break;
   case 'BUILD_ONLINE_MATERIAL':result=await controller.prepareOriginalOnlineMaterial(request.input);break;
   case 'PREPARE_FINISH_CONTEXT':result=await controller.prepareOriginalFinishContext(request.runtimeId);break;
   case 'FINISH_CYCLE':result=await controller.finishCycle(request.input);break;
   case 'READ_CLIENT_DETACH_BARRIER':result={clientDetachBarrier:await controller.readClientDetachBarrier(request.input)};break;
   case 'PREPARE_EXPANSION':result=await controller.prepareExpansion(request.input);break;
   case 'RUN_EXPANSION':result=await controller.runExpansion(request.input);break;
   case 'REGISTER':result=await controller.register(request.input);break;
   case 'RUN_PRODUCTION_GATES':result=await controller.runOriginalProductionGates(request.input);break;
   case 'REGISTER_RETAINED':result=await controller.registerRetainedIncarnations(request.input);break;
   case 'PROVISION_CARRIERS':result=await controller.provisionCarriers(request.input);break;
   case 'START_EDGE':result=await controller.startCommonEdge(request.input);break;
   case 'APPEND_EDGE_ENDPOINTS':result=await controller.appendOriginalCarrierEndpoints();break;
   case 'STOP_EDGE':result=await controller.stopCommonEdge();break;
   case 'START_RUNTIME':result=await controller.startRuntime(request.input);break;
   case 'WAIT_READY':result=await controller.awaitRuntimeReady(request.runtimeId);break;
   case 'PREPARE_DRAIN':result=await controller.prepareRuntime(request.runtimeId);break;
   case 'WAIT_PREPARED':result=await controller.awaitRuntimePrepared(request.runtimeId);break;
   case 'SHUTDOWN':result=await controller.shutdownRuntime(request.runtimeId);break;
   case 'WAIT_CLOSED':result=await controller.awaitRuntimeClosed(request.runtimeId);break;
   case 'TRANSITION':result=await controller.transition(request.nextPhase);break;
   case 'PUBLISH':result=await controller.publish(request.input);break;
   case 'PREPARE_CONTROLLER_CLOSE':result=await controller.prepareOriginalControllerClose();contextClosing=true;break;
   case 'CLOSE':assert(contextClosing,'ONLINE_CONTROLLER_CLOSE_NOT_PREPARED');await contextTask;assert(contextClosed,'ONLINE_CONTROLLER_CONTEXT_NOT_CLOSED');result=await controller.closeOriginalController();finished=true;break;
   default:throw Error('ONLINE_CONTROLLER_FIXED_COMMAND_REQUIRED');
  }
  // No lease token, scope nonce, database credentials or signing material is logged.
  process.stdout.write(JSON.stringify({sequence,event:request.command==='CLOSE'?'CLOSED':'COMMAND_COMPLETED',
   runtimeId:result?.runtimeId??null,qualificationSucceeded:false,
   ...(request.command==='PREPARE_CHECKPOINT_PUBLICATION'?{checkpointPublication:result}:{}),
   ...(request.command==='READ_CONTINUOUS_CONTEXT'?{continuousContext:result}:{}),
   ...(request.command==='PREPARE_CHECKPOINT_CAPTURE'?{checkpointCapture:result}:{}),
   ...(request.command==='OBSERVE_BOOTSTRAP_REQUEST'?{qualificationRequest:result}:{}),
   ...(request.command==='OBSERVE_ONLINE_REQUEST'?{qualificationRequest:result}:{}),
   ...(request.command==='BUILD_BOOTSTRAP_MATERIAL'?{bootstrapMaterial:result}:{}),
   ...(request.command==='BUILD_ONLINE_MATERIAL'?{onlineMaterial:result}:{}),
   ...(request.command==='READ_CYCLE_PLAN'?{cyclePlan:result}:{}),
   ...(request.command==='BUILD_PUBLICATION_REGISTRY'?{publicationPlan:result}:{}),
   ...(request.command==='PREPARE_RETAINED_ROLLBACK'?{rollbackPlan:result}:{}),
   ...(request.command==='READ_CLIENT_DETACH_BARRIER'?result:{}),
   ...(request.command==='RETIRE_EXPIRED_BUILDS'?{retirement:result}:{})})+'\n');
  if(finished)break;
 }
 assert(finished,'ONLINE_ORIGINAL_CONTROLLER_EOF_HELD');
}catch(error){
 process.stderr.write('ONLINE_ORIGINAL_CONTROLLER_FAILED_OR_HELD\n');process.exitCode=1;
 if(controller){try{controller.assertAllOriginalChildrenClosed();}catch{await controller.hold();}}
}finally{if(database)await database.$disconnect();}
