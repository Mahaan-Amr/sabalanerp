import { expect, test } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom } from './support/design-system';

const capabilities = { canManageProfiles: true, canManageCompanyVehicles: true, canManagePlates: true, canManageAssignments: true };
const year = () => Number(new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', timeZone: 'Asia/Tehran' }).formatToParts(new Date()).find(part => part.type === 'year')?.value);

for (const width of [1280, 390]) test(`company vehicle fields preserve plate order and failed-save recovery at ${width}px`, async ({ page }, testInfo) => {
  let createBody: any;
  let plateBody: any;
  const vehicle = { id: 'fixture-vehicle', fleetCode: 'خودروی آزمون', vehicleType: 'سواری', make: null, model: '۲۰۶ تیپ ۲', manufactureYear: null, status: 'DRAFT', plates: [{ plate: '56 ت 786 ایران 87', effectiveFrom: '2026-01-01' }], assignments: [] };
  await page.route('**/api/dispatch-master-data/vehicle-operations/internal-drivers**', route => route.fulfill({ json: { success: true, data: [], capabilities } }));
  await page.route('**/api/dispatch-master-data/company-vehicles**', route => {
    if (route.request().method() === 'POST') {
      if (route.request().url().endsWith('/plates')) plateBody = route.request().postDataJSON();
      else createBody = route.request().postDataJSON();
      return route.fulfill({ status: 400, json: { success: false, error: 'آزمون حفظ اطلاعات پس از خطا' } });
    }
    return route.fulfill({ json: { success: true, data: [vehicle], capabilities } });
  });
  await page.route('**/api/dispatch-master-data/driver-vehicle-assignments', route => route.fulfill({ json: { success: true, data: { assignments: [], plans: [] } } }));
  await loginAsAdmin(page);
  await page.goto('/dashboard/hr/vehicle-operations');
  await setViewportAndZoom(page, { width, height: 1000 });
  await page.getByRole('button', { name: 'خودروهای شرکت', exact: true }).click();
  await expect(page.getByText('مدل ثبت‌شده قبلی: ۲۰۶ تیپ ۲', { exact: false })).toBeVisible();
  const savedPlate = page.locator('[aria-label="56 ت 786 ایران 87"]');
  await expect(savedPlate).toBeVisible();
  const savedParts = await savedPlate.locator('bdi').evaluateAll(parts => parts.map(part => ({ text: part.textContent, x: part.getBoundingClientRect().x })));
  expect(savedParts.map(part => part.text)).toEqual(['56', 'ت', '786', 'ایران', '87']);
  for (let index = 1; index < savedParts.length; index++) expect(savedParts[index].x).toBeGreaterThan(savedParts[index - 1].x);
  expect(await savedPlate.locator('..').evaluate(element => getComputedStyle(element).direction)).toBe('rtl');

  await page.getByRole('button', { name: 'افزودن خودرو', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'افزودن خودروی شرکت' });
  await dialog.getByLabel('کد ناوگان', { exact: true }).fill('QA-FLEET');
  await dialog.getByLabel('نوع خودرو', { exact: true }).fill('سواری');
  await expect(dialog.getByRole('button', { name: 'ثبت خودرو', exact: true })).toBeDisabled();
  const first = dialog.getByRole('textbox', { name: 'پلاک: دو رقم سمت چپ', exact: true });
  const letter = dialog.getByRole('combobox', { name: 'پلاک: حرف', exact: true });
  const serial = dialog.getByRole('textbox', { name: 'پلاک: سه رقم', exact: true });
  const region = dialog.getByRole('textbox', { name: 'پلاک: کد ایران', exact: true });
  await first.fill('۰۱a۲');
  await expect(first).toHaveValue('01');
  await letter.selectOption('ب');
  const arrow = letter.locator('..').locator('svg');
  const arrowBox = await arrow.boundingBox();
  const letterBox = await letter.boundingBox();
  expect(arrowBox!.x - letterBox!.x).toBeGreaterThanOrEqual(10);
  expect(Math.abs((arrowBox!.y + arrowBox!.height / 2) - (letterBox!.y + letterBox!.height / 2))).toBeLessThan(1);
  await serial.fill('۰۲۳۴');
  await expect(serial).toHaveValue('023');
  await region.fill('٠٤');
  await expect(region).toHaveValue('04');
  if (width === 1280) {
    const vinBox = await dialog.getByLabel('شماره شاسی', { exact: true }).boundingBox();
    const plateBox = await dialog.getByRole('group', { name: 'پلاک', exact: true }).boundingBox();
    expect(plateBox!.width).toBeLessThanOrEqual(vinBox!.width + 1);
    expect(Math.abs((await first.boundingBox())!.y - vinBox!.y)).toBeLessThan(2);
  }
  const boxes = await Promise.all([first, letter, serial, region].map(control => control.boundingBox()));
  expect(boxes.every(Boolean)).toBe(true);
  for (let index = 1; index < boxes.length; index++) {
    expect(boxes[index]!.x).toBeGreaterThan(boxes[index - 1]!.x);
    expect(Math.abs(boxes[index]!.y - boxes[0]!.y)).toBeLessThan(2);
  }
  await expect(dialog.getByRole('button', { name: 'ثبت خودرو', exact: true })).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'انتخاب سال ساخت', exact: true }).click();
  const latest = year().toLocaleString('fa-IR', { useGrouping: false });
  await page.getByRole('option', { name: latest, exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'ثبت خودرو', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath(`company-vehicle-${width}.png`) });
  await setViewportAndZoom(page, { width, height: 1000 }, 2);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await setViewportAndZoom(page, { width, height: 1000 });
  await dialog.getByRole('button', { name: 'ثبت خودرو', exact: true }).click();
  await expect(dialog.getByText('آزمون حفظ اطلاعات پس از خطا', { exact: false })).toBeVisible();
  expect(createBody.plate).toBe('01 ب 023 ایران 04');
  expect(createBody.manufactureYear).toBe(year());
  expect(createBody.model).toBeUndefined();
  await expect(first).toHaveValue('01');
  await dialog.getByRole('button', { name: 'انصراف', exact: true }).click();
  await page.getByRole('button', { name: 'عملیات خودرو', exact: true }).click();
  await page.getByRole('button', { name: 'ثبت پلاک جدید', exact: true }).click();
  const replacement = page.getByRole('dialog', { name: 'ثبت پلاک جدید' });
  await replacement.getByRole('textbox', { name: 'پلاک جدید: دو رقم سمت چپ', exact: true }).fill('12');
  await replacement.getByRole('combobox', { name: 'پلاک جدید: حرف', exact: true }).selectOption('ع');
  await replacement.getByRole('textbox', { name: 'پلاک جدید: سه رقم', exact: true }).fill('345');
  await expect(replacement.getByRole('button', { name: 'ثبت پلاک', exact: true })).toBeDisabled();
  await replacement.getByRole('textbox', { name: 'پلاک جدید: کد ایران', exact: true }).fill('11');
  await replacement.getByRole('button', { name: 'ثبت پلاک', exact: true }).click();
  await expect.poll(() => plateBody?.plate).toBe('12 ع 345 ایران 11');
});

test('real company-vehicle API validates new entries and preserves separate model and plate history', async ({ page }) => {
  await loginAsAdmin(page);
  const fleetCode = `QA-PLATE-${Date.now()}`;
  const digits = String(Date.now()).slice(-7);
  const plate = `${digits.slice(0, 2)} ب ${digits.slice(2, 5)} ایران ${digits.slice(5)}`;
  const base = '/api/dispatch-master-data/company-vehicles';
  const data = { fleetCode, vehicleType: 'سواری', manufactureYear: year(), model: 'مدل قبلی برای آزمون', plate };
  for (const invalid of [{ manufactureYear: null }, { manufactureYear: year() + 1 }, { plate: '12 ر 345 11' }, { plate: '12 ب 34 11' }]) {
    const response = await page.request.post(base, { data: { ...data, ...invalid } });
    expect(response.status()).toBe(400);
  }
  let id: string | undefined;
  try {
    const response = await page.request.post(base, { data });
    expect(response.status()).toBe(201);
    const created = (await response.json()).data;
    id = created.id;
    expect(created.manufactureYear).toBe(year());
    expect(created.model).toBe(data.model);
    const change = await page.request.post(`${base}/${id}/plates`, { data: { plate: plate.replace(' ب ', ' ع ') } });
    expect(change.status()).toBe(201);
    const list = await page.request.get(base);
    const vehicle = (await list.json()).data.find((item: any) => item.id === id);
    expect(vehicle.plates).toHaveLength(2);
    const oldPlate = vehicle.plates.find((item: any) => item.plate === plate);
    const newPlate = vehicle.plates.find((item: any) => item.plate !== plate);
    expect(new Date(oldPlate.effectiveTo).getTime()).toBeGreaterThan(new Date(oldPlate.effectiveFrom).getTime());
    expect(oldPlate.effectiveTo).toBe(newPlate.effectiveFrom);
    expect(vehicle.model).toBe(data.model);
  } finally {
    if (id) expect((await page.request.delete(`${base}/${id}`, { data: { reason: 'پاک‌سازی داده آزمون ایزوله' } })).status()).toBe(200);
  }
});
