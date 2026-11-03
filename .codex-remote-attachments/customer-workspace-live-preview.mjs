import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 1536, height: 1050 }, reducedMotion: 'reduce', locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
 let writes = 0;
 page.on('request', r => { if (r.method() !== 'GET' && r.url().includes('/api/accounting/')) writes++; });
 await page.goto('http://127.0.0.1:3000/login');
 await page.evaluate(()=>{localStorage.setItem('theme','light');document.documentElement.classList.remove('dark')});
 await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill('admin');
 await page.locator('input[type="password"]').fill('admin123');
 await page.getByRole('button', { name: 'ورود', exact: true }).click();
 await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60000 });
 const base = 'http://127.0.0.1:3000/dashboard/accounting/customer-accounts/customer%3Acmqmlgrtf000512abdnhdvmpo';
 // Resolve the customer through the existing list instead of relying on an old screenshot ID.
 await page.goto('http://127.0.0.1:3000/dashboard/accounting/customer-accounts');
 const searchResponse = page.waitForResponse(r => r.url().includes('/api/accounting/ledger/customer-accounts?') && r.url().includes('search=') && r.status() === 200);
 await page.getByRole('searchbox', { name: 'جستجوی مشتری', exact: true }).fill('رستگار');
 await searchResponse;
 await expect(page.getByRole('link', { name: 'مشاهده حساب مشتری', exact: true }).first()).toBeVisible();
 await page.getByRole('link', { name: 'مشاهده حساب مشتری', exact: true }).first().click();
 await expect(page.getByRole('heading', { name: 'جمشید رستگار', exact: true })).toBeVisible({timeout:90000});
 const lightToggle = page.getByRole('button',{name:'فعال‌کردن حالت روشن',exact:true}); if(await lightToggle.isVisible()) await lightToggle.click();
 const url = page.url().split('?')[0];
 for(const tab of ['خلاصه','بدهی و اعتبار','دریافت‌ها و چک‌ها','قراردادها','رکوردها و دریافتنی‌ها','ریزگردش','تحلیل']) {
  await page.getByRole('button',{name:new RegExp('^'+tab)}).click();
  await page.screenshot({path:`test-results/accounting-ledger/workspace-live-${['خلاصه','بدهی و اعتبار','دریافت‌ها و چک‌ها','قراردادها','رکوردها و دریافتنی‌ها','ریزگردش','تحلیل'].indexOf(tab)}.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  if (!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)) throw new Error(`Mobile overflow ${tab}`);
  await page.setViewportSize({width:1536,height:1050});
 }
 await page.getByRole('button',{name:'خلاصه',exact:true}).click();
 await page.getByRole('button',{name:/اطلاعات حساب/}).click();
 await expect(page.getByText('قابل استرداد نقدی',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/افتتاحیه بررسی‌شده/}).click();
 await expect(page.getByText('مانده کل تأییدشده',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'سایر عملیات',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'عملیات حساب'}).getByRole('button',{name:'تطبیق انتساب افتتاحیه',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'دریافت‌ها و چک‌ها',exact:true}).click();
 await page.getByRole('button',{name:'جزئیات بدهی',exact:true}).first().click();
 await expect(page.getByRole('dialog',{name:'جزئیات بدهی / اعتبار'})).toBeVisible();
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>document.body.style.zoom='2');
 if (!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)) throw new Error('200% overflow');
 await page.screenshot({path:'test-results/accounting-ledger/workspace-live-mobile-zoom.png',fullPage:true});
 if(writes) throw new Error(`${writes} financial writes`);
 console.log('Live customer: seven tabs, mobile/zoom, opening, attribution action, receipt trace and detail verified; zero financial writes.');
} finally {await browser.close();}
