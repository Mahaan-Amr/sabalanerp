import assert from 'node:assert/strict';
import test from 'node:test';
import {canOfferModelDraftRefresh} from './modelDraft';
import {BrowserBuildHandoff} from './browserBuildHandoff';
import {parseInventoryMasterDataDraft} from '../features/inventory/master-data/inventoryMasterDataDraft';

const model={code:'001',name:'stone',namePersian:'سنگ',description:'متن',images:[] as string[],isActive:true};
const eligible={active:true,ownerCurrent:true,busy:false,hasLiveBlocker:false,model,
  parse:(value:unknown)=>parseInventoryMasterDataDraft('service',value)};

test('refresh offer follows the domain parser, including JSON-safe but unarchived image references',()=>{
  assert.equal(canOfferModelDraftRefresh(eligible),true);
  for(const images of [['/uploads/original.png'],['data:image/png;base64,AA==']]){
    assert.equal(canOfferModelDraftRefresh({...eligible,model:{...model,images}}),false);
  }
  for(const denial of [{active:false},{ownerCurrent:false},{busy:true},{submissionUncertain:true},{hasLiveBlocker:true}]){
    assert.equal(canOfferModelDraftRefresh({...eligible,...denial}),false);
  }
});

test('live denial preview neither captures nor archives, and cannot authorize later preservation',async()=>{
  let writes=0,captures=0,blocked=false;
  const handoff=new BrowserBuildHandoff('erp_preview_20261020',async()=>{writes++;throw Error('unexpected write');});
  handoff.register({userId:'owner',workflow:'inventory-service',draftId:'draft',schemaVersion:1,baseRevision:0,
    capturePayloadJson:()=>{captures++;return '{}';}});
  const release=handoff.registerBlocker(()=>blocked);
  assert.equal(handoff.hasLiveBlocker(),false);
  assert.equal(canOfferModelDraftRefresh({...eligible,hasLiveBlocker:handoff.hasLiveBlocker()}),true);
  assert.equal(writes,0);assert.equal(captures,0);
  blocked=true;
  assert.equal(canOfferModelDraftRefresh({...eligible,hasLiveBlocker:handoff.hasLiveBlocker()}),false);
  assert.equal((await handoff.preserve({userId:'owner',sessionId:'session',generation:1},()=>{})).status,'BLOCKED');
  assert.equal(writes,0);assert.equal(captures,0);
  release();handoff.registerBlocker(()=>{throw Error('unreadable live buffer');});
  assert.equal(handoff.hasLiveBlocker(),true);
});
