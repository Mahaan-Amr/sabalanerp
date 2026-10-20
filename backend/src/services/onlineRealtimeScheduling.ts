/** OFFLINE: HTTP ticks use real consumer-owned HTTP admission, never jobs FD12. */
import {BackgroundJobGroup} from './backgroundJobLifecycle';
import {createOnlineRealtimeConsumer,createOnlineQualificationRealtimeConsumer} from './onlineRealtimeBridge';
import type {OnlineQualifiedRuntime,OnlineComposedRuntime} from './onlineRuntimeComposition';
import {assertOnlineComposedRuntime} from './onlineRuntimeComposition';
import {onlineRealtimeSuspendedForProtectedBootstrap} from './onlineReleaseAdmission';
export async function startOnlineRealtimeConsumer(runtime:OnlineComposedRuntime,application:unknown){
 const composition=assertOnlineComposedRuntime(runtime,'http');
 return start(await createOnlineRealtimeConsumer(runtime,application),()=>onlineRealtimeSuspendedForProtectedBootstrap(composition.admission));
}
export async function startPrivateQualificationRealtimeConsumer(runtime:OnlineQualifiedRuntime,application:unknown){
 return start(await createOnlineQualificationRealtimeConsumer(runtime,application));
}
async function start(consumer:Awaited<ReturnType<typeof createOnlineRealtimeConsumer>>,suspended=()=>false){
 const ticks=new BackgroundJobGroup(work=>work());let failure:unknown,failed=false;
 const stop=ticks.start({name:'online-http-realtime-consumer',intervalMs:100,
  run:async()=>{if(failed)return;try{if(suspended())return;await consumer.drainOnce();}catch(error){failed=true;failure=error;throw error;}}});
 return Object.freeze({stopNewTicks:stop,async drainAndStop(timeoutMs:number){
  stop();await ticks.stop(timeoutMs);if(failed)throw failure;
  // Protected controller must first commit the exact original slot DRAINING
  // after source HTTP requests/HR reservations finish. Consumers stay admitted.
  await consumer.drainAndStop();
 }});
}
