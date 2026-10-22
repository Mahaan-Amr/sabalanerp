import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {observeNativeNavigation,prepareNativeBrowserForm,persistNativeBrowserFailure,waitForNativeSubmitEnabled,NATIVE_FORM_CONTROLS} from './application-native-browser-readiness.fixture.mjs';
const fixture=await fs.readFile(new URL('./application-native-browser.fixture.mjs',import.meta.url),'utf8').then(text=>text.replaceAll('\r\n','\n'));
function pageFixture({status=200,disabled=false,inheritedDisabled=false,missingSelector=null,submitLocked=false}={}){
 const page=new EventEmitter(),calls=[],values=new Map();
 const isDisabled=selector=>disabled||inheritedDisabled||(selector===NATIVE_FORM_CONTROLS.submit&&(submitLocked||!values.get(NATIVE_FORM_CONTROLS.title)||!values.get(NATIVE_FORM_CONTROLS.description)));
 const node=selector=>({disabled:disabled||(selector===NATIVE_FORM_CONTROLS.submit&&isDisabled(selector)),matches:expression=>{assert.equal(expression,':disabled');return isDisabled(selector);},value:values.get(selector)});
 page.goto=async(url,options)=>{calls.push(['goto',url,options]);page.emit('domcontentloaded');return{status:()=>status};};
 page.waitForSelector=async(selector,options)=>{calls.push(['control',selector,options]);if(selector===missingSelector)throw Error('MISSING_CONTROL');return{evaluate:async callback=>callback(node(selector))};};
 page.type=async(selector,value)=>{calls.push(['type',selector,value]);values.set(selector,value);};page.screenshot=async()=>calls.push(['screenshot']);page.$=async()=>({uploadFile:async()=>calls.push(['upload'])});
 page.$eval=async(selector,callback)=>callback(node(selector));
 page.waitForFunction=async(callback,options,selector)=>{calls.push(['enabled-wait',selector,options]);const document={querySelector:s=>node(s)};assert.equal(vm.runInNewContext('('+callback.toString()+')(selector)',{document,selector}),true);};
 page.waitForResponse=()=>{calls.push(['response-wait']);return Promise.resolve('CREATED_RESPONSE');};
 page.click=async selector=>{assert.equal(isDisabled(selector),false);calls.push(['click',selector]);};
 return{page,calls,isDisabled};
}
function actualFill(page,calls,auth,closed=false){
 const section=fixture.slice(fixture.indexOf('  async function fill('),fixture.indexOf('  async function submit('));
 const context={prepareNativeBrowserForm,until:async check=>{calls.push(['auth']);assert.equal(await check(),true);},origin:'http://localhost:3199',failures:[],inputSelector:NATIVE_FORM_CONTROLS.title,descriptionSelector:NATIVE_FORM_CONTROLS.description,operation:'private',directory:'/private',path,fs:{readFile:async()=>Buffer.from('image')},assert,sha:b=>createHash('sha256').update(b).digest('hex'),evidence:{screenshots:[]}};
 const fill=vm.runInNewContext('('+section.trim().replace('async function fill','async function')+')',context);
 return fill({page,readiness:observeNativeNavigation(page),socketRequests:new Map([['original',{authenticated:auth,closed}]])},'old-before-switch');
}
test('actual fill requires document200, actual controls and authenticated original Socket before typing',async()=>{
 const{page,calls}=pageFixture();await actualFill(page,calls,true);
 assert.equal(calls[0][2].waitUntil,'domcontentloaded');assert.equal(calls[0][2].timeout,60000);
 assert.equal(calls.filter(c=>c[0]==='control').length,5);
 assert.ok(calls.findIndex(c=>c[0]==='auth')<calls.findIndex(c=>c[0]==='type'));
 assert.equal(calls.filter(c=>c[0]==='type').length,2);assert.ok(calls.some(c=>c[0]==='upload'));
});
test('actual fill never types or uploads if actual Socket authentication missing',async()=>{
 const{page,calls}=pageFixture();await assert.rejects(actualFill(page,calls,false));assert.ok(!calls.some(c=>['type','upload'].includes(c[0])));
});
test('HTTP refusal and disabled real control refuse before authentication/typing',async()=>{
 for(const options of[{status:503},{disabled:true},{inheritedDisabled:true},{missingSelector:NATIVE_FORM_CONTROLS.file}]){const{page,calls}=pageFixture(options);await assert.rejects(actualFill(page,calls,true));assert.ok(!calls.some(c=>['type','auth','upload'].includes(c[0])));}
});
test('bounded diagnostics exclude query, fragment, headers, body and error messages',async()=>{
 const p=new EventEmitter(),o=observeNativeNavigation(p);
 for(let i=0;i<300;i++){const r={url:()=>`http://user:SECRET@localhost:3199/private/path?token=SECRET#SECRET`,method:()=> 'GET',headers:()=>{throw Error('must not read');},postData:()=>{throw Error('must not read');}};p.emit('request',r);p.emit('response',{url:r.url,status:()=>200});}
 const v=o.snapshot(),raw=JSON.stringify(v);assert.ok(v.events.length<=128&&v.pending.length<=128&&v.omitted>0);assert.ok(!raw.includes('SECRET')&&!raw.includes('?')&&!raw.includes('#'));
 const d=await fs.mkdtemp(path.join(os.tmpdir(),'native-browser-diagnostic-'));
 try{try{await persistNativeBrowserFailure(d,[{readiness:o}],Object.assign(Error('SECRET'),{name:'TimeoutError'}));}catch(error){assert.equal(process.platform,'win32');assert.equal(error.code,'EPERM');}const bytes=await fs.readFile(path.join(d,'navigation-failure.json'));assert.ok(bytes.length<=128*1024);assert.ok(!bytes.includes(Buffer.from('SECRET')));assert.equal(JSON.parse(bytes).qualificationSucceeded,false);}finally{await fs.rm(d,{recursive:true});}
});
test('actual failure handler writes before cleanup; diagnostic and cleanup failures preserve ORIGINAL error',async()=>{
 const primary=Error('ORIGINAL'),calls=[];
 const start=fixture.indexOf('  } catch(error) {\n    primaryFailure=error;');assert.ok(start>0);
 const tail=fixture.slice(start,fixture.lastIndexOf('\n}'));
 const context={primary,calls,directory:'/private',tabs:[],primaryFailure:undefined,browser:{close:async()=>{calls.push('close');throw Error('CLEANUP');}},persistNativeBrowserFailure:async()=>{calls.push('diagnostic');throw Error('DIAGNOSTIC');},closeNetworkClient:async()=>calls.push('socket-close'),pending:new Set()};
 const task=vm.runInNewContext('(async()=>{try{throw primary;'+tail+'})()',context);
 await assert.rejects(task,error=>error===primary);assert.deepEqual(calls,['diagnostic','close','socket-close']);
});
test('all other original business assertions retained in controlled fixture delta',()=>{
 for(const marker of ['oldFormSubmittedAfterSwitch=true','newFormSubmittedOnNewSlot=true','actual compiled Socket must remain open across capture','readSocketPending','fullSalesContractIssuanceQualified:false','86400000','await submit(old,draft);await submit(newer,newDraft);'])assert.ok(fixture.includes(marker),marker);
});

function actualSubmitClickPrefix(page,draft){
 const start=fixture.indexOf('  async function submit('),end=fixture.indexOf('const body=await response.json()',start);
 assert.ok(start>0&&end>start);
 const prefix=fixture.slice(start,end);
 const context={assert,inputSelector:NATIVE_FORM_CONTROLS.title,descriptionSelector:NATIVE_FORM_CONTROLS.description,waitForNativeSubmitEnabled,URL};
 const submit=vm.runInNewContext('('+prefix.trim().replace('async function submit','async function')+'return response;})',context);
 return submit({page},draft);
}
test('actual fill permits initially disabled submit; actual submit gates enabled only after valid fields',async()=>{
 const {page,calls,isDisabled}=pageFixture();assert.equal(isDisabled(NATIVE_FORM_CONTROLS.submit),true);
 const draft=await actualFill(page,calls,true);assert.equal(isDisabled(NATIVE_FORM_CONTROLS.submit),false);
 assert.equal(await actualSubmitClickPrefix(page,draft),'CREATED_RESPONSE');
 const type=calls.findIndex(c=>c[0]==='type'),gate=calls.findIndex(c=>c[0]==='enabled-wait'),click=calls.findIndex(c=>c[0]==='click');
 assert.ok(type>=0&&gate>type&&click>gate);assert.equal(calls.filter(c=>c[0]==='click').length,1);
 assert.equal((fixture.match(/page\.click\('form button\[type="submit"\]'\)/g)||[]).length,1);
});
test('actual submit does not click when later locked or inherited-disabled',async()=>{
 const {page,calls}=pageFixture({submitLocked:true});const draft=await actualFill(page,calls,true);
 await assert.rejects(actualSubmitClickPrefix(page,draft));assert.ok(!calls.some(c=>c[0]==='click'||c[0]==='response-wait'));
 const inherited=pageFixture({inheritedDisabled:true});await assert.rejects(waitForNativeSubmitEnabled(inherited.page));assert.ok(!inherited.calls.some(c=>c[0]==='click'));
});
test('closed authenticated compiled Socket refuses before typing/upload',async()=>{
 const {page,calls}=pageFixture();await assert.rejects(actualFill(page,calls,true,true));assert.ok(!calls.some(c=>['type','upload'].includes(c[0])));
});

const submitStart=fixture.indexOf('  async function submit(tab,draft) {'),submitEnd=fixture.indexOf('\n  try {',submitStart);
assert.ok(submitStart>=0&&submitEnd>submitStart);
const submitBody=fixture.slice(submitStart,submitEnd);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function harness({response,click}){
 const calls=[],evidence={tickets:[]},fixture={title:'title',description:'description',sha256:'sha'};
 const page={$eval:async(selector)=>selector==='title'?'title':selector==='description'?'description':'http://localhost:3199/api/support-tickets/attachments/x',waitForResponse:(predicate,options)=>{calls.push('response');assert.equal(options.timeout,60000);assert.equal(predicate({url:()=> 'http://localhost:3199/api/support-tickets',request:()=>({method:()=> 'POST'})}),true);return response;},click:selector=>{calls.push('click');assert.equal(selector,'form button[type="submit"]');return click();},waitForFunction:async()=>{},waitForSelector:async()=>{},evaluate:async()=>({sha256:'sha',bytes:3})};
 const tab={page,artifact:{buildId:'old'},actor:{slotId:'slot'}};
 const context={assert,URL,Promise,inputSelector:'title',descriptionSelector:'description',waitForNativeSubmitEnabled:async()=>calls.push('enabled'),origin:'http://localhost:3199',uiArtifacts:{new:{}},evidence};
 const submit=vm.runInNewContext('('+submitBody.trim()+')',context);return{run:()=>submit(tab,fixture),calls,evidence};
}
const goodResponse=()=>({status:()=>201,json:async()=>({data:{id:'id',title:'title'}})});
test('response rejection is owned immediately while actual click remains pending',async()=>{
 const response=deferred(),click=deferred(),error=Error('response timeout'),h=harness({response:response.promise,click:()=>click.promise});
 const run=h.run();const observed=assert.rejects(run,e=>e===error);await new Promise(setImmediate);response.reject(error);
 await Promise.race([observed,new Promise((_,reject)=>setTimeout(()=>reject(Error('submit waited for blocked click')),100))]);
 click.resolve();assert.deepEqual(h.calls,['enabled','response','click']);assert.equal(h.evidence.tickets.length,0);
});
test('click rejection joins response before a later response rejection',async()=>{
 const response=deferred(),error=Error('click failed'),h=harness({response:response.promise,click:()=>Promise.reject(error)});
 await assert.rejects(h.run(),e=>e===error);response.reject(Error('late response timeout'));await new Promise(setImmediate);assert.equal(h.evidence.tickets.length,0);
});
test('synchronous click failure still owns the response promise',async()=>{
 const response=deferred(),error=Error('sync click failed'),h=harness({response:response.promise,click:()=>{throw error;}});
 await assert.rejects(h.run(),e=>e===error);response.reject(Error('late response timeout'));await new Promise(setImmediate);
});
test('successful actual submit retains201/title/attachment/build/slot evidence',async()=>{
 const h=harness({response:Promise.resolve(goodResponse()),click:async()=>{}});await h.run();assert.equal(h.evidence.tickets.length,1);assert.equal(h.evidence.tickets[0].backendSlotId,'slot');assert.equal(h.evidence.tickets[0].screenshotSha256,'sha');
});
test('non201 actual business response remains rejected',async()=>{
 const bad=goodResponse();bad.status=()=>500;const h=harness({response:Promise.resolve(bad),click:async()=>{}});await assert.rejects(h.run());assert.equal(h.evidence.tickets.length,0);
});
