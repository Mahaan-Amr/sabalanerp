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
 for (const variant of ['A','B','C']) {
  await page.goto(`${url}?variant=${variant}`);
  await expect(page.getByText('نمونه طراحی با اطلاعات همین پرونده؛ عملیات این نما فقط شبیه‌سازی می‌شوند.')).toBeVisible({timeout:90000});
  await page.screenshot({path:`test-results/accounting-ledger/prototype-${variant}-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw new Error(`Mobile overflow ${variant}`);
  await page.screenshot({path:`test-results/accounting-ledger/prototype-${variant}-mobile.png`,fullPage:true});
  await page.setViewportSize({width:1536,height:1050});
 }
 await page.getByRole('button',{name:'→',exact:true}).click();
 await expect(page).toHaveURL(/variant=A/);
 await page.getByRole('searchbox',{name:'جستجوی قلم یا فاکتور'}).fill('ناموجود');
 await expect(page.getByText('قلمی با این فیلتر وجود ندارد')).toBeVisible();
 await page.keyboard.press('ArrowRight');
 await expect(page).toHaveURL(/variant=A/);
 await page.getByRole('searchbox',{name:'جستجوی قلم یا فاکتور'}).fill('');
 await page.getByRole('button',{name:'ثبت دریافت',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog).toBeVisible();
 await dialog.getByRole('textbox',{name:'مبلغ آزمایشی (ریال)'}).fill('123456789');
 await dialog.getByRole('button',{name:'دیدن خلاصه آزمایشی'}).click();
 await expect(dialog.getByRole('textbox',{name:'مبلغ آزمایشی (ریال)'})).toHaveValue('123,456,789');
 await expect(dialog.getByText(/خلاصه نمونه:/)).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(dialog).not.toBeVisible();
 await page.getByRole('button',{name:'راهنمای رنگ‌ها'}).click();
 await expect(page.getByText('! قرمز: بدهی سررسیدگذشته یا خطای نیازمند رسیدگی')).toBeVisible();
 if(writes) throw new Error(`${writes} unexpected financial writes`);
 console.log(`Verified 3 variants, mobile widths, switcher, search, grouped input and simulated action; zero accounting writes. Preview: ${url}?variant=A`);
} finally { await browser.close(); }




