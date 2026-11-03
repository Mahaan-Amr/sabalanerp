import test from 'node:test';
import assert from 'node:assert/strict';
import {runOriginalSerialPhysicalBinding, readOriginalSerialPhysicalCompletion,
  readOriginalSerialRestoredIncarnation} from '../../scripts/lib/serial-physical/native-binding.mjs';
import {serialIncarnationGeneration,invalidateSerialIncarnation,assertSerialIncarnationGeneration} from '../../scripts/lib/serial-physical/incarnation-generation.mjs';

test('plans, model ports and saved receipts cannot become original serial completion or incarnation', async () => {
  for (const input of [{}, {originalClusterRestored:true, physicalReplayQualified:true},
    {format:'sabalan-original-serial-physical-completion/v1', originalControllers:[{code:0,signal:null}]}]) {
    assert.throws(() => readOriginalSerialPhysicalCompletion(input), /ORIGINAL_SERIAL_PHYSICAL_COMPLETION_REQUIRED/);
    assert.throws(() => readOriginalSerialRestoredIncarnation(input), /ORIGINAL_SERIAL_RESTORED_INCARNATION_REQUIRED/);
    await assert.rejects(runOriginalSerialPhysicalBinding(input), /ORIGINAL_SERIAL_NATIVE_BINDING_REQUIRED/);
  }
});
test('wrapper and restoration replacements revoke every earlier generation across distinct bindings',()=>{
 const firstBinding=serialIncarnationGeneration();assertSerialIncarnationGeneration(firstBinding);
 invalidateSerialIncarnation();const secondBinding=serialIncarnationGeneration();
 assert.throws(()=>assertSerialIncarnationGeneration(firstBinding),/SERIAL_RESTORED_INCARNATION_REVOKED/);
 invalidateSerialIncarnation();assert.throws(()=>assertSerialIncarnationGeneration(secondBinding),/SERIAL_RESTORED_INCARNATION_REVOKED/);
 assertSerialIncarnationGeneration(serialIncarnationGeneration());
});
