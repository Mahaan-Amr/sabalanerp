type Amounts = Record<string, string | number | null | undefined>;
type DatasetRow = { key: string; titlePersian: string; accountCode?: string; amounts: Amounts };
type FrozenDataset = {
  parameters?: { from?: string | Date; to?: string | Date };
  columnKeys?: string[];
  rows?: DatasetRow[];
  comparative?: { from?: string | Date; to?: string | Date; rows?: DatasetRow[] };
};

const amountColumnFa: Record<string, string> = {
  openingDebit: 'مانده بدهکار اول دوره', openingCredit: 'مانده بستانکار اول دوره',
  turnoverDebit: 'گردش بدهکار', turnoverCredit: 'گردش بستانکار',
  endingDebit: 'مانده بدهکار پایان دوره', endingCredit: 'مانده بستانکار پایان دوره',
  periodNetDebit: 'خالص بدهکار دوره', periodNetCredit: 'خالص بستانکار دوره',
};

const persianDate = (value: string | Date | undefined): string => {
  const day = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);
  const date = new Date(`${day}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? 'نامشخص' : date.toLocaleDateString('fa-IR-u-ca-persian', { timeZone: 'UTC' });
};

export const officialReportPeriodLabels = (dataset: FrozenDataset) => ({
  current: `از ${persianDate(dataset.parameters?.from)} تا ${persianDate(dataset.parameters?.to)}`,
  comparative: dataset.comparative ? `از ${persianDate(dataset.comparative.from)} تا ${persianDate(dataset.comparative.to)}` : undefined,
});

export const buildOfficialReportExportRows = (dataset: FrozenDataset): Array<Record<string, string>> => {
  const columnKeys = Array.isArray(dataset.columnKeys) ? dataset.columnKeys : Object.keys(amountColumnFa);
  const currentRows = Array.isArray(dataset.rows) ? dataset.rows : [];
  const comparativeRows = Array.isArray(dataset.comparative?.rows) ? dataset.comparative.rows : [];
  const currentByKey = new Map(currentRows.map((row) => [row.key, row]));
  const comparativeByKey = new Map(comparativeRows.map((row) => [row.key, row]));
  const keys = [...new Set([...currentByKey.keys(), ...comparativeByKey.keys()])];
  return keys.map((key) => {
    const current = currentByKey.get(key);
    const comparative = comparativeByKey.get(key);
    const output: Record<string, string> = { 'کد حساب': current?.accountCode ?? comparative?.accountCode ?? '', 'عنوان': current?.titlePersian ?? comparative?.titlePersian ?? key };
    for (const column of columnKeys) output[amountColumnFa[column] ?? column] = String(current?.amounts?.[column] ?? '');
    if (dataset.comparative) {
      for (const column of columnKeys) output[`${amountColumnFa[column] ?? column} مقایسه‌ای`] = String(comparative?.amounts?.[column] ?? '');
    }
    return output;
  });
};
