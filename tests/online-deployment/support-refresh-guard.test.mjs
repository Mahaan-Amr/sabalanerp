import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';

const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const ts=require('typescript');
function load(name,mocks,globals={}){
  const file=new URL('../../frontend/src/'+name,import.meta.url);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};
  new Function('module','exports','require',...Object.keys(globals),code)(module,module.exports,key=>{
    if(!Object.hasOwn(mocks,key))throw Error('UNEXPECTED_TEST_DEPENDENCY '+key);
    return mocks[key];
  },...Object.values(globals));
  return module.exports;
}

// Execute the actual hook and global handoff; React, archive and session are
// deterministic boundaries here. This is not browser/IndexedDB qualification.
async function fixture(){
  const slots=[],effects=[];let cursor=0,reloads=0,ownWrites=0,globalWrites=0,invalid=false;
  const lease={userId:'owner_a',sessionId:'session_a',generation:1};
  const continuation={acquire:async()=>lease,assertCurrent(){if(invalid)throw Error('OWNER_CHANGED');},
    localRecoveryLease:()=>invalid?undefined:lease,subscribe:()=>()=>{}};
  const {BrowserBuildHandoff}=load('lib/browserBuildHandoff.ts',{'./browserDraftArchive':{}},
    {process:{env:{}}});
  const handoff=new BrowserBuildHandoff('erp_support_refresh_20261020',async snapshot=>{
    globalWrites++;return {...snapshot,id:'test-archive',sha256:'a'.repeat(64)};
  });
  const react={useRef(value){const i=cursor++;return slots[i]??={current:value};},
    useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
    useCallback:fn=>fn};
  const effect=(fn,deps)=>{const i=cursor++,prior=slots[i];if(!prior||deps.some((value,n)=>value!==prior.deps[n])){
    effects.push(()=>{prior?.cleanup?.();slots[i]={deps,cleanup:fn()};});
  }};
  react.useEffect=effect;react.useLayoutEffect=effect;
  const {useSupportTicketDraftRecovery}=load('features/support/useSupportTicketDraftRecovery.ts',{
    react,'@/lib/api':{browserSessionContinuation:continuation},'@/lib/browserBuildHandoff':{browserBuildHandoff:handoff},
    '@/lib/browserEvidenceArchive':{archiveBrowserEvidence:()=>assert.fail('no binary evidence in this control regression')},
    './supportTicketDraftArchive':{archiveSupportDraft:async(_draft,_build,assertOwner)=>{assertOwner();ownWrites++;},verifySupportDraftEvidence:async()=>{}},
    './supportTicketDraft':{parseSupportDraft:JSON.parse,supportOriginForArchive:()=>null,supportFormEmpty:()=>false},
  },{process:{env:{NEXT_PUBLIC_BROWSER_BUILD_ID:'erp_support_refresh_20261020'}},crypto:webcrypto,
    window:{addEventListener(){},removeEventListener(){},location:{reload(){reloads++;}}},setTimeout:()=>1,clearTimeout(){}});
  const input={userId:'owner_a',form:{title:'original',description:'unchanged'},origin:null,evidence:[],detailsOpen:false,
    recording:false,saving:false,evidencePending:false,initialWorkspace:'',isCaptureBusy:()=>false};
  const render=()=>{cursor=0;const value=useSupportTicketDraftRecovery(input);while(effects.length)effects.shift()();return value;};
  let api=render();await Promise.resolve();await Promise.resolve();api=render();api=render();
  return {api,handoff,get reloads(){return reloads;},get ownWrites(){return ownWrites;},get globalWrites(){return globalWrites;},invalidate(){invalid=true;}};
}

test('Support own save cannot bypass another active editor denial before explicit refresh',async()=>{
  const f=await fixture();
  const remove=f.handoff.register({userId:'owner_a',workflow:'unarchived-editor',draftId:'pending-editor',schemaVersion:1,
    baseRevision:0,capturePayloadJson(){throw Error('UNARCHIVED_CHILD');}});
  await assert.rejects(f.api.refresh(),/SUPPORT_REFRESH_NOT_PRESERVED/);
  assert.equal(f.ownWrites,1);assert.equal(f.globalWrites,0);assert.equal(f.reloads,0);
  remove();await f.api.refresh();assert.equal(f.reloads,1);assert.equal(f.globalWrites,1);
});

test('Support refresh refuses lost ownership without reloading or writing',async()=>{
  const f=await fixture();f.invalidate();await assert.rejects(f.api.refresh(),/OWNER_CHANGED|AUTH_CONTEXT_CHANGED/);
  assert.equal(f.reloads,0);assert.equal(f.ownWrites,0);assert.equal(f.globalWrites,0);
});
