import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../backend/node_modules/@prisma/client';
import { createAuthoritativeSession, SESSION_COOKIE } from '../../backend/src/services/identitySessionService';
import { assertNoHorizontalOverflow, setViewportAndZoom, setTheme } from './support/design-system';
import AxeBuilder from '@axe-core/playwright';

const db = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10' } } });
let actorId: string, token: string;
test.beforeAll(async () => {
  const key = randomUUID();
  const actor = await db.user.create({ data: { username: `qa-purchase-${key}`, email: `${key}@example.invalid`, password: 'unused', firstName: 'آزمون', lastName: 'رابط خرید', role: 'ADMIN' } });
  actorId = actor.id;
  token = (await createAuthoritativeSession(db, actorId, { userAgent: 'Purchasing real local UI QA' })).token;
});
test.afterAll(async () => {
  try { if (actorId) { await db.authSession.deleteMany({ where: { userId: actorId } }); await db.recognizedBrowserProfile.deleteMany({ where: { userId: actorId } }); await db.user.delete({ where: { id: actorId } }); } }
  finally { await db.$disconnect(); }
});
test('real purchasing uses shared workspace cards and compact centered Persian forms', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('crash',()=>failures.push('Browser page crashed'));
  page.on('requestfailed',r=>console.log('Purchasing QA request failed:',new URL(r.url()).pathname,r.failure()?.errorText));
  await page.context().addCookies([{ name: SESSION_COOKIE, value: token, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  await page.goto('/dashboard/purchasing');
  await expect(page.getByRole('button', { name: 'استعلام جدید', exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('group', { name: 'گزینه‌ها', exact: true })).toHaveCount(1);
  await expect(page.locator('nav').getByRole('link', { name: 'استعلام‌های ثبت‌شده', exact: true })).toHaveAttribute('href', '/dashboard/purchasing/inquiries');
  await expect(page.locator('[data-dashboard-main]').getByRole('link',{name:'استعلام‌های ثبت‌شده',exact:true})).toHaveAttribute('href','/dashboard/purchasing/inquiries');
  await expect(page.locator('.sds-neumorphic-scope').first()).toBeVisible();
  for(const [label,section,title] of [['درخواست نیازمند تأمین در فهرست','requests','درخواست‌ها'],['سفارش منتظر دریافت در فهرست','orders','سفارش‌های خرید'],['رسید منتظر کیفیت در فهرست','receipts','دریافت بار']]){
    const card=page.getByRole('link').filter({hasText:label});
    await expect(card).toHaveAttribute('href',`/dashboard/purchasing/${section}?view=attention`);
    await card.focus();await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/dashboard/purchasing/${section}\\?view=attention$`));
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    for(const target of ['requests','orders','receipts'])await expect(page.locator(`[data-dashboard-main] a[href="/dashboard/purchasing/${target}?view=attention"]`)).toBeVisible();
    await expect(page.getByRole('combobox',{name:'وضعیت پرونده',exact:true})).toContainText(section==='requests'?'نیازمند تأمین':section==='orders'?'منتظر دریافت':'منتظر بررسی کیفیت');
    await page.goto('/dashboard/purchasing');
    await expect(page.getByRole('button',{name:'استعلام جدید',exact:true})).toBeVisible();
  }
  await page.locator('[data-dashboard-main] a[href="/dashboard/purchasing/requests?view=attention"]').click();
  for(const target of ['orders','receipts','requests']){await page.locator(`[data-dashboard-main] a[href="/dashboard/purchasing/${target}?view=attention"]`).click();await expect(page).toHaveURL(new RegExp(`/dashboard/purchasing/${target}\\?view=attention$`));await expect(page.getByRole('combobox',{name:'وضعیت پرونده',exact:true})).toContainText(target==='requests'?'نیازمند تأمین':target==='orders'?'منتظر دریافت':'منتظر بررسی کیفیت');}
  await page.goto('/dashboard/purchasing');
  for (const theme of ['light', 'dark'] as const) { await setTheme(page, theme); await page.screenshot({ path: `test-results/purchasing-desktop-${theme}.png`, fullPage: true }); }
  await page.screenshot({ path: 'test-results/purchasing-desktop.png', fullPage: true });
  await expect(page.getByRole('textbox',{name:'جست‌وجوی قرارداد',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'قراردادهای فروش',exact:true}).click();
  await expect(page.getByRole('heading',{name:'کارهای باز',exact:true})).toHaveCount(0);
  await page.getByRole('textbox',{name:'جست‌وجوی قرارداد',exact:true}).fill('100312');
  await page.getByRole('button',{name:'انتخاب اقلام قرارداد ۱۰۰۳۱۲',exact:true}).click();
  await expect(page.getByRole('heading',{name:'استعلام جدید',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const entryFields=['نوع کار','خرید برای','مسئول پیگیری خرید'];
  const positions=await Promise.all(entryFields.map(name=>page.getByRole('combobox',{name,exact:true}).boundingBox()));
  expect(Math.max(...positions.map(b=>b!.y))-Math.min(...positions.map(b=>b!.y))).toBeLessThan(4);
  await expect(page.getByRole('textbox',{name:'جست‌وجوی قرارداد',exact:true})).toHaveCount(0);
  const contractPicker=page.getByRole('combobox',{name:'قرارداد',exact:true});await contractPicker.click();
  const noMatch=`qa-no-contract-${randomUUID()}`;
  const searched=page.waitForResponse(r=>r.url().includes('/purchasing/lookups')&&new URL(r.url()).searchParams.get('kind')==='contracts'&&new URL(r.url()).searchParams.get('q')===noMatch);
  await page.getByRole('textbox',{name:'جستجوی گزینه‌ها',exact:true}).fill(noMatch);expect((await searched).status()).toBe(200);
  await page.keyboard.press('Escape');await expect(contractPicker).toContainText('۱۰۰۳۱۲');

  await expect(page.getByRole('button',{name:/ · .* ردیف/}).first()).toBeVisible();
  for(const group of await page.getByRole('button',{name:/ · .* ردیف/}).all())await group.click();
  const choices=page.getByRole('checkbox').filter({hasNot:page.locator('[disabled]')});
  await choices.nth(0).check();
  // The next selected contract line stays independent, even for the same stone.
  await page.getByRole('checkbox').filter({visible:true}).nth(2).check();
  await expect(page.getByLabel(/مقدار محصول نهایی موردنیاز/)).toHaveCount(2);
  for(const theme of ['light','dark'] as const){await setTheme(page,theme);await page.screenshot({path:`test-results/purchasing-contract-start-${theme}.png`,fullPage:true});}
  await page.setViewportSize({width:390,height:844});await assertNoHorizontalOverflow(page);
  await setViewportAndZoom(page,{width:1440,height:1000},2);await assertNoHorizontalOverflow(page);
  await page.goto('/dashboard/purchasing/receipts');
  await page.getByRole('button',{name:'ثبت دریافت بار',exact:true}).click();
  const modal = page.getByRole('dialog', { name: 'دریافت بار', exact: true });
  await expect(modal).toBeVisible();
  await expect.poll(async () => { const b = await modal.boundingBox(); return b ? Math.abs(b.y + b.height / 2 - page.viewportSize()!.height / 2) : 999; }).toBeLessThan(2);
  const box = await modal.boundingBox(), viewport = page.viewportSize()!;
  expect(box).toBeTruthy(); expect(box!.width).toBeLessThan(800);
  expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(5);
  expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(5);
  await page.screenshot({ path: 'test-results/purchasing-request-desktop.png' });
  await modal.getByLabel(/مقدار بار رسیده/).fill('');
  await modal.getByRole('button', { name: 'ثبت دریافت بار', exact: true }).click();
  await expect(modal.getByText(/مقدار|سفارش خرید را/).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await assertNoHorizontalOverflow(page);
  await expect(modal).toBeVisible();
  for (const theme of ['light', 'dark'] as const) { await setTheme(page, theme); await page.screenshot({ path: `test-results/purchasing-request-mobile-${theme}.png` }); }
  await page.screenshot({ path: 'test-results/purchasing-request-mobile.png' });
  const violations = (await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations;
  expect(violations).toEqual([]);
  await setViewportAndZoom(page, { width: 1440, height: 1000 }, 2); await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/purchasing-request-zoom.png' });
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
  if(await page.getByRole('button',{name:'بازکردن منو',exact:true}).isVisible())await page.getByRole('button',{name:'بازکردن منو',exact:true}).click();
  const sectionTitles:Record<string,string>={inquiries:'استعلام‌های ثبت‌شده',orders:'سفارش‌های خرید',receipts:'دریافت بار',exchanges:'تعویض‌ها',suppliers:'تأمین‌کنندگان',inventory:'بارهای پذیرفته‌شده',finance:'پیگیری حسابداری',changes:'تغییر و لغو'};
  for (const section of ['inquiries', 'orders', 'receipts', 'exchanges', 'suppliers', 'inventory', 'finance', 'changes']) {
    console.log('Purchasing QA section:',section);
    if(section!=='inquiries'&&!await page.locator(`nav a[href="/dashboard/purchasing/${section}"]`).isVisible())await page.getByRole('button',{name:/سوابق و جزئیات/}).click();
    await page.locator(`nav a[href="/dashboard/purchasing/${section}"]`).click();
    await page.waitForURL(`**/dashboard/purchasing/${section}`);
    await expect(page.getByRole('heading',{name:sectionTitles[section],exact:true})).toBeVisible();
    await expect(page.getByRole('button', { name: 'به‌روزرسانی', exact: true })).toBeVisible();
    await expect(page.getByText('فضای خرید قابل دریافت نیست', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('group', { name: 'گزینه‌ها', exact: true })).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  }
  await page.goto('/dashboard/purchasing/orders');
  await page.getByRole('button',{name:'سفارش خرید جدید',exact:true}).click();
  const order=page.getByRole('dialog',{name:'سفارش خرید',exact:true});
  await order.getByRole('combobox',{name:'تأمین‌کننده',exact:true}).click();
  const supplierSearch=page.getByRole('textbox',{name:'جستجوی گزینه‌ها',exact:true});
  const query=`qa-not-a-supplier-${randomUUID()}`;
  const supplierRead=page.waitForResponse(r=>r.url().includes('/purchasing/lookups')&&new URL(r.url()).searchParams.get('q')===query);
  await supplierSearch.fill(query);
  expect((await supplierRead).status()).toBe(200);
  await expect(page.getByText('نتیجه‌ای پیدا نشد',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(failures).toEqual([]);
});
