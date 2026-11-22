import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createOriginalLocalOnlineCheckpoint,readOriginalLocalOnlinePhysicalPointSource,readOriginalLocalOnlineWalWindowSource,
 readOriginalLocalOnlineCheckpointCompletion,isOriginalLocalOnlinePhysicalPointSource,isOriginalLocalOnlineWalWindowSource,
 readOriginalLocalOnlinePointWindowAcknowledgements,inspectOriginalLocalOnlineCheckpointInputs} from '../../scripts/lib/original-local-online-checkpoint.mjs';
test('local native point, windows and completion cannot be adopted from JSON or a callback controller',async()=>{
 const fake={format:'sabalan-original-local-online-point-completion/v1',originalControllers:[{code:0,signal:null}],continuousWalQualified:false};
 assert.equal(isOriginalLocalOnlinePhysicalPointSource(fake),false);assert.equal(isOriginalLocalOnlineWalWindowSource(fake),false);
 await assert.rejects(readOriginalLocalOnlinePhysicalPointSource(fake),/ORIGINAL_LOCAL_ONLINE_SOURCE_REQUIRED/);
 await assert.rejects(readOriginalLocalOnlineWalWindowSource(fake),/ORIGINAL_LOCAL_ONLINE_SOURCE_REQUIRED/);
 assert.throws(()=>readOriginalLocalOnlineCheckpointCompletion(fake),/ORIGINAL_LOCAL_ONLINE_COMPLETION_REQUIRED/);
 assert.throws(()=>readOriginalLocalOnlinePointWindowAcknowledgements(fake),/ORIGINAL_LOCAL_ONLINE_SOURCE_REQUIRED/);
 let called=false;await assert.rejects(createOriginalLocalOnlineCheckpoint({capturePlan:fake,coordinator:{prepareOriginalLocalOnlineCapturePlan(){called=true;}},cryptoExecutor:{seal(){called=true;}}}));
 assert.equal(called,false);
});

const nativeReceipt='D:/sabalanerp-online-qa/native-process-owner-qualified-bcf8149601a9df66f1d186f3b9889844/receipt.json';
test('actual fixed runtime preflight verifies original receipt.json and sysroot before any native owner starts',{skip:process.platform!=='win32'||!fs.existsSync(nativeReceipt)},()=>{
 const facts=inspectOriginalLocalOnlineCheckpointInputs({nativeOwnerElfReceipt:nativeReceipt});assert.equal(Object.keys(facts.sourcePins).length,22);assert.equal(facts.productionAdmission,false);
});
