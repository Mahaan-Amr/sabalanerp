import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkTechnicalForms(page, output, theme, width) {
  await page.goto('http://127.0.0.1:3000/__partner330-fixture?technical');
  await page.getByRole('heading', { name: 'پیش‌نمایش فنی بدون قیمت' }).waitFor();
  const operations = page.getByRole('region', { name: 'عملیات فنی' });
  await operations.getByRole('button', { name: 'تغییر مقدار', exact: true }).click();
  const override = operations.getByRole('textbox', { name: 'مقدار نیم لول', exact: true });
  await override.fill('3');
  await override.press('Tab');
  await operations.getByText('3m', { exact: true }).waitFor();
  await operations.getByRole('button', { name: 'تغییر طول برای آزمون' }).click();
  await operations.getByRole('button', { name: 'حفظ مقدار دستی' }).click();
  await operations.getByText('3m', { exact: true }).waitFor();
  // Keeping this edit must not silently approve future geometry changes.
  await operations.getByRole('button', { name: 'تغییر طول برای آزمون' }).click();
  await operations.getByRole('button', { name: 'استفاده از محاسبه' }).click();
  await operations.getByText('6m', { exact: true }).waitFor();
  if (await override.isVisible()) {
    await override.focus();
    await override.press('Tab');
  }
  await operations.getByText('6m', { exact: true }).waitFor();
  const long = page.getByRole('region', { name: 'سنگ طولی فنی' });
  await long.getByRole('textbox', { name: 'مترمربع', exact: true }).fill('1.6');
  await long.getByRole('textbox', { name: 'مترمربع', exact: true }).press('Tab');
  // Existing longitudinal semantics retain width and derive length from area.
  await long.getByText('8 × 2m × 10cm', { exact: true }).waitFor();
  const slab = page.getByRole('region', { name: 'اسلب فنی' });
  await slab.getByText('1 اسلب کامل', { exact: true }).waitFor();
  await slab.getByRole('switch', { name: 'خوراک اره', exact: true }).click();
  await slab.getByText('2 اسلب', { exact: true }).waitFor();
  await slab.getByRole('textbox', { name: 'طول نهایی', exact: true }).fill('نامعتبر');
  await slab.getByRole('textbox', { name: 'طول نهایی', exact: true }).press('Tab');
  assert.equal(await slab.getByRole('textbox', { name: 'طول نهایی', exact: true }).inputValue(), 'نامعتبر');
  assert.doesNotMatch(await page.locator('body').innerText(), /نرخ ثبت نشده|فی هر مترمربع|درصد حکمی|روش محاسبه برش/);
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await operations.getByRole('button', { name: 'تغییر مقدار', exact: true }).click();
  await page.screenshot({ path: path.join(output, `${theme}-${width}-technical.png`), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
}
