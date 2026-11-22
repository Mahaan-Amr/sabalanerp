import test from 'node:test';
import assert from 'node:assert/strict';
import {openInheritedReadonlyTransportRetirementChannel,consumeReadonlyTransportRetirement,
  readReadonlyTransportRetirementCertificate} from '../../deploy/scripts/readonly-transport-retirement.mjs';

test('read-only transport authority cannot be supplied as caller JSON',async()=>{
  for(const fake of [{},Object.freeze({}),{format:'sabalan-original-readonly-transport-channel/v1'},
    Object.create(null)])await assert.rejects(consumeReadonlyTransportRetirement(fake,{}),/ORIGINAL_CHANNEL_UNPROVEN/);
});
test('a serialized displayed certificate cannot grant original-controller authority',()=>{
  const displayed={decision:'READONLY_TRANSPORT_RECONCILED',originalOperationOutcome:'UNKNOWN',
    productionAdmission:false,buildOrImageGcEligible:false};
  assert.throws(()=>readReadonlyTransportRetirementCertificate(displayed),/ORIGINAL_CHANNEL_UNPROVEN/);
  assert.throws(()=>readReadonlyTransportRetirementCertificate(Object.freeze({...displayed})),/ORIGINAL_CHANNEL_UNPROVEN/);
});
test('missing inherited channel cannot fall back to a path or boolean',async()=>{
  const previous=process.env.SABALAN_READONLY_RETIREMENT_FD;
  try{
    delete process.env.SABALAN_READONLY_RETIREMENT_FD;
    await assert.rejects(openInheritedReadonlyTransportRetirementChannel(),/ORIGINAL_CHANNEL_UNPROVEN/);
    process.env.SABALAN_READONLY_RETIREMENT_FD='true';
    await assert.rejects(openInheritedReadonlyTransportRetirementChannel(),/ORIGINAL_CHANNEL_UNPROVEN/);
  }finally{if(previous===undefined)delete process.env.SABALAN_READONLY_RETIREMENT_FD;else process.env.SABALAN_READONLY_RETIREMENT_FD=previous;}
});
