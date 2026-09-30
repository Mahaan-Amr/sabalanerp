import moment from 'moment-jalaali';

export type CalendarValueFormat = 'jalali' | 'gregorian';

// The picker always works in Jalali; date-only persistence may use Gregorian ISO.
export function calendarDisplayDate(value: string, format: CalendarValueFormat): string {
  if (!value || format === 'jalali') return value;
  const date = moment(value, 'YYYY-MM-DD', true);
  return date.isValid() ? date.locale('en').format('jYYYY/jMM/jDD') : '';
}

export function calendarStoredDate(value: string, format: CalendarValueFormat): string {
  if (!value || format === 'jalali') return value;
  const date = moment(value, 'jYYYY/jMM/jDD', true);
  return date.isValid() ? date.locale('en').format('YYYY-MM-DD') : '';
}
