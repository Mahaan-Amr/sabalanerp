import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const source=new URL('../../frontend/src/features/support/supportTicketDraft.ts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const code=require('esbuild').buildSync({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,require);
const {parseSupportDraft,assertSupportRestoreAllowed}=module.exports;
const draft={format:'sabalan-support-draft/v1',scope:{userId:'owner_a',sessionId:'session_a',tabId:'tab_a',draftId:'draft_a'},
  revision:7,form:{title:'گزارش اصلی',description:'شرح',type:'TECHNICAL_ERROR',impact:'SINGLE_TASK',workaroundExists:false,
    reportedWorkspace:'',reportedFeature:'',steps:'قدم اول',expectedResult:'نتیجه',sensitiveEvidenceConsent:false,sensitiveEvidenceText:''},
  origin:{route:'/dashboard'},detailsOpen:true,evidence:[],submission:null};
test('explicit recovery retains raw Persian fields and refuses owner changes, nonempty form and unreviewed old session',()=>{
  const parsed=parseSupportDraft(JSON.stringify(draft));assert.equal(parsed.form.steps,'قدم اول');assert.equal(parsed.revision,7);
  assert.doesNotThrow(()=>assertSupportRestoreAllowed(parsed,{userId:'owner_a',sessionId:'session_a'},true,false));
  assert.throws(()=>assertSupportRestoreAllowed(parsed,{userId:'owner_b',sessionId:'session_a'},true,true));
  assert.throws(()=>assertSupportRestoreAllowed(parsed,{userId:'owner_a',sessionId:'new_session'},true,false));
  assert.throws(()=>assertSupportRestoreAllowed(parsed,{userId:'owner_a',sessionId:'session_a',tabId:'another_tab'},true,false));
  assert.throws(()=>assertSupportRestoreAllowed(parsed,{userId:'owner_a',sessionId:'session_a'},false,true));
});
test('submission history preserves original key/fingerprint and evidence manifests refuse hidden authority fields',()=>{
  const uncertain={...draft,submission:{key:'original_attempt_key',bodySha256:'a'.repeat(64),status:'UNCERTAIN'}};
  assert.deepEqual(parseSupportDraft(JSON.stringify(uncertain)).submission,uncertain.submission);
  assert.throws(()=>parseSupportDraft(JSON.stringify({...uncertain,submission:{...uncertain.submission,stagedTokens:['private_token']}})));
  const reference={...draft.scope,format:'sabalan-browser-evidence/v1',id:'12345678-1234-1234-1234-123456789abc',
    capturedAt:'2026-10-19T12:00:00Z',name:'گزارش.pdf',type:'application/pdf',size:17000000,lastModified:1234,
    sha256:'b'.repeat(64),metadataSha256:'c'.repeat(64)};
  const evidence={id:'original_pdf',kind:'DOCUMENT',reference};
  assert.equal(parseSupportDraft(JSON.stringify({...draft,evidence:[evidence]})).evidence[0].reference.name,'گزارش.pdf');
  assert.throws(()=>parseSupportDraft(JSON.stringify({...draft,evidence:[{...evidence,reference:{...reference,stageToken:'authority'}}]})));
});
