import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,test} from '@playwright/test';
import {assertNoHorizontalOverflow,assertNoSeriousAxeViolations,setTheme,setViewportAndZoom} from './support/design-system';

// Compiled Next/SDS acceptance with controlled auth/API boundaries, matching
// other catalog UI lanes. This does not qualify native auth or server writes.
// Run only against the measured final bdbe image in the existing local project.
const buildId='erp_online_final_20261019_bdbe201e523baab8';
const asset='/_next/static/chunks/app/dashboard/support/new/page-8d6f1034aa11002c.js';
const assetSha='3677223b7e5724863297ccfc8ec40cc1e86a0beeef91e421b919ecc16ee69ebd';
test('final compiled Support preserves original bytes and explicit recovery at desktop,390px and canonical200percent zoom',async({page},info)=>{
 test.setTimeout(180_000);
 const errors:string[]=[],mutations:string[]=[];
 const consoleErrors:string[]=[],apiRequests:Array<{method:string;path:string;elapsedMs:number}>=[],failedRequests:Array<{path:string;error:string|null}>=[];
 const started=Date.now();
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&consoleErrors.length<20)consoleErrors.push(message.text().slice(0,1500));});
 page.on('requestfailed',request=>{if(failedRequests.length<64)failedRequests.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText||null});});
 try{
 const user={id:'support_compiled_qa',username:'support-compiled',firstName:'آزمون',lastName:'پشتیبانی',role:'ADMIN',isActive:true,
  permissions:{features:[],workspaces:[]}};
 await page.route('**/socket.io/**',route=>route.abort());
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(apiRequests.length<64)apiRequests.push({method:request.method(),path,elapsedMs:Date.now()-started});
  if(!['GET','HEAD','OPTIONS'].includes(request.method())){
   mutations.push(request.method()+' '+path);return route.fulfill({status:409,json:{success:false,error:'UI_ACCEPTANCE_MUST_NOT_MUTATE'}});
  }
  const send=(data:unknown,extra={})=>route.fulfill({json:{success:true,data,...extra}});
  if(path==='/api/auth/me')return send(user,{session:{id:'support_compiled_session'}});
  if(path==='/api/dashboard/profile')return send(user);
  if(path==='/api/dashboard/route-availability')return send({allowed:true});
  if(path==='/api/system-recovery/environment')return send({sanitizedEnvironment:true});
  if(path==='/api/support-tickets/context')return send({workspaces:[],features:[]});
  if(path.includes('/personnel-performance/badge/me'))return send(null,{badge:null});
  if(path.endsWith('/notifications/unread-count'))return send({count:0});
  return send([]);
 });
 const response=await page.goto('/dashboard/support/new');expect(response?.ok()).toBe(true);
 expect(await response!.text()).toContain(buildId);
 expect(await page.evaluate(()=>window.isSecureContext),'Archive requires genuine localhost/HTTPS, never an insecure-origin flag').toBe(true);
 const compiled=await page.request.get(asset);expect(compiled.ok()).toBe(true);
 expect(createHash('sha256').update(await compiled.body()).digest('hex')).toBe(assetSha);
 await expect(page.getByRole('button',{name:'حفظ پیش‌نویس',exact:true})).toBeEnabled({timeout:8_000});
 const title='درخواست اصلی برای بازیابیِ آگاهانه';
 await page.getByRole('textbox',{name:'عنوان',exact:true}).fill(title);
 await page.getByRole('textbox',{name:'شرح مشکل',exact:true}).fill('اصل نوشتهٔ فارسی؛ ارسال فقط با تصمیم کاربر انجام می‌شود.');
 const bytes=Buffer.alloc(17*1024*1024+3,32);Buffer.from('%PDF-1.4\n% compiled original evidence\n').copy(bytes);bytes[bytes.length-1]=255;
 await page.locator('input[type=file][accept=".pdf,.docx,.xlsx,.txt"]').setInputFiles({name:'اصل سند پشتیبانی.pdf',mimeType:'application/pdf',buffer:bytes});
 await page.getByRole('button',{name:'حفظ پیش‌نویس',exact:true}).click();
 await expect(page.getByText('نوشته‌ها و فایل‌های همین نسخه در این مرورگر محفوظ است.',{exact:true})).toBeVisible({timeout:60_000});
 const matrix=[{width:1280,height:900,zoom:1},{width:390,height:844,zoom:1},{width:390,height:844,zoom:2}];
 for(const theme of ['light','dark']as const)for(const size of matrix){
  await setTheme(page,theme);await setViewportAndZoom(page,size,size.zoom);await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);
  await page.getByRole('button',{name:'نسخه‌های محفوظ این حساب',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'بازیابی درخواست پشتیبانی'});await expect(sheet).toBeVisible();
  await sheet.getByRole('checkbox').check();await expect(sheet.getByRole('button',{name:'بازیابی این نسخه',exact:true}).first()).toBeDisabled();
  await assertNoHorizontalOverflow(page);await assertNoSeriousAxeViolations(page);
  await page.screenshot({path:info.outputPath(`support-recovery-${theme}-${size.width}-${size.zoom}x.png`),fullPage:true});
  await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
  await expect(page.getByRole('button',{name:'نسخه‌های محفوظ این حساب',exact:true})).toBeFocused();
 }
 await setViewportAndZoom(page,{width:1280,height:900});
 await page.reload();await expect(page.getByRole('textbox',{name:'عنوان',exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'نسخه‌های محفوظ این حساب',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'بازیابی درخواست پشتیبانی'});
 await sheet.getByRole('checkbox').check();await sheet.getByRole('button',{name:'بازیابی این نسخه',exact:true}).first().click();
 await expect(sheet).toBeHidden();await expect(page.getByRole('textbox',{name:'عنوان',exact:true})).toHaveValue(title);
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'دریافت فایل اصلی',exact:true}).click();
 const file=await(await downloaded).path();expect(file).toBeTruthy();
 expect(createHash('sha256').update(fs.readFileSync(file!)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
 expect(mutations).toEqual([]);expect(errors).toEqual([]);
 }finally{
  await info.attach('support-source-errors-and-network',{body:JSON.stringify({elapsedMs:Date.now()-started,errors,consoleErrors,apiRequests,failedRequests}),contentType:'application/json'});
 }
});
