import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '../../backend/node_modules/@prisma/client';
import {createAuthoritativeSession,SESSION_COOKIE} from '../../backend/src/services/identitySessionService';
import {assertNoHorizontalOverflow,setTheme} from './support/design-system';
const db=new PrismaClient({datasources:{db:{url:'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10'}}});
const internal=randomUUID(),stone='تراورتن نمونه بررسی تجربه استعلام';
let actorId='',token='',caseId='',lineId='',supplierId='';
test.beforeAll(async()=>{
 const actor=await db.user.create({data:{username:`qa-quote-ux-${internal}`,email:`${internal}@example.invalid`,password:'unused',role:'ADMIN',firstName:'آزمایش',lastName:'کاربری استعلام'}});actorId=actor.id;
 token=(await createAuthoritativeSession(db,actorId,{userAgent:'Local quotation usability QA'})).token;
 const supplier=await db.purchasingSupplier.create({data:{name:`کارخانه نمونه · ${internal}`,identityKey:`QA-UX:${internal}`,contact:'آزمایش محلی',createdBy:actorId}});supplierId=supplier.id;
 const parent=await db.purchasingDocument.create({data:{kind:'INQUIRY_CASE',ownerId:actorId,creatorId:actorId,data:{reason:'market',title:`استعلام مستقل ${internal}`,lineIds:[]}}});caseId=parent.id;
 const line=await db.purchasingDocument.create({data:{kind:'INQUIRY',parentId:caseId,ownerId:actorId,creatorId:actorId,data:{reason:'market',stone,unit:'مترمربع',quantity:'1234567.125',specKey:`QA-UX:${internal}`,technical:{},selection:[],offers:[{id:randomUUID(),supplierId,supplierName:supplier.name,price:'1000000',quantity:'1234567.125',capacity:'estimate',status:'VALID',variant:'نقدی',recordedAt:new Date().toISOString(),validUntil:null}]}}});lineId=line.id;
 await db.purchasingDocument.update({where:{id:caseId},data:{data:{reason:'market',title:`استعلام مستقل ${internal}`,lineIds:[lineId]}}});
});
test.afterAll(async()=>{try{
 if(lineId)await db.purchasingDocument.deleteMany({where:{id:lineId,creatorId:actorId}});
 if(caseId)await db.purchasingDocument.deleteMany({where:{id:caseId,creatorId:actorId}});
 if(supplierId)await db.purchasingSupplier.delete({where:{id:supplierId}});
 if(actorId){await db.authSession.deleteMany({where:{userId:actorId}});await db.recognizedBrowserProfile.deleteMany({where:{userId:actorId}});await db.user.delete({where:{id:actorId}});}
}finally{await db.$disconnect();}});
test.beforeEach(async({page})=>{await page.context().addCookies([{name:SESSION_COOKIE,value:token,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);});
test('readable inquiry names, contextual proposal action, exact grouped input and one-level details',async({page},info)=>{
 await page.goto(`/dashboard/purchasing/inquiries?document=${caseId}`);
 await expect(page.getByRole('heading',{name:`${stone} · استعلام مستقل`,exact:true})).toBeVisible();
 await expect(page.getByText('مقدار: ۱,۲۳۴,۵۶۷.۱۲۵ مترمربع',{exact:true})).toBeVisible();
 await expect(page.locator('[data-dashboard-main]')).not.toContainText(internal);
 await page.getByRole('button',{name:'ادامه',exact:true}).click();
 await expect(page.getByRole('heading',{name:stone,exact:true})).toBeVisible();
 await expect(page.getByText('هر مترمربع: ۱,۰۰۰,۰۰۰',{exact:true}).filter({visible:true})).toBeVisible();
 await expect(page.locator('[data-dashboard-main]')).not.toContainText(internal);
 const action=page.getByRole('button',{name:'ثبت پیشنهاد تأمین‌کننده',exact:true});
 expect((await action.boundingBox())!.x).toBeGreaterThan(page.viewportSize()!.width/2);
 await page.getByRole('button',{name:/^جزئیات و سوابق/}).click();
 await expect(page.getByLabel('تصویر یا PDF، حداکثر ۱۰ مگابایت',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^تصاویر و مدارک/})).toHaveCount(0);
 await action.click();const modal=page.getByRole('dialog',{name:'پیشنهاد تأمین‌کننده',exact:true});
 await expect(modal.getByRole('combobox',{name:'مقدار اعلام‌شده',exact:true})).toHaveCount(0);
 await expect(modal.getByText('ظرفیت تقریبی تأمین',{exact:true})).toHaveCount(0);
 const price=modal.getByRole('textbox',{name:'نرخ هر مترمربع (تومان)',exact:true}),amount=modal.getByRole('textbox',{name:'مقدار قابل تأمین',exact:true});
 await price.fill('1000000');await expect(price).toHaveValue('1,000,000');
 await amount.fill('۱۲۳۴۵۶۷.۱۲۳۴۵۶۷۸۹');await expect(amount).toHaveValue('1,234,567.123456789');
 await expect(modal.getByRole('combobox',{name:'وضعیت همین پیشنهاد جدید',exact:true})).toContainText('معتبر؛ تأمین‌کننده امکان تأمین دارد');
 await modal.getByRole('button',{name:/^حمل، موعد و شرایط پرداخت/}).click();
 const variant=modal.getByRole('combobox',{name:'نوع پیشنهاد پرداخت',exact:true});await variant.click();
 await page.getByRole('option',{name:'چکی',exact:true}).click();await expect(variant).toContainText('چکی');
 await expect(modal.getByRole('textbox',{name:'عنوان گزینه، مانند نقدی یا چکی',exact:true})).toHaveCount(0);

 await modal.getByRole('button',{name:/^ارتباط با پیشنهاد قبلی/}).click();
 await expect(modal.getByRole('combobox',{name:'پیشنهادی که این پیشنهاد جدید جایگزین آن می‌شود',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('proposal-desktop.png')});
 await page.setViewportSize({width:390,height:844});await assertNoHorizontalOverflow(page);
 await setTheme(page,'dark');await page.screenshot({path:info.outputPath('proposal-mobile-dark.png')});
 await page.keyboard.press('Escape');
 expect((await db.purchasingDocument.findUniqueOrThrow({where:{id:lineId}})).data).toHaveProperty('offers.0.price','1000000');
 const saved=await db.purchasingDocument.findUniqueOrThrow({where:{id:lineId}});
 await db.purchasingDocument.update({where:{id:lineId},data:{data:{...(saved.data as Record<string,unknown>),reason:'stock'}}});
 await page.goto(`/dashboard/purchasing/inquiries?document=${lineId}`);await expect(page.getByRole('checkbox',{name:/انتخاب پیشنهاد کارخانه نمونه/}).filter({visible:true})).toBeVisible();
 await expect(page.locator('[data-dashboard-main]')).not.toContainText(internal);
 await expect(page.getByRole('textbox',{name:'مقدار خرید (مترمربع)',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^مقدار و تبدیل/})).toHaveCount(0);
});
test('catalog reuses Sales families with server filtering and readable list titles',async({page},info)=>{
 await page.goto('/dashboard/purchasing');await page.getByRole('button',{name:'استعلام جدید',exact:true}).click();
 await page.getByRole('combobox',{name:'نوع کار',exact:true}).click();await page.getByRole('option',{name:'استعلام مستقل قیمت',exact:true}).click();
 const typeBox=await page.getByRole('combobox',{name:'نوع کار',exact:true}).boundingBox(),ownerBox=await page.getByRole('combobox',{name:'مسئول پیگیری خرید',exact:true}).boundingBox();expect(Math.abs(typeBox!.y-ownerBox!.y)).toBeLessThan(4);
 await expect(page.getByRole('combobox',{name:'خرید برای',exact:true})).toHaveCount(0);
 for(const [family,name] of [['longitudinal','طولی'],['stair','پله'],['slab','اسلب'],['prepared','آماده']]){
   const tab=page.getByRole('tab',{name,exact:true});await expect(tab).toBeVisible();
   const read=page.waitForResponse(r=>r.url().includes('/purchasing/catalog')&&new URL(r.url()).searchParams.get('family')===family);
   await tab.click();expect((await read).status()).toBe(200);await expect(tab).toHaveAttribute('aria-selected','true');
 }
 await page.screenshot({path:info.outputPath('catalog-categories.png'),fullPage:true});
 page.once('dialog',dialog=>dialog.accept());await page.goto('/dashboard/purchasing/inquiries');
 const row=page.getByRole('row').filter({hasText:`${stone} · استعلام مستقل`});await expect(row).toBeVisible();await expect(row).not.toContainText(internal);
 await page.screenshot({path:info.outputPath('readable-inquiry-list.png'),fullPage:true});
});
