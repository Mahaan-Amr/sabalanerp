import moment from 'moment-jalaali';

export type PersianDateFieldValueFormat = 'persian' | 'iso-date' | 'local-datetime';
export const toPersianDateFieldValue = (value: string, format: PersianDateFieldValueFormat) => {
  if (!value || format === 'persian') return value;
  const parsed = moment(value, format === 'iso-date' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm', true).locale('en');
  return parsed.isValid() ? parsed.format(format === 'iso-date' ? 'jYYYY/jMM/jDD' : 'jYYYY/jMM/jDD HH:mm') : '';
};
export const fromPersianDateFieldValue = (value: string, format: PersianDateFieldValueFormat) => {
  if (!value || format === 'persian') return value;
  const parsed = moment(value, format === 'iso-date' ? 'jYYYY/jMM/jDD' : 'jYYYY/jMM/jDD HH:mm', true).locale('en');
  return parsed.isValid() ? parsed.format(format === 'iso-date' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm') : '';
};
