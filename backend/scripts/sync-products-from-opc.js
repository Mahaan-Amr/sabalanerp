const XLSX = require('xlsx');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_EXCEL_PATH = path.join(__dirname, '../../excel/opc code.xls');
const DEFAULT_SHEET_NAME = 'کد سنگ';
const DEFAULT_COLOR_CODE = '00';
const DEFAULT_COLOR_NAME = 'بدون رنگ';
const DEFAULT_QUALITY_CODE = '1';
const DEFAULT_QUALITY_NAME = 'Standard';
const DEFAULT_QUALITY_NAME_PERSIAN = 'استاندارد';
const DEFAULT_CURRENCY = 'تومان';

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const keepUnusedProducts = args.has('--keep-unused-products');

function textCell(row, index) {
  const value = row[index];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeDigits(input) {
  return String(input || '')
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}

function parseNumberFromText(input) {
  const normalized = normalizeDigits(input);
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function productName(product) {
  return product.name || [
    product.cutType,
    product.material,
    product.width,
    product.thickness,
    product.mine,
    product.finish,
    product.color
  ].filter(Boolean).join(' ');
}

function parseProducts(workbook) {
  const sheetName = process.env.OPC_PRODUCTS_SHEET || DEFAULT_SHEET_NAME;
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });
  const byCode = new Map();
  const duplicateRows = [];
  const skippedRows = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.every((cell) => !String(cell || '').trim())) continue;

    const product = {
      rowNumber: index + 1,
      cutType: textCell(row, 0),
      cutTypeCode: textCell(row, 1),
      material: textCell(row, 2),
      materialCode: textCell(row, 3),
      width: textCell(row, 4),
      widthCode: textCell(row, 5),
      thickness: textCell(row, 6),
      thicknessCode: textCell(row, 7),
      mine: textCell(row, 8),
      mineCode: textCell(row, 9),
      finish: textCell(row, 10),
      finishCode: textCell(row, 11),
      color: textCell(row, 12) || DEFAULT_COLOR_NAME,
      colorCode: textCell(row, 13) || DEFAULT_COLOR_CODE,
      name: textCell(row, 14),
      code: textCell(row, 15)
    };

    const missing = [
      ['product code', product.code],
      ['cut type code', product.cutTypeCode],
      ['stone material code', product.materialCode],
      ['width code', product.widthCode],
      ['thickness code', product.thicknessCode],
      ['mine code', product.mineCode],
      ['finish code', product.finishCode]
    ].filter(([, value]) => !value).map(([label]) => label);

    if (missing.length > 0) {
      skippedRows.push({ row: product.rowNumber, code: product.code || null, missing });
      continue;
    }

    if (byCode.has(product.code)) {
      duplicateRows.push({
        code: product.code,
        keptRow: product.rowNumber,
        replacedRow: byCode.get(product.code).rowNumber
      });
    }
    byCode.set(product.code, product);
  }

  return {
    products: Array.from(byCode.values()),
    duplicateRows,
    skippedRows,
    totalDataRows: rows.length > 0 ? rows.length - 1 : 0
  };
}

function collectReferenceItems(products, keyCode, keyName, extra = () => ({})) {
  const items = new Map();
  for (const product of products) {
    const code = product[keyCode];
    if (!code) continue;
    const name = product[keyName] || code;
    items.set(code, {
      code,
      name,
      namePersian: name,
      isActive: true,
      ...extra(product)
    });
  }
  return Array.from(items.values());
}

async function upsertReferences(model, items) {
  let created = 0;
  let updated = 0;

  for (const item of items) {
    const existing = await model.findUnique({ where: { code: item.code } });
    if (existing) {
      await model.update({ where: { code: item.code }, data: item });
      updated += 1;
    } else {
      await model.create({ data: item });
      created += 1;
    }
  }

  return { total: items.length, created, updated };
}

function buildProductData(product) {
  const name = productName(product);

  return {
    code: product.code,
    name,
    namePersian: name,
    cuttingDimensionCode: product.cutTypeCode,
    cuttingDimensionName: product.cutType,
    cuttingDimensionNamePersian: product.cutType,
    stoneTypeCode: product.materialCode,
    stoneTypeName: product.material,
    stoneTypeNamePersian: product.material,
    widthCode: product.widthCode,
    widthValue: parseNumberFromText(product.width),
    widthName: product.width || product.widthCode,
    thicknessCode: product.thicknessCode,
    thicknessValue: parseNumberFromText(product.thickness),
    thicknessName: product.thickness || product.thicknessCode,
    mineCode: product.mineCode,
    mineName: product.mine || product.mineCode,
    mineNamePersian: product.mine || product.mineCode,
    finishCode: product.finishCode,
    finishName: product.finish,
    finishNamePersian: product.finish,
    colorCode: product.colorCode,
    colorName: product.color || DEFAULT_COLOR_NAME,
    colorNamePersian: product.color || DEFAULT_COLOR_NAME,
    qualityCode: DEFAULT_QUALITY_CODE,
    qualityName: DEFAULT_QUALITY_NAME,
    qualityNamePersian: DEFAULT_QUALITY_NAME_PERSIAN,
    basePrice: null,
    currency: DEFAULT_CURRENCY,
    isAvailable: true,
    leadTime: null,
    description: `کاتالوگ OPC - ردیف ${product.rowNumber}`,
    images: [],
    isActive: true,
    availableInLongitudinalContracts: true,
    availableInStairContracts: true,
    availableInSlabContracts: true,
    availableInVolumetricContracts: true,
    deletedAt: null
  };
}

async function syncProducts(products) {
  const newCodes = new Set(products.map((product) => product.code));
  const existingProducts = await prisma.product.findMany({
    select: {
      id: true,
      code: true,
      _count: {
        select: {
          contractItems: true,
          deliveryProducts: true
        }
      }
    }
  });

  let created = 0;
  let updated = 0;
  let hardDeleted = 0;
  let softDeleted = 0;

  for (const product of products) {
    const data = buildProductData(product);
    const existing = existingProducts.find((item) => item.code === product.code);

    if (existing) {
      await prisma.product.update({ where: { code: product.code }, data });
      updated += 1;
    } else {
      await prisma.product.create({ data });
      created += 1;
    }
  }

  if (!keepUnusedProducts) {
    for (const product of existingProducts) {
      if (newCodes.has(product.code)) continue;

      const isReferenced = product._count.contractItems > 0 || product._count.deliveryProducts > 0;
      if (isReferenced) {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            isActive: false,
            isAvailable: false,
            availableInLongitudinalContracts: false,
            availableInStairContracts: false,
            availableInSlabContracts: false,
            availableInVolumetricContracts: false,
            deletedAt: new Date()
          }
        });
        softDeleted += 1;
      } else {
        await prisma.product.delete({ where: { id: product.id } });
        hardDeleted += 1;
      }
    }
  }

  return { created, updated, hardDeleted, softDeleted, keptUnused: keepUnusedProducts };
}

async function run() {
  const excelPath = process.env.OPC_PRODUCTS_PATH || DEFAULT_EXCEL_PATH;
  console.log(`Reading OPC workbook: ${excelPath}`);
  console.log(`Mode: ${applyChanges ? 'APPLY' : 'DRY RUN'}`);

  const workbook = XLSX.readFile(excelPath);
  const parsed = parseProducts(workbook);

  console.log(`Rows scanned: ${parsed.totalDataRows}`);
  console.log(`Valid unique product codes: ${parsed.products.length}`);
  console.log(`Skipped rows with missing required codes: ${parsed.skippedRows.length}`);
  console.log(`Duplicate valid rows replaced by later rows: ${parsed.duplicateRows.length}`);

  if (parsed.skippedRows.length > 0) {
    console.log('Skipped row sample:', parsed.skippedRows.slice(0, 10));
  }
  if (parsed.duplicateRows.length > 0) {
    console.log('Duplicate row sample:', parsed.duplicateRows.slice(0, 10));
  }

  if (!applyChanges) {
    console.log('\nDry run only. Re-run with --apply to write master data and replace the active product catalog.');
    return;
  }

  const referenceResults = {};
  referenceResults.cutTypes = await upsertReferences(
    prisma.cutType,
    collectReferenceItems(parsed.products, 'cutTypeCode', 'cutType')
  );
  referenceResults.stoneMaterials = await upsertReferences(
    prisma.stoneMaterial,
    collectReferenceItems(parsed.products, 'materialCode', 'material')
  );
  referenceResults.widths = await upsertReferences(
    prisma.cutWidth,
    collectReferenceItems(parsed.products, 'widthCode', 'width', (product) => ({
      value: parseNumberFromText(product.width),
      unit: 'cm'
    }))
  );
  referenceResults.thicknesses = await upsertReferences(
    prisma.thickness,
    collectReferenceItems(parsed.products, 'thicknessCode', 'thickness', (product) => ({
      value: parseNumberFromText(product.thickness),
      unit: 'cm'
    }))
  );
  referenceResults.mines = await upsertReferences(
    prisma.mine,
    collectReferenceItems(parsed.products, 'mineCode', 'mine')
  );
  referenceResults.finishTypes = await upsertReferences(
    prisma.finishType,
    collectReferenceItems(parsed.products, 'finishCode', 'finish')
  );
  referenceResults.colors = await upsertReferences(
    prisma.color,
    collectReferenceItems(parsed.products, 'colorCode', 'color')
  );

  const productResults = await syncProducts(parsed.products);

  console.log('\nMaster data sync summary:');
  for (const [name, result] of Object.entries(referenceResults)) {
    console.log(`${name}: total=${result.total}, created=${result.created}, updated=${result.updated}`);
  }

  console.log('\nProduct catalog replacement summary:');
  console.log(`created=${productResults.created}`);
  console.log(`updated/reactivated=${productResults.updated}`);
  console.log(`hardDeletedUnused=${productResults.hardDeleted}`);
  console.log(`softDeletedReferenced=${productResults.softDeleted}`);
  console.log(`keptUnusedProducts=${productResults.keptUnused}`);
}

run()
  .catch((error) => {
    console.error('OPC product sync failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
