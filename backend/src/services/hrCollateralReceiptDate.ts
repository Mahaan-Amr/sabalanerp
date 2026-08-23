import { tehranCivilDateKey } from './tehranBusinessCalendar';

export const parseCollateralReceiptDate = (value: unknown, now = new Date()) => {
  const isoDate = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error('COLLATERAL_RECEIPT_DATE_ISO_REQUIRED');
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== isoDate) throw new Error('COLLATERAL_RECEIPT_DATE_INVALID');
  if (isoDate > tehranCivilDateKey(now)) throw new Error('COLLATERAL_RECEIPT_DATE_FUTURE');
  return parsed;
};
