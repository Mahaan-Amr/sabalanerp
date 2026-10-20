import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
function load(relative){const filename=new URL('../../frontend/src/'+relative,import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');const code=require('esbuild').buildSync({entryPoints:[filename],bundle:true,write:false,platform:'node',format:'cjs',tsconfig:new URL('../../frontend/tsconfig.json',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')}).outputFiles[0].text;const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,require);return module.exports;}
const {strictDraftJson,parseModelDraft,assertModelRestore}=load('lib/modelDraft.ts');
const {parseFollowUpDraft,followUpDraftFields}=load('features/crm/followUpDraft.ts');
const {parseHiringCreateDraft}=load('features/hr-hiring/hiringCreateDraft.ts');
const {BrowserBuildHandoff}=load('lib/browserBuildHandoff.ts');
const scope={userId:'owner_a',sessionId:'session_a',tabId:'tab_a',draftId:'draft_a',workflow:'crm-follow-up-create',route:'/dashboard/crm/follow-ups/create',record:'customer_a',baseVersion:'new'};
const model=Object.fromEntries(followUpDraftFields.map(key=>[key,key==='summary'?'متن اصلی کاربر':'']));model.hasNextAction=true;
const envelope=()=>({format:'sabalan-model-draft/v1',scope:{...scope},schemaVersion:1,revision:7,submissionUncertain:false,model:{...model}});
test('allowlisted CRM and HR snapshots preserve editable meaning and refuse credentials/unknown choice',()=>{
 assert.equal(parseModelDraft(strictDraftJson(envelope()),parseFollowUpDraft).model.summary,'متن اصلی کاربر');
 assert.throws(()=>parseFollowUpDraft({...model,password:'secret'}));
 const hiring={form:{firstName:'نام',lastName:'نام خانوادگی',mobile:'0912',nationalCode:'001',positionId:'position'},assessmentDecision:'SELECT',assessmentKinds:['DISC','EQ'],assessmentExecutionMethod:'COMPANY'};
 assert.deepEqual(parseHiringCreateDraft(hiring),hiring);
 assert.throws(()=>parseHiringCreateDraft({...hiring,assessmentKinds:['DISC','DISC']}));
 assert.throws(()=>parseHiringCreateDraft({...hiring,assessmentDecision:'SEND'}));
});
test('binary bytes, classes, getters, cycles and nonfinite values cannot become empty JSON evidence',()=>{
 for(const value of [new Blob(['original bytes']),new Date(),NaN,undefined,Array(2),{file:new Blob(['bytes'])}])assert.throws(()=>strictDraftJson(value));
 const cycle={};cycle.self=cycle;assert.throws(()=>strictDraftJson(cycle));
 let invoked=false;assert.throws(()=>strictDraftJson({get secret(){invoked=true;return 'secret';}}));assert.equal(invoked,false);
});
test('restore is explicit, empty and owner/workflow/route/record bound; old session is reviewed only',()=>{
 const draft=parseModelDraft(strictDraftJson(envelope()),parseFollowUpDraft);
 assert.doesNotThrow(()=>assertModelRestore(draft,{...scope,sessionId:'new_session',tabId:'new_tab'},true,true));
 for(const key of ['userId','workflow','route','record','baseVersion'])assert.throws(()=>assertModelRestore(draft,{...scope,[key]:'other'},true,true));
 assert.throws(()=>assertModelRestore({...draft,submissionUncertain:true},scope,true,true));
 assert.throws(()=>assertModelRestore(draft,scope,false,true));assert.throws(()=>assertModelRestore(draft,scope,true,false));
 assert.throws(()=>parseModelDraft(JSON.stringify({...draft,schemaVersion:2}),parseFollowUpDraft));
});
test('actual handoff blocks quota, owner loss and model mutation; preservation never submits/navigates',async()=>{
 let value=envelope(),writes=0;
 const lease={userId:scope.userId,sessionId:scope.sessionId,generation:1};
 const registration={userId:scope.userId,workflow:scope.workflow,draftId:scope.draftId,schemaVersion:1,baseRevision:7,capturePayloadJson:()=>strictDraftJson(value)};
 const failure=new BrowserBuildHandoff('erp_draft_tests_20261020',async()=>{writes++;throw Error('QuotaExceededError');});failure.register(registration);
 assert.equal((await failure.preserve(lease,()=>{})).status,'BLOCKED');assert.equal(writes,1);
 const racing=new BrowserBuildHandoff('erp_draft_tests_20261020',async input=>{value.model.summary='changed while writing';return {...input,id:'archive',sha256:'a'.repeat(64)};});racing.register(registration);
 assert.equal((await racing.preserve(lease,()=>{})).status,'BLOCKED');
 const blocked=new BrowserBuildHandoff('erp_draft_tests_20261020',async()=>assert.fail('no write'));blocked.register(registration);
 assert.equal((await blocked.preserve(lease,()=>{throw Error('OWNER_CHANGED');})).status,'BLOCKED');
});
