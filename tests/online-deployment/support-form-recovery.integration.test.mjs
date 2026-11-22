import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import test,{before,after} from 'node:test';

// UI ONLY: actual Support page, SDS, hooks and real Edge IndexedDB. Next
// navigation, auth transport and Support network calls are controlled system
// boundaries. This is NOT native HTTP, compiled image or 24-hour qualification.
const frontend=fileURLToPath(new URL('../../frontend/',import.meta.url));
const require=createRequire(path.join(frontend,'package.json'));
const {build}=require('esbuild'),{chromium}=require('@playwright/test');
const api=`
import {BrowserSessionContinuation} from ${JSON.stringify(path.join(frontend,'src/lib/browserSessionContinuation.ts'))};
window.__supportActor=window.__supportInitialActor||{userId:'owner_a',sessionId:'session_a'};
window.__supportListeners=new Set();window.__supportUI={requests:[],navigations:[],createUnknown:false};
export const browserSessionContinuation=new BrowserSessionContinuation(async()=>{if(window.__supportDelayProbe)await new Promise(resolve=>window.__supportUI.releaseProbe=resolve);return {...window.__supportActor};});
window.__supportUI.setActor=async(userId,sessionId)=>{
 const prior=browserSessionContinuation.expectedUserId();
 if(prior===userId){browserSessionContinuation.invalidate();const attempt=browserSessionContinuation.beginLogin();browserSessionContinuation.completeLogin({userId,sessionId},attempt);}
 else browserSessionContinuation.clear();
 window.__supportActor={userId,sessionId};await browserSessionContinuation.acquire();window.__supportListeners.forEach(listener=>listener());
};
export const supportTicketsAPI={
 getContext:async()=>{await browserSessionContinuation.acquire();return{data:{data:{workspaces:[],features:[]}}};},
 stageAttachment:async()=>{window.__supportUI.requests.push({method:'POST',path:'stage'});return{data:{data:{token:'ephemeral_token_must_not_archive'}}};},
 create:async(body,key)=>{window.__supportUI.requests.push({method:'POST',path:'create',body,key});throw Error('SIMULATED_RESPONSE_LOSS');}
};`;
const auth=`import {useSyncExternalStore} from 'react';export function useAuth(){const value=useSyncExternalStore(listener=>{window.__supportListeners.add(listener);return()=>window.__supportListeners.delete(listener);},()=>window.__supportActor);return{user:{id:value.userId},loading:false,isAuthenticated:true};}`;
const navigation=`export function useRouter(){return{push:url=>window.__supportUI.navigations.push(url),replace:url=>window.__supportUI.navigations.push(url)};}export function usePathname(){return location.pathname;}export function useSearchParams(){return new URLSearchParams(location.search);}`;
const link=`import React from 'react';export default React.forwardRef(function Link({href,children,...props},ref){return React.createElement('a',{...props,href,ref},children);});`;
const bundle=(await build({absWorkingDir:frontend,stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Page from './src/app/dashboard/support/new/page';import{browserBuildHandoff}from'./src/lib/browserBuildHandoff';import{browserSessionContinuation}from'@/lib/api';window.__supportUI.preserveGlobal=async()=>{const lease=await browserSessionContinuation.acquire();return browserBuildHandoff.preserve(lease,()=>browserSessionContinuation.assertCurrent(lease));};createRoot(document.getElementById('root')).render(<Page/>);`,resolveDir:frontend,loader:'tsx'},
 bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NEXT_PUBLIC_BROWSER_BUILD_ID':'"erp_support_ui_qualification_20261019"','process.env.NEXT_PUBLIC_BUILD_COMMIT':'"ui-scope-only"'},
 plugins:[{name:'controlled-system-boundaries',setup(build){
  const sources={'@/lib/api':api,'@/contexts/AuthContext':auth,'next/navigation':navigation,'next/link':link};
  build.onResolve({filter:/^(@\/lib\/api|@\/contexts\/AuthContext|next\/navigation|next\/link)$/},args=>({path:args.path,namespace:'controlled'}));
  build.onLoad({filter:/.*/,namespace:'controlled'},args=>({contents:sources[args.path],loader:'tsx',resolveDir:frontend}));
 }}]})).outputFiles[0].text;
if(process.argv.includes('--compile-only')){console.log('Actual Support page UI bundle compiled; no browser or runtime test executed.');process.exit(0);}
let browser;
let setupFailure;
before(async()=>{
 const raw=execFileSync('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--format','json'],{encoding:'utf8'});
 const rows=raw.trim().split(/\r?\n/).filter(Boolean).flatMap(value=>JSON.parse(value));
 for(const service of ['backend','frontend','postgres','inquiry'])assert.ok(rows.some(row=>row.Project==='sabalanerp-local'&&row.Service===service&&row.State==='running'&&row.Health==='healthy'));
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-device-for-media-stream']});
});
after(async()=>{if(browser)await browser.close();});
const origin='http://localhost:3101/dashboard/support/new';
async function pageFor(work,{delayProbe=false,otherOwnerOrigin=false}={}){
 if(setupFailure)throw Error('PRIOR_UI_SETUP_FAILED: '+setupFailure);
 const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
 page.setDefaultTimeout(8000);
 const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&pageErrors.length<8)pageErrors.push(message.text().slice(0,1500));});
 if(delayProbe)await page.addInitScript(()=>{window.__supportDelayProbe=true;});
 if(otherOwnerOrigin)await page.addInitScript(()=>{
  window.__supportInitialActor={userId:'owner_b',sessionId:'session_b'};
  const origin={route:'/dashboard/contracts/owner-a-private',pageTitle:'PRIVATE_OWNER_A',sensitiveCandidate:{pageText:'PRIVATE_OWNER_A'}};
  sessionStorage.setItem('sabalan:support-origin:v1:owner_a:session_a',JSON.stringify({format:'sabalan-owned-support-origin/v1',owner:{userId:'owner_a',sessionId:'session_a'},origin}));
  sessionStorage.setItem('support-ticket-origin',JSON.stringify(origin));
 });
 await page.route(origin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl"><body><div id="root"></div><script>'+bundle.replace(/<\/script/gi,'<\\/script')+'</script></body></html>'}));
 try{
  await page.goto(origin);
  try{await page.getByRole('button',{name:'حفظ پیش‌نویس',exact:true}).waitFor({timeout:8000});}
  catch(error){setupFailure=JSON.stringify({pageErrors,body:(await page.locator('body').innerText()).slice(0,1200)});throw Error(setupFailure);}
  await work(page);
 }
 finally{await context.close();}
}
async function fill(page,title){await page.getByRole('textbox',{name:'عنوان',exact:true}).fill(title);await page.getByRole('textbox',{name:'شرح مشکل',exact:true}).fill('شرح فارسی بدون ارسال خودکار');}
async function save(page){await page.getByRole('button',{name:'حفظ پیش‌نویس',exact:true}).click();await page.getByText('نوشته‌ها و فایل‌های همین نسخه در این مرورگر محفوظ است.',{exact:true}).waitFor({timeout:60000});}
async function restore(page){
 await page.getByRole('button',{name:'نسخه‌های محفوظ این حساب',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'بازیابی درخواست پشتیبانی'});
 await sheet.getByRole('checkbox').check();await sheet.getByRole('button',{name:'بازیابی این نسخه',exact:true}).first().click();
 await sheet.waitFor({state:'hidden',timeout:30000});return sheet;
}
test('global handoff original is manually recoverable without a Support index pointer',{timeout:90000},async()=>pageFor(async page=>{
 const title='اصل آخرین نوشتهٔ انتقال نسخه';await fill(page,title);
 const handoff=await page.evaluate(()=>window.__supportUI.preserveGlobal());assert.equal(handoff.status,'PRESERVED');
 // The global writer intentionally does not populate the separate domain
 // index. Remove any autosave pointers too, proving recovery reads the actual
 // original generic archive rather than accidentally relying on a timer.
 await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('sabalan-support-draft-index');request.onsuccess=()=>resolve();request.onerror=request.onblocked=()=>reject(Error('SUPPORT_INDEX_DELETE_FAILED'));}));
 await page.reload();assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).inputValue(),'');
 await restore(page);assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).inputValue(),title);
 assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);
}));
test('actual Support page preserves Persian inputs and 17MiB original PDF through manual refresh and explicit empty-form restore',{timeout:120000},async()=>pageFor(async page=>{
 const title='نسخهٔ اصلی برای بازیابی';await fill(page,title);
 const bytes=Buffer.alloc(17*1024*1024+3,32);Buffer.from('%PDF-1.4\n% original browser evidence\n').copy(bytes);bytes[bytes.length-1]=255;
 await page.locator('input[type=file][accept=".pdf,.docx,.xlsx,.txt"]').setInputFiles({name:'سند اصلی.pdf',mimeType:'application/pdf',buffer:bytes});
 await save(page);assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);
 await page.reload();assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).inputValue(),'');
 await restore(page);assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).inputValue(),title);
 assert.equal(await page.getByRole('textbox',{name:'شرح مشکل',exact:true}).inputValue(),'شرح فارسی بدون ارسال خودکار');
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'دریافت فایل اصلی',exact:true}).click();
 const file=await(await downloaded).path();assert.ok(file);assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);assert.deepEqual(await page.evaluate(()=>window.__supportUI.navigations),[]);
}));
test('quota failure keeps mounted original input and blocks refresh availability',{timeout:60000},async()=>pageFor(async page=>{
 await fill(page,'ورودی هنگام پر شدن حافظه');
 const cdp=await page.context().newCDPSession(page),quotaOrigin=new URL(origin).origin;
 const usage=await cdp.send('Storage.getUsageAndQuota',{origin:quotaOrigin});
 await cdp.send('Storage.overrideQuotaForOrigin',{origin:quotaOrigin,quotaSize:usage.usage+1024});
 const applied=await cdp.send('Storage.getUsageAndQuota',{origin:quotaOrigin});assert.equal(applied.overrideActive,true);
 try{
 await page.locator('input[type=file][accept=".pdf,.docx,.xlsx,.txt"]').setInputFiles({name:'سند.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(17*1024*1024,65)});
 await page.getByRole('button',{name:'حفظ پیش‌نویس',exact:true}).click();await page.getByText(/حفظ کامل نشد/).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).inputValue(),'ورودی هنگام پر شدن حافظه');
 assert.equal(await page.getByRole('button',{name:'تازه‌سازی پس از حفظ کامل',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return event.defaultPrevented;}),true);
 assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);
 }finally{await cdp.send('Storage.overrideQuotaForOrigin',{origin:quotaOrigin});await cdp.detach();}
}));
test('same-owner new session requires explicit review; different owner cannot see original form or archive list',{timeout:60000},async()=>pageFor(async page=>{
 await fill(page,'متن فقط برای مالک اصلی');await save(page);
 await page.evaluate(()=>window.__supportUI.setActor('owner_a','new_session'));
 assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).count(),0);
 await page.getByRole('button',{name:'ورود فعلی همین حساب را بررسی و نسخهٔ محلی را باز کنم',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).inputValue(),'متن فقط برای مالک اصلی');
 await save(page);await page.evaluate(()=>window.__supportUI.setActor('owner_b','other_session'));
 await page.getByText('مالک یا ورود این فرم تغییر کرده است؛ اطلاعات اصلی در همین تب نگه داشته شده و پنهان است.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'نسخه‌های محفوظ این حساب',exact:true}).count(),0);
 assert.equal(await page.getByText('متن فقط برای مالک اصلی',{exact:true}).count(),0);
}));
test('actor change before the first auth probe completes cannot adopt the original mounted draft',{timeout:60000},async()=>pageFor(async page=>{
 await fill(page,'نوشتهٔ اصلی پیش از پاسخ ورود');
 await page.evaluate(async()=>{window.__supportDelayProbe=false;await window.__supportUI.setActor('owner_b','session_b');window.__supportUI.releaseProbe();});
 await page.getByText('مالک یا ورود این فرم تغییر کرده است؛ اطلاعات اصلی در همین تب نگه داشته شده و پنهان است.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'نسخه‌های محفوظ این حساب',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'ورود فعلی همین حساب را بررسی و نسخهٔ محلی را باز کنم',exact:true}).count(),0);
 assert.equal(await page.getByText('نوشتهٔ اصلی پیش از پاسخ ورود',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);
},{delayProbe:true}));
test('an ambiguous explicit submission retains its original intent and never automatically sends again after recovery',{timeout:90000},async()=>pageFor(async page=>{
 await fill(page,'نتیجهٔ ارسال نامشخص');
 await page.locator('input[type=file][accept=".pdf,.docx,.xlsx,.txt"]').setInputFiles({name:'یادداشت.txt',mimeType:'text/plain',buffer:Buffer.from('اصل')});
 await page.getByRole('button',{name:'ثبت درخواست',exact:true}).click();
 await page.getByText('این نسخه سابقهٔ ارسال دارد؛ برای جلوگیری از ثبت دوباره، ابتدا تاریخچهٔ درخواست‌ها را بررسی کنید.',{exact:true}).waitFor();
 await page.waitForFunction(()=>window.__supportUI.requests.some(value=>value.path==='create'));
 const request=await page.evaluate(()=>window.__supportUI.requests.find(value=>value.path==='create'));assert.ok(request?.key);
 assert.equal(await page.getByRole('button',{name:'ثبت درخواست',exact:true}).isDisabled(),true);
 await save(page);await page.reload();await restore(page);
 assert.equal(await page.getByRole('button',{name:'ثبت درخواست',exact:true}).isDisabled(),true);
 assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);
 await page.getByRole('button',{name:'نسخه‌های محفوظ این حساب',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'بازیابی درخواست پشتیبانی'});await sheet.getByRole('checkbox').check();
 const downloaded=page.waitForEvent('download');await sheet.getByRole('button',{name:'دریافت نوشته و فهرست فایل‌های اصلی',exact:true}).first().click();
 const file=await(await downloaded).path(),raw=fs.readFileSync(file,'utf8'),draft=JSON.parse(raw);
 assert.equal(draft.submission.key,request.key);assert.equal(draft.submission.bodySha256,createHash('sha256').update(JSON.stringify(request.body)).digest('hex'));
 assert.equal(raw.includes('ephemeral_token_must_not_archive'),false);
}));
test('corrupted original Blob blocks the real refresh button without losing mounted form',{timeout:60000},async()=>pageFor(async page=>{
 await fill(page,'فایل اصلی باید سالم بماند');
 await page.locator('input[type=file][accept=".pdf,.docx,.xlsx,.txt"]').setInputFiles({name:'اصل.txt',mimeType:'text/plain',buffer:Buffer.from('متن فایل اصلی')});
 await save(page);
 await page.evaluate(async()=>{
  const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('sabalan-browser-evidence-archive',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{await new Promise((resolve,reject)=>{const transaction=database.transaction('evidence','readwrite');transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);
   const request=transaction.objectStore('evidence').openCursor();request.onsuccess=()=>{const cursor=request.result;if(cursor)cursor.update({...cursor.value,blob:new Blob(['damaged'],{type:'text/plain'})});};});}
  finally{database.close();}
 });
 let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
 await page.getByRole('button',{name:'تازه‌سازی پس از حفظ کامل',exact:true}).click();
 await page.getByText('حفظ آخرین نسخه تأیید نشد؛ این صفحه را نبندید.',{exact:true}).waitFor();
 assert.equal(navigations,0);assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).inputValue(),'فایل اصلی باید سالم بماند');
 assert.equal(await page.getByRole('button',{name:'تازه‌سازی پس از حفظ کامل',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);
}));
test('actual MediaRecorder on an empty form blocks unload until final file completion',{timeout:60000},async()=>pageFor(async page=>{
 await page.context().grantPermissions(['microphone'],{origin:new URL(origin).origin});
 await page.getByRole('button',{name:'ضبط پیام صوتی',exact:true}).click();
 await page.getByRole('button',{name:'پایان ضبط',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return event.defaultPrevented;}),true);
 assert.equal(await page.getByRole('button',{name:'حفظ پیش‌نویس',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'پایان ضبط',exact:true}).click();
 await page.locator('audio[src^="blob:"]').waitFor();await save(page);
 assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);
}));

test('another-user bootstrap ignores original-owner origin and unattributable legacy metadata',{timeout:60000},async()=>pageFor(async page=>{
 await fill(page,'درخواست مستقل حساب دوم');await save(page);
 await page.getByRole('button',{name:'نسخه‌های محفوظ این حساب',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'بازیابی درخواست پشتیبانی'});await sheet.getByRole('checkbox').check();
 const downloaded=page.waitForEvent('download');await sheet.getByRole('button',{name:'دریافت نوشته و فهرست فایل‌های اصلی',exact:true}).first().click();
 const file=await(await downloaded).path(),raw=fs.readFileSync(file,'utf8'),draft=JSON.parse(raw);
 assert.equal(draft.scope.userId,'owner_b');assert.equal(draft.origin.route,'/dashboard/support/new');
 assert.equal(raw.includes('PRIVATE_OWNER_A'),false);assert.equal(raw.includes('owner-a-private'),false);
 assert.equal(await page.getByText('PRIVATE_OWNER_A',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('support-ticket-origin')!==null),true);
 assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);
},{otherOwnerOrigin:true}));

test('owner loss while actual microphone acquisition is pending closes returned tracks before recording',{timeout:60000},async()=>pageFor(async page=>{
 await page.context().grantPermissions(['microphone'],{origin:new URL(origin).origin});
 await page.evaluate(()=>{
  const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async(...args)=>{
   const stream=await acquire(...args);window.__pendingActualMic=stream;
   await new Promise(resolve=>window.__releaseActualMic=resolve);return stream;
  };
 });
 await page.getByRole('button',{name:'ضبط پیام صوتی',exact:true}).click();
 await page.waitForFunction(()=>Boolean(window.__releaseActualMic));
 await page.evaluate(async()=>{await window.__supportUI.setActor('owner_b','session_b');window.__releaseActualMic();});
 await page.waitForFunction(()=>window.__pendingActualMic.getTracks().every(track=>track.readyState==='ended'));
 assert.equal(await page.locator('audio').count(),0);assert.equal(await page.getByRole('textbox',{name:'عنوان',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);
}));

test('owner loss normally stops original recording and preserves its completed Blob privately for same-owner review',{timeout:60000},async()=>pageFor(async page=>{
 await page.context().grantPermissions(['microphone'],{origin:new URL(origin).origin});
 await page.evaluate(()=>{
  const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await acquire(...args);window.__recordedActualMic=stream;return stream;};
 });
 await page.getByRole('button',{name:'ضبط پیام صوتی',exact:true}).click();
 await page.getByRole('button',{name:'پایان ضبط',exact:true}).waitFor();
 await page.evaluate(()=>window.__supportUI.setActor('owner_b','session_b'));
 await page.waitForFunction(()=>window.__recordedActualMic.getTracks().every(track=>track.readyState==='ended'));
 assert.equal(await page.locator('audio').count(),0);
 await page.evaluate(()=>window.__supportUI.setActor('owner_a','session_returned'));
 await page.getByRole('button',{name:'ورود فعلی همین حساب را بررسی و نسخهٔ محلی را باز کنم',exact:true}).click();
 await page.locator('audio[src^="blob:"]').waitFor();await save(page);
 assert.equal(await page.evaluate(()=>window.__supportUI.requests.length),0);
}));
