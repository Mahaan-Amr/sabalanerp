/** Canonical CLI only. The SAME master implementation has no CLI evaluation. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runOriginalOnlineQualificationMaster} from './lib/original-online-qualification-master.mjs';
export {runOriginalOnlineQualificationMaster,readOriginalMasterKnownNegative,isOriginalMasterKnownImageNegative,readOriginalMasterKnownImageNegative,isOriginalMasterKnownPreparationNegative,readOriginalMasterKnownPreparationNegative} from './lib/original-online-qualification-master.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const argv=process.argv.slice(2),options={};
 if(argv[0]==='--native-c3-plan-file'){
  assert.ok(argv.length===4||argv.length===5&&argv[4]==='--connection-only');assert.equal(argv[2],'--native-c3-plan-sha256');
  const {executeNativeC3MasterEntry}=await import('./lib/native-c3-master-entry.mjs');await executeNativeC3MasterEntry({file:path.resolve(argv[1]),sha256:argv[3]},{connectionOnly:argv.length===5});
 }else{
 while(argv.length){const key=argv.shift();if(key==='--defer-local'){assert.equal(options.deferLocal,undefined);options.deferLocal=true;continue;}
  const fields={'--candidate-replacement-receipt':'candidateReplacementReceipt','--retained-browser-plan-file':'retainedBrowserPlanFile','--retained-browser-plan-sha256':'retainedBrowserPlanSha256'};
  assert.ok(fields[key]&&argv.length&&options[fields[key]]===undefined);options[fields[key]]=argv.shift();}
 assert.ok(options.deferLocal||options.candidateReplacementReceipt);
 assert.equal(Boolean(options.retainedBrowserPlanFile),Boolean(options.retainedBrowserPlanSha256));
 await runOriginalOnlineQualificationMaster(options);
 }
}
