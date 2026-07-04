import crypto from 'crypto';
import fs from 'fs';
import XLSX from 'xlsx';
import { Prisma, PrismaClient } from '@prisma/client';

export type CatalogKey =
  | 'products'
  | 'services'
  | 'cutting-types'
  | 'sub-services'
  | 'stair-lengths'
  | 'layer-types'
  | 'stone-finishings';

type RemovalAction = 'hardDelete' | 'deactivate';

interface ParsedRow {
  key: string;
  uploadedKey?: string;
  rowNumber: number;
  label: string;
  data: Record<string, any>;
  warnings?: string[];
}

export interface CatalogSyncPlan {
  importId: string;
  catalog: CatalogKey;
  sourceFormat: string;
  canApply: boolean;
  summary: {
    totalRows: number;
    creates: number;
    updates: number;
    removals: number;
    errors: number;
    warnings: number;
  };
  creates: Array<{ key: string; rowNumber: number; label: string; data: Record<string, any> }>;
  updates: Array<{ key: string; rowNumber: number; label: string; changes: Record<string, { from: any; to: any }> }>;
  removals: Array<{ key: string; label: string; action: RemovalAction; reason: string }>;
  errors: Array<{ row?: number; key?: string; error: string }>;
  warnings: Array<{ row?: number; key?: string; warning: string }>;
}

interface StoredPlan {
  expiresAt: number;
  plan: CatalogSyncPlan;
  parsedRows: ParsedRow[];
}

const plans = new Map<string, StoredPlan>();
const PLAN_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CURRENCY = 'تومان';

const normalizeDigits = (input: unknown): string => String(input ?? '')
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

const normalizeText = (input: unknown): string => normalizeDigits(input)
  .replace(/ي/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/\s+/g, ' ')
  .trim();

const text = (input: unknown): string => String(input ?? '').trim();
const codeText = (input: unknown): string => normalizeDigits(input).trim();

const numberFrom = (input: unknown, fallback = 0): number => {
  const normalized = normalizeDigits(input).replace(/,/g, '').trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : fallback;
};

const parseBoolean = (input: unknown, fallback = true): boolean => {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'boolean') return input;
  const value = normalizeText(input).toLowerCase();
  if (['true', '1', 'yes', 'y', 'بله', 'فعال', 'موجود'].includes(value)) return true;
  if (['false', '0', 'no', 'n', 'خیر', 'غيرفعال', 'غیرفعال', 'ناموجود'].includes(value)) return false;
  return fallback;
};

const toComparable = (value: any): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Prisma.Decimal) return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return normalizeText(value);
};

const decimal = (value: unknown) => new Prisma.Decimal(numberFrom(value, 0));

const compactNumber = (input: unknown): string => {
  const normalized = normalizeDigits(input).replace(/,/g, '').trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return '';
  return match[0].replace(/\.0+$/, '');
};

const widthLabel = (input: unknown): string => {
  const value = text(input);
  if (!value) return '';
  if (normalizeText(value).startsWith('ع')) return value;
  const numeric = compactNumber(value);
  return numeric ? `ع${numeric}` : value;
};

const thicknessLabel = (input: unknown): string => {
  const value = text(input);
  if (!value) return '';
  if (normalizeText(value).startsWith('ض')) return value;
  const numeric = compactNumber(value);
  return numeric ? `ض${numeric}` : value;
};

const buildCanonicalProductName = (data: Record<string, any>) => [
  data.cuttingDimensionNamePersian,
  data.stoneTypeNamePersian,
  widthLabel(data.widthName || data.widthValue),
  thicknessLabel(data.thicknessName || data.thicknessValue),
  data.mineNamePersian,
  data.finishNamePersian
].map(text).filter(Boolean).join(' ');

const productCodeComponents = [
  'cuttingDimensionCode',
  'stoneTypeCode',
  'widthCode',
  'thicknessCode',
  'mineCode',
  'finishCode',
  'colorCode'
];

const buildCanonicalProductCode = (data: Record<string, any>): string | null => {
  const parts = productCodeComponents.map((field) => codeText(data[field]));
  return parts.every(Boolean) ? parts.join('') : null;
};

const missingCanonicalNameFields = (data: Record<string, any>) => {
  const fields: Array<[string, unknown]> = [
    ['نوع برش', data.cuttingDimensionNamePersian],
    ['جنس سنگ', data.stoneTypeNamePersian],
    ['عرض', data.widthName || data.widthValue],
    ['ضخامت', data.thicknessName || data.thicknessValue],
    ['معدن', data.mineNamePersian],
    ['نوع پرداخت', data.finishNamePersian]
  ];
  return fields.filter(([, value]) => !text(value)).map(([label]) => label);
};

export const canonicalizeProductData = (data: Record<string, any>, rowNumber: number) => {
  const warnings: string[] = [];
  const uploadedCode = codeText(data.code);
  for (const field of productCodeComponents.concat(['qualityCode'])) {
    if (data[field] !== undefined) data[field] = codeText(data[field]);
  }

  const generatedName = buildCanonicalProductName(data);
  const missingNameFields = missingCanonicalNameFields(data);
  if (generatedName) {
    if (text(data.namePersian) && normalizeText(data.namePersian) !== normalizeText(generatedName)) {
      warnings.push(`نام محصول از روی اجزای محصول بازسازی شد: ${generatedName}`);
    }
    data.namePersian = generatedName;
    data.name = generatedName;
  }
  if (missingNameFields.length) {
    warnings.push(`اجزای نام محصول کامل نیستند: ${missingNameFields.join('، ')}`);
  }

  const generatedCode = buildCanonicalProductCode(data);
  if (generatedCode) {
    if (uploadedCode && uploadedCode !== generatedCode) {
      warnings.push(`کد محصول از روی اجزای کد اصلاح شد: ${uploadedCode} ← ${generatedCode}`);
    }
    data.code = generatedCode;
  } else {
    data.code = uploadedCode;
    const missingCodeFields = productCodeComponents
      .filter((field) => !codeText(data[field]))
      .join(', ');
    warnings.push(`اجزای کد محصول کامل نیستند: ${missingCodeFields}`);
  }

  return {
    data,
    key: data.code,
    uploadedKey: uploadedCode || undefined,
    label: data.namePersian || data.name || data.code || `ردیف ${rowNumber}`,
    warnings
  };
};

const worksheetRows = (workbook: XLSX.WorkBook, preferredSheet?: string): any[][] => {
  const sheetName = preferredSheet && workbook.Sheets[preferredSheet]
    ? preferredSheet
    : workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' }) as any[][];
};

const applyTextFormatToColumns = (worksheet: XLSX.WorkSheet, columnIndexes: number[]) => {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
  for (const columnIndex of columnIndexes) {
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cellValue = worksheet[address]?.v ?? '';
      worksheet[address] = {
        ...(worksheet[address] || {}),
        t: 's',
        v: String(cellValue),
        z: '@'
      };
    }
  }
};

const headerMap = (headers: any[]) => {
  const map = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = normalizeText(header);
    if (normalized) map.set(normalized, index);
  });
  return map;
};

const cell = (row: any[], headers: Map<string, number>, names: string[], fallbackIndex?: number) => {
  for (const name of names) {
    const index = headers.get(normalizeText(name));
    if (index !== undefined) return row[index];
  }
  return fallbackIndex !== undefined ? row[fallbackIndex] : '';
};

const productName = (data: Record<string, any>) => data.namePersian || [
  data.cuttingDimensionNamePersian,
  data.stoneTypeNamePersian,
  data.widthName,
  data.thicknessName,
  data.mineNamePersian,
  data.finishNamePersian,
  data.colorNamePersian
].filter(Boolean).join(' ');

const productVisibility = (cutTypeInput: unknown) => {
  const cutType = normalizeText(cutTypeInput);
  const isLongitudinal = cutType.includes('طولی') || cutType.includes('تایل');
  const isSlab = cutType.includes('اسلب');
  const isPrepared = cutType.includes('کیوبیک') || cutType.includes('قطعات آماده') || cutType.includes('حجمی');
  return {
    availableInLongitudinalContracts: isLongitudinal,
    availableInStairContracts: isLongitudinal,
    availableInSlabContracts: isSlab,
    availableInVolumetricContracts: isPrepared
  };
};

const parseProducts = (workbook: XLSX.WorkBook): { rows: ParsedRow[]; sourceFormat: string; errors: CatalogSyncPlan['errors'] } => {
  const sourceSheet = workbook.Sheets['کد سنگ'] ? 'کد سنگ' : workbook.SheetNames[0];
  const rows = worksheetRows(workbook, sourceSheet);
  const errors: CatalogSyncPlan['errors'] = [];
  if (rows.length < 2) return { rows: [], sourceFormat: 'unknown', errors: [{ error: 'فایل اکسل خالی است' }] };

  const headers = headerMap(rows[0]);
  const isOpc = sourceSheet === 'کد سنگ' || normalizeText(rows[0][0]).includes('نوع برش');
  const parsed: ParsedRow[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.every((value) => !text(value))) continue;
    const rowNumber = index + 1;
    const data = isOpc
      ? {
          code: codeText(row[15]),
          name: text(row[14]),
          namePersian: text(row[14]),
          cuttingDimensionName: text(row[0]),
          cuttingDimensionNamePersian: text(row[0]),
          cuttingDimensionCode: codeText(row[1]),
          stoneTypeName: text(row[2]),
          stoneTypeNamePersian: text(row[2]),
          stoneTypeCode: codeText(row[3]),
          widthName: text(row[4]),
          widthValue: numberFrom(row[4]),
          widthCode: codeText(row[5]),
          thicknessName: text(row[6]),
          thicknessValue: numberFrom(row[6]),
          thicknessCode: codeText(row[7]),
          mineName: text(row[8]),
          mineNamePersian: text(row[8]),
          mineCode: codeText(row[9]),
          finishName: text(row[10]),
          finishNamePersian: text(row[10]),
          finishCode: codeText(row[11]),
          colorName: text(row[12]) || 'بدون رنگ',
          colorNamePersian: text(row[12]) || 'بدون رنگ',
          colorCode: codeText(row[13]) || '00',
          qualityCode: '1',
          qualityName: 'Standard',
          qualityNamePersian: 'استاندارد',
          currency: DEFAULT_CURRENCY,
          isAvailable: true,
          isActive: true,
          leadTime: null,
          description: `کاتالوگ OPC - ردیف ${rowNumber}`,
          ...productVisibility(row[0])
        }
      : {
          code: codeText(cell(row, headers, ['کد محصول'])),
          name: text(cell(row, headers, ['نام محصول', 'نام محصول (انگلیسی)'])),
          namePersian: text(cell(row, headers, ['نام فارسی محصول', 'نام محصول (فارسی)', 'نام محصول'])),
          cuttingDimensionName: text(cell(row, headers, ['نوع برش'])),
          cuttingDimensionNamePersian: text(cell(row, headers, ['نوع برش'])),
          cuttingDimensionCode: codeText(cell(row, headers, ['کد نوع برش'])),
          stoneTypeName: text(cell(row, headers, ['جنس سنگ'])),
          stoneTypeNamePersian: text(cell(row, headers, ['جنس سنگ'])),
          stoneTypeCode: codeText(cell(row, headers, ['کد جنس سنگ'])),
          widthName: text(cell(row, headers, ['عرض', 'عرض / مشخصات'])),
          widthValue: numberFrom(cell(row, headers, ['مقدار عرض', 'عرض', 'عرض / مشخصات'])),
          widthCode: codeText(cell(row, headers, ['کد عرض'])),
          thicknessName: text(cell(row, headers, ['ضخامت'])),
          thicknessValue: numberFrom(cell(row, headers, ['مقدار ضخامت', 'ضخامت'])),
          thicknessCode: codeText(cell(row, headers, ['کد ضخامت'])),
          mineName: text(cell(row, headers, ['معدن'])),
          mineNamePersian: text(cell(row, headers, ['معدن'])),
          mineCode: codeText(cell(row, headers, ['کد معدن'])),
          finishName: text(cell(row, headers, ['نوع پرداخت'])),
          finishNamePersian: text(cell(row, headers, ['نوع پرداخت'])),
          finishCode: codeText(cell(row, headers, ['کد نوع پرداخت'])),
          colorName: text(cell(row, headers, ['رنگ'])) || 'بدون رنگ',
          colorNamePersian: text(cell(row, headers, ['رنگ'])) || 'بدون رنگ',
          colorCode: codeText(cell(row, headers, ['کد رنگ'])) || '00',
          qualityCode: codeText(cell(row, headers, ['کد کیفیت'])) || '1',
          qualityName: text(cell(row, headers, ['کیفیت'])) || 'Standard',
          qualityNamePersian: text(cell(row, headers, ['کیفیت'])) || 'استاندارد',
          basePrice: cell(row, headers, ['قیمت پایه']) === '' ? null : numberFrom(cell(row, headers, ['قیمت پایه'])),
          currency: text(cell(row, headers, ['ارز'])) || DEFAULT_CURRENCY,
          isAvailable: parseBoolean(cell(row, headers, ['موجود']), true),
          isActive: parseBoolean(cell(row, headers, ['فعال']), true),
          leadTime: cell(row, headers, ['زمان تحویل']) === '' ? null : numberFrom(cell(row, headers, ['زمان تحویل'])),
          description: text(cell(row, headers, ['توضیحات'])) || null,
          availableInLongitudinalContracts: parseBoolean(cell(row, headers, ['طولی']), true),
          availableInStairContracts: parseBoolean(cell(row, headers, ['پله']), true),
          availableInSlabContracts: parseBoolean(cell(row, headers, ['اسلب']), false),
          availableInVolumetricContracts: parseBoolean(cell(row, headers, ['حجمی']), false)
        };

    if (!data.namePersian) data.namePersian = productName(data);
    if (!data.name) data.name = data.namePersian;
    const canonical = canonicalizeProductData(data, rowNumber);
    const required = ['code'];
    const missing = required.filter((field) => !canonical.data[field]);
    if (missing.length) {
      errors.push({ row: rowNumber, error: `فیلدهای اجباری خالی هستند: ${missing.join(', ')}` });
      continue;
    }
    parsed.push({ key: canonical.key, uploadedKey: canonical.uploadedKey, rowNumber, label: canonical.label, data: canonical.data, warnings: canonical.warnings });
  }
  return { rows: parsed, sourceFormat: isOpc ? 'OPC کد سنگ' : 'ERP محصولات', errors };
};

const catalogSheets: Record<CatalogKey, string> = {
  products: 'محصولات',
  services: 'خدمات',
  'cutting-types': 'انواع ابزار',
  'sub-services': 'ابزارها',
  'stair-lengths': 'طول پله',
  'layer-types': 'نوع لایه',
  'stone-finishings': 'فرآوری سنگ'
};

const catalogTextColumnIndexes = (catalog: CatalogKey) => {
  if (catalog === 'products') return [0, 2, 4, 6, 8, 10, 12, 14, 16];
  if (catalog === 'stair-lengths') return [];
  return [0];
};

const parseSimpleCatalog = (catalog: CatalogKey, workbook: XLSX.WorkBook) => {
  const rows = worksheetRows(workbook);
  const errors: CatalogSyncPlan['errors'] = [];
  if (rows.length < 1) return { rows: [] as ParsedRow[], sourceFormat: catalogSheets[catalog], errors: [{ error: 'فایل اکسل خالی است' }] };
  const headers = headerMap(rows[0]);
  const parsed: ParsedRow[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.every((value) => !text(value))) continue;
    const rowNumber = index + 1;
    let data: Record<string, any>;
    let key: string;
    if (catalog === 'services') {
      data = { code: text(cell(row, headers, ['کد'])), namePersian: text(cell(row, headers, ['نام فارسی'])), name: text(cell(row, headers, ['نام انگلیسی/داخلی'])), description: text(cell(row, headers, ['توضیحات'])) || null, isActive: parseBoolean(cell(row, headers, ['فعال']), true) };
      key = data.code;
    } else if (catalog === 'cutting-types') {
      data = { code: text(cell(row, headers, ['کد'])), namePersian: text(cell(row, headers, ['نام فارسی'])), name: text(cell(row, headers, ['نام انگلیسی/داخلی'])), pricePerMeter: cell(row, headers, ['قیمت هر متر']) === '' ? null : decimal(cell(row, headers, ['قیمت هر متر'])), description: text(cell(row, headers, ['توضیحات'])) || null, isActive: parseBoolean(cell(row, headers, ['فعال']), true) };
      key = data.code;
    } else if (catalog === 'sub-services') {
      data = { code: text(cell(row, headers, ['کد'])), namePersian: text(cell(row, headers, ['نام فارسی'])), name: text(cell(row, headers, ['نام انگلیسی/داخلی'])), pricePerMeter: decimal(cell(row, headers, ['قیمت'])), calculationBase: normalizeText(cell(row, headers, ['مبنای محاسبه'])) === 'متر مربع' ? 'squareMeters' : text(cell(row, headers, ['مبنای محاسبه'])) || 'length', description: text(cell(row, headers, ['توضیحات'])) || null, isActive: parseBoolean(cell(row, headers, ['فعال']), true) };
      key = data.code;
    } else if (catalog === 'stair-lengths') {
      data = { value: decimal(cell(row, headers, ['مقدار'])), unit: text(cell(row, headers, ['واحد'])) || 'm', label: text(cell(row, headers, ['برچسب'])) || null, description: text(cell(row, headers, ['توضیحات'])) || null, isActive: parseBoolean(cell(row, headers, ['فعال']), true) };
      key = `${data.value.toString()}::${data.unit}`;
    } else if (catalog === 'layer-types') {
      data = { code: text(cell(row, headers, ['کد'])), name: text(cell(row, headers, ['نام'])), pricePerLayer: decimal(cell(row, headers, ['قیمت هر لایه'])), description: text(cell(row, headers, ['توضیحات'])) || null, isActive: parseBoolean(cell(row, headers, ['فعال']), true) };
      key = data.code;
    } else {
      data = { code: text(cell(row, headers, ['کد'])), namePersian: text(cell(row, headers, ['نام فارسی'])), name: text(cell(row, headers, ['نام انگلیسی/داخلی'])), unitPrice: decimal(cell(row, headers, ['قیمت واحد'])), pricePerSquareMeter: decimal(cell(row, headers, ['قیمت واحد'])), calculationBase: normalizeText(cell(row, headers, ['مبنای محاسبه'])) === 'متر طول' ? 'length' : text(cell(row, headers, ['مبنای محاسبه'])) || 'squareMeters', description: text(cell(row, headers, ['توضیحات'])) || null, isActive: parseBoolean(cell(row, headers, ['فعال']), true) };
      key = data.code;
    }
    if (!key) errors.push({ row: rowNumber, error: 'کلید پایدار رکورد خالی است' });
    else parsed.push({ key, rowNumber, label: data.namePersian || data.name || data.label || key, data });
  }
  return { rows: parsed, sourceFormat: catalogSheets[catalog], errors };
};

const prismaModel = (prisma: any, catalog: CatalogKey): any => ({
  services: prisma.service,
  'cutting-types': prisma.cuttingType,
  'sub-services': prisma.subService,
  'stair-lengths': prisma.stairStandardLength,
  'layer-types': prisma.layerType,
  'stone-finishings': prisma.stoneFinishing
}[catalog]);

const existingKey = (catalog: CatalogKey, item: any) => (
  catalog === 'stair-lengths' ? `${item.value.toString()}::${item.unit}` : item.code
);

const labelFor = (item: any) => item.namePersian || item.name || item.label || item.code || `${item.value} ${item.unit}`;

const compareData = (existing: any, data: Record<string, any>) => {
  const changes: Record<string, { from: any; to: any }> = {};
  for (const [field, value] of Object.entries(data)) {
    if (toComparable(existing[field]) !== toComparable(value)) {
      changes[field] = { from: existing[field], to: value };
    }
  }
  return changes;
};

const findDuplicateErrors = (rows: ParsedRow[]) => {
  const seen = new Map<string, ParsedRow>();
  const errors: CatalogSyncPlan['errors'] = [];
  for (const row of rows) {
    const normalizedKey = normalizeText(row.key);
    const previous = seen.get(normalizedKey);
    if (previous) {
      errors.push({ row: row.rowNumber, key: row.key, error: `کلید تکراری؛ قبلا در ردیف ${previous.rowNumber} آمده است` });
    } else {
      seen.set(normalizedKey, row);
    }
  }
  return errors;
};

const rememberPlan = (plan: CatalogSyncPlan, parsedRows: ParsedRow[]) => {
  plans.set(plan.importId, { expiresAt: Date.now() + PLAN_TTL_MS, plan, parsedRows });
};

const cleanupPlans = () => {
  const now = Date.now();
  for (const [id, stored] of plans.entries()) {
    if (stored.expiresAt < now) plans.delete(id);
  }
};

export const buildCatalogPlan = async (prisma: PrismaClient, catalog: CatalogKey, filePath: string): Promise<CatalogSyncPlan> => {
  cleanupPlans();
  const workbook = XLSX.readFile(filePath);
  const parsed = catalog === 'products' ? parseProducts(workbook) : parseSimpleCatalog(catalog, workbook);
  const duplicateErrors = findDuplicateErrors(parsed.rows);
  const errors = [...parsed.errors, ...duplicateErrors];
  const warnings: CatalogSyncPlan['warnings'] = parsed.rows.flatMap((row) =>
    (row.warnings || []).map((warning) => ({ row: row.rowNumber, key: row.key, warning }))
  );
  const importId = crypto.randomUUID();

  const creates: CatalogSyncPlan['creates'] = [];
  const updates: CatalogSyncPlan['updates'] = [];
  const removals: CatalogSyncPlan['removals'] = [];

  if (catalog === 'products') {
    const existing = await prisma.product.findMany({
      include: { _count: { select: { contractItems: true, deliveryProducts: true } } }
    });
    const existingMap = new Map(existing.map((item) => [normalizeText(item.code), item]));
    const incomingKeys = new Set(parsed.rows.map((row) => normalizeText(row.key)));
    for (const row of parsed.rows) {
      if (row.uploadedKey && normalizeText(row.uploadedKey) !== normalizeText(row.key)) {
        const uploadedProduct = existingMap.get(normalizeText(row.uploadedKey));
        const generatedProduct = existingMap.get(normalizeText(row.key));
        if (uploadedProduct && generatedProduct && uploadedProduct.id !== generatedProduct.id) {
          errors.push({
            row: row.rowNumber,
            key: row.key,
            error: `کد محصول بارگذاری‌شده (${row.uploadedKey}) و کد تولیدشده (${row.key}) به دو محصول متفاوت اشاره می‌کنند`
          });
          continue;
        }
      }
      const current = existingMap.get(normalizeText(row.key));
      if (!current) creates.push({ key: row.key, rowNumber: row.rowNumber, label: row.label, data: row.data });
      else {
        const changes = compareData(current, { ...row.data, deletedAt: null });
        if (Object.keys(changes).length) updates.push({ key: row.key, rowNumber: row.rowNumber, label: row.label, changes });
      }
    }
    for (const item of existing) {
      if (incomingKeys.has(normalizeText(item.code))) continue;
      const referenced = item._count.contractItems > 0 || item._count.deliveryProducts > 0;
      removals.push({
        key: item.code,
        label: item.namePersian,
        action: referenced ? 'deactivate' : 'hardDelete',
        reason: referenced ? 'در سوابق قرارداد/تحویل استفاده شده است' : 'در فایل اکسل وجود ندارد و سابقه مصرف ندارد'
      });
    }
  } else {
    const existing = await prismaModel(prisma, catalog).findMany();
    const existingMap: Map<string, any> = new Map(existing.map((item: any) => [normalizeText(existingKey(catalog, item)), item]));
    const incomingKeys = new Set(parsed.rows.map((row) => normalizeText(row.key)));
    for (const row of parsed.rows) {
      const current = existingMap.get(normalizeText(row.key));
      if (!current) creates.push({ key: row.key, rowNumber: row.rowNumber, label: row.label, data: row.data });
      else {
        const changes = compareData(current, row.data);
        if (Object.keys(changes).length) updates.push({ key: row.key, rowNumber: row.rowNumber, label: row.label, changes });
      }
    }
    for (const item of existing) {
      if (incomingKeys.has(normalizeText(existingKey(catalog, item)))) continue;
      removals.push({
        key: existingKey(catalog, item),
        label: labelFor(item),
        action: 'deactivate',
        reason: 'در فایل اکسل وجود ندارد؛ برای حفظ سوابق غیرفعال می‌شود'
      });
    }
  }

  const plan: CatalogSyncPlan = {
    importId,
    catalog,
    sourceFormat: parsed.sourceFormat,
    canApply: errors.length === 0,
    summary: {
      totalRows: parsed.rows.length,
      creates: creates.length,
      updates: updates.length,
      removals: removals.length,
      errors: errors.length,
      warnings: warnings.length
    },
    creates,
    updates,
    removals,
    errors,
    warnings
  };

  rememberPlan(plan, parsed.rows);
  try { fs.unlinkSync(filePath); } catch {}
  return plan;
};

export const applyCatalogPlan = async (prisma: PrismaClient, importId: string) => {
  cleanupPlans();
  const stored = plans.get(importId);
  if (!stored) throw new Error('پیش‌نمایش منقضی شده است. فایل را دوباره بارگذاری کنید');
  if (!stored.plan.canApply) throw new Error('تا زمانی که خطاهای اعتبارسنجی وجود دارد، اعمال import ممکن نیست');
  const { catalog, removals } = stored.plan;
  const rows = stored.parsedRows;

  if (catalog === 'products') {
    const existing = await prisma.product.findMany({ select: { code: true } });
    const existingKeys = new Set(existing.map((item) => normalizeText(item.code)));
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const data = { ...row.data, deletedAt: null };
        if (existingKeys.has(normalizeText(row.key))) {
          await tx.product.update({ where: { code: row.key }, data });
        } else {
          await tx.product.create({ data: { ...data, images: [] } as any });
        }
      }
      for (const removal of removals) {
        if (removal.action === 'hardDelete') await tx.product.delete({ where: { code: removal.key } });
        else await tx.product.update({
          where: { code: removal.key },
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
      }
    }, { timeout: 20000 });
  } else {
    const model = prismaModel(prisma, catalog);
    const existing = await model.findMany();
    const existingMap = new Map(existing.map((item: any) => [normalizeText(existingKey(catalog, item)), item]));
    await prisma.$transaction(async (tx) => {
      const txModel = prismaModel(tx, catalog);
      for (const row of rows) {
        const current = existingMap.get(normalizeText(row.key)) as any;
        if (current) await txModel.update({ where: { id: current.id }, data: row.data });
        else await txModel.create({ data: row.data });
      }
      for (const removal of removals) {
        const current = existingMap.get(normalizeText(removal.key)) as any;
        if (current) await txModel.update({ where: { id: current.id }, data: { isActive: false } });
      }
    }, { timeout: 20000 });
  }

  plans.delete(importId);
  return stored.plan;
};

export const buildTemplateWorkbook = (catalog: CatalogKey) => {
  const workbook = XLSX.utils.book_new();
  let headers: string[];
  let sample: any[];
  if (catalog === 'products') {
    headers = ['کد محصول', 'نام محصول', 'کد نوع برش', 'نوع برش', 'کد جنس سنگ', 'جنس سنگ', 'کد عرض', 'عرض', 'کد ضخامت', 'ضخامت', 'کد معدن', 'معدن', 'کد نوع پرداخت', 'نوع پرداخت', 'کد رنگ', 'رنگ', 'کد کیفیت', 'کیفیت', 'قیمت پایه', 'ارز', 'موجود', 'فعال', 'طولی', 'پله', 'اسلب', 'حجمی', 'زمان تحویل', 'توضیحات'];
    sample = ['1010810450100', 'طولی تراورتن ع40 ض2 ابرکوه صیقل', '1', 'طولی', '01', 'تراورتن', '08', 'ع40', '1', 'ض2', '045', 'ابرکوه', '01', 'صیقل', '00', 'بدون رنگ', '1', 'استاندارد', '', 'تومان', 'بله', 'فعال', 'بله', 'بله', 'خیر', 'خیر', '', ''];
  } else if (catalog === 'services') {
    headers = ['کد', 'نام فارسی', 'نام انگلیسی/داخلی', 'توضیحات', 'فعال'];
    sample = ['SVC-001', 'خدمت نمونه', '', '', 'فعال'];
  } else if (catalog === 'cutting-types') {
    headers = ['کد', 'نام فارسی', 'نام انگلیسی/داخلی', 'قیمت هر متر', 'توضیحات', 'فعال'];
    sample = ['CT-001', 'نوع ابزار نمونه', '', 100000, '', 'فعال'];
  } else if (catalog === 'sub-services') {
    headers = ['کد', 'نام فارسی', 'نام انگلیسی/داخلی', 'قیمت', 'مبنای محاسبه', 'توضیحات', 'فعال'];
    sample = ['TOOL-001', 'ابزار نمونه', '', 100000, 'length', '', 'فعال'];
  } else if (catalog === 'stair-lengths') {
    headers = ['مقدار', 'واحد', 'برچسب', 'توضیحات', 'فعال'];
    sample = [1.2, 'm', '۱.۲ متر', '', 'فعال'];
  } else if (catalog === 'layer-types') {
    headers = ['کد', 'نام', 'قیمت هر لایه', 'توضیحات', 'فعال'];
    sample = ['LT-001', 'لایه نمونه', 100000, '', 'فعال'];
  } else {
    headers = ['کد', 'نام فارسی', 'نام انگلیسی/داخلی', 'قیمت واحد', 'مبنای محاسبه', 'توضیحات', 'فعال'];
    sample = ['SF-001', 'فرآوری نمونه', '', 100000, 'squareMeters', '', 'فعال'];
  }
  const worksheet = XLSX.utils.aoa_to_sheet([headers, sample]);
  worksheet['!cols'] = headers.map(() => ({ wch: 22 }));
  applyTextFormatToColumns(
    worksheet,
    catalogTextColumnIndexes(catalog)
  );
  XLSX.utils.book_append_sheet(workbook, worksheet, catalogSheets[catalog]);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

export const buildExportWorkbook = async (prisma: PrismaClient, catalog: CatalogKey, productsWhere?: any) => {
  const workbook = XLSX.utils.book_new();
  let data: any[][] = [];
  if (catalog === 'products') {
    const products = await prisma.product.findMany({ where: productsWhere || { deletedAt: null }, orderBy: { createdAt: 'desc' } });
    data = [[...XLSX.utils.sheet_to_json(XLSX.read(buildTemplateWorkbook('products'), { type: 'buffer' }).Sheets['محصولات'], { header: 1 })[0] as any[]]];
    data.push(...products.map((item) => [item.code, item.namePersian, item.cuttingDimensionCode, item.cuttingDimensionNamePersian, item.stoneTypeCode, item.stoneTypeNamePersian, item.widthCode, item.widthName, item.thicknessCode, item.thicknessName, item.mineCode, item.mineNamePersian, item.finishCode, item.finishNamePersian, item.colorCode, item.colorNamePersian, item.qualityCode, item.qualityNamePersian, item.basePrice?.toString() || '', item.currency, item.isAvailable ? 'بله' : 'خیر', item.isActive ? 'فعال' : 'غیرفعال', item.availableInLongitudinalContracts ? 'بله' : 'خیر', item.availableInStairContracts ? 'بله' : 'خیر', item.availableInSlabContracts ? 'بله' : 'خیر', item.availableInVolumetricContracts ? 'بله' : 'خیر', item.leadTime || '', item.description || '']));
  } else {
    const items = await prismaModel(prisma, catalog).findMany({ orderBy: { createdAt: 'desc' } });
    const templateRows = XLSX.utils.sheet_to_json(XLSX.read(buildTemplateWorkbook(catalog), { type: 'buffer' }).Sheets[catalogSheets[catalog]], { header: 1 }) as any[][];
    data = [templateRows[0]];
    data.push(...items.map((item: any) => {
      if (catalog === 'services') return [item.code, item.namePersian, item.name || '', item.description || '', item.isActive ? 'فعال' : 'غیرفعال'];
      if (catalog === 'cutting-types') return [item.code, item.namePersian, item.name || '', item.pricePerMeter?.toString() || '', item.description || '', item.isActive ? 'فعال' : 'غیرفعال'];
      if (catalog === 'sub-services') return [item.code, item.namePersian, item.name || '', item.pricePerMeter?.toString() || '', item.calculationBase, item.description || '', item.isActive ? 'فعال' : 'غیرفعال'];
      if (catalog === 'stair-lengths') return [item.value?.toString() || '', item.unit, item.label || '', item.description || '', item.isActive ? 'فعال' : 'غیرفعال'];
      if (catalog === 'layer-types') return [item.code, item.name, item.pricePerLayer?.toString() || '', item.description || '', item.isActive ? 'فعال' : 'غیرفعال'];
      return [item.code, item.namePersian, item.name || '', (item.unitPrice || item.pricePerSquareMeter)?.toString() || '', item.calculationBase, item.description || '', item.isActive ? 'فعال' : 'غیرفعال'];
    }));
  }
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  worksheet['!cols'] = (data[0] || []).map(() => ({ wch: 22 }));
  applyTextFormatToColumns(
    worksheet,
    catalogTextColumnIndexes(catalog)
  );
  XLSX.utils.book_append_sheet(workbook, worksheet, catalogSheets[catalog]);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};
