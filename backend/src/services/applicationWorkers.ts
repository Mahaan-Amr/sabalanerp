/** OFFLINE integration candidate: one actual scheduler group per process. */
import type {PrismaClient} from '@prisma/client';
import {prisma} from '../lib/prisma';
import {stopBackgroundJobs,startBackgroundJob} from './backgroundJobLifecycle';
import {getRecoveryRuntimeState} from './recoveryRuntime';
import {assertRuntimeControlAdmission} from './runtimeControlOwnership';
import {loadOnlineRuntimeScope} from './onlineRuntimeScope';
import {assertOnlineComposedRuntime,assertOnlineQualifiedRuntime,type OnlineQualifiedRuntime,type OnlineComposedRuntime} from './onlineRuntimeComposition';
import {assertOnlineRealtimeProducer,assertOnlineQualificationRealtimeProducer,type OnlineQualificationRealtimeProducer,type OnlineRealtimeProducer} from './onlineRealtimeBridge';
import {deliverPendingPrivateQualificationHrInvalidation,deliverPendingOnlineHrInvalidation} from './onlineHrInvalidation';
import type {RealtimeNotificationPublisher} from './notificationService';
import {startBiometricStagedCaptureMaintenance} from './biometricStagedCaptureMaintenance';
import {startAuthenticationRetentionCleanup} from './authenticationRetentionService';
import {startHiringInvitationDeliveryPolling} from './hrHiringDeliveryPollingService';
import {startPersonnelErasureRecovery} from './hrPersonnelErasureRecovery';
import {startSystemRecoveryMaintenance} from './systemRecoveryLifecycle';
import {startNotificationOutboxDelivery} from './notificationService';
import {startSupportTicketMaintenance} from './supportTicketMaintenance';
import {startHrVehicleAssignmentMaintenance} from './hrVehicleAssignmentWorker';
import {startDispatchBuyerSmsDelivery} from './dispatchBuyerSmsWorker';
import {startContractCancellationNoticeDelivery} from './contractCancellationNotice';
import {startAccountingTaxpayerOutboxDelivery} from './accountingTaxpayerOutboxWorker';
import {startCrossWorkspaceDutyDeadlineMaintenance} from './crossWorkspaceDutyModule';
import {inquiryNotificationAccess,startPartnerInquiryNotificationDelivery} from './partnerSales/notifications/inquiryDelivery';
import {startPersonnelPerformanceMaintenance} from './personnelPerformanceMaintenance';
import {startOrdinaryContractExpiry} from './ordinaryContractLifecycle';
import {registerPartnerNotificationAccess} from './partnerSales/notifications/access';
let observed=false;
async function startAll(database:PrismaClient,publish:RealtimeNotificationPublisher,online?:{family:'accepted';runtime:OnlineComposedRuntime;producer:OnlineRealtimeProducer}|{family:'qualification';runtime:OnlineQualifiedRuntime;producer:OnlineQualificationRealtimeProducer}){
 if(observed||database!==prisma)throw Error('APPLICATION_WORKERS_ALREADY_BOUND_OR_WRONG_CLIENT');
 observed=true;if(getRecoveryRuntimeState().mode!=='NORMAL')throw Error('APPLICATION_WORKERS_RECOVERY_NOT_NORMAL');
 registerPartnerNotificationAccess(inquiryNotificationAccess);
 const stops:Array<()=>void>=[];let stopped=false;
 const stopNewTicks=()=>{if(stopped)return;stopped=true;for(const stop of stops)stop();};
 try{
  stops.push(startAuthenticationRetentionCleanup(database));
  stops.push(startHiringInvitationDeliveryPolling(database));
  stops.push(startPersonnelErasureRecovery(database));
  stops.push(startSystemRecoveryMaintenance(database));
  stops.push(startNotificationOutboxDelivery(database,publish));
  stops.push(startSupportTicketMaintenance(database));
  stops.push(startDispatchBuyerSmsDelivery(database));
  stops.push(startHrVehicleAssignmentMaintenance(database));
  stops.push(startContractCancellationNoticeDelivery(database));
  stops.push(startAccountingTaxpayerOutboxDelivery(database));
  stops.push(startCrossWorkspaceDutyDeadlineMaintenance(database));
  stops.push(startPersonnelPerformanceMaintenance(database));
  stops.push(startOrdinaryContractExpiry(database));
  stops.push(startBiometricStagedCaptureMaintenance(database));
  stops.push(startPartnerInquiryNotificationDelivery(database));
  if(online){
   stops.push(startBackgroundJob({name:'online-hr-invalidation',intervalMs:1000,
    run:()=>online.family==='accepted'?deliverPendingOnlineHrInvalidation(online.runtime,database,online.producer):deliverPendingPrivateQualificationHrInvalidation(online.runtime,database,online.producer)}));
  }
  return Object.freeze({stopNewTicks,async stopAndDrain(timeoutMs:number){
   stopNewTicks();await stopBackgroundJobs(timeoutMs);
   if(online)await online.producer.stopAndDrain();
  }});
 }catch(error){
  stopNewTicks();const closureErrors:unknown[]=[];
  try{await stopBackgroundJobs(240_000);}catch(drainError){closureErrors.push(drainError);}
  // Partial startup did not return an owner to the entry. Keep its ORIGINAL
  // producer promise/latch in this catch; never skip it after a group error.
  if(online)try{await online.producer.stopAndDrain();}catch(drainError){closureErrors.push(drainError);}
  if(closureErrors.length)throw Object.assign(new Error('APPLICATION_WORKER_STARTUP_CLOSURE_UNPROVEN'),{cause:error,errors:Object.freeze([error,...closureErrors])});
  throw error;
 }
}
/** Legacy path preserves its original recovery bootstrap before this call. */
export function startOrdinaryApplicationWorkers(database:PrismaClient,publish:RealtimeNotificationPublisher){
 if(loadOnlineRuntimeScope()||(process.env.BACKEND_RUNTIME_ROLE&&process.env.BACKEND_RUNTIME_ROLE!=='standalone'))
  throw Error('ORDINARY_APPLICATION_WORKERS_ROLE_REQUIRED');
 assertRuntimeControlAdmission();return startAll(database,publish);
}
/** Bind createScopedRuntimeWork FIRST: its existing original group executor
 * dynamically calls withRecoveryBackgroundWrite -> genuine jobs runBackground.
 * There is no serving->standalone translation or arbitrary executor input. */
export function startOnlineApplicationWorkers(runtime:OnlineComposedRuntime,database:PrismaClient,producer:OnlineRealtimeProducer){
 assertOnlineComposedRuntime(runtime,'jobs');assertOnlineRealtimeProducer(runtime,producer);
 return startAll(database,producer.publishNotification,{family:'accepted',runtime,producer});
}

export function startPrivateQualificationApplicationWorkers(runtime:OnlineQualifiedRuntime,database:PrismaClient,producer:OnlineQualificationRealtimeProducer){
 assertOnlineQualifiedRuntime(runtime,'jobs');assertOnlineQualificationRealtimeProducer(runtime,producer);
 return startAll(database,producer.publishNotification,{family:'qualification',runtime,producer});
}
