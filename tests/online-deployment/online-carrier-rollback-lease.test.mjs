import test from 'node:test';
import assert from 'node:assert/strict';
import {OriginalOnlineReleaseController} from '../../deploy/scripts/online-release-controller.mjs';
import {provisionOriginalOnlineReleaseCarriers} from '../../deploy/scripts/online-release-carriers.mjs';
import {readProvisionedInquiryCarrier} from '../../deploy/scripts/online-inquiry-carrier.mjs';

// Exercise the exported consumers. Only the original controller's database
// lease boundary is replaced; the real module's private token maps remain.
for(const [name,read] of [['ERP',provisionOriginalOnlineReleaseCarriers],['Inquiry',readProvisionedInquiryCarrier]]){
 test(`${name} rollback operation reaches original capability validation, terminal/stale leases refuse`,async()=>{
  const original=OriginalOnlineReleaseController.prototype.assertOwned;
  let phase='ONLINE_ROLLBACK_PUBLISHING',leaseLive=true,calls=0,callerOverride=false;
  const controller=Object.create(OriginalOnlineReleaseController.prototype);
  controller.assertOwned=()=>{callerOverride=true;};
  OriginalOnlineReleaseController.prototype.assertOwned=async function(phases){
   calls++;assert.equal(this,controller);assert.ok(leaseLive&&phases.includes(phase),'FIXTURE_REAL_LEASE_REFUSED');
  };
  try{
   await assert.rejects(read(controller,{}),name==='ERP'?/ONLINE_CARRIER_RUNTIME_SET_INVALID/:/ORIGINAL_INQUIRY_CARRIER_REQUIRED/);
   assert.equal(calls,1);assert.equal(callerOverride,false);
   for(phase of ['COMPLETED','ROLLED_BACK'])await assert.rejects(read(controller,{}),/FIXTURE_REAL_LEASE_REFUSED/);
   phase='ONLINE_ROLLBACK_PUBLISHING';leaseLive=false;
   await assert.rejects(read(controller,{}),/FIXTURE_REAL_LEASE_REFUSED/);
   assert.equal(callerOverride,false);
  }finally{OriginalOnlineReleaseController.prototype.assertOwned=original;}
 });
}
