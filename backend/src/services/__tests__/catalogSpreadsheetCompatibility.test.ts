import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import { buildCatalogPlan, buildExportWorkbook, buildTemplateWorkbook } from '../catalogExcelSync';

test('catalog spreadsheet export uses the maintained SheetJS build and preserves text product codes', () => {
  assert.equal(XLSX.version, '0.20.3');

  const workbook = XLSX.read(buildTemplateWorkbook('products'), { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['محصولات']);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['محصولات'], {
    header: 1,
    raw: false,
    defval: '',
  });
  const codeColumn = rows[0].indexOf('کد محصول');
  assert.notEqual(codeColumn, -1);
  assert.equal(rows[1][codeColumn], '1010810450100');
  assert.equal(workbook.Sheets['محصولات'].A2.t, 's');
  assert.equal(XLSX.utils.decode_range(workbook.Sheets['محصولات']['!ref']!).e.r, 4999);
});

test('maintained SheetJS build supports the production catalog import and export seams', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-xlsx-'));
  const uploadPath = path.join(directory, 'products.xlsx');
  fs.writeFileSync(uploadPath, buildTemplateWorkbook('products'));

  const product = {
    code: '0010810450100',
    namePersian: 'طولی تراورتن ع40 ض2 ابرکوه صیقل',
    currency: 'تومان',
    isAvailable: true,
    isActive: true,
    availableInLongitudinalContracts: true,
    availableInStairContracts: true,
    availableInSlabContracts: false,
    availableInVolumetricContracts: false,
  };
  const prisma = {
    product: {
      findMany: async (args: Record<string, unknown>) => args.include ? [] : [product],
    },
  } as unknown as PrismaClient;

  try {
    const plan = await buildCatalogPlan(prisma, 'products', uploadPath);
    assert.equal(plan.canApply, true);
    assert.equal(plan.summary.creates, 1);
    assert.equal(plan.creates[0].key, '1010810450100');
    assert.equal(fs.existsSync(uploadPath), false);

    const exported = XLSX.read(await buildExportWorkbook(prisma, 'products'), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(exported.Sheets['محصولات'], {
      header: 1,
      raw: false,
      defval: '',
    });
    assert.equal(rows[1][0], '0010810450100');
    assert.equal(exported.Sheets['محصولات'].A2.t, 's');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
