import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const ts=require('typescript');
function load(file,mocks={}){
 const source=fs.readFileSync(new URL('../../frontend/src/'+file,import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}};
 new Function('module','exports','require',code)(module,module.exports,key=>{
  assert.ok(Object.hasOwn(mocks,key),'unexpected dependency '+key);return mocks[key];
 });return module.exports;
}
const domain=load('features/support/supportTicketDraft.ts');
const draft={format:'sabalan-support-draft/v1',scope:{userId:'owner_a',sessionId:'session_a',tabId:'tab_a',draftId:'draft_a'},
 revision:8,form:{title:'آخرین نوشته؛ قبل از ذخیرهٔ خودکار',description:'اصل فارسی',type:'TECHNICAL_ERROR',impact:'SINGLE_TASK',workaroundExists:false,
 reportedWorkspace:'',reportedFeature:'',steps:'',expectedResult:'',sensitiveEvidenceConsent:false,sensitiveEvidenceText:''},
 origin:{route:'/dashboard'},detailsOpen:false,evidence:[],submission:null};
const saved={format:'sabalan-browser-draft/v1',userId:'owner_a',workflow:'support-ticket',draftId:'draft_a',schemaVersion:1,baseRevision:8,
 id:'00000000-0000-4000-8000-000000000008',capturedAt:'2026-10-20T00:00:00Z',payloadJson:JSON.stringify(draft)};
function fixture(rows=[saved]){
 const reads=[],files=[];
 const module=load('features/support/supportTicketDraftArchive.ts',{
  '@/lib/browserDraftArchive':{readBrowserWorkflowDraftArchives:async(...args)=>{reads.push(args);args[2]();return {archives:rows,next:{key:['owner_a','support-ticket','draft_a'],id:saved.id}};}},
  '@/lib/browserEvidenceArchive':{readBrowserEvidence:async(scope,reference,assertCurrent)=>{assertCurrent();files.push({scope,reference});return 'original binary';}},
  './supportTicketDraft':domain,
  './supportTicketDraftIndex':{indexSupportDraft:()=>assert.fail('discovery must not depend on a Support index write')},
 });return {...module,reads,files};
}
test('global handoff snapshot without a Support index pointer is discoverable, with original text and bounded cursor',async()=>{
 const f=fixture(),assertCurrent=()=>{},before={key:['owner_a','support-ticket','prior_draft'],id:'00000000-0000-4000-8000-000000000001'};
 const found=await f.listSupportDrafts('owner_a',assertCurrent,before);
 assert.deepEqual(f.reads[0],['owner_a','support-ticket',assertCurrent,before]);
 assert.deepEqual(found.archives,[{id:saved.id,capturedAt:saved.capturedAt,draft}]);
 assert.deepEqual(found.next,{key:['owner_a','support-ticket','draft_a'],id:saved.id});
 assert.deepEqual(f.files,[],'listing must not upload or replay business requests');
});
test('Support discovery rejects owner, workflow, revision, draft and schema manifest mismatches',async()=>{
 for(const patch of [{userId:'owner_b'},{workflow:'sales-contract'},{baseRevision:7},{draftId:'another_draft'},{schemaVersion:2}]){
  const f=fixture([{...saved,...patch}]);await assert.rejects(f.listSupportDrafts('owner_a',()=>{}),/SUPPORT_DRAFT_MANIFEST_UNVERIFIED/);
 }
 const f=fixture();await assert.rejects(f.listSupportDrafts('owner_a',()=>{throw Error('OWNER_LOST');}),/OWNER_LOST/);
});
test('recovered global handoff evidence uses the exact original scoped reference through the binary verifier',async()=>{
 const f=fixture(),reference={...draft.scope,id:'original_evidence'};
 const result=await f.readSupportDraftFiles({...draft,evidence:[{id:'pdf_original',kind:'DOCUMENT',reference}]},()=>{});
 assert.deepEqual(f.files,[{scope:draft.scope,reference}]);
 assert.deepEqual(result,[{id:'pdf_original',kind:'DOCUMENT',file:'original binary'}]);
});
