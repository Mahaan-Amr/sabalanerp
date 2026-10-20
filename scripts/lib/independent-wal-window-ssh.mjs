/** Original backup WAL verification. A parsed report/path never mints custody. */
import assert from 'node:assert/strict';
import {runOriginalIndependentGuardianWalWindow,readOriginalIndependentGuardianWalWindow,acknowledgeOriginalIndependentGuardianWalWindow,originalIndependentGuardianAvailability,runOriginalIndependentRestoreOverSsh,readOriginalIndependentGuardianWalWindowAcknowledgement,waitOriginalIndependentGuardianClosure} from './independent-full-restore-ssh.mjs';
export async function runOriginalIndependentWalWindowVerification(options){
  if(options.independentGuardian){const value=originalIndependentGuardianAvailability(options.independentGuardian);if(value.live&&!value.draining)return runOriginalIndependentGuardianWalWindow(options);if(value.live&&value.draining)await waitOriginalIndependentGuardianClosure(options.independentGuardian);}
  // A new fixed original owner reacquires both locks only after the previous
  // original owner is actually closed. No receipt/PID adoption or reconnect.
  assert.ok(options.pythonExecutable&&options.profilePath&&options.expected,'ORIGINAL_INDEPENDENT_STANDALONE_OPTIONS_REQUIRED');
  let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const original=runOriginalIndependentRestoreOverSsh({...options,walStandalone:true,onOriginalGuardianReady:readyResolve,onHeld:value=>{options.onHeld?.(value);readyReject(Error('ORIGINAL_STANDALONE_GUARDIAN_HELD'));}});
  original.catch(readyReject);const independentGuardian=await ready;return runOriginalIndependentGuardianWalWindow({independentGuardian,sourceWindow:options.sourceWindow});
}
export function readOriginalIndependentWalWindowVerification(token){return readOriginalIndependentGuardianWalWindow(token);}
export async function acknowledgeOriginalIndependentWalWindowVerification(token,certificate){return acknowledgeOriginalIndependentGuardianWalWindow(token,certificate);}

export function readOriginalIndependentWalWindowAcknowledgement(token,options){return readOriginalIndependentGuardianWalWindowAcknowledgement(token,options);}
