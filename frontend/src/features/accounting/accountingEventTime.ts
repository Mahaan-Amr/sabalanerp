import moment from 'moment-jalaali';
import type { AccountingActionField } from './AccountingActionModal';

const ascii = (value: string) => value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
const invalid = () => new Error('تاریخ و زمان رخداد را به وقت تهران وارد کنید؛ زمان مبهم یا نامعتبر قابل ثبت نیست.');
const civil = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const civilFields = (instant: number) => Object.fromEntries(civil.formatToParts(new Date(instant))
  .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
const localEpoch = (instant: number) => {
  const p = civilFields(instant);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
};

/** Omitted instant means a current event, stamped by the authoritative server.
 * Historical entry is explicit Tehran date AND time. Never use browser-local
 * midnight, guess a historical offset, or choose an ambiguous DST occurrence. */
export function accountingEventInstant(input: { timing?: string | number; date?: string | number; time?: string | number }): string | undefined {
  if (input.timing === 'NOW') return undefined;
  if (input.timing !== 'HISTORICAL') throw invalid();
  const date = ascii(String(input.date || '')), time = ascii(String(input.time || ''));
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) throw invalid();
  const day = moment.utc(date, 'jYYYY/jMM/jDD', true).locale('en');
  if (!day.isValid() || day.format('jYYYY/jMM/jDD') !== date) throw invalid();
  const gregorian = day.format('YYYY-MM-DD');
  const rough = Date.parse(`${gregorian}T${time}.000Z`);
  const offsets = new Set([-86_400_000, 0, 86_400_000].map(delta => localEpoch(rough + delta) - (rough + delta)));
  const candidates = Array.from(offsets).map(offset => rough - offset).filter(instant => localEpoch(instant) === rough);
  if (candidates.length !== 1) throw invalid();
  return new Date(candidates[0]).toISOString();
}

export const partnerAccountingTimeFields: AccountingActionField[] = [
  { id: 'timing', label: 'زمان رخداد', type: 'select', required: true, defaultValue: 'NOW', options: [
    { value: 'NOW', label: 'هم‌اکنون' }, { value: 'HISTORICAL', label: 'تاریخ و ساعت مشخص' },
  ] },
  { id: 'eventDate', label: 'تاریخ رخداد به وقت تهران', type: 'date', required: true, visibleWhen: { fieldId: 'timing', equals: 'HISTORICAL' } },
  { id: 'eventTime', label: 'ساعت رخداد به وقت تهران', type: 'text', placeholder: 'HH:mm:ss', required: true,
    visibleWhen: { fieldId: 'timing', equals: 'HISTORICAL' } },
];
