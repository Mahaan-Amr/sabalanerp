import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export const NATIVE_FORM_CONTROLS=Object.freeze({title:'form input[maxlength="180"]',description:'form textarea[maxlength="10000"]',file:'form input[type="file"][accept="image/jpeg,image/png,image/webp"]',submit:'form button[type="submit"]'});
export const NATIVE_IMAGE_UPLOAD_LABEL='form label:has(input[type="file"][accept="image/jpeg,image/png,image/webp"])';
const safePath=value=>{try{return new URL(value).pathname.slice(0,256);}catch{return '[invalid-url]';}};
export function observeNativeNavigation(page){
 const pending=new Map(),events=[];let omitted=0;
 const lifecycle={domcontentloaded:false,load:false};const controls=Object.fromEntries(Object.keys(NATIVE_FORM_CONTROLS).map(k=>[k,null]));
 const record=row=>{if(events.length<128)events.push(row);else omitted++;};
 page.on('domcontentloaded',()=>{lifecycle.domcontentloaded=true;});page.on('load',()=>{lifecycle.load=true;});
 page.on('request',request=>{const row={path:safePath(request.url()),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method())?request.method():'OTHER'};if(pending.size<128)pending.set(request,row);else omitted++;record({event:'request',...row});});
 page.on('response',response=>{const status=response.status();record({event:'response',path:safePath(response.url()),status:Number.isInteger(status)&&status>=100&&status<=599?status:null});});
 for(const event of ['requestfinished','requestfailed'])page.on(event,request=>{const row=pending.get(request);pending.delete(request);if(row)record({event,...row});});
 return {markControl:name=>{controls[name]=true;},snapshot:()=>({lifecycle:{...lifecycle},controls:{...controls},pending:[...pending.values()].map(v=>({...v})),events:events.map(v=>({...v})),omitted})};
}
export async function prepareNativeBrowserForm(page,origin,observation,waitForAuthenticatedSocket){
 const response=await page.goto(origin+'/dashboard/support/new',{waitUntil:'domcontentloaded',timeout:60000});
 assert.equal(response?.status(),200);
 for(const[name,selector]of Object.entries(NATIVE_FORM_CONTROLS)){const handle=await page.waitForSelector(selector,{visible:name!=='file',timeout:30000});
  if(name!=='submit')assert.equal(await handle.evaluate(node=>!node.matches(':disabled')),true);
  if(name==='file')await page.waitForSelector(NATIVE_IMAGE_UPLOAD_LABEL,{visible:true,timeout:30000});
  observation.markControl(name);}
 await waitForAuthenticatedSocket();
 return response;
}
export async function persistNativeBrowserFailure(directory,tabs,error){
 const raw=Buffer.from(JSON.stringify({format:'sabalan-native-browser-failure-diagnostic/v1',productionAdmission:false,qualificationSucceeded:false,errorName:['TimeoutError','AssertionError','Error'].includes(error?.name)?error.name:'OTHER',tabs:tabs.slice(0,2).map(tab=>tab.readiness.snapshot())})+'\n');
 assert.ok(raw.length<=128*1024);const file=path.join(directory,'navigation-failure.json');const handle=await fs.open(file,'wx',0o600);
 try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
 const parent=await fs.open(directory,'r');try{await parent.sync();}finally{await parent.close();}
}

export async function waitForNativeSubmitEnabled(page){
 const selector=NATIVE_FORM_CONTROLS.submit;
 await page.waitForSelector(selector,{visible:true,timeout:30000});
 await page.waitForFunction(selector=>{const node=document.querySelector(selector);return Boolean(node)&&!node.matches(':disabled');},{timeout:30000},selector);
 assert.equal(await page.$eval(selector,node=>!node.matches(':disabled')),true);
}
