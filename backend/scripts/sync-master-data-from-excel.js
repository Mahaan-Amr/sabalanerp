const XLSX = require('xlsx');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function normalizeDigits(input) {
  if (!input) return '';
  const value = String(input);
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  return value
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
}

function parseNumberFromText(input) {
  const normalized = normalizeDigits(input);
  const match = normalized.match(/(\d+(\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]);
}

function textCell(row, index) {
  const value = row[index];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

async function upsertByCode(items, findFn, createFn, updateFn) {
  let created = 0;
  let updated = 0;

  for (const item of items) {
    const existing = await findFn(item.code);
    if (existing) {
      await updateFn(item);
      updated += 1;
    } else {
      await createFn(item);
      created += 1;
    }
  }

  return { created, updated, total: items.length };
}

async function run() {
  const excelPath = process.env.EXCEL_PATH || path.join(__dirname, '../../excel/kala-kod.xls');
  const sheetName = process.env.EXCEL_SHEET || 'Sheet2';

  console.log(`Reading Excel: ${excelPath}`);
  const workbook = XLSX.readFile(excelPath);
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found in ${excelPath}`);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  console.log(`Rows in ${sheetName}: ${rows.length}`);

  const cutTypes = new Map();
  const stoneMaterials = new Map();
  const widths = new Map();
  const thicknesses = new Map();
  const mines = new Map();
  const finishTypes = new Map();
  const colors = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const cutType = textCell(row, 0);
    const cutTypeCode = textCell(row, 1);
    const stoneMaterial = textCell(row, 2);
    const stoneMaterialCode = textCell(row, 3);
    const width = textCell(row, 4);
    const widthCode = textCell(row, 5);
    const thickness = textCell(row, 6);
    const thicknessCode = textCell(row, 7);
    const mine = textCell(row, 8);
    const mineCode = textCell(row, 9);
    const finishType = textCell(row, 10);
    const finishCode = textCell(row, 11);
    const color = textCell(row, 12);
    const colorCode = textCell(row, 13);

    if (cutTypeCode && cutType) cutTypes.set(cutTypeCode, cutType);
    if (stoneMaterialCode && stoneMaterial) stoneMaterials.set(stoneMaterialCode, stoneMaterial);
    if (widthCode && width) widths.set(widthCode, width);
    if (thicknessCode && thickness) thicknesses.set(thicknessCode, thickness);
    if (mineCode && mine) mines.set(mineCode, mine);
    if (finishCode && finishType) finishTypes.set(finishCode, finishType);
    if (colorCode && color) colors.set(colorCode, color);
  }

  const cutTypeItems = Array.from(cutTypes.entries()).map(([code, name]) => ({
    code,
    name,
    namePersian: name,
    isActive: true,
  }));
  const stoneMaterialItems = Array.from(stoneMaterials.entries()).map(([code, name]) => ({
    code,
    name,
    namePersian: name,
    isActive: true,
  }));
  const widthItems = Array.from(widths.entries()).map(([code, name]) => ({
    code,
    name,
    namePersian: name,
    value: parseNumberFromText(name),
    isActive: true,
  }));
  const thicknessItems = Array.from(thicknesses.entries()).map(([code, name]) => ({
    code,
    name,
    namePersian: name,
    value: parseNumberFromText(name),
    isActive: true,
  }));
  const mineItems = Array.from(mines.entries()).map(([code, name]) => ({
    code,
    name,
    namePersian: name,
    isActive: true,
  }));
  const finishTypeItems = Array.from(finishTypes.entries()).map(([code, name]) => ({
    code,
    name,
    namePersian: name,
    isActive: true,
  }));
  const colorItems = Array.from(colors.entries()).map(([code, name]) => ({
    code,
    name,
    namePersian: name,
    isActive: true,
  }));

  console.log('Syncing master data from Excel...');

  const results = {};

  results.cutTypes = await upsertByCode(
    cutTypeItems,
    (code) => prisma.cutType.findUnique({ where: { code } }),
    (data) => prisma.cutType.create({ data }),
    (data) => prisma.cutType.update({ where: { code: data.code }, data })
  );

  results.stoneMaterials = await upsertByCode(
    stoneMaterialItems,
    (code) => prisma.stoneMaterial.findUnique({ where: { code } }),
    (data) => prisma.stoneMaterial.create({ data }),
    (data) => prisma.stoneMaterial.update({ where: { code: data.code }, data })
  );

  results.widths = await upsertByCode(
    widthItems,
    (code) => prisma.cutWidth.findUnique({ where: { code } }),
    (data) => prisma.cutWidth.create({ data }),
    (data) => prisma.cutWidth.update({ where: { code: data.code }, data })
  );

  results.thicknesses = await upsertByCode(
    thicknessItems,
    (code) => prisma.thickness.findUnique({ where: { code } }),
    (data) => prisma.thickness.create({ data }),
    (data) => prisma.thickness.update({ where: { code: data.code }, data })
  );

  results.mines = await upsertByCode(
    mineItems,
    (code) => prisma.mine.findUnique({ where: { code } }),
    (data) => prisma.mine.create({ data }),
    (data) => prisma.mine.update({ where: { code: data.code }, data })
  );

  results.finishTypes = await upsertByCode(
    finishTypeItems,
    (code) => prisma.finishType.findUnique({ where: { code } }),
    (data) => prisma.finishType.create({ data }),
    (data) => prisma.finishType.update({ where: { code: data.code }, data })
  );

  results.colors = await upsertByCode(
    colorItems,
    (code) => prisma.color.findUnique({ where: { code } }),
    (data) => prisma.color.create({ data }),
    (data) => prisma.color.update({ where: { code: data.code }, data })
  );

  console.log('\nMaster data sync summary:');
  console.log(`CutTypes: total=${results.cutTypes.total}, created=${results.cutTypes.created}, updated=${results.cutTypes.updated}`);
  console.log(`StoneMaterials: total=${results.stoneMaterials.total}, created=${results.stoneMaterials.created}, updated=${results.stoneMaterials.updated}`);
  console.log(`Widths: total=${results.widths.total}, created=${results.widths.created}, updated=${results.widths.updated}`);
  console.log(`Thicknesses: total=${results.thicknesses.total}, created=${results.thicknesses.created}, updated=${results.thicknesses.updated}`);
  console.log(`Mines: total=${results.mines.total}, created=${results.mines.created}, updated=${results.mines.updated}`);
  console.log(`FinishTypes: total=${results.finishTypes.total}, created=${results.finishTypes.created}, updated=${results.finishTypes.updated}`);
  console.log(`Colors: total=${results.colors.total}, created=${results.colors.created}, updated=${results.colors.updated}`);
}

run()
  .catch((err) => {
    console.error('Master data sync failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
